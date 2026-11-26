/**
 * The pull: everything the planner needs from NKERP for one date range.
 *
 *   1. Sign in.
 *   2. Tours: General search → Groups for the office. Every tour with its
 *      status, ports, flights and sub-venue plans. Only approved tours with a
 *      Najaf stay in the range go on; pending ones (including tours awaiting
 *      re-approval) are listed, not planned.
 *   3. Guests: each of those tours' guest lists, person by person. A guest
 *      marked "accommodation not required" needs a bed from us, whether or
 *      not the rest of the tour is housed by NKERP.
 *   4. Stays: one per approved stay, including tours that currently need zero beds.
 *
 * Every call is a read (see client.mjs). Progress is reported through `emit`
 * so the loading screen can show it live: a window lights for each day once
 * every tour arriving by that day has been counted.
 */
import { NkerpError } from './client.mjs';
import { addDays, countGuests, countsFromTour, datedRoute, flightsOf, isApprovedTour, isLiveTour, pendingTour, sameOffice, statusOf, staysFromGroupRow, tripDate, venueOf, withGuests } from './normalize.mjs';

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
    const chunk = data?.lstGeneralGroupsSearch;
    const total = Number(data?.TotalRows);
    if (!Array.isArray(chunk) || (!chunk.length && seen < total)) {
      throw new NkerpError('NKERP returned an incomplete tour list. The saved plan is unchanged.', { code: 'format' });
    }
    seen += chunk.length;
    rows.push(...chunk.filter((row) => sameOffice(row?.OfficeName, office)));
    onPage(rows.length);
    if (!chunk.length || seen >= (total || seen)) return rows;
  }
  throw new NkerpError('NKERP returned too many pages to finish this pull. Try a shorter date range.', { code: 'format' });
}

async function readGuests(client, tourId, signal) {
  const path = `api/tours/getApplicants/${Number(tourId)}`;
  try {
    return await read();
  } catch (error) {
    if (signal?.aborted) throw error;
    // One more try: NKERP drops the odd request under load.
    return read();
  }

  async function read() {
    const data = await client.read(path, undefined, { signal });
    if (!data || !Object.hasOwn(data, 'Applicants') || (data.Applicants != null && !Array.isArray(data.Applicants))) {
      throw new NkerpError('NKERP returned an incomplete guest list. The saved plan is unchanged.', { code: 'format' });
    }
    return data.Applicants ?? [];
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

const otherCity = (venue) => venue === 'najaf' ? 'karbala' : 'najaf';
const firstDate = (a, b) => a < b ? a : b;
const lastDate = (a, b) => a > b ? a : b;

function windowFor(venue, { from, to = null }) {
  const horizon = to ?? addDays(from, MAX_DAYS);
  return {
    venue, from, to, horizon,
    stays: [],
    pending: [],
    overlaps: ({ checkIn, checkOut }) => checkOut >= from && checkIn <= horizon,
  };
}

/** One read of the office's tours and each relevant guest list serves both city windows. */
export async function runSync({
  client, from, to = null, office = DEFAULT_OFFICE, venue: venueInput = 'najaf',
  otherRange, tracked = [], emit = () => {}, signal,
}) {
  const venue = venueOf(venueInput);
  const city = venue === 'karbala' ? 'Karbala' : 'Najaf';
  const primary = windowFor(venue, { from, to });
  const windows = otherRange ? [primary, windowFor(otherCity(venue), otherRange)] : [primary];
  const started = Date.now();
  const initialRequests = client.requests;
  const step = (id, status, detail) => emit('step', { id, status, detail });
  const tourPlans = new Map();
  const observations = {};
  const counts = new Map();
  const trackedIds = new Set(tracked.map((t) => t.tourId));
  // What each tour looks like now, compared with the last pull to report
  // changes: itinerary, status, flights and guest counts. A fact this pull did
  // not read stays undefined, so it is not mistaken for a change.
  const observe = (id, ref, facts) => {
    const entry = (observations[id] ??= { tourNo: String(ref ?? id).split('/').pop() });
    for (const [field, value] of Object.entries(facts)) if (value !== undefined && value !== null) entry[field] = value;
  };
  const guestFacts = (guests) => ({ hotelPax: guests.notRequired, housed: guests.required, infants: guests.fromTour ? undefined : guests.infants });
  const readPlan = async (id) => {
    if (!tourPlans.has(id)) {
      const data = await client.read(`api/tours/getTourSubVenue/${Number(id)}`, undefined, { signal });
      if (!data || !Object.hasOwn(data, 'TourPlan')) {
        throw new NkerpError('NKERP returned incomplete tour dates. The saved plan is unchanged.', { code: 'format' });
      }
      tourPlans.set(id, data.TourPlan);
    }
    return tourPlans.get(id);
  };

  step('signin', 'active', 'Signing in to NKERP');
  await client.login({ signal });
  step('signin', 'done', 'Signed in');
  step('tours', 'active', 'Reading the office’s tours');
  const rows = await readTours(client, {
    office,
    arrivalFrom: addDays(windows.map((w) => w.from).reduce(firstDate), -LOOKBACK_DAYS),
    arrivalTo: windows.map((w) => w.horizon).reduce(lastDate),
    signal,
    onPage: (n) => step('tours', 'active', `Reading the office’s tours (${n} found)`),
  });
  const byId = new Map(rows.filter((r) => Number(r.TourId) > 0).map((r) => [Number(r.TourId), r]));
  const pending = [];
  for (const [id, row] of byId) {
    if (isApprovedTour(row)) {
      observe(id, row.ReferenceNo, {
        route: Array.isArray(row.lstSubVenuePlan) ? datedRoute(row) : undefined,
        status: statusOf(row),
        flights: flightsOf(row.lstTransportItinerary),
      });
      for (const w of windows) w.stays.push(...staysFromGroupRow(row, w.venue).filter(w.overlaps));
    } else if (isLiveTour(row)) {
      const start = tripDate(row.StartDateTimeZone, row.StartDate);
      const end = tripDate(row.EndDateTimeZone, row.EndDate);
      const within = windows.filter((w) => (!start || start <= w.horizon) && (!end || end >= w.from));
      if (within.length || trackedIds.has(id)) pending.push({ id, row, within });
    } else if (trackedIds.has(id)) {
      observe(id, row.ReferenceNo, { status: statusOf(row) });
    }
  }
  if (pending.length) step('tours', 'active', `Reading ${pending.length} pending tours`);
  await pool(pending, POOL, async ({ id, row, within }) => {
    const detail = await readPlan(id);
    observe(id, row.ReferenceNo, {
      route: Array.isArray(detail?.TourSubvenuePlan) ? datedRoute(row, detail) : undefined,
      status: statusOf(row, detail),
      flights: flightsOf(row.lstTransportItinerary?.length ? row.lstTransportItinerary : detail?.TransportItinerary),
    });
    for (const w of within) w.pending.push(pendingTour(row, detail, w.venue));
  });

  // A rescheduled tour may leave both search windows. Read its itinerary by
  // exact ID so the refresh can still report the move out of the plan.
  const missing = tracked.filter((t) => !byId.has(t.tourId) && windows.some((w) => w.venue === t.venue && w.overlaps(t)));
  await pool([...new Map(missing.map((t) => [t.tourId, t])).values()], POOL, async (t) => {
    const detail = await readPlan(t.tourId);
    if (Array.isArray(detail?.TourSubvenuePlan)) observe(t.tourId, detail.ReferenceNo || t.tourNo, { route: datedRoute(null, detail) });
  });

  const primaryIds = new Set(primary.stays.map((s) => Number(s.tourId)));
  const pendingReapproval = primary.pending.filter((t) => t.reapproval).length;
  step('tours', 'done', `${primaryIds.size} approved tours staying in ${city}${primary.pending.length ? `, ${primary.pending.length} pending in NKERP${pendingReapproval ? ` (${pendingReapproval} awaiting re-approval)` : ''}` : ''}`);

  const endOf = (w) => w.to ?? w.stays.reduce((end, stay) => lastDate(end, stay.checkOut), w.from);
  const end = firstDate(endOf(primary), addDays(from, MAX_DAYS));
  const days = [];
  for (let day = from; day <= end; day = addDays(day, 1)) days.push(day);
  emit('days', { dates: days });

  const firstById = new Map();
  for (const stay of windows.flatMap((w) => w.stays)) {
    const id = Number(stay.tourId);
    firstById.set(id, firstDate(firstById.get(id) ?? stay.checkIn, stay.checkIn));
  }
  const tours = [...firstById].sort((a, b) => a[1].localeCompare(b[1]));
  step('guests', 'active', `Counting guests on ${tours.length} tours`);
  const counted = [];
  let lit = 0;
  const light = (through) => {
    while (lit < days.length && days[lit] <= through) {
      const date = days[lit++];
      const sum = (field) => counted.filter((s) => s[field] === date).reduce((n, s) => n + s.pax, 0);
      emit('day', { date, read: lit, total: days.length, arriving: sum('checkIn'), leaving: sum('checkOut') });
    }
  };
  await pool(tours, POOL, async ([id]) => {
    let guests = countGuests(await readGuests(client, id, signal));
    if (!guests.total) {
      const detail = await readPlan(id);
      if (detail) guests = countsFromTour(detail);
    }
    counts.set(id, guests);
    observe(id, byId.get(id)?.ReferenceNo, guestFacts(guests));
    if (primaryIds.has(id)) counted.push(...primary.stays.filter((s) => Number(s.tourId) === id).map((s) => withGuests(s, guests)));
    const selfHoused = counted.filter((s) => s.pax > 0);
    emit('tours', { approved: primary.stays.length, selfHoused: selfHoused.length, guests: selfHoused.reduce((n, s) => n + s.pax, 0) });
    step('guests', 'active', `Counting guests (${counts.size} of ${tours.length} tours)`);
    const waiting = tours.find(([id]) => !counts.has(id) && primaryIds.has(id));
    light(waiting ? addDays(waiting[1], -1) : end);
  });
  light(end);
  step('guests', 'done', `${counted.filter((s) => s.pax > 0).length} stays with guests who need a hotel`);

  // The approved counts take precedence if the upstream service or request
  // budget is exhausted. Pending tours still have the counts from their plans.
  const pendingCounts = new Map();
  const pendingTours = pending.filter(({ within }) => within.length);
  step('match', 'active', pendingTours.length ? 'Checking hotel pax on pending tours' : 'Building the stays');
  await pool(pendingTours, POOL, async ({ id, row }) => {
    try {
      const applicants = await readGuests(client, id, signal);
      if (applicants.length) pendingCounts.set(id, countGuests(applicants));
    } catch (error) {
      if (signal?.aborted || !(error instanceof NkerpError)) throw error;
      // Drafts may only expose the tour totals.
    }
    const guests = pendingCounts.get(id);
    const tour = guests ? null : pendingTour(row, tourPlans.get(id));
    observe(id, row.ReferenceNo, guests ? guestFacts(guests) : { hotelPax: tour.needHotel, housed: tour.housed });
  });

  const fetchedAt = new Date().toISOString();
  const datasets = windows.map((w) => {
    const groups = w.stays.map((s) => withGuests(s, counts.get(Number(s.tourId))))
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (a.arrivalAt ?? '').localeCompare(b.arrivalAt ?? '') || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true }));
    return {
      groups,
      meta: {
        source: 'nkerp',
        venue: w.venue,
        office,
        from: w.from,
        to: w.to,
        through: endOf(w),
        coveredThrough: w.horizon,
        fetchedAt,
        approvedStays: groups.length,
        nkerpHousedOnly: groups.filter((g) => g.pax === 0).length,
        notApproved: w.pending.length,
        reapproval: w.pending.filter((t) => t.reapproval).length,
        pending: w.pending.map((tour) => {
          const guests = pendingCounts.get(Number(tour.tourId));
          return guests ? { ...tour, needHotel: guests.notRequired, housed: guests.required, unclassified: guests.unknown, hotelPaxSource: 'applicants' } : tour;
        }).sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true })),
        toursRead: new Set(groups.map((g) => g.tourId)).size,
        requests: client.requests - initialRequests,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      },
    };
  });
  step('match', 'done', `${datasets[0].groups.filter((s) => s.pax > 0).length} groups ready`);
  return { ...datasets[0], companion: datasets[1], observations };
}
