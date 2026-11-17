/**
 * Baked-in hotel data. This is the file to edit when the numbers change.
 */
import type { Hold, RoomType, RuyaRoom, Settings } from './types';

/** First night the planner covers. Groups that reached Najaf earlier are in the opening balance. */
export const PLANNING_START = '2026-12-01';

/**
 * Ruya (Hotel Roya): every room on the hotel's sheet, floor by floor.
 * 33 rooms, 93 beds.
 */
export const RUYA_SHEET: RuyaRoom[] = [
  // First floor: 3 × 2-bed, 5 × 3-bed, 2 × 4-bed (29 beds)
  { no: '101', beds: 4, floor: 1 },
  { no: '102', beds: 4, floor: 1 },
  { no: '103', beds: 3, floor: 1 },
  { no: '104', beds: 3, floor: 1 },
  { no: '105', beds: 3, floor: 1 },
  { no: '106', beds: 2, floor: 1 },
  { no: '107', beds: 2, floor: 1 },
  { no: '108', beds: 3, floor: 1 },
  { no: '109', beds: 3, floor: 1 },
  { no: '110', beds: 2, floor: 1 },
  // Second floor: 3 × 2-bed, 5 × 3-bed, 2 × 4-bed (29 beds)
  { no: '201', beds: 4, floor: 2 },
  { no: '202', beds: 4, floor: 2 },
  { no: '203', beds: 3, floor: 2 },
  { no: '204', beds: 3, floor: 2 },
  { no: '205', beds: 2, floor: 2 },
  { no: '206', beds: 2, floor: 2 },
  { no: '207', beds: 3, floor: 2 },
  { no: '208', beds: 3, floor: 2 },
  { no: '209', beds: 3, floor: 2 },
  { no: '210', beds: 2, floor: 2 },
  // Third floor: 6 × 2-bed, 5 × 3-bed, 2 × 4-bed (35 beds; there is no 311)
  { no: '301', beds: 3, floor: 3 },
  { no: '302', beds: 3, floor: 3 },
  { no: '303', beds: 2, floor: 3 },
  { no: '304', beds: 2, floor: 3 },
  { no: '305', beds: 2, floor: 3 },
  { no: '306', beds: 2, floor: 3 },
  { no: '307', beds: 3, floor: 3 },
  { no: '308', beds: 3, floor: 3 },
  { no: '309', beds: 2, floor: 3 },
  { no: '310', beds: 2, floor: 3 },
  { no: '312', beds: 3, floor: 3 },
  { no: '313', beds: 4, floor: 3 },
  { no: '314', beds: 4, floor: 3 },
];

/**
 * Rooms kept out of the plan: one 2-bed, one 3-bed and one 4-bed room
 * (9 beds), so the plan uses 30 rooms and 84 beds. Which rooms are left out
 * can be changed on the "Hotels and rooms" panel.
 */
export const RUYA_WITHHELD: string[] = ['310', '312', '314'];

/** The Ruya rooms the planner may use, as a room list. */
export function ruyaRooms(withheld: readonly string[] = RUYA_WITHHELD): RoomType[] {
  const out = new Set(withheld);
  const bySize = new Map<number, string[]>();
  for (const room of RUYA_SHEET) {
    if (out.has(room.no)) continue;
    bySize.set(room.beds, [...(bySize.get(room.beds) ?? []), room.no]);
  }
  return [...bySize]
    .sort(([a], [b]) => a - b)
    .map(([beds, labels]) => ({ beds, count: labels.length, labels }));
}

export const RUYA_ROOMS: RoomType[] = ruyaRooms();

/**
 * Opening balance: who is already in a hotel on the first night (the
 * end-of-November count). In Ruya only rooms 109, 110, 201 and 202 are
 * occupied on 1 Dec; they are free from 2 Dec.
 */
export const OPENING_BALANCE: Hold[] = [
  {
    id: 'opening-ruya',
    label: 'November group',
    hotel: 'ruya',
    pax: 13,
    from: PLANNING_START,
    to: '2026-12-02',
    roomLabels: ['109', '110', '201', '202'],
  },
];

export const DEFAULT_SETTINGS: Settings = {
  ruyaCapacity: RUYA_ROOMS.reduce((sum, r) => sum + r.beds * r.count, 0),
  arafCapacity: 100,
  rooms: RUYA_ROOMS,
  departureDayRule: true,
};
