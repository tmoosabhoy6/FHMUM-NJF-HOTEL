/**
 * Turns raw NKERP rows into plain facts about one Najaf stay.
 * No allocation policy lives here: the browser decides who sleeps where.
 */

export const NAJAF = 'NAJAF';
export const KARBALA = 'KARBALA';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const upper = (value) => clean(value).toUpperCase();

/** "2026-11-07T11:00:00" → "2026-11-07". NKERP list times are Najaf local. */
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

/** Airline designator from a flight code: "IA 441" → "IA", "FZ 221 EVE" → "FZ". */
export function airlineOf(flight) {
  const code = upper(flight);
  if (!code) return null;
  if (/IRAQI/.test(code)) return 'IA';
  const match = code.match(/^([A-Z][A-Z0-9]|[0-9][A-Z])(?=\s*\d)/) ?? code.match(/^([A-Z]{2,3})\b/);
  return match ? match[1] : null;
}

export const isIraqiAirways = (flight) => airlineOf(flight) === 'IA' || airlineOf(flight) === 'IAW';
export const isNajafAirport = (port) => /NAJAF/.test(upper(port)) && /AIR/.test(upper(port));

/**
 * Guests the group houses itself. NKERP stores 0/0 when the whole tour was
 * approved without accommodation, in which case the full pax count applies.
 */
export function selfHousedPax({ pax, required, notRequired, approvedWithAccommodation }) {
  const total = Number(pax) || 0;
  const not = Number(notRequired) || 0;
  const req = Number(required) || 0;
  if (not > 0) return not;
  if (req === 0 && approvedWithAccommodation === false) return total;
  return 0;
}

function pickItinerary(itineraries, arrivalAt, departureAt) {
  const list = (itineraries ?? []).filter((it) => it && it.IsActive !== false);
  if (list.length <= 1) return list[0] ?? null;
  const inside = list.filter(
    (it) =>
      (!it.ArrivalDateTimeZone || it.ArrivalDateTimeZone <= departureAt) &&
      (!it.DepartureDateTimeZone || it.DepartureDateTimeZone >= arrivalAt),
  );
  return (inside.length ? inside : list).sort((a, b) => (b.Id ?? 0) - (a.Id ?? 0))[0];
}

function nearestLeg(legs, predicate, date) {
  let best = null;
  for (const leg of legs) {
    if (!predicate(leg)) continue;
    const gap = Math.abs(daysBetween(date, dateOf(leg.Date) ?? date));
    if (!best || gap < best.gap) best = { leg, gap };
  }
  return best && best.gap <= 1 ? best.leg : null;
}

/** One row of the Najaf ziyarat lists → one stay. Returns null when it is not usable. */
export function stayFromCensusRow(row) {
  const tour = row?.Tour ?? {};
  const arrivalAt = row.ArrivalDate ?? null;
  const departureAt = row.DepartureDate ?? null;
  const checkIn = dateOf(arrivalAt);
  const checkOut = dateOf(departureAt);
  if (!tour.ReferenceNo || !checkIn || !checkOut || checkOut < checkIn) return null;

  const itinerary = pickItinerary(tour.TransportItinerary, arrivalAt, departureAt);
  const legs = (tour.TourIternerayBreakUp ?? []).filter((leg) => leg && leg.IsActive !== false);
  const legIn = nearestLeg(legs, (leg) => upper(leg.To) === NAJAF, checkIn);
  const legOut = nearestLeg(legs, (leg) => upper(leg.From) === NAJAF, checkOut);

  let arrival;
  if (legIn) {
    arrival =
      upper(legIn.TravelType) === 'S'
        ? { kind: 'transfer', place: clean(legIn.From), flight: null }
        : { kind: 'airport', place: clean(legIn.From), flight: clean(itinerary?.ArrivalTransportCode) || null };
  } else if (itinerary && dateOf(itinerary.ArrivalDateTimeZone) === checkIn) {
    arrival = { kind: 'airport', place: clean(tour.EntryPortName), flight: clean(itinerary.ArrivalTransportCode) || null };
  } else if (itinerary?.ArrivalDateTimeZone) {
    arrival = { kind: 'transfer', place: KARBALA, flight: null };
  } else {
    arrival = { kind: 'unknown', place: '', flight: null };
  }

  let departure;
  if (legOut) {
    departure =
      upper(legOut.TravelType) === 'S'
        ? { kind: 'transfer', place: clean(legOut.To), flight: null }
        : { kind: 'airport', place: clean(legOut.To), flight: clean(itinerary?.DepartureTransportCode) || null };
  } else if (itinerary && dateOf(itinerary.DepartureDateTimeZone) === checkOut) {
    departure = { kind: 'airport', place: clean(tour.ExitPortName), flight: clean(itinerary.DepartureTransportCode) || null };
  } else if (itinerary?.DepartureDateTimeZone) {
    departure = { kind: 'transfer', place: KARBALA, flight: null };
  } else {
    departure = { kind: 'unknown', place: '', flight: null };
  }
  departure.airline = airlineOf(departure.flight);

  const planId = row.TourSubVenuePlanId ?? row.Id;
  const paxTotal = Number(tour.PaxCount) || 0;
  return {
    id: `${row.TourId}:${planId}`,
    tourId: row.TourId,
    planId,
    ref: clean(tour.ReferenceNo),
    tourNo: clean(tour.ReferenceNo).split('/').pop(),
    office: clean(tour.OfficeName),
    leader: clean(row.GroupLead ?? tour.GroupLead ?? tour.TOName),
    pax: selfHousedPax({
      pax: paxTotal,
      required: tour.PaxRequiredAcc,
      notRequired: tour.PaxNotRequiredAcc,
      approvedWithAccommodation: tour.IsApprovedWithAccommodation,
    }),
    paxTotal,
    paxNkerpHoused: Number(tour.PaxRequiredAcc) || 0,
    checkIn,
    checkOut,
    arrivalAt,
    departureAt,
    arrival,
    departure,
    secondLeg: arrival.kind === 'transfer' && upper(arrival.place) === KARBALA,
    seenIn: { tourList: true, dashboard: false },
    notes: [],
  };
}

/** A reissued plan for the same tour and overlapping dates: the newest plan wins. */
export function collapseReissues(stays) {
  const byTour = new Map();
  for (const stay of stays) {
    const list = byTour.get(stay.tourId) ?? [];
    list.push(stay);
    byTour.set(stay.tourId, list);
  }
  const kept = [];
  for (const list of byTour.values()) {
    list.sort((a, b) => b.planId - a.planId);
    const winners = [];
    for (const stay of list) {
      const overlaps = winners.some((w) => stay.checkIn <= w.checkOut && w.checkIn <= stay.checkOut);
      if (!overlaps) winners.push(stay);
    }
    kept.push(...winners);
  }
  return kept;
}

/** Dashboard rows share one shape; this picks the fields the planner uses. */
export function dashboardFact(kind, row) {
  const local =
    kind === 'arrival' || kind === 'stay'
      ? row.ArrivalTimeWithTimeZone
      : kind === 'departure'
        ? row.DepartureTimeWithTimeZone
        : row.ArrivalDepartureTime;
  return {
    kind,
    tourId: row.TourId,
    ref: clean(row.TourReferenceNo),
    tourNo: clean(row.TourReferenceNo).split('/').pop(),
    office: clean(row.OfficeName),
    leader: clean(row.GroupLeaderName),
    paxTotal: Number(row.NoOfPax) || 0,
    pax: selfHousedPax({
      pax: row.NoOfPax,
      required: row.PaxRequiredAcc,
      notRequired: row.PaxNotRequiredAcc,
      approvedWithAccommodation: row.Accommodation,
    }),
    at: local ?? null,
    date: dateOf(local),
    port: clean(kind === 'arrival' || kind === 'stay' ? row.ArrivalPort : row.DeparturePort) || null,
    flight: clean(kind === 'departure' ? row.FlightCode : kind === 'arrival' || kind === 'stay' ? row.FlightCode : '') || null,
    departureFlight: clean(row.DepartureFlightCode) || null,
    from: clean(row.SubVenueFrom) || null,
    to: clean(row.SubVenueTo) || null,
  };
}

/**
 * Checks each stay against what the transport dashboards showed and fills in
 * anything the tour list did not carry. Differences become plain-language
 * notes so a person can look at them; the tour list stays the reference.
 */
export function reconcile(stays, facts, { from }) {
  const byTour = new Map();
  for (const stay of stays) {
    const list = byTour.get(stay.tourId) ?? [];
    list.push(stay);
    byTour.set(stay.tourId, list);
  }
  const closest = (tourId, date, field) => {
    const list = byTour.get(tourId);
    if (!list?.length) return null;
    return [...list].sort(
      (a, b) => Math.abs(daysBetween(a[field], date ?? a[field])) - Math.abs(daysBetween(b[field], date ?? b[field])),
    )[0];
  };
  const orphans = new Map();

  for (const fact of facts) {
    if (fact.pax <= 0) continue;
    const field = fact.kind === 'departure' || fact.kind === 'transfer-out' ? 'checkOut' : 'checkIn';
    const stay =
      fact.kind === 'stay'
        ? (byTour.get(fact.tourId) ?? []).find((s) => s.checkIn <= fact.queried && fact.queried <= s.checkOut)
        : closest(fact.tourId, fact.date, field);
    if (!stay) {
      const entry = orphans.get(fact.tourId) ?? { facts: [] };
      entry.facts.push(fact);
      orphans.set(fact.tourId, entry);
      continue;
    }
    stay.seenIn.dashboard = true;
    if (fact.pax !== stay.pax && !stay.notes.some((n) => n.startsWith('Guest count'))) {
      stay.notes.push(`Guest count differs: tour list says ${stay.pax}, transport dashboard says ${fact.pax}.`);
    }
    if (fact.kind === 'departure') {
      if (fact.date && fact.date !== stay.checkOut) {
        stay.notes.push(`Departure dashboard shows this group leaving on ${fact.date}, the tour list says ${stay.checkOut}.`);
      }
      if (stay.departure.kind !== 'airport') {
        stay.departure = { kind: 'airport', place: fact.port ?? '', flight: fact.flight, airline: airlineOf(fact.flight) };
      } else {
        if (fact.flight && stay.departure.flight && upper(fact.flight) !== upper(stay.departure.flight)) {
          stay.notes.push(`Departure flight differs: tour list ${stay.departure.flight}, dashboard ${fact.flight}.`);
        }
        stay.departure.flight = fact.flight ?? stay.departure.flight;
        stay.departure.place = fact.port ?? stay.departure.place;
        stay.departure.airline = airlineOf(stay.departure.flight);
      }
    } else if (fact.kind === 'transfer-in') {
      if (stay.arrival.kind !== 'transfer') {
        stay.arrival = { kind: 'transfer', place: fact.from ?? KARBALA, flight: null };
        stay.secondLeg = upper(stay.arrival.place) === KARBALA;
      }
    } else if (fact.kind === 'arrival') {
      if (stay.arrival.kind === 'unknown') stay.arrival = { kind: 'airport', place: fact.port ?? '', flight: fact.flight };
    } else if (fact.kind === 'transfer-out') {
      if (stay.departure.kind === 'unknown') {
        stay.departure = { kind: 'transfer', place: fact.to ?? KARBALA, flight: null, airline: null };
      }
    }
  }

  // Groups the dashboards show in Najaf that the tour lists did not return.
  const extras = [];
  for (const [tourId, { facts: list }] of orphans) {
    const first = list[0];
    const arrivalFact = list.find((f) => f.kind === 'arrival' || f.kind === 'transfer-in');
    const departureFact = list.find((f) => f.kind === 'departure' || f.kind === 'transfer-out');
    const checkIn = arrivalFact?.date ?? from;
    const checkOut = departureFact?.date ?? null;
    if (!checkOut || checkOut < checkIn) continue;
    extras.push({
      id: `${tourId}:dashboard`,
      tourId,
      planId: 0,
      ref: first.ref,
      tourNo: first.tourNo,
      office: first.office,
      leader: first.leader,
      pax: first.pax,
      paxTotal: first.paxTotal,
      paxNkerpHoused: Math.max(0, first.paxTotal - first.pax),
      checkIn,
      checkOut,
      arrivalAt: arrivalFact?.at ?? null,
      departureAt: departureFact?.at ?? null,
      arrival: !arrivalFact
        ? { kind: 'unknown', place: '', flight: null }
        : arrivalFact.kind === 'arrival'
          ? { kind: 'airport', place: arrivalFact.port ?? '', flight: arrivalFact.flight }
          : { kind: 'transfer', place: arrivalFact.from ?? KARBALA, flight: null },
      departure:
        departureFact.kind === 'departure'
          ? { kind: 'airport', place: departureFact.port ?? '', flight: departureFact.flight, airline: airlineOf(departureFact.flight) }
          : { kind: 'transfer', place: departureFact.to ?? KARBALA, flight: null, airline: null },
      secondLeg: arrivalFact?.kind === 'transfer-in' && upper(arrivalFact.from) === KARBALA,
      seenIn: { tourList: false, dashboard: true },
      notes: [
        arrivalFact
          ? 'Found on the transport dashboard only, not in the Najaf tour list.'
          : `Found on the transport dashboard only. Already in Najaf on ${from}; the arrival date is not known.`,
      ],
    });
  }
  return [...stays, ...extras];
}
