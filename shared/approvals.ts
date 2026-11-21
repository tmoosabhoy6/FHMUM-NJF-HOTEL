import { addDays, daysBetween, eachDate, isIsoDate } from './dates';
import { DEPARTURE_DAY_AIRPORTS, nightsOf, suggestRooms } from './engine';
import { parseRoomSpec } from './roomSpec';
import type { Group, GroupInput, HotelId, PendingTour, Plan, Room, Settings, Venue } from './types';

interface Segment {
  city: Venue;
  from: string;
  to: string;
}

interface Route {
  segments: [Segment, Segment];
  nights: string[];
  retainsOrder: boolean;
  hasDepartureDay: boolean;
  needsFlightCheck: boolean;
}

export interface Recommendation {
  tour: PendingTour;
  pax: number | null;
  route: Route | null;
  hotel: HotelId | null;
  rooms: Room[];
  issue: string | null;
}

export interface ApprovalDay {
  date: string;
  fixedRuya: number;
  proposedRuya: number;
  ruyaBedsUsed: number;
  proposedAraf: number;
  proposedOverflow: number;
  arrivals: { tourNo: string; pax: number; hotel: HotelId }[];
  fixedRoomConflict: boolean;
}

export interface ApprovalPlan {
  recommendations: Recommendation[];
  days: ApprovalDay[];
  capacity: number;
  fixedGuestNights: number;
  ruyaGuestNights: number;
  ruyaTours: number;
  arafTours: number;
  overflowTours: number;
  heldTours: number;
  limited: boolean;
}

export interface ApprovalRequest {
  pending: PendingTour[];
  approved: Group[];
  /** The existing Najaf plan. Its hotel, nights and rooms are fixed during this search. */
  baseline: Plan;
  inputs: Record<number, GroupInput | undefined>;
  settings: Pick<Settings, 'departureDayRule'>;
  from: string;
  to: string;
  coveredFrom: string;
  coveredThrough: string;
  today: string;
}

interface Candidate {
  tour: PendingTour;
  pax: number;
  options: Option[];
  pin: HotelId | null;
  labels: string[];
  spec: number[];
}

interface Option extends Route {
  index: number[];
  mask: bigint;
}

interface Choice {
  route: Option;
  hotel: HotelId;
  rooms: number[];
}

// Compare in this order. Satisfy saved constraints, fill Ruya, then minimize
// Hotel C use and retain the recorded city order when the capacity is equal.
type Score = [ready: number, ruyaGuestNights: number, ruyaTours: number, ruyaReapprovals: number, negativeOverflowNights: number, retainedOrders: number];

const CITY: Record<Venue, string> = { karbala: 'Karbala', najaf: 'Najaf' };
const SEARCH_LIMIT = 25_000;
const valid = (date: string | null): date is string => Boolean(date && isIsoDate(date) && addDays(date, 0) === date);

export function balancedSegments(start: string, end: string, first: Venue): Route['segments'] {
  const nights = daysBetween(start, end);
  const karbala = Math.ceil(nights / 2);
  const transfer = addDays(start, first === 'karbala' ? karbala : nights - karbala);
  return [
    { city: first, from: start, to: transfer },
    { city: first === 'karbala' ? 'najaf' : 'karbala', from: transfer, to: end },
  ];
}

function routeFor(tour: PendingTour, segments: Route['segments'], settings: ApprovalRequest['settings']): Route {
  const najaf = segments.find((s) => s.city === 'najaf')!;
  const secondLeg = segments[1].city === 'najaf';
  const airline = tour.departureAirline ?? null;
  // Only a confirmed qualifying flight changes occupancy in the Najaf planner.
  const exit = tour.exitPort.trim();
  const possibleAirport = !exit || DEPARTURE_DAY_AIRPORTS.test(exit);
  const possibleAirline = !airline || airline === 'IA' || airline === 'IAW';
  const needsFlightCheck = settings.departureDayRule && secondLeg && possibleAirport && possibleAirline && (!exit || !airline);
  const nights = nightsOf({
    checkIn: najaf.from,
    checkOut: najaf.to,
    secondLeg,
    departure: {
      kind: secondLeg && DEPARTURE_DAY_AIRPORTS.test(tour.exitPort) ? 'airport' : 'transfer',
      place: tour.exitPort,
      flight: tour.departureFlight ?? null,
      airline,
    },
  }, settings);
  const sameOrder = tour.route.toLowerCase().split('→').map((city) => city.trim()).join('|') ===
    segments.map((segment) => segment.city).join('|');
  return { segments, nights, retainsOrder: sameOrder, needsFlightCheck, hasDepartureDay: nights.at(-1) === najaf.to };
}

const bit = (index: number) => 1n << BigInt(index);

function* roomSets(pax: number, spec: number[], free: number[], rooms: Room[], masks: bigint[], future: bigint) {
  const buckets = new Map<string, number[]>();
  for (const index of free) {
    const key = `${rooms[index].beds}:${masks[index] & future}`;
    const pool = buckets.get(key);
    if (pool) pool.push(index);
    else buckets.set(key, [index]);
  }
  // Rooms of the same size and availability on all remaining options are interchangeable.
  const pools = [...buckets.values()].sort((a, b) => rooms[b[0]].beds - rooms[a[0]].beds);
  const sizes = pools.map((pool) => rooms[pool[0]].beds);
  const suffix = Array(pools.length + 1).fill(0) as number[];
  for (let i = pools.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + sizes[i] * pools[i].length;
  const requested = new Map<number, number>();
  for (const size of spec) requested.set(size, (requested.get(size) ?? 0) + 1);
  for (const [size, count] of requested) if (free.filter((i) => rooms[i].beds === size).length < count) return;
  const picked: number[] = [];
  const used = new Map<number, number>();

  function* visit(index: number, beds: number, smallest: number): Generator<number[]> {
    const goal = spec.length || pax;
    if (spec.length ? picked.length === goal : beds >= goal) {
      // Adding rooms beyond a minimal cover cannot improve any later booking.
      if (spec.length || beds - smallest < pax) yield [...picked];
      return;
    }
    if (index === pools.length || beds + suffix[index] < pax) return;
    const size = sizes[index];
    const count = used.get(size) ?? 0;
    const take = Math.min(pools[index].length, spec.length ? (requested.get(size) ?? 0) - count : Math.ceil((pax - beds) / size));
    for (let n = take; n >= 0; n--) {
      picked.push(...pools[index].slice(0, n));
      used.set(size, count + n);
      yield* visit(index + 1, beds + n * size, n ? size : smallest);
      picked.length -= n;
      used.set(size, count);
    }
  }

  // Seed the search with the existing allocator's tight fit.
  const quick = spec.length ? null : suggestRooms(pax, free.map((i) => rooms[i]));
  const quickIds = quick ? new Set(quick.map((room) => room.id)) : null;
  const seed = quickIds ? free.filter((i) => quickIds.has(rooms[i].id)) : null;
  if (seed) yield seed;
  for (const set of visit(0, 0, Infinity)) {
    if (seed && seed.length === set.length && set.every((i) => seed.includes(i))) continue;
    yield set;
  }
}

function compareScores(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function buildApprovalPlan(request: ApprovalRequest, searchLimit = SEARCH_LIMIT): ApprovalPlan {
  const { approved, baseline, pending, settings, inputs, from, to, coveredFrom, coveredThrough, today } = request;
  const allDates = eachDate(coveredFrom, coveredThrough);
  const dateIndex = new Map(allDates.map((date, index) => [date, index]));
  const fixed = new Map(baseline.days.map((day) => [day.date, day]));
  const rooms = baseline.rooms;
  const roomIndex = new Map(rooms.map((room, index) => [room.id, index]));
  const ruya = allDates.map((date) => fixed.get(date)?.hotels.ruya.pax ?? 0);
  const bedsUsed = allDates.map((date) => rooms.length ? fixed.get(date)?.hotels.ruya.beds ?? 0 : fixed.get(date)?.hotels.ruya.pax ?? 0);
  const araf = allDates.map((date) => fixed.get(date)?.hotels.araf.pax ?? 0);
  const masks = rooms.map(() => 0n);
  const conflicts = new Set<number>();
  const paxByGroup = new Map(approved.map((group) => [group.id, group.pax]));

  for (const stay of Object.values(baseline.placements)) {
    if (stay.hotel !== 'ruya') continue;
    const indexes = stay.nights.flatMap((date) => dateIndex.has(date) ? [dateIndex.get(date)!] : []);
    const occupied = indexes.reduce((mask, index) => mask | bit(index), 0n);
    for (const room of stay.rooms) {
      const index = roomIndex.get(room.id);
      if (index !== undefined) masks[index] |= occupied;
    }
    if (stay.overbooked || (rooms.length && stay.beds < (paxByGroup.get(stay.groupId) ?? 0))) {
      for (const index of indexes) conflicts.add(index);
    }
  }
  for (const [index, pax] of ruya.entries()) {
    if (pax > baseline.capacity.ruya || bedsUsed[index] < pax) conflicts.add(index);
  }

  const approvedIds = new Set(approved.map((group) => Number(group.tourId)));
  const candidates: Candidate[] = [];
  const recommendations: Recommendation[] = [];
  const seen = new Set<number>();
  const hold = (tour: PendingTour, pax: number | null, issue: string) => recommendations.push({ tour, pax, route: null, hotel: null, rooms: [], issue });
  for (const tour of pending) {
    const id = Number(tour.tourId);
    if (seen.has(id)) continue;
    seen.add(id);
    if (tour.start && (tour.start > to || (tour.start < from && (!tour.reapproval || !tour.end || tour.end < from)))) continue;
    const input = inputs[id];
    const pax = input?.pax ?? tour.needHotel;
    if (pax === 0 && (!tour.unclassified || input?.pax === 0)) continue;
    if (approvedIds.has(id)) {
      hold(tour, pax, 'This tour already has a fixed approved stay.');
      continue;
    }
    if (pax == null || !Number.isInteger(pax) || pax < 0 || (input?.pax === undefined && tour.unclassified)) {
      hold(tour, pax, 'Confirm the number of guests who need a Najaf hotel in Edit pending hotel pax.');
      continue;
    }
    if (!valid(tour.start) || !valid(tour.end) || daysBetween(tour.start, tour.end) < 2) {
      hold(tour, pax, 'Confirm trip dates with at least one night in each city.');
      continue;
    }
    if (tour.start < coveredFrom && tour.start >= today) {
      hold(tour, pax, 'Extend the Najaf pull back to the trip’s arrival.');
      continue;
    }
    if (addDays(tour.end, -1) > coveredThrough) {
      hold(tour, pax, `Extend the Najaf pull through ${tour.end}.`);
      continue;
    }

    const cities = tour.route ? tour.route.toLowerCase().split('→').map((city) => city.trim()) : [];
    if (cities.length > 2 || cities.some((city) => city !== 'najaf' && city !== 'karbala')) {
      hold(tour, pax, 'Review the recorded itinerary before replacing any city stay.');
      continue;
    }

    const parsed = parseRoomSpec(input?.spec);
    const labels = [...new Set(input?.roomNos ?? [])];
    const pin = labels.length ? 'ruya' : input?.pin ?? null;
    if (!labels.length && (!pin || pin === 'ruya') && (parsed.error || (parsed.rooms.length && parsed.beds < pax))) {
      hold(tour, pax, 'Check the saved room request against the hotel pax.');
      continue;
    }

    let routes = (['najaf', 'karbala'] as const).map((first) => routeFor(tour, balancedSegments(tour.start!, tour.end!, first), settings));
    if (tour.start < today) {
      // A started re-approval can keep its recorded itinerary if it already meets the split rule.
      routes = routes.filter((route) => {
        const recorded = tour.najaf;
        const leg = route.segments.find((s) => s.city === 'najaf')!;
        return tour.reapproval && route.retainsOrder && recorded.length === 1 && recorded[0].checkIn === leg.from && recorded[0].checkOut === leg.to;
      });
      if (!routes.length || tour.end < today) {
        hold(tour, pax, 'Review the existing city stays for this trip before proposing dates.');
        continue;
      }
    }
    const options = routes.filter((route) => route.nights.every((date) => dateIndex.has(date))).map((route) => {
      const index = route.nights.map((date) => dateIndex.get(date)!);
      return { ...route, index, mask: index.reduce((mask, day) => mask | bit(day), 0n) };
    });
    if (!options.length) {
      hold(tour, pax, 'Extend the Najaf pull to cover the whole proposed stay.');
      continue;
    }
    options.sort((a, b) => b.nights.length - a.nights.length || +b.retainsOrder - +a.retainsOrder || +a.needsFlightCheck - +b.needsFlightCheck);
    candidates.push({ tour, pax, options, pin, labels, spec: parsed.rooms });
  }

  candidates.sort((a, b) =>
    +Boolean(b.pin) - +Boolean(a.pin) || +b.tour.reapproval - +a.tour.reapproval || a.options.length - b.options.length ||
    b.pax - a.pax || a.tour.start!.localeCompare(b.tour.start!) || Number(a.tour.tourId) - Number(b.tour.tourId),
  );
  const remaining = Array<number[]>(candidates.length + 1);
  remaining[candidates.length] = [0, 0, 0, 0, 0, 0];
  const future = Array<bigint>(candidates.length + 1).fill(0n);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i];
    const canUseRuya = !candidate.pin || candidate.pin === 'ruya';
    const upper = [1, canUseRuya ? candidate.pax * candidate.options[0].nights.length : 0, +canUseRuya,
      +(canUseRuya && candidate.tour.reapproval), 0, +candidate.options.some((option) => option.retainsOrder)];
    remaining[i] = remaining[i + 1].map((value, index) => value + upper[index]);
    future[i] = candidate.options.reduce((mask, option) => mask | option.mask, future[i + 1]);
  }

  // Exact room labels break interchangeability for earlier candidates.
  const namedRooms = new Set(candidates.flatMap((c) => c.labels));
  const labels = rooms.map((room, index) => namedRooms.has(room.label) ? bit(allDates.length + index) : 0n);
  const labelBits = labels.reduce((mask, label) => mask | label, 0n);
  function* roomOptions(candidate: Candidate, route: Option, later: bigint): Generator<number[]> {
    if (route.index.some((i) => conflicts.has(i) || ruya[i] + candidate.pax > baseline.capacity.ruya)) return;
    if (!rooms.length && !candidate.labels.length) {
      yield [];
      return;
    }
    const free = rooms.flatMap((_, index) => (masks[index] & route.mask) === 0n ? [index] : []);
    if (candidate.labels.length) {
      const picked = free.filter((index) => candidate.labels.includes(rooms[index].label));
      if (picked.length === candidate.labels.length && picked.reduce((sum, index) => sum + rooms[index].beds, 0) >= candidate.pax) yield picked;
      return;
    }
    // Earlier named groups have priority in the search, but treat every named
    // room as distinct while there are still later choices to explore.
    const distinct = masks.map((mask, i) => mask | labels[i]);
    yield* roomSets(candidate.pax, candidate.spec, free, rooms, distinct, later | labelBits);
  }

  function* choices(candidate: Candidate, later: bigint): Generator<Choice | null> {
    const routes = candidate.options;
    const iterators = !candidate.pin || candidate.pin === 'ruya'
      ? routes.map((route) => ({ route, sets: roomOptions(candidate, route, later) }))
      : [];
    for (const { route, sets } of iterators) {
      const picked = sets.next();
      if (!picked.done) yield { route, hotel: 'ruya', rooms: picked.value };
    }
    for (const route of routes) {
      if ((!candidate.pin || candidate.pin === 'araf') && route.index.every((i) => araf[i] + candidate.pax <= baseline.capacity.araf)) {
        yield { route, hotel: 'araf', rooms: [] };
      }
      if (!candidate.pin || candidate.pin === 'c') yield { route, hotel: 'c', rooms: [] };
    }
    if (candidate.pin && candidate.pin !== 'c') yield null;
    for (const { route, sets } of iterators) for (const picked of sets) yield { route, hotel: 'ruya', rooms: picked };
  }

  const selected: (Choice | null)[] = [];
  let best: (Choice | null)[] = [];
  let bestScore: Score = [-1, 0, 0, 0, 0, 0];
  let visited = 0;
  let limited = false;

  function search(i: number, score: Score) {
    const optimistic = score.map((value, index) => value + remaining[i][index]);
    if (visited++ >= Math.max(searchLimit, candidates.length + 1)) {
      limited = true;
      return;
    }
    if (compareScores(optimistic, bestScore) <= 0) return;
    if (i === candidates.length) {
      if (compareScores(score, bestScore) > 0) {
        bestScore = score;
        best = [...selected];
      }
      return;
    }
    const candidate = candidates[i];
    for (const choice of choices(candidate, future[i + 1])) {
      selected[i] = choice;
      const next: Score = [...score];
      const hotel = choice?.hotel;
      if (choice) {
        next[0]++;
        if (hotel === 'ruya') {
          next[1] += candidate.pax * choice.route.nights.length;
          next[2]++;
          if (candidate.tour.reapproval) next[3]++;
        }
        if (hotel === 'c') next[4] -= candidate.pax * choice.route.nights.length;
        if (choice.route.retainsOrder) next[5]++;
      }
      const load = hotel === 'ruya' ? ruya : hotel === 'araf' ? araf : null;
      for (const day of choice?.route.index ?? []) if (load) load[day] += candidate.pax;
      for (const room of choice?.rooms ?? []) masks[room] |= choice!.route.mask;
      search(i + 1, next);
      for (const day of choice?.route.index ?? []) if (load) load[day] -= candidate.pax;
      for (const room of choice?.rooms ?? []) masks[room] &= ~choice!.route.mask;
      if (limited || compareScores(optimistic, bestScore) <= 0) return;
    }
  }

  search(0, [0, 0, 0, 0, 0, 0]);
  const projected = allDates.map((date, i): ApprovalDay => ({
    date, fixedRuya: ruya[i], proposedRuya: 0, ruyaBedsUsed: bedsUsed[i], proposedAraf: 0, proposedOverflow: 0, arrivals: [], fixedRoomConflict: conflicts.has(i),
  }));
  let lastDate = to;
  const totals = { ruyaTours: 0, arafTours: 0, overflowTours: 0 };
  candidates.forEach((c, i) => {
    const choice = best[i];
    if (!choice) {
      hold(c.tour, c.pax, 'The saved hotel or exact rooms do not fit alongside the other stays.');
      return;
    }
    const picked = choice.rooms.map((index) => rooms[index]).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const { route, hotel } = choice;
    const { segments, nights, retainsOrder, hasDepartureDay, needsFlightCheck } = route;
    const reportEnd = c.tour.end! > coveredThrough ? coveredThrough : c.tour.end!;
    if (reportEnd > lastDate) lastDate = reportEnd;
    const bedCount = picked.length ? picked.reduce((sum, room) => sum + room.beds, 0) : c.pax;
    totals[hotel === 'ruya' ? 'ruyaTours' : hotel === 'araf' ? 'arafTours' : 'overflowTours']++;
    for (const index of route.index) {
      const day = projected[index];
      if (day.date > lastDate) lastDate = day.date;
      if (hotel === 'ruya') {
        day.proposedRuya += c.pax;
        day.ruyaBedsUsed += bedCount;
      } else if (hotel === 'araf') day.proposedAraf += c.pax;
      else day.proposedOverflow += c.pax;
    }
    const checkIn = segments.find((s) => s.city === 'najaf')!.from;
    const arrival = dateIndex.get(checkIn);
    if (arrival !== undefined) projected[arrival].arrivals.push({ tourNo: c.tour.tourNo, pax: c.pax, hotel });
    recommendations.push({ tour: c.tour, pax: c.pax, route: { segments, nights, retainsOrder, hasDepartureDay, needsFlightCheck }, hotel, rooms: picked, issue: null });
  });
  const days = projected.filter(({ date }) => date >= from && date <= lastDate);
  recommendations.sort((a, b) => +b.tour.reapproval - +a.tour.reapproval || (a.tour.start ?? '').localeCompare(b.tour.start ?? '') ||
    a.tour.tourNo.localeCompare(b.tour.tourNo, undefined, { numeric: true }));
  const [ready, ruyaGuestNights] = bestScore;
  return {
    recommendations,
    days,
    capacity: baseline.capacity.ruya,
    fixedGuestNights: days.reduce((sum, day) => sum + day.fixedRuya, 0),
    ruyaGuestNights,
    heldTours: recommendations.length - ready,
    limited,
    ...totals,
  };
}

export const approvalCity = (city: Venue) => CITY[city];
