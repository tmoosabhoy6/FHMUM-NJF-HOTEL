import { dayMonth, fullDate, isIsoDate } from '../../shared/dates';

/** "just now", "7 min ago", "3 h ago", then the date. */
export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return fullDate(iso.slice(0, 10));
}

/** NKERP writes dates as 2026-12-11; show them the way the rest of the app does ("11 Dec"). */
export const plainDates = (text: string) => text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => (isIsoDate(date) ? dayMonth(date) : date));
