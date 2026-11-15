/**
 * Baked-in hotel data. This is the file to edit when the real numbers arrive.
 */
import type { Hold, RoomType, Settings } from './types';

/** First day the planner covers. */
export const PLANNING_START = '2026-12-01';

/**
 * Ruya room list: one line per room size.
 * TODO(awaiting data): the real list comes from the Ruya Excel sheet. Until
 * then this stays empty and Ruya is planned by head count only.
 *   e.g. { beds: 2, count: 10 }, { beds: 4, count: 8, labels: ['101', '102', ...] }
 */
export const RUYA_ROOMS: RoomType[] = [];

/**
 * Opening balance: guests already in a hotel on PLANNING_START whose hotel was
 * decided before the planner existed (the end-of-November running count).
 * TODO(awaiting data): paste the end-of-November actuals here.
 *   e.g. { id: 'nov-2443', label: 'Tour 2443', hotel: 'ruya', pax: 20, from: '2026-11-24', to: '2026-12-02', rooms: [4, 4, 4, 4, 4] }
 */
export const OPENING_BALANCE: Hold[] = [];

export const DEFAULT_SETTINGS: Settings = {
  ruyaCapacity: 97,
  arafCapacity: 100,
  rooms: RUYA_ROOMS,
  departureDayRule: true,
};

/** A made-up room list (97 beds) for previewing the room-by-room view. Not Ruya's real rooms. */
export const EXAMPLE_ROOMS: RoomType[] = [
  { beds: 2, count: 10 },
  { beds: 3, count: 9 },
  { beds: 4, count: 8 },
  { beds: 5, count: 2 },
  { beds: 8, count: 1 },
];
