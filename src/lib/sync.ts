import type { Group, PullMeta } from '../../shared/types';

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
  const query = new URLSearchParams({ from: params.from, source: params.source });
  if (params.to) query.set('to', params.to);
  const stream = new EventSource(`/api/sync?${query}`);
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
