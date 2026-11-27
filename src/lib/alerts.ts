import { createContext, useContext } from 'react';
import type { FieldChange, MonitorState, PullMeta, TourAlert } from '../../shared/types';
import { plainDates } from './time';

/** Per tour ID, the time of the last change someone marked seen (shared for everyone). */
export type SeenAlerts = Record<string, string>;

export interface Alerts {
  seen: SeenAlerts;
  markSeen: (tours: { tourId: number; at: string }[]) => void;
  monitor: MonitorState | null;
}

export const AlertsContext = createContext<Alerts>({ seen: {}, markSeen: () => {}, monitor: null });
export const useAlerts = () => useContext(AlertsContext);

export const FIELD_LABEL: Record<FieldChange['field'], string> = {
  dates: 'Dates',
  hotelPax: 'Hotel pax',
  housed: 'Faiz accommodation',
  infants: 'Infants',
  flights: 'Flights',
  status: 'Status',
};
const ORDER = Object.keys(FIELD_LABEL);

export interface Unseen {
  tourId: number;
  tourNo: string;
  /** The newest change, used when marking it seen. */
  at: string;
  /** One line per field: the value before the first unseen change and after the last. */
  changes: FieldChange[];
}

/** Changes on one tour nobody has marked seen. Null when there are none. */
export function unseen(tourId: number, alert: TourAlert | undefined, seen: SeenAlerts): Unseen | null {
  const since = seen[tourId] ?? '';
  const entries = (alert?.entries ?? []).filter((e) => e.at > since);
  if (!alert || !entries.length) return null;
  const fields = new Map<string, FieldChange>();
  for (const { changes } of entries) {
    for (const c of changes) {
      const first = fields.get(c.field);
      fields.set(c.field, { field: c.field, before: first?.before ?? c.before, after: c.after });
    }
  }
  const changes = [...fields.values()].filter((c) => c.before !== c.after).sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
  return { tourId, tourNo: alert.tourNo, at: entries.at(-1)!.at, changes };
}

/** Every tour in this pull with unseen changes, most recent first. */
export function unseenTours(meta: PullMeta | undefined, seen: SeenAlerts): Unseen[] {
  return Object.entries(meta?.alerts ?? {})
    .map(([id, alert]) => unseen(Number(id), alert, seen))
    .filter((u): u is Unseen => Boolean(u?.changes.length))
    .sort((a, b) => b.at.localeCompare(a.at) || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true }));
}

export const changeText = (c: FieldChange) => `${FIELD_LABEL[c.field]}: ${plainDates(c.before)} → ${plainDates(c.after)}`;
