/**
 * The Karbala tab: no hotel planning, only the room-request messages.
 *
 * Groups come from the same NKERP pull as Najaf (venue 'karbala'): approved
 * tours staying in Karbala, counting the guests marked "accommodation not
 * required". Each group's nights follow the same rule as Najaf: from the
 * arrival date to the night before it leaves, plus the departure day when
 * Karbala is the second half of the trip and the group flies Iraqi Airways out
 * of Najaf or Baghdad (when that rule is on).
 */
import { nightsOf } from './engine';
import { karbalaMessage, type HotelMessage } from './messages';
import { parseRoomSpec } from './roomSpec';
import type { Group, GroupInput, Settings } from './types';

export interface KarbalaRow {
  group: Group;
  /** Every night the group sleeps in Karbala, in order. */
  nights: string[];
  /** True when the departure day counts as a night (Iraqi Airways rule). */
  departureDay: boolean;
  /** Room sizes asked for, largest first; null when none are typed or they cannot be read. */
  rooms: number[] | null;
  /** Why the typed rooms are not in the message, or fall short of the guests. */
  issue: string | null;
  /** Null when the group has no night in Karbala. */
  message: HotelMessage | null;
}

/**
 * One row per group with guests who need a hotel, by arrival date then tour.
 * `inputs` holds the rooms the messages are built from, by group id.
 */
export function karbalaRows(groups: readonly Group[], inputs: Record<string, GroupInput | undefined>, settings: Pick<Settings, 'departureDayRule'>, includeZeroPax = false): KarbalaRow[] {
  return groups
    .filter((g) => includeZeroPax || g.pax > 0)
    .map((group) => {
      const nights = nightsOf(group, settings);
      const departureDay = nights.length > 0 && nights[nights.length - 1] === group.checkOut;
      const parsed = parseRoomSpec(inputs[group.id]?.spec);
      const rooms = parsed.error || !parsed.rooms.length ? null : parsed.rooms;
      const issue = parsed.error
        ? `The rooms typed could not be read: ${parsed.error}`
        : rooms && parsed.beds < group.pax
          ? `The rooms typed have ${parsed.beds} beds for ${group.pax} guests.`
          : null;
      return { group, nights, departureDay, rooms, issue, message: group.pax > 0 ? karbalaMessage(group, nights, rooms) : null };
    })
    .sort(
      (a, b) =>
        a.group.checkIn.localeCompare(b.group.checkIn) ||
        (a.group.arrivalAt ?? '').localeCompare(b.group.arrivalAt ?? '') ||
        a.group.tourNo.localeCompare(b.group.tourNo, undefined, { numeric: true }),
    );
}
