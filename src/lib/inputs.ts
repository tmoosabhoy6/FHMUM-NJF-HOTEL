import type { Group } from '../../shared/types';

/**
 * Room requests and hotel choices are kept per tour number, so they survive a
 * new pull, cover every Najaf stay of the tour, and can be pasted before the
 * tour is approved.
 */
export const inputKey = (group: Pick<Group, 'tourNo'>) => String(Number(group.tourNo) || group.tourNo).trim();
