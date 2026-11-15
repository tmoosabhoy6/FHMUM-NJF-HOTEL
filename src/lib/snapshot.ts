/**
 * The GitHub Pages copy of the app has no server. Instead, GitHub Actions pulls
 * NKERP on a schedule and publishes an encrypted snapshot next to the app
 * (data.json). This unlocks it with the team passphrase and replays it through
 * the same progress screen as a live pull.
 */
import { addDays, eachDate } from '../../shared/dates';
import type { Group, PullMeta } from '../../shared/types';
import { unlock, type LockedFile } from '../../shared/vault.mjs';
import type { PullProgress, PullResult } from './sync';

export interface SnapshotInfo {
  fetchedAt: string;
  from: string;
  through: string;
}

/** Where to press "Run workflow" to refresh the data now. Set by the Pages workflow. */
export const REFRESH_URL = import.meta.env.VITE_REFRESH_URL || '';

let cached: LockedFile<SnapshotInfo> | null = null;

/** Looks for a published snapshot. Returns its readable info, or null when there is none. */
export async function findSnapshot(): Promise<SnapshotInfo | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data.json`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const file = (await response.json()) as LockedFile<SnapshotInfo>;
    if (file?.v !== 1 || !file.info?.fetchedAt) return null;
    cached = file;
    return file.info;
  } catch {
    return null;
  }
}

interface Handlers {
  onProgress: (update: (p: PullProgress) => PullProgress) => void;
  onDone: (result: PullResult) => void;
  onFailed: (message: string) => void;
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  });

/** Unlocks the snapshot, keeps the groups in the chosen dates, and plays the loading screen quickly. */
export function startSnapshot(params: { from: string; to: string | null; passphrase: string }, handlers: Handlers): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const step = (id: keyof PullProgress['steps'], status: 'active' | 'done', detail: string) =>
    !signal.aborted && handlers.onProgress((p) => ({ ...p, steps: { ...p.steps, [id]: { status, detail } } }));

  (async () => {
    step('signin', 'active', 'Unlocking the NKERP data');
    if (!cached) await findSnapshot();
    if (!cached) throw new Error('missing');
    let full: { groups: Group[]; meta: PullMeta };
    try {
      full = await unlock<{ groups: Group[]; meta: PullMeta }>(cached, params.passphrase);
    } catch (error) {
      throw (error as Error).name === 'WrongPassphrase' ? new Error('passphrase') : error;
    }
    if (signal.aborted) return;
    step('signin', 'done', 'Unlocked');

    const { from, to } = params;
    const groups = full.groups.filter((g) => g.checkOut >= from && (!to || g.checkIn <= to));
    step('tours', 'active', 'Reading approved Najaf tours');
    await pause(250, signal);
    step('tours', 'done', `${groups.length} groups arranging their own hotel`);
    handlers.onProgress((p) => ({ ...p, groups: groups.length, guests: groups.reduce((sum, g) => sum + g.pax, 0) }));

    const last = to ?? groups.reduce((max, g) => (g.checkOut > max ? g.checkOut : max), from);
    const dates = eachDate(from, last < from ? from : last > addDays(from, 150) ? addDays(from, 150) : last);
    handlers.onProgress((p) => ({ ...p, dates }));
    step('transport', 'active', `Arrivals and departures for ${dates.length} days`);
    const gap = Math.max(12, Math.min(60, Math.round(1100 / Math.max(1, dates.length))));
    for (const date of dates) {
      if (signal.aborted) return;
      const arriving = groups.filter((g) => g.checkIn === date).reduce((s, g) => s + g.pax, 0);
      const leaving = groups.filter((g) => g.checkOut === date).reduce((s, g) => s + g.pax, 0);
      handlers.onProgress((p) => ({ ...p, read: { ...p.read, [date]: { arriving, leaving } } }));
      await pause(gap, signal);
    }
    step('transport', 'done', `Arrivals and departures for ${dates.length} days`);
    step('match', 'done', `${groups.filter((g) => g.departure.airline === 'IA').length} leaving on Iraqi Airways`);
    if (!signal.aborted) handlers.onDone({ groups, meta: { ...full.meta, from, to } });
  })().catch((error: Error) => {
    if (signal.aborted) return;
    handlers.onFailed(
      error.message === 'passphrase'
        ? 'That passphrase does not open the NKERP data. Check it and try again.'
        : error.message === 'missing'
          ? 'The NKERP data could not be loaded from the site. Reload the page and try again.'
          : 'The NKERP data could not be opened. Reload the page and try again.',
    );
  });
  return () => abort.abort();
}
