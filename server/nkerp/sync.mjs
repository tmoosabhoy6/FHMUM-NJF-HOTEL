/**
 * The pull: everything the planner needs from NKERP for one date range.
 *
 *   1. Sign in.
 *   2. Tour list: every approved Najaf stay of the office (all four ziyarat
 *      status lists), which carries the stay dates, ports, flight codes, the
 *      Karbala → Najaf leg and the "accommodation not required" pax.
 *   3. Transport dashboards, day by day (arrivals, departures, sub-venue
 *      transfers, and who is in Najaf on the first day) to confirm each
 *      departure flight and catch a group the lists did not return.
 *   4. Reconcile both views into one list of stays.
 *
 * Progress is reported through `emit` so the loading screen can show it live.
 */
import { addDays, collapseReissues, dashboardFact, daysBetween, reconcile, sameOffice, stayFromCensusRow } from './normalize.mjs';

export const DEFAULT_OFFICE = 'Fayz E Husayni Trust Mumbai';
const VENUE_IRAQ = 2;
const SUBVENUE_NAJAF = 3;
const LOOKBACK_DAYS = 45; // a group that arrived this long before the range can still be in Najaf
const MAX_DAYS = 150;
const PAGE = 100;

const LISTS = [
  { key: 'non_scheduled', path: 'api/VisitingPoint/MuwafiqaApprovedTours', flags: [false, true] },
  { key: 'scheduled', path: 'api/VisitingPoint/getScheduledTours', flags: [false] },
  { key: 'partial', path: 'api/VisitingPoint/getPartialScheduledTours', flags: [false] },
  { key: 'released', path: 'api/VisitingPoint/getReleasedTours', flags: [false] },
];

const rowsOf = (data) => [...(data?.lstMufiquaFinalInZSDTO ?? []), ...(data?.lstMufiquaInZSDTO ?? [])];

async function readList(client, list, flag, { office, arrivalFrom, arrivalTo, signal }) {
  const rows = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = await client.read(
      list.path,
      {
        IsZiyaratRequired: flag,
        PackageId: null,
        TOId: client.userId,
        TOOfficeNameSearch: office,
        FromDateFromSearch: arrivalFrom,
        FromDateToSearch: arrivalTo,
        TourSearchRefNo: null,
        ZiyaratGroupId: null,
        clientTimeZoneOffset: -180,
        currentPage: page,
        ddlSubVenue: { Value: SUBVENUE_NAJAF, Text: 'NAJAF' },
        group: client.groupId,
        itemsPerPage: PAGE,
        maxSize: PAGE,
        reverse: false,
        sortBy: 'ModifiedOn',
        totalItems: PAGE,
        subVenueSearchId: SUBVENUE_NAJAF,
        venueSearchId: VENUE_IRAQ,
      },
      { signal },
    );
    const chunk = rowsOf(data);
    rows.push(...chunk);
    const total = Number(data?.TotalRows) || rows.length;
    if (!chunk.length || rows.length >= total) break;
  }
  return rows;
}

const dashboardBody = (date, sortBy) => ({
  Date: `${date}T00:00:00.000Z`,
  VenueId: VENUE_IRAQ,
  SubVenueId: SUBVENUE_NAJAF,
  TimeZone: null,
  Timezone: 3,
  itemsPerPage: 10,
  maxSize: 10,
  totalItems: 0,
  currentPage: 1,
  reverse: false,
  IsForRoomAccomDashboard: false,
  TransportCode: null,
  EntryPort: null,
  ExitPort: null,
  sortBy,
});

async function readDay(client, date, { office, withStay, signal }) {
  const mine = (row) => sameOffice(row.OfficeName, office);
  const [arrivals, departures, transfers, stay] = await Promise.all([
    client.read('api/vehicle/getArrivals', dashboardBody(date, 'ArrivalTime'), { signal }),
    client.read('api/vehicle/getDepartures', dashboardBody(date, 'DepartureTime'), { signal }),
    client.read('api/vehicle/getSubVenueTransfers', dashboardBody(date, 'DepartureTime'), { signal }),
    withStay ? client.read('api/vehicle/getStayInSubvenuev2', dashboardBody(date, 'ArrivalTime'), { signal }) : null,
  ]);
  const facts = [
    ...(arrivals?.arrivalRequest ?? []).filter(mine).map((r) => dashboardFact('arrival', r)),
    ...(departures?.departureRequest ?? []).filter(mine).map((r) => dashboardFact('departure', r)),
    ...(transfers?.SubVenueArrival ?? [])
      .filter((r) => mine(r) && String(r.SubVenueTo).toUpperCase() === 'NAJAF')
      .map((r) => dashboardFact('transfer-in', r)),
    ...(transfers?.SubVenueDeparture ?? [])
      .filter((r) => mine(r) && String(r.SubVenueFrom).toUpperCase() === 'NAJAF')
      .map((r) => dashboardFact('transfer-out', r)),
    ...(stay?.StayInsubvenueRequest ?? []).filter(mine).map((r) => dashboardFact('stay', r)),
  ].map((fact) => ({ ...fact, queried: date, date: fact.date ?? date }));
  return facts;
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

  step('signin', 'active', 'Signing in to NKERP');
  await client.login({ signal });
  step('signin', 'done', 'Signed in');

  // ---- tour list ---------------------------------------------------------
  step('tours', 'active', 'Reading approved Najaf tours');
  const arrivalFrom = addDays(from, -LOOKBACK_DAYS);
  const raw = new Map();
  for (const list of LISTS) {
    for (const flag of list.flags) {
      const rows = await readList(client, list, flag, { office, arrivalFrom, arrivalTo: to, signal });
      for (const row of rows) {
        if (!sameOffice(row?.Tour?.OfficeName, office)) continue;
        raw.set(`${row.TourId}:${row.TourSubVenuePlanId ?? row.Id}`, row);
      }
      step('tours', 'active', `Reading approved Najaf tours (${raw.size} found)`);
    }
  }
  const approved = [...raw.values()].map(stayFromCensusRow).filter(Boolean);
  const inRange = collapseReissues(approved).filter((s) => s.checkOut >= from && (!to || s.checkIn <= to));
  const selfHoused = inRange.filter((s) => s.pax > 0);
  step('tours', 'done', `${inRange.length} approved stays, ${selfHoused.length} arranging their own hotel`);
  emit('tours', {
    approved: inRange.length,
    selfHoused: selfHoused.length,
    guests: selfHoused.reduce((sum, s) => sum + s.pax, 0),
  });

  // ---- transport dashboards ---------------------------------------------
  const lastOut = selfHoused.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), from);
  let sweepTo = to ?? lastOut;
  if (daysBetween(from, sweepTo) > MAX_DAYS) sweepTo = addDays(from, MAX_DAYS);
  const days = [];
  for (let d = from; d <= sweepTo; d = addDays(d, 1)) days.push(d);
  emit('days', { dates: days });
  step('transport', 'active', `Reading arrivals and departures for ${days.length} days`);

  const facts = [];
  let read = 0;
  await pool(days, 4, async (date, index) => {
    const dayFacts = await readDay(client, date, { office, withStay: index === 0, signal });
    facts.push(...dayFacts);
    read += 1;
    const guests = (kinds) => dayFacts.filter((f) => kinds.includes(f.kind) && f.pax > 0).reduce((sum, f) => sum + f.pax, 0);
    emit('day', {
      date,
      read,
      total: days.length,
      arriving: guests(['arrival', 'transfer-in']),
      leaving: guests(['departure', 'transfer-out']),
    });
  });
  step('transport', 'done', `Arrivals and departures read for ${days.length} days`);

  // ---- reconcile ---------------------------------------------------------
  step('match', 'active', 'Matching tours with their flights');
  const stays = reconcile(selfHoused, facts, { from })
    .filter((s) => s.pax > 0 && s.checkOut >= from && (!to || s.checkIn <= to))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || (a.arrivalAt ?? '').localeCompare(b.arrivalAt ?? '') || a.tourNo.localeCompare(b.tourNo));
  const iraqi = stays.filter((s) => s.departure.airline === 'IA').length;
  step('match', 'done', `${stays.length} groups ready, ${iraqi} leaving on Iraqi Airways`);

  return {
    groups: stays,
    meta: {
      source: 'nkerp',
      office,
      from,
      to,
      through: stays.reduce((max, s) => (s.checkOut > max ? s.checkOut : max), sweepTo),
      fetchedAt: new Date().toISOString(),
      approvedStays: inRange.length,
      nkerpHousedOnly: inRange.length - selfHoused.length,
      daysRead: days.length,
      requests: client.requests,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    },
  };
}
