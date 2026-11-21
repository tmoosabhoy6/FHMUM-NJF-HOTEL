/**
 * Cloudflare Worker: serves the built app (dist/) and the read-only NKERP API.
 *
 *   GET /api/health        is NKERP sign-in set up?
 *   GET /api/sync?from&to&venue  the pull (venue najaf or karbala), streamed to the loading screen as server-sent events
 *   /api/state             the app's shared saved state, in D1 (server/state.mjs)
 *
 * The NKERP login comes from the Worker's secrets NKERP_LOGIN_ID and
 * NKERP_PASSWORD. The app itself has no login: anyone with the link can use it.
 */
import { NkerpClient, NkerpError } from '../server/nkerp/client.mjs';
import { DEFAULT_OFFICE } from '../server/nkerp/sync.mjs';
import { refreshFromNkerp, validPullRange } from '../server/pull.mjs';
import { d1Store, handleState } from '../server/state.mjs';
import { FILES } from './assets.generated.mjs';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

function sync(url, env, ctx) {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') || null;
  const venue = url.searchParams.get('venue') || 'najaf';
  if (venue !== 'najaf' && venue !== 'karbala') return json(400, { error: 'Unknown city' });
  if (!validPullRange(from, to)) {
    return json(400, { error: 'Choose a start date, and an end date that is not before it.' });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let open = true;
  const send = (text) => {
    if (!open) return;
    writer.write(encoder.encode(text)).catch(() => {
      // The browser went away: stop reading NKERP.
      open = false;
      abort.abort();
    });
  };
  const emit = (event, data) => send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const beat = setInterval(() => send(': keep-alive\n\n'), 15_000);

  const work = (async () => {
    try {
      const result = await refreshFromNkerp({
        store: d1Store(env.DB),
        client: new NkerpClient({ loginId: env.NKERP_LOGIN_ID, password: env.NKERP_PASSWORD, baseUrl: env.NKERP_BASE_URL }),
        from,
        to,
        venue,
        office: env.NKERP_OFFICE_NAME || DEFAULT_OFFICE,
        emit,
        signal: abort.signal,
      });
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
      open = false;
      await writer.close().catch(() => {});
    }
  })();
  ctx.waitUntil(work);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** The app's files, bundled into the Worker at build time. Unknown paths get the app. */
function serveFile(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const file = FILES[url.pathname] ?? (url.pathname.startsWith('/assets/') ? null : FILES['/index.html']);
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : file.body, {
    headers: {
      'Content-Type': file.type,
      'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return serveFile(request, url);
    if (url.pathname === '/api/state' || url.pathname.startsWith('/api/state/')) {
      if (!env.DB) return json(503, { error: 'Shared storage is not set up' });
      try {
        return await handleState(request, url, d1Store(env.DB));
      } catch (error) {
        console.error('[state]', error);
        return json(500, { error: 'Could not save' });
      }
    }
    if (request.method !== 'GET') return json(405, { error: 'Read-only API' });
    if (url.pathname === '/api/health') {
      return json(200, { ok: true, nkerp: Boolean(env.NKERP_LOGIN_ID && env.NKERP_PASSWORD), office: env.NKERP_OFFICE_NAME || DEFAULT_OFFICE });
    }
    if (url.pathname === '/api/sync') {
      if (!env.DB) return json(503, { error: 'Shared storage is not set up' });
      return sync(url, env, ctx);
    }
    return json(404, { error: 'Not found' });
  },
};
