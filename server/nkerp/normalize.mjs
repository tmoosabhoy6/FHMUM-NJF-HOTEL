/**
 * Turns raw NKERP rows into plain facts about one Najaf stay.
 * No allocation policy lives here: the browser decides who sleeps where.
 *
 * Two sources:
 *   - General search → Groups: one row per tour, with its status, ports,
 *     flights and sub-venue plans (Najaf, Karbala, in trip order).
 *   - The tour's guest list: one row per person, with their accommodation
 *     choice. Only guests marked "accommodation not required" need a bed from
 *     us, and a tour that NKERP houses can still have some of them.
 */

export const NAJAF = 'NAJAF';
export const KARBALA = 'KARBALA';
export const SUBVENUE_NAJAF = 3;

/** Tour statuses that mean NKERP has approved the tour. */
export const APPROVED_STATUSES = new Set(['APPROVED', 'CURRENT', 'COMPLETED']);

/** NKERP AccomodationOptionId: 2 = accommodation required (NKERP houses them), 3 = not required (they house themselves). */
export const ACCOMMODATION_REQUIRED = 2;
export const ACCOMMODATION_NOT_REQUIRED = 3;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = (value) => clean(value).toUpperCase();

/** "2026-11-07T11:00:00" → "2026-11-07". NKERP local (Najaf) times. */
export const dateOf = (stamp) => (typeof stamp === 'string' && stamp.length >= 10 ? stamp.slice(0, 10) : null);

export const sameOffice = (a, b) => upper(a).replace(/[^A-Z0-9]/g, '') === upper(b).replace(/[^A-Z0-9]/g, '');

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The date a sub-venue plan ends on. A plan followed by another sub-venue
 * ends at 23:59 the day before the move ("2026-11-23T23:59:59.997" when the
 * group moves on 24 Nov), so that rolls over to the next date; a plan that
 * ends the trip ends at midnight on the departure date.
 */
export function endDateOf(stamp) {
  const date = dateOf(stamp);
  if (!date) return null;
  return /T23:59/.test(stamp) ? addDays(date, 1) : date;
}

/** Airline designator from a flight code: "IA 441" → "IA", "FZ 221 EVE" → "FZ". */
export function airlineOf(flight) {
  const code = upper(flight);
  if (!code) return null;
  if (/IRAQI/.test(code)) return 'IA';
  const match = code.match(/^([A-Z][A-Z0-9]|[0-9][A-Z])(?=\s*\d)/) ?? code.match(/^([A-Z]{2,3})\b/);
  return match ? match[1] : null;
}

export const isIraqiAirways = (flight) => airlineOf(flight) === 'IA' || airlineOf(flight) === 'IAW';

export const isApprovedTour = (row) => row?.IsActive !== false && APPROVED_STATUSES.has(upper(row?.Status));

/** Tours that may still come: neither deleted nor rejected. */
export const isLiveTour = (row) => row?.IsActive !== false && !/DELETED|REJECTED|CANCEL/.test(upper(row?.Status));

/**
 * A tour that was approved, then updated, waits for re-approval: General
 * search lists it as Pending with no plans, and every version of its plans is
 * marked inactive. The most recent version (the plans saved last, together)
 * holds its current dates. Returns a General-search-shaped row built from the
 * tour's sub-venue plans, or null when the tour is not awaiting re-approval
 * or has no plans.
 */
/** The current version of a tour's sub-venue plans: the active ones, else the ones saved last, together. */
export function latestPlans(tourPlan) {
  const plans = (tourPlan?.TourSubvenuePlan ?? []).filter((p) => p && !p.IsRemoved && p.StartDateTimeZone && p.EndDateTimeZone);
  const active = plans.filter((p) => p.IsActive !== false);
  if (active.length || !plans.length) return active;
  const newest = plans.reduce((max, p) => (String(p.CreatedOn) > max ? String(p.CreatedOn) : max), '');
  const cutoff = Date.parse(newest) - 60_000; // plans saved together share a timestamp, give or take
  return plans.filter((p) => Date.parse(String(p.CreatedOn)) >= cutoff);
}

export function reapprovalRow(row, tourPlan) {
  if (!tourPlan?.IsReApproval) return null;
  const latest = latestPlans(tourPlan);
  if (!latest.length) return null;
  return {
    ...row,
    TourId: row?.TourId ?? tourPlan.Id,
    ReferenceNo: row?.ReferenceNo ?? tourPlan.ReferenceNo,
    Status: 'Awaiting re-approval',
    EntryPort: row?.EntryPort ?? tourPlan.EntryPortName,
    ExitPort: row?.ExitPort ?? tourPlan.ExitPortName,
    PaxCount: row?.PaxCount ?? tourPlan.PaxCount,
    lstTransportItinerary: row?.lstTransportItinerary?.length ? row.lstTransportItinerary : (tourPlan.TransportItinerary ?? []),
    lstSubVenuePlan: latest.map((p) => ({ ...p, IsActive: true })),
    reapproval: true,
  };
}

const activePlans = (row) =>
  (row?.lstSubVenuePlan ?? [])
    .filter((p) => p && p.IsActive !== false && !p.IsRemoved && p.StartDateTimeZone && p.EndDateTimeZone)
    .sort((a, b) => String(a.StartDateTimeZone).localeCompare(String(b.StartDateTimeZone)));

function pickItinerary(itineraries, from, to) {
  const list = (itineraries ?? []).filter((it) => it && it.IsActive !== false);
  if (list.length <= 1) return list[0] ?? null;
  const inside = list.filter(
    (it) => (!it.ArrivalDateTimeZone || dateOf(it.ArrivalDateTimeZone) <= to) && (!it.DepartureDateTimeZone || dateOf(it.DepartureDateTimeZone) >= from),
  );
  return (inside.length ? inside : list).sort((a, b) => (b.Id ?? 0) - (a.Id ?? 0))[0];
}

/**
 * One tour row from General search → Groups → one stay per Najaf plan.
 * Guest counts are filled in later from the guest list (`withGuests`).
 */
export function staysFromGroupRow(row) {
  const ref = clean(row?.ReferenceNo);
  if (!ref || !row?.TourId) return [];
  const plans = activePlans(row);
  const stays = [];
  plans.forEach((plan, i) => {
    if (Number(plan.SubvenueId) !== SUBVENUE_NAJAF && upper(plan.SubvenueName) !== NAJAF) return;
    const checkIn = dateOf(plan.StartDateTimeZone);
    const checkOut = endDateOf(plan.EndDateTimeZone);
    if (!checkIn || !checkOut || checkOut < checkIn) return;
    const previous = plans[i - 1] ?? null;
    const next = plans[i + 1] ?? null;
    const itinerary = pickItinerary(row.lstTransportItinerary, checkIn, checkOut);

    const arrival = previous
      ? { kind: 'transfer', place: upper(previous.SubvenueName) || KARBALA, flight: null }
      : { kind: 'airport', place: clean(row.EntryPort), flight: clean(itinerary?.ArrivalTransportCode) || null };
    const departure = next
      ? { kind: 'transfer', place: upper(next.SubvenueName) || KARBALA, flight: null, airline: null }
      : { kind: 'airport', place: clean(row.ExitPort), flight: clean(itinerary?.DepartureTransportCode) || null, airline: null };
    departure.airline = airlineOf(departure.flight);

    const landed = itinerary?.ArrivalDateTimeZone && dateOf(itinerary.ArrivalDateTimeZone) === checkIn ? itinerary.ArrivalDateTimeZone : null;
    const leaves = itinerary?.DepartureDateTimeZone && dateOf(itinerary.DepartureDateTimeZone) === checkOut ? itinerary.DepartureDateTimeZone : null;
    stays.push({
      id: `${row.TourId}:${plan.Id ?? i}`,
      tourId: row.TourId,
      planId: plan.Id ?? 0,
      ref,
      tourNo: ref.split('/').pop(),
      office: clean(row.OfficeName),
      leader: '',
      status: clean(row.Status),
      pax: 0,
      infants: 0,
      paxTotal: Number(row.PaxCount) || 0,
      paxNkerpHoused: 0,
      checkIn,
      checkOut,
      arrivalAt: arrival.kind === 'airport' ? landed : null,
      departureAt: departure.kind === 'airport' ? leaves : null,
      arrival,
      departure,
      secondLeg: arrival.kind === 'transfer' && arrival.place === KARBALA,
      notes: row.reapproval ? ['Updated in NKERP and awaiting re-approval: planned with its latest dates.'] : [],
    });
  });
  return stays;
}

/**
 * A tour that is not approved yet, for the "Pending tours" table: what the
 * tour says about itself (trip dates, ports, guests and the guests who need a
 * hotel, as NKERP counts them for the tour), and its Najaf dates when it has
 * any plans.
 */
export function pendingTour(row, tourPlan) {
  const t = tourPlan ?? {};
  const ref = clean(row?.ReferenceNo ?? t.ReferenceNo);
  const plans = latestPlans(t).sort((a, b) => String(a.StartDateTimeZone).localeCompare(String(b.StartDateTimeZone)));
  const najaf = plans
    .filter((p) => Number(p.SubvenueId) === SUBVENUE_NAJAF || upper(p.SubvenueName) === NAJAF)
    .map((p) => ({ checkIn: dateOf(p.StartDateTimeZone), checkOut: endDateOf(p.EndDateTimeZone) }))
    .filter((n) => n.checkIn && n.checkOut);
  const name = (p) => (upper(p.SubvenueName) === NAJAF ? 'Najaf' : upper(p.SubvenueName) === KARBALA ? 'Karbala' : clean(p.SubvenueName));
  const count = (value) => (value === null || value === undefined ? null : Number(value) || 0);
  return {
    tourId: row?.TourId ?? t.Id,
    ref,
    tourNo: ref.split('/').pop(),
    status: t.IsReApproval ? 'Awaiting re-approval' : clean(row?.Status) || 'Pending',
    reapproval: Boolean(t.IsReApproval),
    start: dateOf(row?.StartDate ?? t.StartDate),
    end: dateOf(row?.EndDate ?? t.EndDate),
    entryPort: clean(row?.EntryPort ?? t.EntryPortName),
    exitPort: clean(row?.ExitPort ?? t.ExitPortName),
    route: plans.map(name).join(' → '),
    najaf,
    pax: Number(row?.PaxCount ?? t.PaxCount) || 0,
    needHotel: count(t.PaxNotRequiredAcc),
    housed: count(t.PaxRequiredAcc),
    remarks: clean(t.Remarks),
  };
}

/**
 * Counts a tour's guests, person by person. Cancelled, inactive and dummy
 * guests are left out. `notRequired` is the beds we must find: guests marked
 * "accommodation not required", not counting infants, who share a bed.
 */
export function countGuests(applicants) {
  const counts = { total: 0, required: 0, notRequired: 0, infants: 0, unknown: 0, cancelled: 0, leader: '' };
  for (const a of applicants ?? []) {
    if (!a) continue;
    if (a.IsCancellation || a.IsActive === false || a.IsApplicantActive === false || a.IsDummy) {
      counts.cancelled += 1;
      continue;
    }
    counts.total += 1;
    if (a.IsLead && !counts.leader) counts.leader = clean(`${a.FirstName ?? a.First_name ?? ''} ${a.LastName ?? a.Surname ?? ''}`) || clean(a.fullname);
    const option = Number(a.AccomodationOptionId);
    if (option === ACCOMMODATION_NOT_REQUIRED) {
      if (a.IsInfant) counts.infants += 1;
      else counts.notRequired += 1;
    } else if (option === ACCOMMODATION_REQUIRED) {
      if (!a.IsInfant) counts.required += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return counts;
}

/**
 * An approved tour whose guest list is still empty in NKERP (common for tours
 * a few weeks out) still carries the tour's own totals: guests who need a
 * hotel (PaxNotRequiredAcc) and guests NKERP houses (PaxRequiredAcc). Used in
 * place of the guest count until the list is filled in. Infants are not told
 * apart in these totals.
 */
export function countsFromTour(tourPlan) {
  const t = tourPlan ?? {};
  const notRequired = Number(t.PaxNotRequiredAcc) || 0;
  const required = Number(t.PaxRequiredAcc) || 0;
  return { total: notRequired + required || Number(t.PaxCount) || 0, required, notRequired, infants: 0, unknown: 0, cancelled: 0, leader: '', fromTour: true };
}

/** Fills a stay's guest numbers from its tour's guest count. */
export function withGuests(stay, counts) {
  const notes = [...stay.notes];
  if (counts.fromTour) notes.push('Guest list not in NKERP yet: numbers are the tour’s own totals.');
  if (counts.infants) notes.push(`${counts.infants} ${counts.infants === 1 ? 'infant' : 'infants'} too, sharing a bed.`);
  if (counts.unknown) notes.push(`${counts.unknown} ${counts.unknown === 1 ? 'guest has' : 'guests have'} no accommodation choice in NKERP.`);
  return {
    ...stay,
    leader: counts.leader || stay.leader,
    pax: counts.notRequired,
    infants: counts.infants,
    paxTotal: counts.total || stay.paxTotal,
    paxNkerpHoused: counts.required,
    notes,
  };
}
