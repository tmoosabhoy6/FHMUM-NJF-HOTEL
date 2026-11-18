/**
 * The pull: everything the planner needs from NKERP for one date range.
 *
 *   1. Sign in.
 *   2. Tours: General search → Groups for the office. Every tour with its
 *      status, ports, flights and sub-venue plans. Only approved tours with a
 *      Najaf stay in the range go on.
 *   3. Guests: each of those tours' guest lists, person by person. A guest
 *      marked "accommodation not required" needs a bed from us, whether or
 *      not the rest of the tour is housed by NKERP.
 *   4. Stays: one per Najaf stay with at least one such guest.
 *
 * Every call is a read (see client.mjs). Progress is reported through `emit`
 * so the loading screen can show it live: a window lights for each day once
 * every tour arriving by that day has been counted.
 */
import { addDays, countGuests, countsFromTour, daysBetween, isApprovedTour, isLiveTour, pendingTour, reapprovalRow, sameOffice, staysFromGroupRow, withGuests } from './normalize.mjs';

export const DEFAULT_OFFICE = 'Fayz E Husayni Trust Mumbai';
const LOOKBACK_DAYS = 45; // a tour that started this long before the range can still be in Najaf
const MAX_DAYS = 150;
const PAGE = 200;
const POOL = 4;

async function readTours(client, { office, arrivalFrom, arrivalTo, signal, onPage }) {
  const rows = [];
  let seen = 0;
  for (let page = 1; page <= 60; page += 1) {
    const data = await client.read(
      'api/tours/GeneralSearchGroups',
      {
        reverse: false,
        sortBy: 'StartDateTimeZone',
        itemsPerPage: PAGE,
        maxSize: 10,
        currentPage: page,
        clientTimeZoneOffset: -180,
        IsPaging: true,
        OfficeName: office,
        ArrivalFromSearch: arrivalFrom,
        ArrivalToSearch: arrivalTo,
      },
      { signal },
    );
    const chunk = data?.lstGeneralGroupsSearch ?? [];
    seen += chunk.length;
    rows.push(...chunk.filter((row) => sameOffice(row?.OfficeName, office)));
    onPage(rows.length);
    const total = Number(data?.TotalRows) || seen;
    if (!chunk.length || seen >= total) break;
  }
  return rows;
}

async function readGuests(client, tourId, signal) {
  const path = `api/tours/getApplicants/${Number(tourId)}`;
  try {
    return (await client.read(path, undefined, { signal }))?.Applicants ?? [];
  } catch (error) {
    if (signal?.aborted) throw error;
    // One more try: NKERP drops the odd request under load.
    return (await client.read(path, undefined, { signal }))?.Applicants ?? [];
  }
}

/** Runs `worker` over `items` with a small pool so NKERP is not flooded. */
async function pool(items, size, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

export async function runSync({ client, from, to: toInput = null, office = DEFAULT_OFFICE, emit = () => {}, signal }) {
  const to = toInput || null;
  const started = Date.now();
  const step = (id, status, detail) => emit('step', { id, status, detail });
  const inRange = (stay) => stay.checkOut >= from && (!to || stay.checkIn <= to);

  step('signin', 'active', 'Signing in to NKERP');
  await client.login({ signal });
  step('signin', 'done', 'Signed in');

  // ---- tours ---------------------------------------------------------------
  step('tours', 'active', 'Reading the office’s tours');
  const rows = await readTours(client, {
    office,
    arrivalFrom: addDays(from, -LOOKBACK_DAYS),
    arrivalTo: to ?? addDays(from, MAX_DAYS),
    signal,
    onPage: (n) => step('tours', 'active', `Reading the office’s tours (${n} found)`),
  });
  const byTour = new Map();
  const horizon = to ?? addDays(from, MAX_DAYS);
  const pending = [];
  for (const row of rows) {
    if (isApprovedTour(row)) {
      const stays = staysFromGroupRow(row).filter(inRange);
      if (stays.length) byTour.set(row.TourId, stays);
      continue;
    }
    // Not approved (Pending, Draft…): it may be an approved tour that was updated and awaits re-approval.
    const start = String(row?.StartDate ?? '').slice(0, 10);
    const end = String(row?.EndDate ?? '').slice(0, 10);
    if (isLiveTour(row) && start && start <= horizon && (!end || end >= from)) pending.push(row);
  }

  // Tours awaiting re-approval: General search shows them with no plans, so read their plans.
  let notApproved = 0;
  let reapproval = 0;
  const waiting = [];
  const tourPlans = new Map(); // tour plans already read, reused when a guest list is empty
  if (pending.length) {
    step('tours', 'active', `Checking ${pending.length} pending tours for re-approval`);
    await pool(pending, POOL, async (row) => {
      const data = await client.read(`api/tours/getTourSubVenue/${Number(row.TourId)}`, undefined, { signal });
      tourPlans.set(row.TourId, data?.TourPlan);
      const updated = reapprovalRow(row, data?.TourPlan);
      const stays = updated ? staysFromGroupRow(updated).filter(inRange) : [];
      if (stays.length) {
        byTour.set(row.TourId, stays);
        reapproval += 1;
      } else if (!updated) {
        notApproved += 1;
        waiting.push(pendingTour(row, data?.TourPlan));
      }
    });
  }
  const tours = [...byTour.entries()]
    .map(([tourId, stays]) => ({ tourId, stays, first: stays.reduce((min, s) => (s.checkIn < min ? s.checkIn : min), stays[0].checkIn) }))
    .sort((a, b) => a.first.localeCompare(b.first));
  const approvedStays = tours.reduce((sum, t) => sum + t.stays.length, 0);
  step(
    'tours',
    'done',
    `${tours.length} approved tours staying in Najaf${reapproval ? ` (${reapproval} awaiting re-approval)` : ''}${notApproved ? `, ${notApproved} not approved yet` : ''}`,
  );

  // ---- the days the loading screen shows -----------------------------------
  const lastOut = tours.flatMap((t) => t.stays).reduce((max, s) => (s.checkOut > max ? s.checkOut : max), from);
  let end = to ?? lastOut;
  if (daysBetween(from, end) > MAX_DAYS) end = addDays(from, MAX_DAYS);
  const days = [];
  for (let d = from; d <= end; d = addDays(d, 1)) days.push(d);
  emit('days', { dates: days });

  // ---- guests, tour by tour ------------------------------------------------
  step('guests', 'active', `Counting guests on ${tours.length} tours`);
  const done = new Set();
  const counted = [];
  let lit = 0;
  const light = (through) => {
    while (lit < days.length && days[lit] <= through) {
      const date = days[lit];
      const sum = (field) => counted.filter((s) => s[field] === date).reduce((n, s) => n + s.pax, 0);
      lit += 1;
      emit('day', { date, read: lit, total: days.length, arriving: sum('checkIn'), leaving: sum('checkOut') });
    }
  };
  await pool(tours, POOL, async (tour) => {
    let counts = countGuests(await readGuests(client, tour.tourId, signal));
    if (!counts.total) {
      // Approved, but NKERP has no guest list for it yet: use the tour's own totals.
      let plan = tourPlans.get(tour.tourId);
      if (plan === undefined) plan = (await client.read(`api/tours/getTourSubVenue/${Number(tour.tourId)}`, undefined, { signal }))?.TourPlan;
      if (plan) counts = countsFromTour(plan);
    }
    for (const stay of tour.stays) counted.push(withGuests(stay, counts));
    done.add(tour.tourId);
    const selfHoused = counted.filter((s) => s.pax > 0);
    emit('tours', { approved: approvedStays, selfHoused: selfHoused.length, guests: selfHoused.reduce((n, s) => n + s.pax, 0) });
    step('guests', 'active', `Counting guests (${done.size} of ${tours.length} tours)`);
    // Every tour arriving before the earliest unfinished one is counted, so those days are complete.
    const waiting = tours.find((t) => !done.has(t.tourId));
    light(waiting ? addDays(waiting.first, -1) : end);
  });
  light(end);
  const groups = counted
    .filter((s) => s.pax > 0)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (a.arrivalAt ?? '').localeCompare(b.arrivalAt ?? '') || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true }));
  const mixed = groups.filter((s) => s.paxNkerpHoused > 0).length;
  step('guests', 'done', `${groups.length} stays with guests who need a hotel${mixed ? ` (${mixed} of them part-housed by NKERP)` : ''}`);

  // ---- stays ---------------------------------------------------------------
  step('match', 'active', 'Building the stays');
  const iraqi = groups.filter((s) => s.departure.airline === 'IA').length;
  step('match', 'done', `${groups.length} groups ready, ${iraqi} leaving on Iraqi Airways`);

  return {
    groups,
    meta: {
      source: 'nkerp',
      office,
      from,
      to,
      through: groups.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), end),
      fetchedAt: new Date().toISOString(),
      approvedStays,
      nkerpHousedOnly: counted.filter((s) => s.pax === 0).length,
      notApproved,
      reapproval,
      pending: waiting.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true })),
      toursRead: tours.length,
      requests: client.requests,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    },
  };
}
