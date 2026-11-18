/**
 * The Karbala tab's state: its own pull, the rooms typed per tour, and what
 * the messages were last built from. Saved for everyone like Najaf's
 * (karbala* keys on the server, lib/shared.ts), with a local copy for the
 * first paint. Lives in App so other devices' changes keep arriving while
 * the Najaf tab is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group, GroupInput, PullMeta } from '../../shared/types';
import { inputKey } from './inputs';
import type { SharedState, Values } from './shared';
import { load, save } from './storage';
import { emptyProgress, startPull, type PullProgress } from './sync';

export interface KarbalaDataset {
  groups: Group[];
  meta: PullMeta;
}

export interface Range {
  from: string;
  to: string;
}

const KEY = { data: 'kbl.dataset.v1', inputs: 'kbl.inputs.v1', applied: 'kbl.applied.v1', range: 'kbl.range.v1' };
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function useKarbala(shared: SharedState, loaded: boolean, defaultRange: Range) {
  const [dataset, setDataset] = useState<KarbalaDataset | null>(() => load<KarbalaDataset | null>(KEY.data, null));
  // What staff have typed (shown at once) and what the messages were last built from ("Refresh messages").
  const [typed, setTyped] = useState<Record<string, GroupInput>>(() => load(KEY.inputs, {}));
  const [applied, setApplied] = useState<Record<string, GroupInput>>(() => load(KEY.applied, {}));
  const [range, setRange] = useState<Range>(() => load(KEY.range, defaultRange));
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<PullProgress>(emptyProgress);
  const [error, setError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef({ dataset, typed, applied, range });
  latest.current = { dataset, typed, applied, range };

  useEffect(() => save(KEY.inputs, typed), [typed]);
  useEffect(() => save(KEY.applied, applied), [applied]);
  useEffect(() => save(KEY.range, range), [range]);
  useEffect(() => {
    if (loaded) shared.put('karbalaRange', range);
  }, [loaded, range, shared]);
  useEffect(() => () => cancel.current?.(), []);

  /** Values from the server (first read and every poll). */
  const apply = useCallback(
    (values: Values) => {
      const now = latest.current;
      if ('karbalaDataset' in values && values.karbalaDataset && !same(values.karbalaDataset, now.dataset)) {
        const next = values.karbalaDataset as KarbalaDataset;
        save(KEY.data, next);
        setDataset(next);
      }
      if ('karbalaInputs' in values) {
        const next = { ...(values.karbalaInputs as Record<string, GroupInput>) };
        for (const [k, v] of Object.entries(shared.pendingFields('karbalaInputs'))) {
          if (v === null) delete next[k];
          else next[k] = v as GroupInput;
        }
        if (!same(next, now.typed)) setTyped(next);
      }
      if ('karbalaApplied' in values && !shared.busy('karbalaApplied') && !same(values.karbalaApplied, now.applied)) {
        setApplied((values.karbalaApplied ?? {}) as Record<string, GroupInput>);
      }
      if ('karbalaRange' in values && values.karbalaRange && !shared.busy('karbalaRange') && !same(values.karbalaRange, now.range)) {
        setRange(values.karbalaRange as Range);
      }
    },
    [shared],
  );

  const pull = useCallback(() => {
    cancel.current?.();
    setProgress(emptyProgress());
    setError(null);
    setPulling(true);
    const { from, to } = latest.current.range;
    cancel.current = startPull(
      { from, to: to || null, source: 'nkerp', venue: 'karbala' },
      {
        onProgress: (update) => setProgress(update),
        onDone: (result) => {
          save(KEY.data, result);
          shared.put('karbalaDataset', result);
          setDataset(result);
          setPulling(false);
        },
        onFailed: (message) => {
          setError(message);
          setPulling(false);
        },
      },
    );
  }, [shared]);

  /** Stops a pull, or puts away its error. */
  const stop = useCallback(() => {
    cancel.current?.();
    cancel.current = null;
    setPulling(false);
    setError(null);
  }, []);

  /** Rooms typed for one tour (kept by tour number, so they survive a new pull). */
  const onInput = useCallback(
    (tourNo: string, spec: string) => {
      const key = inputKey({ tourNo });
      const copy = { ...latest.current.typed };
      if (spec.trim()) copy[key] = { spec };
      else delete copy[key];
      latest.current.typed = copy;
      setTyped(copy);
      shared.patch('karbalaInputs', key, spec.trim() ? { spec } : null);
    },
    [shared],
  );

  const refresh = useCallback(() => {
    const typedNow = latest.current.typed;
    setApplied(typedNow);
    shared.put('karbalaApplied', typedNow);
    setRefreshed(true);
    window.setTimeout(() => setRefreshed(false), 2400);
  }, [shared]);

  const groups = useMemo(() => dataset?.groups ?? [], [dataset]);
  /** Tours in this pull whose typed rooms differ from what the messages were built with. */
  const pending = useMemo(() => {
    const keys = new Set(groups.filter((g) => g.pax > 0).map(inputKey));
    return [...keys].filter((k) => (typed[k]?.spec ?? '') !== (applied[k]?.spec ?? '')).length;
  }, [groups, typed, applied]);

  return { dataset, groups, typed, applied, range, setRange, pulling, progress, error, refreshed, pending, apply, pull, stop, onInput, refresh };
}

export type Karbala = ReturnType<typeof useKarbala>;
