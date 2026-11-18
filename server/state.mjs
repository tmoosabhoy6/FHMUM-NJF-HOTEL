/**
 * The app's shared saved state: the last pull, room requests and hotel
 * choices, what the plan was last built from, hotel settings and the date
 * range; and the same for the Karbala tab (karbala* keys: its last pull, room
 * requests, what its messages were last built from, its date range). One copy for everyone, so every device and every link to the app
 * sees the same thing.
 *
 *   GET   /api/state?since=N   keys changed after version N (all keys when N is 0)
 *   PUT   /api/state/{key}     replace one key's value (JSON body)
 *   PATCH /api/state/{key}     set or remove fields of an object key: {"2270": {...}, "2271": null}
 *
 * Every write bumps one version counter, so a device polls with the last
 * version it saw and gets only what changed.
 *
 * Stores: D1 on Cloudflare (d1Store), a JSON file for `npm run dev` (fileStore).
 */

export const STATE_KEYS = new Set(['dataset', 'inputs', 'applied', 'prefs', 'range', 'karbalaDataset', 'karbalaInputs', 'karbalaApplied', 'karbalaRange']);
/** Keys holding one entry per tour, which devices change field by field. */
const PATCH_KEYS = new Set(['inputs', 'applied', 'karbalaInputs', 'karbalaApplied']);
const FIELD = /^[A-Za-z0-9 _.\/-]{1,60}$/;
const MAX_BODY = 1_500_000;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Handles /api/state requests (Fetch API Request → Response). */
export async function handleState(request, url, store) {
  const key = decodeURIComponent(url.pathname.replace(/^\/api\/state\/?/, ''));
  if (request.method === 'GET' && !key) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const { rows, version } = await store.list(since);
    const values = {};
    for (const row of rows) values[row.key] = JSON.parse(row.value);
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
  if (request.method === 'PUT') return json(200, { version: await store.put(key, JSON.stringify(body)) });

  if (!PATCH_KEYS.has(key)) return json(400, { error: 'This key is replaced whole' });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Send an object' });
  const fields = Object.entries(body);
  if (!fields.length || fields.length > 500 || fields.some(([f]) => !FIELD.test(f))) return json(400, { error: 'Bad fields' });
  return json(200, { version: await store.patch(key, fields) });
}

// ---- D1 (Cloudflare) -------------------------------------------------------

const SCHEMA = 'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL)';
const NEXT = '(SELECT COALESCE(MAX(version), 0) + 1 FROM state)';

export function d1Store(db) {
  let ready = null;
  const init = () => (ready ??= db.prepare(SCHEMA).run().catch((e) => ((ready = null), Promise.reject(e))));
  return {
    async list(since) {
      await init();
      const [rows, top] = await db.batch([
        db.prepare('SELECT key, value, version FROM state WHERE version > ?1').bind(since),
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
  const write = () => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, JSON.stringify(data));
  };
  const bump = (key, value) => {
    data.version += 1;
    data.keys[key] = { value, version: data.version };
    write();
    return data.version;
  };
  return {
    async list(since) {
      const rows = Object.entries(data.keys)
        .filter(([, row]) => row.version > since)
        .map(([key, row]) => ({ key, value: row.value, version: row.version }));
      return { rows, version: data.version };
    },
    async put(key, value) {
      return bump(key, value);
    },
    async patch(key, fields) {
      const current = JSON.parse(data.keys[key]?.value ?? '{}');
      for (const [field, value] of fields) {
        if (value === null || value === undefined) delete current[field];
        else current[field] = value;
      }
      return bump(key, JSON.stringify(current));
    },
  };
}
