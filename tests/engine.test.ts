import { describe, expect, it } from 'vitest';
import { buildPlan, nightsOf, staysDepartureDay, suggestRooms } from '../shared/engine';
import { parseRoomSpec, describeRooms } from '../shared/roomSpec';
import type { Group, Settings } from '../shared/types';

const settings = (over: Partial<Settings> = {}): Settings => ({ ruyaCapacity: 97, arafCapacity: 100, rooms: [], departureDayRule: true, ...over });

let seq = 0;
function group(over: Partial<Group> & Pick<Group, 'pax' | 'checkIn' | 'checkOut'>): Group {
  seq += 1;
  return {
    id: over.id ?? `g${seq}`,
    tourId: seq,
    planId: 1,
    ref: `T/${seq}`,
    tourNo: over.tourNo ?? String(1000 + seq),
    office: 'FH',
    leader: 'Leader',
    paxTotal: over.pax,
    paxNkerpHoused: 0,
    arrivalAt: `${over.checkIn}T11:00:00`,
    departureAt: `${over.checkOut}T08:00:00`,
    arrival: { kind: 'transfer', place: 'KARBALA', flight: null },
    departure: { kind: 'transfer', place: 'KARBALA', flight: null, airline: null },
    secondLeg: true,
    seenIn: { tourList: true, dashboard: true },
    notes: [],
    ...over,
  };
}
const iraqi = { kind: 'airport' as const, place: 'Najaf Airport', flight: 'IA 441', airline: 'IA' };

describe('nights', () => {
  it('ends the night before departure', () => {
    expect(nightsOf(group({ pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-04' }), settings())).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
  });
  it('counts the departure day for second-leg groups on Iraqi Airways from Najaf', () => {
    const g = group({ pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-02', departure: iraqi });
    expect(staysDepartureDay(g, settings())).toBe(true);
    expect(nightsOf(g, settings())).toEqual(['2026-12-01', '2026-12-02']);
  });
  it('does not apply the rule to first-leg groups, other airlines or other airports', () => {
    const base = { pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-03' };
    expect(staysDepartureDay(group({ ...base, departure: iraqi, secondLeg: false }), settings())).toBe(false);
    expect(staysDepartureDay(group({ ...base, departure: { ...iraqi, flight: 'G9 374', airline: 'G9' } }), settings())).toBe(false);
    expect(staysDepartureDay(group({ ...base, departure: { ...iraqi, place: 'Baghdad Airport' } }), settings())).toBe(false);
    expect(staysDepartureDay(group({ ...base, departure: iraqi }), settings({ departureDayRule: false }))).toBe(false);
  });
});

describe('hotel priority by head count', () => {
  it('fills Ruya, then Araf, then Hotel C, never splitting a group', () => {
    const groups = [
      group({ id: 'a', pax: 60, checkIn: '2026-12-01', checkOut: '2026-12-05' }),
      group({ id: 'b', pax: 45, checkIn: '2026-12-02', checkOut: '2026-12-04' }), // 37 free in Ruya: whole group to Araf
      group({ id: 'c', pax: 70, checkIn: '2026-12-02', checkOut: '2026-12-04' }), // processed before b (larger), also Araf
      group({ id: 'd', pax: 30, checkIn: '2026-12-03', checkOut: '2026-12-06' }), // fits Ruya
    ];
    const plan = buildPlan({ groups, inputs: {}, settings: settings(), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('ruya');
    expect(plan.placements.c.hotel).toBe('araf');
    expect(plan.placements.c.reason).toBe('ruya-full');
    expect(plan.placements.b.hotel).toBe('c');
    expect(plan.placements.b.reason).toBe('araf-full');
    expect(plan.placements.d.hotel).toBe('ruya');
    const dec3 = plan.days.find((d) => d.date === '2026-12-03')!;
    expect(dec3.hotels.ruya.pax).toBe(90);
    expect(dec3.hotels.araf.pax).toBe(70);
    expect(dec3.hotels.c.pax).toBe(45);
  });

  it('gives beds freed by a departure to arrivals on the same date', () => {
    const groups = [
      group({ id: 'out', pax: 90, checkIn: '2026-12-01', checkOut: '2026-12-03' }),
      group({ id: 'in', pax: 80, checkIn: '2026-12-03', checkOut: '2026-12-05' }),
    ];
    const plan = buildPlan({ groups, inputs: {}, settings: settings(), from: '2026-12-01' });
    expect(plan.placements.in.hotel).toBe('ruya');
  });

  it('keeps a group out of Ruya when the departure-day night collides', () => {
    const groups = [
      group({ id: 'out', pax: 90, checkIn: '2026-12-01', checkOut: '2026-12-03', departure: iraqi }),
      group({ id: 'in', pax: 80, checkIn: '2026-12-03', checkOut: '2026-12-05' }),
    ];
    const plan = buildPlan({ groups, inputs: {}, settings: settings(), from: '2026-12-01' });
    expect(plan.placements.in.hotel).toBe('araf');
    expect(plan.days.find((d) => d.date === '2026-12-03')!.hotels.ruya.pax).toBe(90);
  });

  it('needs room on every night of the stay, and lists the Araf booking', () => {
    const groups = [
      group({ id: 'late', pax: 80, checkIn: '2026-12-03', checkOut: '2026-12-06' }),
      group({ id: 'long', pax: 30, checkIn: '2026-12-01', checkOut: '2026-12-05' }),
    ];
    // "long" arrives first and takes Ruya; "late" then cannot fit and goes to Araf.
    const plan = buildPlan({ groups, inputs: {}, settings: settings(), from: '2026-12-01' });
    expect(plan.placements.long.hotel).toBe('ruya');
    expect(plan.placements.late.hotel).toBe('araf');
    expect(plan.bookings).toEqual([
      expect.objectContaining({ hotel: 'araf', from: '2026-12-03', lastNight: '2026-12-05', nights: 3, peak: 80, groupIds: ['late'] }),
    ]);
  });

  it('honours a hand-picked hotel and flags it when it does not fit', () => {
    const groups = [
      group({ id: 'a', pax: 90, checkIn: '2026-12-01', checkOut: '2026-12-04' }),
      group({ id: 'b', pax: 20, checkIn: '2026-12-02', checkOut: '2026-12-04' }),
    ];
    const plan = buildPlan({ groups, inputs: { b: { pin: 'ruya' }, a: { pin: 'ruya' } }, settings: settings(), from: '2026-12-01' });
    expect(plan.placements.b.hotel).toBe('ruya');
    expect(plan.placements.b.overbooked).toBe(true);
    expect(plan.placements.a.overbooked).toBe(false);
  });
});

describe('Ruya room by room', () => {
  const rooms = [
    { beds: 2, count: 4 },
    { beds: 5, count: 2 },
  ]; // 18 beds
  it('gives exactly the rooms asked for', () => {
    const g = group({ id: 'a', pax: 10, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({ groups: [g], inputs: { a: { spec: '2x5' } }, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('ruya');
    expect(plan.placements.a.rooms.map((r) => r.beds)).toEqual([5, 5]);
    expect(plan.capacity.ruya).toBe(18);
  });
  it('sends the whole group to Araf with "room-mix" when beds exist but the rooms do not', () => {
    const g = group({ id: 'a', pax: 10, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({ groups: [g], inputs: { a: { spec: '5x2' } }, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('araf');
    expect(plan.placements.a.reason).toBe('room-mix');
    expect(plan.days[0].hotels.ruya.pax).toBe(0); // Ruya rooms stay empty
  });
  it('says "ruya-full" when there are simply not enough beds', () => {
    const groups = [
      group({ id: 'a', pax: 12, checkIn: '2026-12-01', checkOut: '2026-12-04' }),
      group({ id: 'b', pax: 10, checkIn: '2026-12-02', checkOut: '2026-12-03' }),
    ];
    const plan = buildPlan({ groups, inputs: { b: { spec: '5x2' } }, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('ruya');
    expect(plan.placements.b.reason).toBe('ruya-full');
  });
  it('suggests the tightest set of rooms when nothing was typed', () => {
    const g = group({ id: 'a', pax: 9, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({ groups: [g], inputs: {}, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.specSource).toBe('suggested');
    expect(plan.placements.a.rooms.map((r) => r.beds).sort()).toEqual([2, 2, 5]);
  });
  it('never gives one room to two groups on the same night, and reuses it after checkout', () => {
    const groups = [
      group({ id: 'a', pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-03' }),
      group({ id: 'b', pax: 5, checkIn: '2026-12-02', checkOut: '2026-12-04' }),
      group({ id: 'c', pax: 5, checkIn: '2026-12-03', checkOut: '2026-12-05' }),
    ];
    const inputs = { a: { spec: '1x5' }, b: { spec: '1x5' }, c: { spec: '1x5' } };
    const plan = buildPlan({ groups, inputs, settings: settings({ rooms }), from: '2026-12-01' });
    const [ra, rb, rc] = ['a', 'b', 'c'].map((id) => plan.placements[id].rooms[0].id);
    expect(ra).not.toBe(rb);
    expect(rc).toBe(ra); // freed on the 3rd, taken again the same day
    expect(plan.placements.c.hotel).toBe('ruya');
  });
  it('places opening-balance guests first', () => {
    const g = group({ id: 'a', pax: 10, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({
      groups: [g],
      inputs: { a: { spec: '2x5' } },
      settings: settings({ rooms }),
      holds: [{ id: 'h', label: 'November', hotel: 'ruya', pax: 5, from: '2026-11-28', to: '2026-12-02', rooms: [5] }],
      from: '2026-12-01',
    });
    expect(plan.placements.a.hotel).toBe('araf');
    expect(plan.days[0].hotels.ruya.pax).toBe(5);
  });
});

describe('room suggestions', () => {
  it('wastes as few beds as possible, then uses the fewest rooms', () => {
    const free = [2, 2, 2, 3, 4, 8].map((beds, i) => ({ id: String(i), beds, label: String(i) }));
    expect(suggestRooms(8, free)!.map((r) => r.beds)).toEqual([8]);
    expect(suggestRooms(7, free)!.map((r) => r.beds).sort()).toEqual([3, 4]);
    expect(suggestRooms(30, free)).toBeNull();
  });
});

describe('reading room requests', () => {
  it.each([
    ['5x2', [2, 2, 2, 2, 2]],
    ['5 rooms of 2', [2, 2, 2, 2, 2]],
    ['2 x 5-bed', [5, 5]],
    ['2,2,2,3', [3, 2, 2, 2]],
    ['22222', [2, 2, 2, 2, 2]],
    ['5x2 + 1x3', [3, 2, 2, 2, 2, 2]],
    ['10', [10]],
    ['2 2 4', [4, 2, 2]],
  ])('%s', (text, rooms) => {
    expect(parseRoomSpec(text)).toMatchObject({ rooms, error: null });
  });
  it('reports text it cannot read', () => {
    expect(parseRoomSpec('two big rooms').error).toBeTruthy();
    expect(parseRoomSpec('').rooms).toEqual([]);
  });
  it('describes rooms in words', () => {
    expect(describeRooms([2, 2, 2, 3])).toBe('1 × 3-bed, 3 × 2-bed');
  });
});
