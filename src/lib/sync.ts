import { runSample } from '../../shared/sample';
import type { Group, PullMeta } from '../../shared/types';

/**
 * Where the NKERP server lives. Empty means the same site (npm run dev /
 * npm start). A static copy such as GitHub Pages sets VITE_API_URL at build
 * time; with no server at all, only sample groups are available.
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export type ServerState = 'checking' | 'ready' | 'no-login' | 'no-server';
export type Source = 'nkerp' | 'sample' | 'snapshot';

export async function checkServer(): Promise<ServerState> {
  try {
    const response = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return 'no-server';
    const health = (await response.json()) as { nkerp?: boolean };
    return health.nkerp ? 'ready' : 'no-login';
  } catch {
    return 'no-server';
  }
}

export type StepId = 'signin' | 'tours' | 'transport' | 'match';
export type StepStatus = 'waiting' | 'active' | 'done';

export interface PullProgress {
  steps: Record<StepId, { status: StepStatus; detail: string }>;
  /** Dates the transport dashboards will be read for. */
  dates: string[];
  /** Dates read so far, with the guests moving that day. */
  read: Record<string, { arriving: number; leaving: number }>;
  groups: number;
  guests: number;
}

export interface PullResult {
  groups: Group[];
  meta: PullMeta;
}

export const STEP_ORDER: StepId[] = ['signin', 'tours', 'transport', 'match'];
export const STEP_TITLE: Record<StepId, string> = {
  signin: 'Sign in to NKERP',
  tours: 'Approved Najaf tours',
  transport: 'Arrivals and departures',
  match: 'Match groups with flights',
};

export const emptyProgress = (): PullProgress => ({
  steps: {
    signin: { status: 'waiting', detail: '' },
    tours: { status: 'waiting', detail: '' },
    transport: { status: 'waiting', detail: '' },
    match: { status: 'waiting', detail: '' },
  },
  dates: [],
  read: {},
  groups: 0,
  guests: 0,
});

interface Handlers {
  onProgress: (update: (p: PullProgress) => PullProgress) => void;
  onDone: (result: PullResult) => void;
  onFailed: (message: string) => void;
}

/** Starts a pull and streams its progress. Returns a function that cancels it. */
export function startPull(params: { from: string; to: string | null; source: 'nkerp' | 'sample' }, handlers: Handlers): () => void {
  if (params.source === 'sample') return startSample(params, handlers);
  const query = new URLSearchParams({ from: params.from });
  if (params.to) query.set('to', params.to);
  const stream = new EventSource(`${API_URL}/api/sync?${query}`);
  let finished = false;
  const on = <T,>(name: string, fn: (data: T) => void) =>
    stream.addEventListener(name, (event) => fn(JSON.parse((event as MessageEvent).data) as T));

  on<{ id: StepId; status: StepStatus; detail: string }>('step', ({ id, status, detail }) =>
    handlers.onProgress((p) => ({ ...p, steps: { ...p.steps, [id]: { status, detail } } })),
  );
  on<{ selfHoused: number; guests: number }>('tours', ({ selfHoused, guests }) =>
    handlers.onProgress((p) => ({ ...p, groups: selfHoused, guests })),
  );
  on<{ dates: string[] }>('days', ({ dates }) => handlers.onProgress((p) => ({ ...p, dates })));
  on<{ date: string; arriving: number; leaving: number }>('day', ({ date, arriving, leaving }) =>
    handlers.onProgress((p) => ({ ...p, read: { ...p.read, [date]: { arriving, leaving } } })),
  );
  on<PullResult>('done', (result) => {
    finished = true;
    stream.close();
    handlers.onDone(result);
  });
  on<{ message: string }>('failed', ({ message }) => {
    finished = true;
    stream.close();
    handlers.onFailed(message);
  });
  stream.onerror = () => {
    if (finished) return;
    finished = true;
    stream.close();
    handlers.onFailed('The connection to the server dropped before the pull finished. Check the server is running, then pull again.');
  };
  return () => {
    finished = true;
    stream.close();
  };
}

/** Sample groups are made up in the browser, with the same progress events as a real pull. */
function startSample(params: { from: string; to: string | null }, handlers: Handlers): () => void {
  const abort = new AbortController();
  const emit = (event: string, data: unknown) => {
    if (abort.signal.aborted) return;
    const d = data as Record<string, never>;
    if (event === 'step') handlers.onProgress((p) => ({ ...p, steps: { ...p.steps, [d.id]: { status: d.status, detail: d.detail } } }));
    if (event === 'tours') handlers.onProgress((p) => ({ ...p, groups: d.selfHoused, guests: d.guests }));
    if (event === 'days') handlers.onProgress((p) => ({ ...p, dates: d.dates }));
    if (event === 'day') handlers.onProgress((p) => ({ ...p, read: { ...p.read, [d.date]: { arriving: d.arriving, leaving: d.leaving } } }));
  };
  runSample({ from: params.from, to: params.to, emit, signal: abort.signal })
    .then((result) => !abort.signal.aborted && handlers.onDone(result))
    .catch(() => !abort.signal.aborted && handlers.onFailed('The sample groups could not be made. Reload the page and try again.'));
  return () => abort.abort();
}
