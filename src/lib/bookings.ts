import { addDays, clock, fullDate } from '../../shared/dates';
import { HOTEL_ORDER } from '../../shared/engine';
import type { Group, HotelId, Plan } from '../../shared/types';

/** One booking to make: one tour's run of nights in Araf or Hotel C. */
export interface BookingRow {
  key: string;
  hotel: HotelId;
  group: Group;
  from: string;
  lastNight: string;
  nights: number;
}

/**
 * "Bookings to make", one row per tour per hotel stay (not per change in the
 * head count), sorted by first night, then hotel, then tour. Used by the page
 * and the Excel file so they always match.
 */
export function bookingRows(plan: Plan, byId: Map<string, Group>): BookingRow[] {
  const rows: BookingRow[] = [];
  const seen = new Set<string>();
  for (const b of plan.bookings) {
    for (const id of b.groupIds) {
      const p = plan.placements[id];
      const group = byId.get(id);
      if (!p || !group || seen.has(`${b.hotel}:${id}`)) continue;
      seen.add(`${b.hotel}:${id}`);
      // The tour's nights in this hotel, as runs of consecutive nights (normally one).
      const nights = [...p.nights].sort();
      let start = 0;
      for (let i = 1; i <= nights.length; i += 1) {
        if (i < nights.length && addDays(nights[i - 1], 1) === nights[i]) continue;
        rows.push({ key: `${b.hotel}:${id}:${nights[start]}`, hotel: b.hotel, group, from: nights[start], lastNight: nights[i - 1], nights: i - start });
        start = i;
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.from.localeCompare(b.from) ||
      HOTEL_ORDER.indexOf(a.hotel) - HOTEL_ORDER.indexOf(b.hotel) ||
      a.group.tourNo.localeCompare(b.group.tourNo, undefined, { numeric: true }),
  );
}

/** "Baghdad Airport · IA 441, 14:30", or "From Karbala (subvenue)" for a transfer. */
export function legDetail(leg: Group['arrival'], at: string | null, word: 'From' | 'To'): string {
  if (leg.kind === 'transfer') return `${word} ${leg.place ? leg.place.charAt(0) + leg.place.slice(1).toLowerCase() : 'Karbala'} (subvenue)`;
  const flight = [leg.flight, clock(at)].filter(Boolean).join(', ');
  return [leg.place, flight || 'Flight not in NKERP'].filter(Boolean).join(' · ');
}

/** The date and the detail on one line, for the Excel file. */
export const legText = (leg: Group['arrival'], at: string | null, date: string, word: 'From' | 'To') => `${fullDate(date)} · ${legDetail(leg, at, word)}`;

/** Under a date: "(subvenue)" for a transfer, else the flight code and its time. */
export function howText(leg: Group['arrival'], at: string | null): string {
  if (leg.kind === 'transfer') return '(subvenue)';
  if (leg.kind !== 'airport') return '';
  return [leg.flight, clock(at)].filter(Boolean).join(', ');
}
