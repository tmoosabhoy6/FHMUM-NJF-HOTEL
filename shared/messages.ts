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
 * The dates are the first night and the day the group leaves. When an Iraqi
 * Airways departure day is booked as a night, the night count includes it but
 * the second date stays the actual departure date.
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
  /**
   * First night and the group's actual departure date. When the Iraqi
   * Airways rule books the departure day as a night, `to` is still the day
   * the group leaves, not the day after that extra night.
   */
  from: string;
  to: string;
  nights: number;
  /** Room sizes in the message, or null when the group has no rooms yet. */
  rooms: number[] | null;
  /** True when the message lists room numbers (only rooms the plan gave the group have numbers). */
  numbered: boolean;
  text: string;
}

interface MessageParts {
  groupId: string;
  tourNo: string;
  leader: string;
  pax: number;
  /** City in the heading: "NAJAF (05 NIGHT)", "KARBALA (03 NIGHT)". */
  city: string;
  /** Every night the group sleeps there, in order. */
  nights: string[];
  /** The day the group actually leaves. Defaults to the day after the last night. */
  departure?: string;
  /** Bed count of each room, or null when no rooms are known yet. */
  rooms: number[] | null;
  /** Rooms with numbers, listed on each room line when given. */
  numberedRooms?: { beds: number; label: string }[];
}

/** One message in the team's format. Null when the group has no nights. */
export function roomMessage({ groupId, tourNo, leader, pax, city, nights, departure, rooms, numberedRooms = [] }: MessageParts): HotelMessage | null {
  if (!nights.length) return null;
  const from = nights[0];
  const last = nights[nights.length - 1];
  // The night count includes a booked departure day; the dates show the real departure.
  const to = departure && departure > from && departure <= addDays(last, 1) ? departure : addDays(last, 1);
  const lines = [
    `Tour id -${tourNo}`,
    `GL -  ${(leader || '').toUpperCase()}`.trimEnd(),
    `Hotel pax - ${pax}`,
    '',
    `${city} (${two(nights.length)} NIGHT)`,
    `${dmy(from)} TO ${dmy(to)}`,
    '',
    'Room Requirement:',
    '',
  ];
  const numbered = numberedRooms.length > 0;
  if (rooms) {
    for (const { beds, count } of groupRooms(rooms)) {
      const line = ` ${two(beds)} beds x   ${two(count)} Rooms = ${two(beds * count)} beds`;
      const labels = numberedRooms
        .filter((r) => r.beds === beds)
        .map((r) => r.label)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      lines.push(numbered && labels.length ? `${line} - Room no. ${labels.join(', ')}` : line);
    }
    lines.push('', `TOTAL- ${rooms.reduce((sum, b) => sum + b, 0)} BEDS`);
  } else {
    lines.push(' To be confirmed', '', `TOTAL- ${pax} BEDS`);
  }
  return { groupId, tourNo, from, to, nights: nights.length, rooms, numbered, text: lines.join('\n') };
}

/**
 * The message for one group, from its plan: the nights it sleeps in Najaf
 * (the departure day included when that rule applies), its actual departure
 * date and its rooms (the Ruya rooms it was given, else the rooms typed for it).
 */
export function hotelMessage(group: Group, placement: Placement, { roomNumbers = false }: { roomNumbers?: boolean } = {}): HotelMessage | null {
  const rooms = placement.rooms.length ? placement.rooms.map((r) => r.beds) : placement.spec?.length ? placement.spec : null;
  return roomMessage({
    groupId: group.id,
    tourNo: group.tourNo,
    leader: group.leader,
    pax: group.pax,
    city: 'NAJAF',
    nights: placement.nights,
    departure: group.checkOut,
    rooms,
    numberedRooms: roomNumbers ? placement.rooms : [],
  });
}

/**
 * The message for one Karbala group: its nights in Karbala and the rooms
 * typed for it (largest first, as parseRoomSpec gives them), or "To be
 * confirmed" when none are typed.
 */
export function karbalaMessage(group: Group, nights: string[], rooms: number[] | null): HotelMessage | null {
  return roomMessage({ groupId: group.id, tourNo: group.tourNo, leader: group.leader, pax: group.pax, city: 'KARBALA', nights, departure: group.checkOut, rooms: rooms?.length ? rooms : null });
}
