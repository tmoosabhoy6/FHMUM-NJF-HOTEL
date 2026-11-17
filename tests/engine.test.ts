import { describe, expect, it } from 'vitest';
import { buildPlan, hotelNames, nightsOf, reasonLabel, staysDepartureDay, suggestRooms } from '../shared/engine';
import { describeRooms, formatSpec, parseRoomSpec } from '../shared/roomSpec';
import { hotelMessage } from '../shared/messages';
import { DEFAULT_SETTINGS, OPENING_BALANCE, PLANNING_START, RUYA_SHEET, ruyaRooms } from '../shared/config';
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
    infants: 0,
    paxTotal: over.pax,
    paxNkerpHoused: 0,
    status: 'Approved',
    arrivalAt: `${over.checkIn}T11:00:00`,
    departureAt: `${over.checkOut}T08:00:00`,
    arrival: { kind: 'transfer', place: 'KARBALA', flight: null },
    departure: { kind: 'transfer', place: 'KARBALA', flight: null, airline: null },
    secondLeg: true,
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
  it('counts it for Iraqi Airways from Baghdad too', () => {
    const g = group({ pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-03', departure: { kind: 'airport', place: 'Baghdad Airport', flight: 'IA 112', airline: 'IA' } });
    expect(staysDepartureDay(g, settings())).toBe(true);
    expect(nightsOf(g, settings())).toEqual(['2026-12-01', '2026-12-02', '2026-12-03']);
  });
  it('does not apply the rule to first-leg groups, other airlines or other airports', () => {
    const base = { pax: 5, checkIn: '2026-12-01', checkOut: '2026-12-03' };
    expect(staysDepartureDay(group({ ...base, departure: iraqi, secondLeg: false }), settings())).toBe(false);
    expect(staysDepartureDay(group({ ...base, departure: { ...iraqi, flight: 'G9 374', airline: 'G9' } }), settings())).toBe(false);
    expect(staysDepartureDay(group({ ...base, departure: { ...iraqi, place: 'Basra Airport' } }), settings())).toBe(false);
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
    const plan = buildPlan({ groups: [g], inputs: { a: { spec: '5x2' } }, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('ruya');
    expect(plan.placements.a.rooms.map((r) => r.beds)).toEqual([5, 5]);
    expect(plan.capacity.ruya).toBe(18);
  });
  it('sends the whole group to Araf with "room-mix" when beds exist but the rooms do not', () => {
    const g = group({ id: 'a', pax: 10, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({ groups: [g], inputs: { a: { spec: '2x5' } }, settings: settings({ rooms }), from: '2026-12-01' });
    expect(plan.placements.a.hotel).toBe('araf');
    expect(plan.placements.a.reason).toBe('room-mix');
    expect(plan.days[0].hotels.ruya.pax).toBe(0); // Ruya rooms stay empty
  });
  it('says "ruya-full" when there are simply not enough beds', () => {
    const groups = [
      group({ id: 'a', pax: 12, checkIn: '2026-12-01', checkOut: '2026-12-04' }),
      group({ id: 'b', pax: 10, checkIn: '2026-12-02', checkOut: '2026-12-03' }),
    ];
    const plan = buildPlan({ groups, inputs: { b: { spec: '5 beds x 2 rooms' } }, settings: settings({ rooms }), from: '2026-12-01' });
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
    const inputs = { a: { spec: '5x1' }, b: { spec: '5x1' }, c: { spec: '5x1' } };
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
      inputs: { a: { spec: '5x2' } },
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

describe('reading room requests (bed size first, as the team writes them)', () => {
  it.each([
    ['02 beds x   06 Rooms = 12 beds', [2, 2, 2, 2, 2, 2]],
    ['04 beds x   02 Room  =  08 beds', [4, 4]],
    ['2x6', [2, 2, 2, 2, 2, 2]],
    ['2 X 3', [2, 2, 2]],
    ['2×6, 3×1', [3, 2, 2, 2, 2, 2, 2]],
    ['6 rooms of 2 beds', [2, 2, 2, 2, 2, 2]],
    ['5 rooms of 2', [2, 2, 2, 2, 2]],
    ['2 x 5-bed', [5, 5]],
    ['5-bed x 2', [5, 5]],
    ['2,2,2,3', [3, 2, 2, 2]],
    ['22222', [2, 2, 2, 2, 2]],
    ['2x5 + 3x1', [3, 2, 2, 2, 2, 2]],
    ['10', [10]],
    ['2 2 4', [4, 2, 2]],
    [' 02 beds x   06 Rooms = 12 beds\n 03 beds x   01 Rooms = 03 beds\n 04 beds x   02 Room  =  08 beds\nTOTAL- 23 BEDS', [4, 4, 3, 2, 2, 2, 2, 2, 2]],
  ])('%s', (text, rooms) => {
    expect(parseRoomSpec(text)).toMatchObject({ rooms, error: null });
  });
  it('reports text it cannot read', () => {
    expect(parseRoomSpec('two big rooms').error).toBeTruthy();
    expect(parseRoomSpec('2 beds x 3 beds').error).toBeTruthy();
    expect(parseRoomSpec('').rooms).toEqual([]);
  });
  it('describes rooms bed size first, and writes a short form that reads back the same', () => {
    expect(describeRooms([2, 2, 2, 3])).toBe('2-bed × 3, 3-bed × 1');
    expect(formatSpec([4, 4, 3, 2, 2, 2, 2, 2, 2])).toBe('2x6, 3x1, 4x2');
    expect(parseRoomSpec(formatSpec([4, 4, 3, 2, 2])).rooms).toEqual([4, 4, 3, 2, 2]);
  });
});

describe('Ruya as it really is', () => {
  it('has 33 rooms and 93 beds on the sheet, 84 beds once three rooms are left out', () => {
    expect(RUYA_SHEET).toHaveLength(33);
    expect(RUYA_SHEET.reduce((n, r) => n + r.beds, 0)).toBe(93);
    expect(DEFAULT_SETTINGS.ruyaCapacity).toBe(84);
    expect(ruyaRooms().map((t) => [t.beds, t.count])).toEqual([[2, 11], [3, 14], [4, 5]]);
    expect(ruyaRooms([]).reduce((n, t) => n + t.beds * t.count, 0)).toBe(93);
  });
  it('keeps rooms 109, 110, 201 and 202 for the November group on 1 Dec and frees them on 2 Dec', () => {
    const plan = buildPlan({ groups: [], inputs: {}, settings: DEFAULT_SETTINGS, holds: OPENING_BALANCE, from: PLANNING_START, to: '2026-12-02' });
    expect(plan.placements['opening-ruya'].rooms.map((r) => r.label).sort()).toEqual(['109', '110', '201', '202']);
    expect(plan.days[0].hotels.ruya.beds).toBe(13);
    expect(plan.days[1].hotels.ruya.beds).toBe(0);
  });
  it('gives those four rooms to a group from 2 Dec, not before', () => {
    const big = group({ id: 'big', pax: 71, checkIn: '2026-12-01', checkOut: '2026-12-03' }); // 84 − 13 = 71 free on the 1st
    const next = group({ id: 'next', pax: 13, checkIn: '2026-12-02', checkOut: '2026-12-04' });
    const plan = buildPlan({ groups: [big, next], inputs: {}, settings: DEFAULT_SETTINGS, holds: OPENING_BALANCE, from: PLANNING_START });
    expect(plan.placements.big.hotel).toBe('ruya');
    expect(plan.placements.next.hotel).toBe('ruya');
    expect(plan.placements.next.rooms.map((r) => r.label).sort()).toEqual(['109', '110', '201', '202']);
  });
  it('lists groups that arrived before the first night without placing them, unless kept by hand', () => {
    const early = group({ id: 'early', tourNo: '2447', pax: 18, checkIn: '2026-11-29', checkOut: '2026-12-04' });
    const plan = buildPlan({ groups: [early], inputs: {}, settings: DEFAULT_SETTINGS, holds: OPENING_BALANCE, from: PLANNING_START, start: PLANNING_START });
    expect(plan.before).toEqual(['early']);
    expect(plan.placements.early).toBeUndefined();
    expect(plan.totals.groups).toBe(0);
    const kept = buildPlan({ groups: [early], inputs: { early: { pin: 'araf' } }, settings: DEFAULT_SETTINGS, from: PLANNING_START, start: PLANNING_START });
    expect(kept.before).toEqual([]);
    expect(kept.placements.early.hotel).toBe('araf');
    expect(kept.days[0].hotels.araf.pax).toBe(18);
  });
});

describe('Ruya rooms chosen by hand', () => {
  it('puts the group in exactly those rooms and plans everyone else around them', () => {
    const picked = group({ id: 'picked', pax: 8, checkIn: '2026-12-03', checkOut: '2026-12-06' });
    const auto = group({ id: 'auto', pax: 4, checkIn: '2026-12-01', checkOut: '2026-12-08', tourNo: '9' }); // arrives first, but hand-picked rooms come first
    const plan = buildPlan({
      groups: [auto, picked],
      inputs: { picked: { roomNos: ['101', '102'] }, auto: { spec: '4x1' } },
      settings: DEFAULT_SETTINGS,
      from: PLANNING_START,
    });
    expect(plan.placements.picked).toMatchObject({ hotel: 'ruya', reason: 'pinned', specSource: 'manual', overbooked: false });
    expect(plan.placements.picked.rooms.map((r) => r.label)).toEqual(['101', '102']);
    expect(plan.placements.auto.hotel).toBe('ruya');
    expect(plan.placements.auto.rooms.map((r) => r.label)).not.toContain('101');
    expect(plan.placements.auto.rooms.map((r) => r.label)).not.toContain('102');
  });
  it('flags a clash with the opening balance, a room not in the plan, and too few beds', () => {
    const g = group({ id: 'g', pax: 10, checkIn: '2026-12-01', checkOut: '2026-12-03' });
    const plan = buildPlan({
      groups: [g],
      inputs: { g: { roomNos: ['109', '310', '103'] } },
      settings: DEFAULT_SETTINGS,
      holds: OPENING_BALANCE,
      from: PLANNING_START,
    });
    const p = plan.placements.g;
    expect(p.overbooked).toBe(true);
    expect(p.rooms.map((r) => r.label)).toEqual(['103']);
    expect(p.detail).toMatch(/Room 310 is not in the plan/);
    expect(p.detail).toMatch(/Room 109 is already taken on 1 Dec/);
    expect(p.detail).toMatch(/sleep 3, the group is 10/);
  });
  it('says when the chosen rooms differ from the request', () => {
    const g = group({ id: 'g', pax: 8, checkIn: '2026-12-05', checkOut: '2026-12-07' });
    const plan = buildPlan({ groups: [g], inputs: { g: { spec: '2x4', roomNos: ['101', '102'] } }, settings: DEFAULT_SETTINGS, from: PLANNING_START });
    expect(plan.placements.g.specIssue).toMatch(/not the rooms asked for/);
  });
});

describe('renaming the hotels', () => {
  it('uses the new names in the reasons the plan gives', () => {
    const names = { ruya: 'Roya Palace', araf: 'Al Araf', c: 'Overflow' };
    const groups = [
      group({ id: 'a', pax: 80, checkIn: '2026-12-05', checkOut: '2026-12-07' }),
      group({ id: 'b', pax: 30, checkIn: '2026-12-05', checkOut: '2026-12-07' }),
    ];
    const plan = buildPlan({ groups, inputs: {}, settings: { ...DEFAULT_SETTINGS, names }, from: PLANNING_START });
    expect(plan.placements.b.hotel).toBe('araf');
    expect(reasonLabel(plan.placements.b.reason, names)).toBe('Roya Palace is full');
    expect(hotelNames({ ruya: '  ', araf: 'X' })).toEqual({ ruya: 'Ruya', araf: 'X', c: 'Hotel C' });
  });
});

describe('hotel messages', () => {
  it('writes the message in the team\'s exact format', () => {
    const g = group({ id: 'm', tourNo: '2213', leader: 'Juzer bhai Chhas', pax: 23, checkIn: '2026-11-19', checkOut: '2026-11-24' });
    const plan = buildPlan({ groups: [g], inputs: { m: { spec: '2x6, 3x1, 4x2' } }, settings: DEFAULT_SETTINGS, from: '2026-11-19' });
    const message = hotelMessage(g, plan.placements.m);
    expect(message?.text).toBe(
      [
        'Tour id -2213',
        'GL -  JUZER BHAI CHHAS',
        'Hotel pax - 23',
        '',
        'NAJAF (05 NIGHT)',
        '19-11-2026 TO 24-11-2026',
        '',
        'Room Requirement:',
        '',
        ' 02 beds x   06 Rooms = 12 beds',
        ' 03 beds x   01 Rooms = 03 beds',
        ' 04 beds x   02 Rooms = 08 beds',
        '',
        'TOTAL- 23 BEDS',
      ].join('\n'),
    );
  });
  it('books the departure day too when that rule applies, and says when rooms are not known', () => {
    const g = group({ id: 'ia', tourNo: '2446', pax: 30, checkIn: '2026-12-03', checkOut: '2026-12-07', departure: { kind: 'airport', place: 'Najaf Airport', flight: 'IA 441', airline: 'IA' } });
    const filler = group({ id: 'f', pax: 84, checkIn: '2026-12-03', checkOut: '2026-12-09' }); // fills Ruya, so 2446 goes to Araf with no rooms
    const plan = buildPlan({ groups: [filler, g], inputs: {}, settings: DEFAULT_SETTINGS, from: '2026-12-03' });
    const message = hotelMessage(g, plan.placements.ia)!;
    expect(plan.placements.ia.hotel).toBe('araf');
    expect(message.text).toContain('NAJAF (05 NIGHT)\n03-12-2026 TO 08-12-2026');
    expect(message.rooms).toBeNull();
    expect(message.text).toContain(' To be confirmed');
  });
});

describe('hotel messages with room numbers', () => {
  it('adds the planned room numbers to each room line', () => {
    const g = group({ id: 'n', tourNo: '2218', leader: 'Lead', pax: 7, checkIn: '2026-12-05', checkOut: '2026-12-07' });
    const plan = buildPlan({ groups: [g], inputs: { n: { roomNos: ['106', '107', '103'] } }, settings: DEFAULT_SETTINGS, from: '2026-12-05' });
    const plain = hotelMessage(g, plan.placements.n)!;
    const numbered = hotelMessage(g, plan.placements.n, { roomNumbers: true })!;
    expect(plain.text).toContain(' 02 beds x   02 Rooms = 04 beds\n 03 beds x   01 Rooms = 03 beds\n');
    expect(numbered.numbered).toBe(true);
    expect(numbered.text).toContain(' 02 beds x   02 Rooms = 04 beds - Room no. 106, 107\n 03 beds x   01 Rooms = 03 beds - Room no. 103\n');
    expect(numbered.text.replace(/ - Room no\. [\d, ]+/g, '')).toBe(plain.text);
  });
});
