/**
 * One small server: the API that talks to NKERP, plus the web app.
 *   npm run dev    → API + Vite dev server on one port
 *   npm start      → API + the built app from dist/
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NkerpError, sharedClient } from './nkerp/client.mjs';
import { DEFAULT_OFFICE, runSync } from './nkerp/sync.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 8787;
const OFFICE = process.env.NKERP_OFFICE_NAME || DEFAULT_OFFICE;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Server-sent events: the loading screen listens to this while the pull runs. */
async function handleSync(req, res, url) {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') || null;
  if (!ISO_DATE.test(from) || (to && !ISO_DATE.test(to)) || (to && to < from)) {
    return json(res, 400, { error: 'Choose a start date, and an end date that is not before it.' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const emit = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const beat = setInterval(() => !res.writableEnded && res.write(': keep-alive\n\n'), 15_000);
  try {
    const result = await runSync({ client: sharedClient(), from, to, office: OFFICE, emit, signal: abort.signal });
    emit('done', result);
  } catch (error) {
    if (!abort.signal.aborted) {
      const known = error instanceof NkerpError;
      if (!known) console.error('[sync]', error);
      emit('failed', {
        code: known ? error.code : 'internal',
        message: known ? error.message : 'The pull stopped because of an unexpected error on the server.',
      });
    }
  } finally {
    clearInterval(beat);
    res.end();
  }
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Read-only API' });
  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, nkerp: sharedClient().configured, office: OFFICE });
  }
  if (url.pathname === '/api/sync') return handleSync(req, res, url);
  return json(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, safe);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('The app has not been built yet. Run "npm run build" first, or "npm run dev".');
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const hashed = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(res);
}

let vite = null;
if (DEV) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (vite) return vite.middlewares(req, res);
    return serveStatic(req, res, url);
  } catch (error) {
    console.error('[server]', error);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
    else res.end();
  }
});

server.listen(PORT, () => {
  const mode = DEV ? 'dev' : 'production';
  console.log(`Najaf stays (${mode}) on http://localhost:${PORT}  ·  NKERP sign-in ${sharedClient().configured ? 'set up' : 'missing'}`);
});
