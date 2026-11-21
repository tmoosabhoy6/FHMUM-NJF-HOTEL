import type { Group } from '../../shared/types';
import { editInput, inputKey, type InputChange, type TourInputs } from './inputs';

export type SharedKey = 'dataset' | 'inputs' | 'prefs' | 'range' | 'karbalaDataset' | 'karbalaInputs' | 'karbalaRange';
export type SaveStatus = 'saved' | 'saving' | 'offline';
export type Values = Partial<Record<SharedKey, unknown>>;
type InputKey = 'inputs' | 'karbalaInputs';
type Write = { key: SharedKey; value: unknown } | { key: InputKey; tour: string; legacyKey: string | null; changes: InputChange };

const OUTBOX = 'fh.shared-outbox.v1';
function readOutbox(): Write[] {
  try {
    return JSON.parse(sessionStorage.getItem(OUTBOX) ?? '[]');
  } catch {
    return [];
  }
}

/** One shared server copy, with a per-tab outbox that survives a reload. */
export class SharedState {
  private version = 0;
  private pollRequest: Promise<Values | null> | null = null;
  private known: Values = {};
  private outbox = readOutbox();
  private active: Write | undefined;
  private wrote = 0;
  private timer: number | undefined;
  private failures = 0;
  status: SaveStatus = 'saved';
  onStatus: (status: SaveStatus) => void = () => {};

  private setStatus(status: SaveStatus) {
    if (this.status !== status) {
      this.status = status;
      this.onStatus(status);
    }
  }

  poll(): Promise<Values | null> {
    return this.pollRequest ??= this.read().finally(() => { this.pollRequest = null; });
  }

  private async read(): Promise<Values | null> {
    const started = this.wrote;
    try {
      const res = await fetch(`/api/state?since=${this.version}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json() as { version: number; values: Values };
      // A response started before our write completed can contain older data.
      // Leave the cursor alone so the next read can recover those changes.
      if (started !== this.wrote || this.active) return null;
      this.version = body.version;
      Object.assign(this.known, body.values);
      if (!this.outbox.length) this.setStatus('saved');
      return body.values;
    } catch {
      this.setStatus('offline');
      return null;
    }
  }

  put(key: SharedKey, value: unknown) {
    if (!this.pending(key) && JSON.stringify(this.known[key]) === JSON.stringify(value)) return;
    this.outbox = this.outbox.filter((write) => write === this.active || write.key !== key);
    this.outbox.push({ key, value });
    this.schedule();
  }

  edit(key: InputKey, group: Pick<Group, 'tourId' | 'tourNo'>, legacy: string | null, changes: InputChange) {
    const tour = inputKey(group);
    const queued = this.outbox.find((write) => write !== this.active && write.key === key && 'tour' in write && write.tour === tour);
    if (queued && 'tour' in queued) Object.assign(queued.changes, changes);
    else this.outbox.push({ key, tour, legacyKey: legacy, changes: { ...changes } });
    this.schedule();
  }

  pending(key: SharedKey) {
    return this.outbox.some((write) => write.key === key);
  }

  withPending(key: InputKey, server: TourInputs): TourInputs {
    let inputs = server;
    for (const write of this.outbox) {
      if (write.key !== key) continue;
      inputs = 'tour' in write ? editInput(inputs, write.tour, write.legacyKey, write.changes) : write.value as TourInputs;
    }
    return inputs;
  }

  resume() {
    if (this.outbox.length) this.schedule();
  }

  private remember() {
    try {
      if (this.outbox.length) sessionStorage.setItem(OUTBOX, JSON.stringify(this.outbox));
      else sessionStorage.removeItem(OUTBOX);
    } catch {
      // The in-memory queue still retries when browser storage is unavailable.
    }
  }

  private schedule() {
    this.remember();
    this.setStatus('saving');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 250);
  }

  async flush(keepalive = false) {
    if (this.active || !this.outbox.length) return;
    window.clearTimeout(this.timer);
    while (this.outbox.length) {
      const write = this.active = this.outbox[0];
      const path = 'tour' in write ? `${write.key}/${write.tour}` : write.key;
      const value = 'tour' in write ? { legacyKey: write.legacyKey, changes: write.changes } : write.value;
      try {
        const res = await fetch(`/api/state/${path}`, {
          method: 'tour' in write ? 'PATCH' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
          keepalive,
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(String(res.status));
        this.outbox.shift();
        this.wrote += 1;
        this.failures = 0;
        this.remember();
      } catch {
        this.setStatus('offline');
        this.failures += 1;
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.flush(), Math.min(30_000, 2000 * 2 ** this.failures));
        return;
      } finally {
        this.active = undefined;
      }
    }
    this.setStatus('saved');
  }
}
