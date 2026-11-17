/**
 * The planner: decides which hotel every group sleeps in, night by night.
 *
 * Rules, in the order they apply
 * ------------------------------
 * 1. Hotels fill in priority order: Ruya, then Araf, then Hotel C (no limit).
 * 2. A group is one tour's "accommodation not required" guests. It is never
 *    split between hotels and never moves hotel during its stay, so a hotel
 *    must have room for the whole group on every night of the stay.
 * 3. A group sleeps from its Najaf arrival date up to the night before its
 *    departure date. If Najaf is the second half of the trip and the group
 *    flies out of Najaf Airport on Iraqi Airways, the departure day counts as
 *    a night too.
 * 4. Rooms freed by a departure are available to arrivals on that same date.
 * 5. Groups are placed in arrival order; on the same date larger groups go
 *    first, so the biggest groups get the first claim on Ruya.
 * 6. Ruya is planned room by room when its room list is known. A group gets
 *    exactly the rooms it asked for, or none: if Ruya cannot give that exact
 *    set for the whole stay the whole group goes to Araf and the Ruya rooms
 *    stay empty. The reason is recorded as either "room-mix" (beds were
 *    there, the rooms were not) or "ruya-full" (not enough beds).
 * 7. A person can keep a group in a chosen hotel. That choice is honoured
 *    even when it overbooks the hotel, and is flagged.
 * 8. The opening balance (who is already in house on the first night) is
 *    booked first, in its exact Ruya rooms when they are given. Groups that
 *    reached Najaf before the planning start are covered by it, so they are
 *    listed but not placed, unless a person keeps them in a hotel by hand.
 */
import { addDays, dayMonth, eachDate } from './dates';
import { describeRooms, groupRooms, parseRoomSpec } from './roomSpec';
import type { Booking, DayRow, Group, GroupInput, Hold, HotelDay, HotelId, Placement, Plan, Reason, Room, Settings } from './types';

export const HOTEL_ORDER: HotelId[] = ['ruya', 'araf', 'c'];
export const HOTEL_NAME: Record<HotelId, string> = { ruya: 'Ruya', araf: 'Araf', c: 'Hotel C' };

/** The flag shown for each reason. `detail` on the placement carries the evidence. */
export const REASON_LABEL: Record<Reason, string> = {
  fits: 'In Ruya',
  'room-mix': 'Rooms not available in Ruya',
  'ruya-full': 'Ruya is full',
  'araf-full': 'Ruya and Araf are full',
  pinned: 'Kept here by hand',
  held: 'Opening balance',
};

/** True when the group's departure day counts as a night of its stay. */
export function staysDepartureDay(group: Group, settings: Pick<Settings, 'departureDayRule'>): boolean {
  if (!settings.departureDayRule) return false;
  const { departure } = group;
  return (
    group.secondLeg &&
    departure.kind === 'airport' &&
    /najaf/i.test(departure.place) &&
    (departure.airline === 'IA' || departure.airline === 'IAW')
  );
}

/** Every night the group sleeps in Najaf. */
export function nightsOf(group: Group, settings: Pick<Settings, 'departureDayRule'>): string[] {
  const last = staysDepartureDay(group, settings) ? group.checkOut : addDays(group.checkOut, -1);
  return last < group.checkIn ? [] : eachDate(group.checkIn, last);
}

/** Rooms in room-number order: 101, 102, … 110, 201. */
const byLabel = (rooms: Room[]): Room[] => [...rooms].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

/** Expands the room list into individual rooms. */
export function expandRooms(types: Settings['rooms']): Room[] {
  const rooms: Room[] = [];
  for (const type of [...types].sort((a, b) => a.beds - b.beds)) {
    for (let i = 0; i < type.count; i += 1) {
      const label = type.labels?.[i]?.trim() || `${type.beds}-${String(i + 1).padStart(2, '0')}`;
      rooms.push({ id: `${type.beds}b-${i + 1}`, beds: type.beds, label });
    }
  }
  return rooms;
}

interface RoomState extends Room {
  /** Booked nights. */
  taken: Set<string>;
  /** Last night of the most recent booking, for tight packing. */
  lastUsed: string;
}

interface Candidate {
  id: string;
  pax: number;
  nights: string[];
  order: string;
}

/**
 * Chooses rooms covering `pax` with the fewest empty beds, then the fewest
 * rooms. `free` is the rooms available for the whole stay.
 */
export function suggestRooms(pax: number, free: readonly Room[]): Room[] | null {
  const total = free.reduce((sum, r) => sum + r.beds, 0);
  if (pax <= 0) return [];
  if (total < pax) return null;
  // best[b] = fewest rooms giving exactly b beds; from[b] remembers the last room used.
  const limit = total;
  const best = new Array<number>(limit + 1).fill(Infinity);
  const picks: (number[] | null)[] = new Array(limit + 1).fill(null);
  best[0] = 0;
  picks[0] = [];
  free.forEach((room, index) => {
    for (let b = limit; b >= room.beds; b -= 1) {
      const prev = best[b - room.beds];
      if (prev + 1 < best[b]) {
        best[b] = prev + 1;
        picks[b] = [...(picks[b - room.beds] as number[]), index];
      }
    }
  });
  for (let b = pax; b <= limit; b += 1) {
    if (picks[b]) return (picks[b] as number[]).map((i) => free[i]);
  }
  return null;
}

class Ruya {
  readonly rooms: RoomState[];
  readonly byRooms: boolean;
  readonly capacity: number;
  private paxByNight = new Map<string, number>();
  private bedsByNight = new Map<string, number>();

  constructor(settings: Settings) {
    this.rooms = expandRooms(settings.rooms).map((r) => ({ ...r, taken: new Set<string>(), lastUsed: '' }));
    this.byRooms = this.rooms.length > 0;
    this.capacity = this.byRooms ? this.rooms.reduce((sum, r) => sum + r.beds, 0) : settings.ruyaCapacity;
  }

  private freeRooms(nights: string[]): RoomState[] {
    return this.rooms.filter((room) => nights.every((n) => !room.taken.has(n)));
  }

  /** Fewest free beds on any night of the stay, and the night it happens. */
  tightest(nights: string[]): { free: number; night: string } {
    let result = { free: Infinity, night: nights[0] ?? '' };
    for (const night of nights) {
      const used = this.byRooms ? (this.bedsByNight.get(night) ?? 0) : (this.paxByNight.get(night) ?? 0);
      const free = this.capacity - used;
      if (free < result.free) result = { free, night };
    }
    return result;
  }

  /** The rooms with these numbers that are free on every night given. */
  roomsByLabel(labels: readonly string[], nights: string[]): RoomState[] {
    const wanted = new Set(labels.map((l) => l.trim()));
    return this.freeRooms(nights).filter((room) => wanted.has(room.label));
  }

  /** Picks concrete rooms for a list of bed sizes, or says which size ran short. */
  private match(spec: number[], nights: string[]): { rooms: RoomState[] } | { shortOf: { beds: number; need: number; have: number } } {
    const free = this.freeRooms(nights);
    const first = nights[0];
    const chosen: RoomState[] = [];
    for (const { beds, count } of groupRooms(spec)) {
      // Prefer the room whose last guests left most recently: keeps untouched rooms free for long stays.
      const pool = free
        .filter((r) => r.beds === beds)
        .sort((a, b) => (a.lastUsed < first ? 0 : 1) - (b.lastUsed < first ? 0 : 1) || b.lastUsed.localeCompare(a.lastUsed) || a.id.localeCompare(b.id, undefined, { numeric: true }));
      if (pool.length < count) return { shortOf: { beds, need: count, have: pool.length } };
      chosen.push(...pool.slice(0, count));
    }
    return { rooms: chosen };
  }

  book(pax: number, nights: string[], rooms: RoomState[]) {
    const beds = rooms.reduce((sum, r) => sum + r.beds, 0);
    for (const night of nights) {
      this.paxByNight.set(night, (this.paxByNight.get(night) ?? 0) + pax);
      this.bedsByNight.set(night, (this.bedsByNight.get(night) ?? 0) + (this.byRooms ? beds : pax));
      for (const room of rooms) room.taken.add(night);
    }
    const last = nights[nights.length - 1] ?? '';
    for (const room of rooms) if (last > room.lastUsed) room.lastUsed = last;
  }

  /**
   * Tries to place a group. Returns the rooms on success, or the reason it
   * does not fit. Never books anything itself.
   */
  tryFit(
    candidate: Candidate,
    spec: number[] | null,
  ): { ok: true; rooms: RoomState[]; spec: number[] | null; source: Placement['specSource'] } | { ok: false; reason: Reason; detail: string } {
    const { pax, nights } = candidate;
    const tight = this.tightest(nights);
    if (!this.byRooms) {
      if (tight.free >= pax) return { ok: true, rooms: [], spec, source: spec ? 'typed' : 'none' };
      return { ok: false, reason: 'ruya-full', detail: fullDetail(tight, pax) };
    }
    if (tight.free < pax) return { ok: false, reason: 'ruya-full', detail: fullDetail(tight, pax) };
    if (spec?.length) {
      const result = this.match(spec, nights);
      if ('rooms' in result) return { ok: true, rooms: result.rooms, spec, source: 'typed' };
      const { beds, need, have } = result.shortOf;
      return {
        ok: false,
        reason: 'room-mix',
        detail: `Needs ${need} × ${beds}-bed, ${have === 0 ? 'none' : `only ${have}`} free for the whole stay.`,
      };
    }
    const suggested = suggestRooms(pax, this.freeRooms(nights));
    if (suggested) {
      const ids = new Set(suggested.map((r) => r.id));
      const rooms = this.rooms.filter((r) => ids.has(r.id));
      return { ok: true, rooms, spec: rooms.map((r) => r.beds).sort((a, b) => b - a), source: 'suggested' };
    }
    return {
      ok: false,
      reason: 'room-mix',
      detail: 'Enough beds each night, but no set of rooms stays free for the whole stay.',
    };
  }
}

const bedsFree = (tight: { free: number; night: string }) =>
  `${Math.max(0, tight.free)} ${tight.free === 1 ? 'bed' : 'beds'} free on ${dayMonth(tight.night)}`;
const fullDetail = (tight: { free: number; night: string }, pax: number) => `${bedsFree(tight)}, the group needs ${pax}.`;

class HeadCount {
  private byNight = new Map<string, number>();
  constructor(readonly capacity: number) {}
  tightest(nights: string[]) {
    let result = { free: Infinity, night: nights[0] ?? '' };
    for (const night of nights) {
      const free = this.capacity - (this.byNight.get(night) ?? 0);
      if (free < result.free) result = { free, night };
    }
    return result;
  }
  book(pax: number, nights: string[]) {
    for (const night of nights) this.byNight.set(night, (this.byNight.get(night) ?? 0) + pax);
  }
}

export interface PlanInput {
  groups: Group[];
  inputs: Record<string, GroupInput | undefined>;
  settings: Settings;
  holds?: Hold[];
  /** First date shown. */
  from: string;
  /** Last date shown. Defaults to the last night anyone stays. */
  to?: string | null;
  /**
   * First night of the plan. Groups arriving earlier are covered by the
   * opening balance and are not placed (unless kept in a hotel by hand).
   */
  start?: string | null;
}

export function buildPlan({ groups, inputs, settings, holds = [], from, to, start = null }: PlanInput): Plan {
  const ruya = new Ruya(settings);
  const araf = new HeadCount(settings.arafCapacity);
  const placements: Record<string, Placement> = {};

  const base = (id: string, nights: string[], extra: Partial<Placement>): Placement => ({
    groupId: id,
    hotel: 'c',
    reason: 'fits',
    detail: '',
    nights,
    staysDepartureDay: false,
    rooms: [],
    spec: null,
    specSource: 'none',
    beds: 0,
    overbooked: false,
    carriedOver: false,
    specIssue: null,
    ...extra,
  });

  // ---- opening balance: guests already in house ---------------------------
  for (const hold of holds) {
    const nights = hold.to > hold.from ? eachDate(hold.from, addDays(hold.to, -1)) : [];
    const candidate: Candidate = { id: hold.id, pax: hold.pax, nights, order: '' };
    let rooms: Room[] = [];
    if (hold.hotel === 'ruya') {
      let state: RoomState[];
      if (hold.roomLabels?.length && ruya.byRooms) {
        state = ruya.roomsByLabel(hold.roomLabels, nights);
      } else {
        const fit = ruya.tryFit(candidate, hold.rooms?.length ? [...hold.rooms].sort((a, b) => b - a) : null);
        state = fit.ok ? fit.rooms : [];
      }
      ruya.book(hold.pax, nights, state);
      rooms = byLabel(state.map(({ id, beds, label }) => ({ id, beds, label })));
    } else if (hold.hotel === 'araf') {
      araf.book(hold.pax, nights);
    }
    placements[hold.id] = base(hold.id, nights, {
      hotel: hold.hotel,
      reason: 'held',
      detail: `${hold.label}: already in ${HOTEL_NAME[hold.hotel]} at the start.`,
      rooms,
      beds: rooms.reduce((sum, r) => sum + r.beds, 0),
      carriedOver: true,
    });
  }

  // ---- groups --------------------------------------------------------------
  const before: string[] = [];
  const queue = groups
    .filter((g) => g.pax > 0)
    .filter((g) => {
      const early = Boolean(start && g.checkIn < start && !inputs[g.id]?.pin);
      if (early) before.push(g.id);
      return !early;
    })
    .map((group) => {
      const nights = nightsOf(group, settings);
      const input = inputs[group.id] ?? {};
      const parsed = parseRoomSpec(input.spec);
      return { group, nights, input, parsed };
    })
    .sort((a, b) => {
      const pinA = a.input.pin ? 0 : 1;
      const pinB = b.input.pin ? 0 : 1;
      return (
        pinA - pinB ||
        a.group.checkIn.localeCompare(b.group.checkIn) ||
        b.group.pax - a.group.pax ||
        (a.group.arrivalAt ?? '').localeCompare(b.group.arrivalAt ?? '') ||
        a.group.tourNo.localeCompare(b.group.tourNo, undefined, { numeric: true })
      );
    });

  for (const { group, nights, input, parsed } of queue) {
    const candidate: Candidate = { id: group.id, pax: group.pax, nights, order: group.checkIn };
    const spec = parsed.rooms.length ? parsed.rooms : null;
    const specIssue = parsed.error
      ? parsed.error
      : spec && parsed.beds < group.pax
        ? `These rooms sleep ${parsed.beds}, the group is ${group.pax}.`
        : null;
    const common: Partial<Placement> = {
      staysDepartureDay: staysDepartureDay(group, settings),
      carriedOver: group.checkIn < from,
      spec,
      specSource: spec ? 'typed' : 'none',
      specIssue,
    };
    const toRooms = (rooms: RoomState[]): Room[] => byLabel(rooms.map(({ id, beds, label }) => ({ id, beds, label })));

    if (!nights.length) {
      placements[group.id] = base(group.id, nights, { ...common, hotel: 'ruya', detail: 'Arrives and leaves the same day: no night to book.' });
      continue;
    }

    // A person chose the hotel.
    if (input.pin) {
      const hotel = input.pin;
      let rooms: RoomState[] = [];
      let overbooked = false;
      let source: Placement['specSource'] = common.specSource ?? 'none';
      let usedSpec = spec;
      if (hotel === 'ruya') {
        const fit = ruya.tryFit(candidate, spec);
        if (fit.ok) {
          rooms = fit.rooms;
          source = fit.source;
          usedSpec = fit.spec;
        } else overbooked = true;
        ruya.book(group.pax, nights, rooms);
      } else if (hotel === 'araf') {
        overbooked = araf.tightest(nights).free < group.pax;
        araf.book(group.pax, nights);
      }
      placements[group.id] = base(group.id, nights, {
        ...common,
        hotel,
        reason: 'pinned',
        detail: overbooked
          ? `Kept in ${HOTEL_NAME[hotel]} by hand, but it does not fit there.`
          : `Kept in ${HOTEL_NAME[hotel]} by hand.`,
        rooms: toRooms(rooms),
        spec: usedSpec,
        specSource: source,
        beds: rooms.reduce((sum, r) => sum + r.beds, 0),
        overbooked,
      });
      continue;
    }

    // Ruya first.
    const fit = ruya.tryFit(candidate, spec);
    if (fit.ok) {
      ruya.book(group.pax, nights, fit.rooms);
      placements[group.id] = base(group.id, nights, {
        ...common,
        hotel: 'ruya',
        reason: 'fits',
        detail: fit.rooms.length ? `In Ruya: ${describeRooms(fit.rooms.map((r) => r.beds))}.` : 'In Ruya.',
        rooms: toRooms(fit.rooms),
        spec: fit.spec,
        specSource: fit.source,
        beds: fit.rooms.reduce((sum, r) => sum + r.beds, 0),
      });
      continue;
    }

    // Then Araf, whole group.
    const arafTight = araf.tightest(nights);
    if (arafTight.free >= group.pax) {
      araf.book(group.pax, nights);
      placements[group.id] = base(group.id, nights, { ...common, hotel: 'araf', reason: fit.reason, detail: fit.detail });
      continue;
    }

    // Hotel C takes everyone else.
    placements[group.id] = base(group.id, nights, {
      ...common,
      hotel: 'c',
      reason: 'araf-full',
      detail: `${fit.reason === 'room-mix' ? `Ruya: ${fit.detail.charAt(0).toLowerCase()}${fit.detail.slice(1)}` : `Ruya has ${fit.detail}`} Araf has ${bedsFree(arafTight)}.`,
    });
  }

  return summarise({ groups, holds, placements, before, ruya, settings, from, to });
}

function summarise({
  groups,
  holds,
  placements,
  before,
  ruya,
  settings,
  from,
  to,
}: {
  groups: Group[];
  holds: Hold[];
  placements: Record<string, Placement>;
  before: string[];
  ruya: Ruya;
  settings: Settings;
  from: string;
  to?: string | null;
}): Plan {
  const paxOf = new Map<string, number>([...groups.map((g) => [g.id, g.pax] as const), ...holds.map((h) => [h.id, h.pax] as const)]);
  const lastNight = Object.values(placements).reduce((max, p) => {
    const last = p.nights[p.nights.length - 1];
    return last && last > max ? last : max;
  }, from);
  const end = to && to >= from ? to : lastNight;

  const empty = (): HotelDay => ({ pax: 0, groups: [], beds: 0, rooms: 0 });
  const index = new Map<string, DayRow>();
  const days: DayRow[] = eachDate(from, end).map((date) => {
    const row: DayRow = { date, hotels: { ruya: empty(), araf: empty(), c: empty() }, arrivals: [], departures: [], total: 0 };
    index.set(date, row);
    return row;
  });

  for (const placement of Object.values(placements)) {
    const pax = paxOf.get(placement.groupId) ?? 0;
    for (const night of placement.nights) {
      const row = index.get(night);
      if (!row) continue;
      const cell = row.hotels[placement.hotel];
      cell.pax += pax;
      cell.groups.push(placement.groupId);
      cell.beds += placement.beds;
      cell.rooms += placement.rooms.length;
      row.total += pax;
    }
  }
  for (const group of groups) {
    if (group.pax <= 0 || !placements[group.id]) continue;
    index.get(group.checkIn)?.arrivals.push(group.id);
    index.get(group.checkOut)?.departures.push(group.id);
  }

  const bookings: Booking[] = [];
  for (const hotel of ['araf', 'c'] as const) {
    let run: Booking | null = null;
    for (const row of days) {
      const cell = row.hotels[hotel];
      if (cell.pax === 0) {
        run = null;
        continue;
      }
      if (!run) {
        run = { hotel, from: row.date, lastNight: row.date, nights: 0, peak: 0, groupIds: [], steps: [] };
        bookings.push(run);
      }
      run.lastNight = row.date;
      run.nights += 1;
      run.peak = Math.max(run.peak, cell.pax);
      for (const id of cell.groups) if (!run.groupIds.includes(id)) run.groupIds.push(id);
      const step = run.steps[run.steps.length - 1];
      if (step && step.pax === cell.pax) step.lastNight = row.date;
      else run.steps.push({ from: row.date, lastNight: row.date, pax: cell.pax });
    }
  }
  bookings.sort((a, b) => a.from.localeCompare(b.from) || HOTEL_ORDER.indexOf(a.hotel) - HOTEL_ORDER.indexOf(b.hotel));

  const byHotel = { ruya: tally(), araf: tally(), c: tally() };
  for (const group of groups) {
    const placement = placements[group.id];
    if (!placement || group.pax <= 0) continue;
    byHotel[placement.hotel].groups += 1;
    byHotel[placement.hotel].guests += group.pax;
  }
  for (const row of days) {
    for (const hotel of HOTEL_ORDER) {
      byHotel[hotel].guestNights += row.hotels[hotel].pax;
      byHotel[hotel].peak = Math.max(byHotel[hotel].peak, row.hotels[hotel].pax);
    }
  }
  const real = groups.filter((g) => g.pax > 0 && placements[g.id]);
  return {
    range: { from, to: end },
    capacity: { ruya: ruya.capacity, araf: settings.arafCapacity },
    rooms: ruya.rooms.map(({ id, beds, label }) => ({ id, beds, label })),
    placements,
    before,
    days,
    bookings,
    totals: {
      groups: real.length,
      guests: real.reduce((sum, g) => sum + g.pax, 0),
      byHotel,
      flagged: real.filter((g) => {
        const p = placements[g.id];
        return p && (p.hotel !== 'ruya' || p.overbooked);
      }).length,
    },
  };

  function tally() {
    return { groups: 0, guests: 0, guestNights: 0, peak: 0 };
  }
}
