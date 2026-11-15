/** Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; no time zones involved. */

const DAY = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(toMs(date) + days * DAY).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY);
}

/** Every date from `from` to `to`, both included. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toMs(value));

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options });
  return (date: string) => f.format(new Date(toMs(date)));
};

export const weekdayShort = fmt({ weekday: 'short' });
export const weekdayLong = fmt({ weekday: 'long' });
export const dayNumber = fmt({ day: 'numeric' });
export const monthShort = fmt({ month: 'short' });
export const monthLong = fmt({ month: 'long', year: 'numeric' });
/** "14 Dec" */
export const dayMonth = fmt({ day: 'numeric', month: 'short' });
/** "Mon 14 Dec" */
export const dayLabel = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
/** "14 Dec 2026" */
export const fullDate = fmt({ day: 'numeric', month: 'short', year: 'numeric' });

/** "14–17 Dec" or "29 Nov – 2 Dec". */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return dayMonth(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayNumber(from)}–${dayMonth(to)}`;
  return `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** "07:30" from a local timestamp, or null. */
export function clock(stamp: string | null): string | null {
  return stamp && stamp.length >= 16 ? stamp.slice(11, 16) : null;
}
