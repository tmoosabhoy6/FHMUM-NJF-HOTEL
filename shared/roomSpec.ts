/**
 * Reading what a person types for "rooms needed in Ruya".
 *
 * The exact wording the team will use is still to be confirmed, so this reads
 * every form that is unambiguous and shows its reading back to the person:
 *
 *   5x2            five 2-bed rooms            (rooms × beds)
 *   5 rooms of 2   five 2-bed rooms
 *   2 x 5-bed      two 5-bed rooms             ("bed" marks which number is the size)
 *   2,2,2,3        three 2-bed rooms and one 3-bed room (one number per room)
 *   22222          five 2-bed rooms            (one digit per room)
 *   5x2 + 1x3      mixes of the above, joined with + , ; or "and"
 */

export interface ParsedSpec {
  /** Bed count of every room asked for, largest first. */
  rooms: number[];
  beds: number;
  /** Set when the text could not be read; `rooms` is empty then. */
  error: string | null;
}

const MAX_BEDS = 20;
const MAX_ROOMS = 60;

export function parseRoomSpec(text: string | undefined | null): ParsedSpec {
  const source = (text ?? '').trim().toLowerCase();
  if (!source) return { rooms: [], beds: 0, error: null };

  const rooms: number[] = [];
  const fail = (message: string): ParsedSpec => ({ rooms: [], beds: 0, error: message });
  const parts = source
    .replace(/\band\b/g, '+')
    .split(/[+,;/]|\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    // "2 x 5-bed", "2 × 5 beds", "2 rooms of 5 beds": the number next to "bed" is the size.
    let m = part.match(/^(\d+)\s*(?:rooms?|rms?)?\s*(?:x|×|\*|of|with)?\s*(\d+)\s*-?\s*(?:beds?|bedded|pax|people|persons?)$/);
    if (m) {
      push(Number(m[1]), Number(m[2]));
      continue;
    }
    // "5x2", "5 × 2", "5*2", "5 rooms of 2": rooms first, then beds.
    m = part.match(/^(\d+)\s*(?:rooms?|rms?)?\s*(?:x|×|\*|of)\s*(\d+)$/);
    if (m) {
      push(Number(m[1]), Number(m[2]));
      continue;
    }
    // Numbers separated by spaces: one room each.
    if (/^\d+(\s+\d+)+$/.test(part)) {
      for (const n of part.split(/\s+/)) push(1, Number(n));
      continue;
    }
    // A bare number: one room, unless it is too big to be a room, then one digit per room.
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n >= 1 && n <= MAX_BEDS) push(1, n);
      else if (/^[1-9]+$/.test(part)) for (const digit of part) push(1, Number(digit));
      else return fail(`"${part}" is not a room size`);
      continue;
    }
    // "5-bed", "a 5 bed room"
    m = part.match(/^(?:a\s+|one\s+)?(\d+)\s*-?\s*(?:beds?|bedded)(?:\s*rooms?)?$/);
    if (m) {
      push(1, Number(m[1]));
      continue;
    }
    return fail(`Could not read "${part}". Try 5x2 for five 2-bed rooms.`);
  }

  if (rooms.some((b) => b < 1 || b > MAX_BEDS)) return fail(`A room has between 1 and ${MAX_BEDS} beds`);
  if (rooms.length > MAX_ROOMS) return fail(`That is more than ${MAX_ROOMS} rooms`);
  rooms.sort((a, b) => b - a);
  return { rooms, beds: rooms.reduce((sum, b) => sum + b, 0), error: null };

  function push(count: number, beds: number) {
    for (let i = 0; i < Math.min(count, MAX_ROOMS + 1); i += 1) rooms.push(beds);
  }
}

/** [2,2,2,3] → [{beds:3,count:1},{beds:2,count:3}] */
export function groupRooms(rooms: readonly number[]): { beds: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const beds of rooms) counts.set(beds, (counts.get(beds) ?? 0) + 1);
  return [...counts].map(([beds, count]) => ({ beds, count })).sort((a, b) => b.beds - a.beds);
}

/** [2,2,2,3] → "1 × 3-bed, 3 × 2-bed" */
export function describeRooms(rooms: readonly number[]): string {
  return groupRooms(rooms)
    .map(({ beds, count }) => `${count} × ${beds}-bed`)
    .join(', ');
}
