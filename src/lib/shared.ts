/**
 * The app's shared saved state, kept on the server (server/state.mjs) so every
 * device and every link sees the same pull, room requests, hotel choices and
 * settings. localStorage stays as a fast local copy for the first paint and
 * for when the server cannot be reached.
 *
 * Writes are queued and sent shortly after a change; room requests go field by
 * field (one tour at a time), so two people typing for different tours never
 * overwrite each other. Other devices' changes arrive by polling.
 */

export type SharedKey = 'dataset' | 'inputs' | 'applied' | 'prefs' | 'range';
export type SaveStatus = 'saved' | 'saving' | 'offline';
export type Values = Partial<Record<SharedKey, unknown>>;

export class SharedState {
  /** Server version of the last poll fully applied. */
  private version = 0;
  /** JSON of each key as last seen on, or sent to, the server. */
  private known: Partial<Record<SharedKey, string>> = {};
  private puts: Partial<Record<SharedKey, unknown>> = {};
  private patches: Partial<Record<SharedKey, Record<string, unknown>>> = {};
  /** Keys with a write in flight, and a counter of finished writes per key. */
  private inflight = new Set<SharedKey>();
  private wrote: Partial<Record<SharedKey, number>> = {};
  private seq = 0;
  private timer: number | undefined;
  private flushing = false;
  private failures = 0;
  status: SaveStatus = 'saved';
  onStatus: (status: SaveStatus) => void = () => {};

  private setStatus(status: SaveStatus) {
    if (status !== this.status) {
      this.status = status;
      this.onStatus(status);
    }
  }

  /** Changes on the server since the last poll, or null when it cannot be reached. */
  async poll(): Promise<Values | null> {
    const started = this.seq;
    let body: { version: number; values: Values };
    try {
      const res = await fetch(`/api/state?since=${this.version}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      body = await res.json();
    } catch {
      if (this.status === 'saved') this.setStatus('offline');
      return null;
    }
    if (this.status === 'offline' && !this.pendingCount()) this.setStatus('saved');
    const values: Values = {};
    let skipped = false;
    for (const [k, value] of Object.entries(body.values) as [SharedKey, unknown][]) {
      // A write to this key finished (or is still going) after this poll started: its answer may be older.
      if (this.inflight.has(k) || (this.wrote[k] ?? 0) > started) {
        skipped = true;
        continue;
      }
      this.known[k] = JSON.stringify(value);
      values[k] = value;
    }
    if (!skipped) this.version = body.version;
    return values;
  }

  /** Replace a key's value on the server (skipped when the server already has it). */
  put(key: SharedKey, value: unknown) {
    if (this.known[key] === JSON.stringify(value) && !(key in this.puts) && !this.patches[key]) return;
    this.puts[key] = value;
    delete this.patches[key];
    this.schedule(400);
  }

  /** Set (or with null, remove) one field of an object key, e.g. one tour's room request. */
  patch(key: SharedKey, field: string, value: unknown) {
    if (key in this.puts) {
      const whole = { ...(this.puts[key] as Record<string, unknown>) };
      if (value === null || value === undefined) delete whole[field];
      else whole[field] = value;
      this.puts[key] = whole;
    } else {
      (this.patches[key] ??= {})[field] = value ?? null;
    }
    this.schedule(700);
  }

  /** Whether a key has local changes the server does not have yet. */
  busy(key: SharedKey) {
    return key in this.puts || Boolean(this.patches[key]) || this.inflight.has(key);
  }

  /** Local field changes not yet on the server, to lay over a value from the server. */
  pendingFields(key: SharedKey): Record<string, unknown> {
    if (key in this.puts) return { ...(this.puts[key] as Record<string, unknown>) };
    return { ...(this.patches[key] ?? {}) };
  }

  private pendingCount() {
    return Object.keys(this.puts).length + Object.keys(this.patches).length + this.inflight.size;
  }

  private schedule(ms: number) {
    this.setStatus('saving');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), ms);
  }

  async flush(keepalive = false) {
    if (this.flushing) return;
    this.flushing = true;
    let failed = false;
    try {
      for (const key of Object.keys(this.puts) as SharedKey[]) {
        const value = this.puts[key];
        delete this.puts[key];
        this.inflight.add(key);
        const ok = await send('PUT', key, value, keepalive);
        this.inflight.delete(key);
        if (ok) {
          this.known[key] = JSON.stringify(value);
          this.wrote[key] = ++this.seq;
        } else if (!(key in this.puts)) {
          this.puts[key] = value;
          failed = true;
        }
      }
      for (const key of Object.keys(this.patches) as SharedKey[]) {
        const fields = this.patches[key]!;
        delete this.patches[key];
        this.inflight.add(key);
        const ok = await send('PATCH', key, fields, keepalive);
        this.inflight.delete(key);
        if (ok) {
          delete this.known[key];
          this.wrote[key] = ++this.seq;
        } else {
          // Keep newer local changes over the ones that failed.
          if (key in this.puts) continue;
          this.patches[key] = { ...fields, ...(this.patches[key] ?? {}) };
          failed = true;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (failed) {
      this.failures += 1;
      this.setStatus('offline');
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.flush(), Math.min(30_000, 2_000 * 2 ** this.failures));
    } else {
      this.failures = 0;
      if (this.pendingCount()) this.schedule(100);
      else this.setStatus('saved');
    }
  }
}

async function send(method: 'PUT' | 'PATCH', key: SharedKey, body: unknown, keepalive: boolean) {
  try {
    const res = await fetch(`/api/state/${key}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}
