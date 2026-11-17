/**
 * Reading room requests.
 *
 * The team writes the bed size first, then the number of rooms, as on the
 * WhatsApp room-request messages and on Ruya's own sheet ("2 X 6" = six
 * 2-bed rooms):
 *
 *   02 beds x 06 Rooms = 12 beds   six 2-bed rooms (the "= 12 beds" is checked)
 *   2x6                            six 2-bed rooms (bed size first)
 *   6 rooms of 2 beds              six 2-bed rooms (the words decide the order)
 *   2 x 5-bed                      two 5-bed rooms ("bed" marks the size)
 *   2,2,2,3                        three 2-bed rooms and one 3-bed room (one number per room)
 *   2x6, 3x1 + 4x2                 mixes, joined by new lines, + , ; or "and"
 *
 * `parseRoomMessages` reads whole pasted messages (one or many) and pulls out
 * the tour, the hotel pax, the dates and the room lines.
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

const UNIT = String.raw`(beds?|bedded|pax|rooms?|rms?)`;
const SEP = String.raw`(?:x|\*|of|with)`;
const PAIR_SEP = new RegExp(String.raw`^(\d+)\s*-?\s*${UNIT}?\s*${SEP}\s*(\d+)\s*-?\s*${UNIT}?$`);
const PAIR_WORDS = new RegExp(String.raw`^(\d+)\s*-?\s*${UNIT}\s+(\d+)\s*-?\s*${UNIT}$`);
const isBed = (unit?: string) => Boolean(unit && /^(bed|pax)/.test(unit));
const isRoom = (unit?: string) => Boolean(unit && /^r/.test(unit));

/** Lines of a message that are not room lines. */
const NOT_ROOMS = /^(total|tour|gl\b|group|hotel|najaf|karbala|room\s*requirement|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/;

export function parseRoomSpec(text: string | undefined | null): ParsedSpec {
  const source = (text ?? '')
    .toLowerCase()
    .replace(/[×✕✖]/g, 'x')
    .split(/\r?\n/)
    .map((line) => line.replace(/=.*$/, '').trim())
    .filter((line) => line && !NOT_ROOMS.test(line))
    .join('\n');
  if (!source) return { rooms: [], beds: 0, error: null };

  const rooms: number[] = [];
  const fail = (message: string): ParsedSpec => ({ rooms: [], beds: 0, error: message });
  const parts = source
    .replace(/\band\b/g, '+')
    .split(/[\n+,;/]/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const part of parts) {
    const pair = part.match(PAIR_SEP) ?? part.match(PAIR_WORDS);
    if (pair) {
      const [, a, unitA, b, unitB] = pair;
      if ((isBed(unitA) && isBed(unitB)) || (isRoom(unitA) && isRoom(unitB))) return fail(`Could not tell rooms from beds in "${part}"`);
      // Bed size first unless the words say otherwise ("6 rooms of 2", "2 x 5-bed").
      const roomsFirst = isRoom(unitA) || isBed(unitB);
      if (roomsFirst) push(Number(a), Number(b));
      else push(Number(b), Number(a));
      continue;
    }
    // "5-bed", "a 5 bed room"
    const single = part.match(/^(?:a\s+|one\s+)?(\d+)\s*-?\s*(?:beds?|bedded)(?:\s*rooms?)?$/);
    if (single) {
      push(1, Number(single[1]));
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
    return fail(`Could not read "${part}". Write it like 2 beds x 6 rooms.`);
  }

  if (rooms.some((b) => b < 1 || b > MAX_BEDS)) return fail(`A room has between 1 and ${MAX_BEDS} beds`);
  if (rooms.length > MAX_ROOMS) return fail(`That is more than ${MAX_ROOMS} rooms`);
  rooms.sort((a, b) => b - a);
  return { rooms, beds: rooms.reduce((sum, b) => sum + b, 0), error: null };

  function push(count: number, beds: number) {
    for (let i = 0; i < Math.min(count, MAX_ROOMS + 1); i += 1) rooms.push(beds);
  }
}

/** [2,2,2,3] → [{beds:2,count:3},{beds:3,count:1}], smallest rooms first as the team lists them. */
export function groupRooms(rooms: readonly number[]): { beds: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const beds of rooms) counts.set(beds, (counts.get(beds) ?? 0) + 1);
  return [...counts].map(([beds, count]) => ({ beds, count })).sort((a, b) => a.beds - b.beds);
}

/** [2,2,2,3] → "2-bed × 3, 3-bed × 1" */
export function describeRooms(rooms: readonly number[]): string {
  return groupRooms(rooms)
    .map(({ beds, count }) => `${beds}-bed × ${count}`)
    .join(', ');
}

/** [2,2,2,3] → "2x3, 3x1", the short form the parser reads back the same way. */
export function formatSpec(rooms: readonly number[]): string {
  return groupRooms(rooms)
    .map(({ beds, count }) => `${beds}x${count}`)
    .join(', ');
}

// ---- whole messages ----------------------------------------------------------

export interface RoomMessage {
  /** Short tour number, e.g. "2213". */
  tourNo: string;
  leader: string | null;
  /** "Hotel pax" as written. */
  hotelPax: number | null;
  nights: number | null;
  /** Najaf dates as written, YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  /** The room lines, in the short form ("2x6, 3x1, 4x2"). Empty when none were found. */
  spec: string;
  rooms: number[];
  beds: number;
  /** Things in the message that do not add up. */
  issues: string[];
}

const pad = (n: string) => n.padStart(2, '0');
const isoDate = (d: string, m: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${pad(m)}-${pad(d)}`;

/** Reads one or many pasted room-request messages. Text without a tour id is ignored. */
export function parseRoomMessages(text: string): RoomMessage[] {
  const blocks = (text ?? '').split(/(?=tour\s*id\b)/i).filter((b) => /tour\s*id\b/i.test(b));
  const out: RoomMessage[] = [];
  for (const block of blocks) {
    const tour = block.match(/tour\s*id\s*[-:–#.]*\s*(?:nkerp\s*\/\s*tour\s*\/\s*\d{4}\s*\/\s*)?(\d{2,6})/i);
    if (!tour) continue;
    const issues: string[] = [];
    const leader = block.match(/^\s*g\.?\s*l\.?\s*[-:–]+\s*(.+?)\s*$/im)?.[1]?.replace(/\s+/g, ' ') ?? null;
    const paxText = block.match(/hotel\s*pax\s*[-:–]*\s*(\d+)/i)?.[1];
    const nightsText = block.match(/\(\s*(\d+)\s*nights?\s*\)/i)?.[1];
    const dates = block.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*(?:to|-|–)\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/i);
    const from = dates ? isoDate(dates[1], dates[2], dates[3]) : null;
    const to = dates ? isoDate(dates[4], dates[5], dates[6]) : null;

    // Room lines: between "Room Requirement" and "TOTAL" when present, else every line naming beds.
    const lines = block.split(/\r?\n/);
    const start = lines.findIndex((l) => /room\s*requirement/i.test(l));
    const end = lines.findIndex((l, i) => i > start && /^\s*total\b/i.test(l));
    const body = (start >= 0 ? lines.slice(start + 1, end > start ? end : undefined) : lines).filter((l) =>
      /\d\s*-?\s*(beds?|rooms?)\b|\d\s*[x×]\s*\d/i.test(l),
    );
    for (const line of body) {
      const subtotal = line.match(/=\s*(\d+)\s*beds?/i);
      const parsed = parseRoomSpec(line);
      if (subtotal && !parsed.error && parsed.beds !== Number(subtotal[1])) {
        issues.push(`"${line.trim()}" adds up to ${parsed.beds} beds, not ${Number(subtotal[1])}.`);
      }
    }
    const parsed = parseRoomSpec(body.join('\n'));
    if (parsed.error) issues.push(parsed.error);
    if (!body.length) issues.push('No room lines found.');

    const total = block.match(/total\s*[-:–]*\s*(\d+)\s*beds?/i)?.[1];
    if (total && !parsed.error && parsed.beds !== Number(total)) {
      issues.push(`The rooms add up to ${parsed.beds} beds, the message says ${Number(total)}.`);
    }
    const hotelPax = paxText ? Number(paxText) : null;
    if (hotelPax !== null && !parsed.error && parsed.rooms.length && parsed.beds < hotelPax) {
      issues.push(`The rooms sleep ${parsed.beds}, the hotel pax is ${hotelPax}.`);
    }
    const nights = nightsText ? Number(nightsText) : null;
    if (nights !== null && from && to) {
      const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
      if (span !== nights) issues.push(`${from} to ${to} is ${span} nights, the message says ${nights}.`);
    }

    out.push({
      tourNo: String(Number(tour[1])),
      leader,
      hotelPax,
      nights,
      from,
      to,
      spec: parsed.error ? '' : formatSpec(parsed.rooms),
      rooms: parsed.error ? [] : parsed.rooms,
      beds: parsed.error ? 0 : parsed.beds,
      issues,
    });
  }
  return out;
}
