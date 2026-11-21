import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group } from '../../shared/types';
import { editInput, inputKey, legacyKey, tourInput, withHotelPax, type InputChange, type TourInputs } from './inputs';
import type { SharedState, Values } from './shared';
import { load, save } from './storage';
import { emptyProgress, startPull, type PullProgress, type PullResult } from './sync';

export interface Range {
  from: string;
  to: string;
}

const KEY = { data: 'kbl.dataset.v1', inputs: 'kbl.inputs.v1', range: 'kbl.range.v1' };

export function useKarbala(shared: SharedState, defaultRange: Range, poll: () => void) {
  const [dataset, setDataset] = useState(() => load<PullResult | null>(KEY.data, null));
  const [typed, setTyped] = useState<TourInputs>(() => load(KEY.inputs, {}));
  const [range, setRange] = useState<Range>(() => load(KEY.range, defaultRange));
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<PullProgress>(emptyProgress);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const latestDataset = useRef(dataset);
  latestDataset.current = dataset;

  useEffect(() => save(KEY.inputs, typed), [typed]);
  useEffect(() => save(KEY.range, range), [range]);
  useEffect(() => () => cancel.current?.(), []);

  const accept = (next: PullResult) => {
    if (next.meta.fetchedAt < (latestDataset.current?.meta.fetchedAt ?? '')) return;
    latestDataset.current = next;
    save(KEY.data, next);
    setDataset(next);
  };

  const apply = (values: Values, first: boolean) => {
    if (values.karbalaDataset) accept(values.karbalaDataset as PullResult);
    if ('karbalaInputs' in values || first) setTyped(shared.withPending('karbalaInputs', (values.karbalaInputs ?? {}) as TourInputs));
    if (values.karbalaRange && !shared.pending('karbalaRange')) setRange(values.karbalaRange as Range);
    else if (first && !latestDataset.current) setRange(defaultRange);
  };

  const pull = () => {
    cancel.current?.();
    setProgress(emptyProgress());
    setError(null);
    setPulling(true);
    cancel.current = startPull(
      { from: range.from, to: range.to || null, source: 'nkerp', venue: 'karbala' },
      {
        onProgress: (update) => setProgress(update),
        onDone: (result) => {
          cancel.current = null;
          accept(result);
          setPulling(false);
          poll();
        },
        onFailed: (message) => {
          setError(message);
          setPulling(false);
          poll();
        },
      },
    );
  };

  const stop = useCallback(() => {
    cancel.current?.();
    cancel.current = null;
    setPulling(false);
    setError(null);
  }, []);

  const onInput = (group: Group, changes: InputChange) => {
    const legacy = legacyKey(group, dataset?.meta);
    setTyped((all) => editInput(all, inputKey(group), legacy, changes));
    shared.edit('karbalaInputs', group, legacy, changes);
  };

  const groups = useMemo(() => withHotelPax(dataset?.groups ?? [], typed, dataset?.meta), [dataset, typed]);
  const inputs = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, tourInput(typed, g, dataset?.meta)])), [groups, typed, dataset]);
  const changeRange = (update: (previous: Range) => Range) => {
    const next = update(range);
    setRange(next);
    shared.put('karbalaRange', next);
  };

  return { dataset, groups, inputs, range, setRange: changeRange, pulling, progress, error, apply, pull, stop, onInput };
}

export type Karbala = ReturnType<typeof useKarbala>;
