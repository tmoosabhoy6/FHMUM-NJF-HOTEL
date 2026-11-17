/**
 * The room-request messages sent to the hotels, in the team's exact format:
 *
 *   Tour id -2213
 *   GL -  JUZER BHAI CHHAS
 *   Hotel pax - 23
 *
 *   NAJAF (05 NIGHT)
 *   19-11-2026 TO 24-11-2026
 *
 *   Room Requirement:
 *
 *    02 beds x   06 Rooms = 12 beds
 *    03 beds x   01 Rooms = 03 beds
 *    04 beds x   02 Rooms = 08 beds
 *
 *   TOTAL- 23 BEDS
 *
 * With room numbers, each room line ends with the rooms planned for it:
 *    02 beds x   06 Rooms = 12 beds - Room no. 106, 107, 110, 205, 206, 210
 */
import { addDays } from './dates';
import { groupRooms } from './roomSpec';
import type { Group, Placement } from './types';

const two = (n: number) => String(n).padStart(2, '0');
/** "2026-11-19" → "19-11-2026" */
const dmy = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;

export interface HotelMessage {
  groupId: string;
  tourNo: string;
  /** First night and the day after the last night (the hotel's check-in and check-out). */
  from: string;
  to: string;
  nights: number;
  /** Room sizes in the message, or null when the group has no rooms yet. */
  rooms: number[] | null;
  /** True when the message lists room numbers (only rooms the plan gave the group have numbers). */
  numbered: boolean;
  text: string;
}

/**
 * The message for one group, from its plan: the nights it sleeps in Najaf
 * (the departure day included when that rule applies) and its rooms (the
 * Ruya rooms it was given, else the rooms typed for it).
 */
export function hotelMessage(group: Group, placement: Placement, { roomNumbers = false }: { roomNumbers?: boolean } = {}): HotelMessage | null {
  const nights = placement.nights;
  if (!nights.length) return null;
  const from = nights[0];
  const to = addDays(nights[nights.length - 1], 1);
  const rooms = placement.rooms.length ? placement.rooms.map((r) => r.beds) : placement.spec?.length ? placement.spec : null;
  const lines = [
    `Tour id -${group.tourNo}`,
    `GL -  ${(group.leader || '').toUpperCase()}`.trimEnd(),
    `Hotel pax - ${group.pax}`,
    '',
    `NAJAF (${two(nights.length)} NIGHT)`,
    `${dmy(from)} TO ${dmy(to)}`,
    '',
    'Room Requirement:',
    '',
  ];
  const numbered = roomNumbers && placement.rooms.length > 0;
  if (rooms) {
    for (const { beds, count } of groupRooms(rooms)) {
      const line = ` ${two(beds)} beds x   ${two(count)} Rooms = ${two(beds * count)} beds`;
      const labels = placement.rooms
        .filter((r) => r.beds === beds)
        .map((r) => r.label)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      lines.push(numbered && labels.length ? `${line} - Room no. ${labels.join(', ')}` : line);
    }
    lines.push('', `TOTAL- ${rooms.reduce((sum, b) => sum + b, 0)} BEDS`);
  } else {
    lines.push(' To be confirmed', '', `TOTAL- ${group.pax} BEDS`);
  }
  return { groupId: group.id, tourNo: group.tourNo, from, to, nights: nights.length, rooms, numbered, text: lines.join('\n') };
}
