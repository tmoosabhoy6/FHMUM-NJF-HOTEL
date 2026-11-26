/**
 * Shared city snapshots, staff edits, hotel settings and date ranges.
 *
 *   GET   /api/state?since=N         read keys changed after version N
 *   PATCH /api/state/{key}/{tour}    merge selected fields on one tour
 *   PUT   /api/state/{key}           save settings/range or clear tour edits
 *
 * An NKERP pull commits both city snapshots and the itinerary history at
 * one version. Staff edits use separate keys so a pull cannot replace them.
 * `monitor` (the automatic check and alert emails) is written by the server
 * only; `seenAlerts` holds, per tour ID, the last change someone marked seen.
 * D1 backs the Worker, and a JSON file backs the local Node server.
 */

export const STATE_KEYS = new Set(['dataset', 'inputs', 'applied', 'prefs', 'range', 'karbalaDataset', 'karbalaInputs', 'karbalaApplied', 'karbalaRange', 'monitor', 'seenAlerts']);
const PULL_KEYS = ['dataset', 'karbalaDataset', 'pullHistory'];
const SERVER_KEYS = new Set([...PULL_KEYS, 'monitor']);
/** Server-only rows, never sent to the browser: the itinerary history, unsent alert emails, the pull lease. */
const INTERNAL = "('pullHistory', 'alertOutbox', 'pullLease')";
const TOUR_KEYS = new Set(['inputs', 'karbalaInputs']);
const TOUR_KEY = /^tour-[1-9]\d{0,11}$/;
// Older open tabs may still patch entries by display number.
const PATCH_KEYS = new Set(['inputs', 'applied', 'karbalaInputs', 'karbalaApplied', 'seenAlerts']);
const STAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]{5,15}Z$/;
const FIELD = /^[A-Za-z0-9 _.\/-]{1,60}$/;
const MAX_BODY = 1_500_000;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Handles /api/state requests (Fetch API Request → Response). */
export async function handleState(request, url, store) {
  const [key = '', tour, ...extra] = url.pathname.replace(/^\/api\/state\/?/, '').split('/');
  if (extra.length) return json(404, { error: 'Unknown key' });
  if (request.method === 'GET' && !key) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { rows, version } = await store.list(since);
    const values = {};
    for (const row of rows) if (STATE_KEYS.has(row.key)) values[row.key] = JSON.parse(row.value);
    return json(200, { version, values });
  }
  if (!STATE_KEYS.has(key)) return json(404, { error: 'Unknown key' });
  if (request.method !== 'PUT' && request.method !== 'PATCH') return json(405, { error: 'Method not allowed' });

  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, { error: 'Too large' });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'Not JSON' });
  }
  if (tour !== undefined) {
    if (request.method !== 'PATCH' || !TOUR_KEYS.has(key) || !TOUR_KEY.test(tour)) return json(404, { error: 'Unknown tour edits' });
    if (!validTourEdit(body)) return json(400, { error: 'Invalid tour edits' });
    return json(200, { version: await store.editTour(key, tour, body.legacyKey, body.changes) });
  }
  if (request.method === 'PUT') {
    if (SERVER_KEYS.has(key)) return json(405, { error: 'Only an NKERP pull can refresh this data' });
    return json(200, { version: await store.put(key, JSON.stringify(body)) });
  }

  if (!PATCH_KEYS.has(key)) return json(400, { error: 'This key is replaced whole' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Send an object' });
  const fields = Object.entries(body);
  if (!fields.length || fields.length > 500 || fields.some(([f]) => !FIELD.test(f))) return json(400, { error: 'Bad fields' });
  if (key === 'seenAlerts' && fields.some(([f, v]) => !/^\d{1,12}$/.test(f) || (v !== null && !(typeof v === 'string' && STAMP.test(v))))) {
    return json(400, { error: 'Bad fields' });
  }
  return json(200, { version: await store.patch(key, fields) });
}

function validTourEdit(body) {
  if (!body || (body.legacyKey !== null && (typeof body.legacyKey !== 'string' || !FIELD.test(body.legacyKey))) || !body.changes ||
      typeof body.changes !== 'object' || Array.isArray(body.changes)) return false;
  const fields = Object.entries(body.changes);
  return fields.length > 0 && fields.every(([field, value]) => {
    switch (field) {
      case 'paxBefore':
      case 'pax': return value === null || (Number.isInteger(value) && value >= 0 && value <= 9999);
      case 'spec': return value === null || (typeof value === 'string' && value.length <= 1000);
      case 'pin': return value === null || ['ruya', 'araf', 'c'].includes(value);
      case 'roomNos': return value === null || (Array.isArray(value) && value.length <= 100 &&
        value.every((room) => typeof room === 'string' && /^[A-Za-z0-9 -]{1,25}$/.test(room)));
      default: return false;
    }
  });
}

const pullSnapshot = (rows) => ({
  values: Object.fromEntries(rows.map(({ key, value }) => [key, JSON.parse(value)])),
  version: rows.reduce((version, row) => Math.max(version, row.version), 0),
});

// ---- D1 (Cloudflare) -------------------------------------------------------

const SCHEMA = 'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL)';
const NEXT = '(SELECT COALESCE(MAX(version), 0) + 1 FROM state)';
const PULL_FILTER = "key IN ('dataset', 'karbalaDataset', 'pullHistory')";

export function d1Store(db) {
  let ready = null;
  const init = () => (ready ??= db.prepare(SCHEMA).run().catch((e) => ((ready = null), Promise.reject(e))));
  return {
    async list(since) {
      await init();
      const [rows, top] = await db.batch([
        db.prepare(`SELECT key, value, version FROM state WHERE version > ?1 AND key NOT IN ${INTERNAL}`).bind(since),
        db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM state'),
      ]);
      return { rows: rows.results, version: top.results[0].v };
    },
    async put(key, value) {
      await init();
      const row = await db
        .prepare(`INSERT INTO state (key, value, version) VALUES (?1, ?2, ${NEXT}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version RETURNING version`)
        .bind(key, value)
        .first();
      return row.version;
    },
    async get(key) {
      await init();
      const row = await db.prepare('SELECT value FROM state WHERE key = ?1').bind(key).first();
      return row ? JSON.parse(row.value) : undefined;
    },
    async readPull() {
      await init();
      const { results } = await db.prepare(`SELECT key, value, version FROM state WHERE ${PULL_FILTER}`).all();
      return pullSnapshot(results);
    },
    async savePull(expected, values) {
      await init();
      const row = await db.prepare(`
        WITH revision AS MATERIALIZED (
          SELECT ${NEXT} AS next, (SELECT COALESCE(MAX(version), 0) FROM state WHERE ${PULL_FILTER}) AS current
        ), updates(key, value) AS (VALUES ('dataset', ?2), ('karbalaDataset', ?3), ('pullHistory', ?4))
        INSERT INTO state (key, value, version)
          SELECT key, value, next FROM updates, revision WHERE current = ?1
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = excluded.version
        RETURNING version
      `).bind(expected, ...PULL_KEYS.map((key) => JSON.stringify(values[key]))).first();
      return Boolean(row);
    },
    async editTour(key, tour, legacy, changes) {
      await init();
      const row = await db.prepare(`
        INSERT INTO state (key, value, version) VALUES (?1, json_object(?5, json_patch('{}', ?4)), ${NEXT})
        ON CONFLICT(key) DO UPDATE SET
          value = json_set(state.value, ?2, json_patch(COALESCE(json_extract(state.value, ?2), json_extract(state.value, ?3), '{}'), ?4)),
          version = excluded.version
        RETURNING version
      `).bind(key, `$."${tour}"`, legacy === null ? null : `$."${legacy}"`, JSON.stringify(changes), tour).first();
      return row.version;
    },
    async patch(key, fields) {
      await init();
      const statements = [db.prepare("INSERT OR IGNORE INTO state (key, value, version) VALUES (?1, '{}', 0)").bind(key)];
      for (const [field, value] of fields) {
        const path = `$."${field}"`;
        statements.push(
          value === null || value === undefined
            ? db.prepare('UPDATE state SET value = json_remove(value, ?2) WHERE key = ?1').bind(key, path)
            : db.prepare('UPDATE state SET value = json_set(value, ?2, json(?3)) WHERE key = ?1').bind(key, path, JSON.stringify(value)),
        );
      }
      statements.push(db.prepare(`UPDATE state SET version = ${NEXT} WHERE key = ?1 RETURNING version`).bind(key));
      const results = await db.batch(statements);
      return results.at(-1).results[0].version;
    },
  };
}

// ---- JSON file (npm run dev / npm start) -------------------------------------

export async function fileStore(path) {
  const fs = await import('node:fs');
  const { dirname } = await import('node:path');
  let data = { version: 0, keys: {} };
  try {
    data = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    /* first run */
  }
  const write = (keys) => {
    const next = { version: data.version + 1, keys: { ...data.keys } };
    for (const [key, value] of Object.entries(keys)) next.keys[key] = { value, version: next.version };
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path + '.tmp', JSON.stringify(next));
    fs.renameSync(path + '.tmp', path);
    data = next;
    return next.version;
  };
  const rows = () => Object.entries(data.keys).map(([key, row]) => ({ key, ...row }));
  const readPull = () => pullSnapshot(rows().filter((row) => PULL_KEYS.includes(row.key)));
  return {
    async list(since) {
      return { rows: rows().filter((row) => row.version > since), version: data.version };
    },
    async put(key, value) {
      return write({ [key]: value });
    },
    async get(key) {
      const row = data.keys[key];
      return row ? JSON.parse(row.value) : undefined;
    },
    async readPull() {
      return readPull();
    },
    async savePull(expected, values) {
      if (readPull().version !== expected) return false;
      write(Object.fromEntries(PULL_KEYS.map((key) => [key, JSON.stringify(values[key])])));
      return true;
    },
    async editTour(key, tour, legacy, changes) {
      const current = JSON.parse(data.keys[key]?.value ?? '{}');
      const input = { ...(current[tour] ?? (legacy && Object.hasOwn(current, legacy) ? current[legacy] : {})) };
      for (const [field, value] of Object.entries(changes)) {
        if (value === null) delete input[field];
        else input[field] = value;
      }
      current[tour] = input;
      return write({ [key]: JSON.stringify(current) });
    },
    async patch(key, fields) {
      const current = JSON.parse(data.keys[key]?.value ?? '{}');
      for (const [field, value] of fields) {
        if (value === null || value === undefined) delete current[field];
        else Object.defineProperty(current, field, { value, enumerable: true, writable: true, configurable: true });
      }
      return write({ [key]: JSON.stringify(current) });
    },
  };
}
