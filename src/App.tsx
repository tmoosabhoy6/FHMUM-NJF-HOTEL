import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OPENING_BALANCE, PLANNING_START, RUYA_WITHHELD, ruyaRooms } from '../shared/config';
import { dayMonth, fullDate } from '../shared/dates';
import { buildPlan, hotelNames } from '../shared/engine';
import type { Group, GroupInput, PullMeta, Settings } from '../shared/types';
import { HotelMessages } from './components/HotelMessages';
import { SettingsDrawer, type Prefs } from './components/SettingsDrawer';
import { Brand } from './components/ui';
import { exportPlan } from './lib/export';
import { inputKey } from './lib/inputs';
import { NamesContext } from './lib/names';
import { SharedState, type SaveStatus, type Values } from './lib/shared';
import { load, remove, save } from './lib/storage';
import { checkServer, emptyProgress, startPull, type PullProgress, type ServerState } from './lib/sync';
import { Night } from './screens/Night';
import { PlanView } from './screens/PlanView';

interface Dataset {
  groups: Group[];
  meta: PullMeta;
}

// v2: guests are counted person by person, and room requests are written bed size first.
// Local copies only: the shared copy everyone sees is on the server (lib/shared.ts).
const KEY = { data: 'njf.dataset.v2', inputs: 'njf.inputs.v2', applied: 'njf.applied.v2', prefs: 'njf.prefs.v2', range: 'njf.range.v2', merged: 'njf.shared.v1' };
const POLL_MS = 15_000;

const DEFAULT_PREFS: Prefs = { arafCapacity: 100, departureDayRule: true, withheld: RUYA_WITHHELD };

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return fullDate(iso.slice(0, 10));
}

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(() => load<Dataset | null>(KEY.data, null));
  // What staff have typed (shown in the Groups table straight away) and what the plan was last built from.
  // The plan only changes when "Refresh plan" copies the one into the other.
  const [typed, setTyped] = useState<Record<string, GroupInput>>(() => load(KEY.inputs, {}));
  const [applied, setApplied] = useState<Record<string, GroupInput>>(() => load(KEY.applied, load(KEY.inputs, {})));
  const [refreshed, setRefreshed] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>(KEY.prefs, {}) }));
  const [range, setRange] = useState(() => load(KEY.range, { from: PLANNING_START, to: '' }));
  const [screen, setScreen] = useState<'start' | 'pulling' | 'failed' | 'app'>(() => (load<Dataset | null>(KEY.data, null) ? 'app' : 'start'));
  const [progress, setProgress] = useState<PullProgress>(emptyProgress);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState>('checking');
  const [source, setSource] = useState<'nkerp' | 'sample'>('nkerp');
  const [panel, setPanel] = useState<'settings' | 'messages' | null>(null);
  const [exporting, setExporting] = useState(false);
  const cancel = useRef<(() => void) | null>(null);
  const [shared] = useState(() => new SharedState());
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  // The latest values, for the poll and for typing (which works from the current room requests).
  const latest = useRef({ dataset, typed, applied, prefs, range, screen });
  latest.current = { dataset, typed, applied, prefs, range, screen };

  useEffect(() => {
    checkServer().then(setServer);
    // Data saved by the first version is in an older shape: drop it.
    for (const old of ['njf.dataset.v1', 'njf.inputs.v1', 'njf.settings.v1', 'njf.range.v1']) remove(old);
  }, []);
  useEffect(() => save(KEY.inputs, typed), [typed]);
  useEffect(() => save(KEY.applied, applied), [applied]);
  useEffect(() => save(KEY.prefs, prefs), [prefs]);
  useEffect(() => save(KEY.range, range), [range]);
  // Settings and the date range go to the shared copy as they change (once it has been read).
  useEffect(() => {
    if (loaded) shared.put('prefs', prefs);
  }, [loaded, prefs, shared]);
  useEffect(() => {
    if (loaded) shared.put('range', range);
  }, [loaded, range, shared]);

  // ---- the shared copy: read it, keep reading other devices' changes -------
  useEffect(() => {
    shared.onStatus = setSaveStatus;
    let stopped = false;
    const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const apply = (values: Values, first: boolean) => {
      const now = latest.current;
      if ('dataset' in values && values.dataset && !same(values.dataset, now.dataset)) {
        const next = values.dataset as Dataset;
        save(KEY.data, next);
        setDataset(next);
        if (first && now.screen === 'start') setScreen('app');
      }
      if ('inputs' in values) {
        const next = { ...(values.inputs as Record<string, GroupInput>) };
        for (const [k, v] of Object.entries(shared.pendingFields('inputs'))) {
          if (v === null) delete next[k];
          else next[k] = v as GroupInput;
        }
        if (!same(next, now.typed)) setTyped(next);
      }
      if ('applied' in values && !shared.busy('applied') && !same(values.applied, now.applied)) setApplied((values.applied ?? {}) as Record<string, GroupInput>);
      if ('prefs' in values && !shared.busy('prefs')) {
        const next = { ...DEFAULT_PREFS, ...(values.prefs as Partial<Prefs>) };
        if (!same(next, now.prefs)) setPrefs(next);
      }
      if ('range' in values && values.range && !shared.busy('range') && !same(values.range, now.range)) setRange(values.range as typeof now.range);
    };
    const first = async () => {
      let values = await shared.poll();
      while (!values && !stopped) {
        // Server unreachable: keep working from this device's copy and try again.
        await new Promise((r) => window.setTimeout(r, 5_000));
        values = await shared.poll();
      }
      if (stopped || !values) return;
      const now = latest.current;
      // This device's own earlier work (from before sharing) goes up once: whole keys the server lacks,
      // and room requests for tours the server has nothing for.
      if (!load(KEY.merged, false)) {
        if (values.dataset === undefined && now.dataset) shared.put('dataset', now.dataset);
        if (values.applied === undefined && Object.keys(now.applied).length) shared.put('applied', now.applied);
        const server = (values.inputs ?? {}) as Record<string, GroupInput>;
        for (const [k, v] of Object.entries(now.typed)) if (!(k in server)) shared.patch('inputs', k, v);
        if (values.prefs === undefined) values.prefs = now.prefs;
        if (values.range === undefined) values.range = now.range;
        save(KEY.merged, true);
      }
      apply(values, true);
      setLoaded(true);
    };
    void first();
    const tick = async () => {
      if (!stopped && latest.current && document.visibilityState !== 'hidden') {
        const values = await shared.poll();
        if (values && !stopped) apply(values, false);
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    const onHide = () => void shared.flush(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('pagehide', onHide);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('pagehide', onHide);
    };
  }, [shared]);
  useEffect(() => () => cancel.current?.(), []);

  const settings = useMemo<Settings>(() => {
    const rooms = ruyaRooms(prefs.withheld);
    return {
      rooms,
      ruyaCapacity: rooms.reduce((sum, r) => sum + r.beds * r.count, 0),
      arafCapacity: prefs.arafCapacity,
      departureDayRule: prefs.departureDayRule,
      names: hotelNames(prefs.names),
    };
  }, [prefs]);

  const pull = useCallback(
    (source: 'nkerp' | 'sample') => {
      cancel.current?.();
      setSource(source);
      setProgress(emptyProgress());
      setError(null);
      setScreen('pulling');
      cancel.current = startPull(
        { from: range.from, to: range.to || null, source },
        {
          onProgress: (update) => setProgress(update),
          onDone: (result) => {
            save(KEY.data, result);
            shared.put('dataset', result);
            // Let the last windows light before the night lifts.
            window.setTimeout(() => {
              setDataset(result);
              setScreen('app');
            }, 900);
          },
          onFailed: (message) => {
            setError(message);
            setScreen('failed');
          },
        },
      );
    },
    [range, shared],
  );

  const groups = useMemo(() => dataset?.groups ?? [], [dataset]);
  const inputs = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, typed[inputKey(g)]])), [groups, typed]);
  const appliedInputs = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, applied[inputKey(g)]])), [groups, applied]);
  const plan = useMemo(
    () =>
      dataset
        ? buildPlan({ groups, inputs: appliedInputs, settings, holds: OPENING_BALANCE, from: dataset.meta.from, to: dataset.meta.to, start: PLANNING_START })
        : null,
    [dataset, groups, appliedInputs, settings],
  );
  /** Tours whose typed rooms or hotel differ from what the plan was built with. */
  const pending = useMemo(() => {
    // Only tours in this pull can change the plan.
    const keys = new Set(groups.map(inputKey));
    return [...keys].filter((k) => JSON.stringify(typed[k] ?? {}) !== JSON.stringify(applied[k] ?? {})).length;
  }, [groups, typed, applied]);
  const refresh = useCallback(() => {
    setApplied(typed);
    shared.put('applied', typed);
    setRefreshed(true);
    window.setTimeout(() => setRefreshed(false), 2400);
  }, [typed, shared]);

  const onInput = useCallback((tourNo: string, patch: GroupInput) => {
    const key = inputKey({ tourNo });
    const all = latest.current.typed;
    const next: GroupInput = { ...all[key], ...patch };
    if (!next.spec?.trim()) delete next.spec;
    if (!next.pin) delete next.pin;
    if (!next.roomNos?.length) delete next.roomNos;
    const copy = { ...all };
    if (Object.keys(next).length) copy[key] = next;
    else delete copy[key];
    latest.current.typed = copy;
    setTyped(copy);
    shared.patch('inputs', key, Object.keys(next).length ? next : null);
  }, [shared]);

  const names = settings.names ?? hotelNames();
  const night = screen !== 'app';
  const flagged = plan?.totals.flagged ?? 0;

  return (
    <NamesContext.Provider value={names}>
      {dataset && plan ? (
        <div className="app" aria-hidden={night}>
          <header className="app-top">
            <div className="app-top-inner">
              <Brand />
              <div className="pulled">
                <b>
                  From {dayMonth(dataset.meta.from)}
                  {dataset.meta.to ? ` to ${dayMonth(dataset.meta.to)}` : ''}
                </b>
                Pulled {ago(dataset.meta.fetchedAt)}
                <span className="save-status" data-status={saveStatus} title="Room requests, hotel choices and settings are shared by every device and link">
                  {saveStatus === 'saving' ? ' · Saving…' : saveStatus === 'offline' ? ' · Not saved yet, retrying' : loaded ? ' · Saved for everyone' : ''}
                </span>
              </div>
              <div className="top-actions">
                <button className="btn refresh" data-pending={pending > 0} onClick={refresh} title="Rebuild the plan with the room requests and choices made since the last refresh">
                  {refreshed && !pending ? 'Plan refreshed' : 'Refresh plan'}
                  {pending ? <span className="badge">{pending}</span> : null}
                </button>
                <button className="btn" onClick={() => setPanel('messages')}>
                  Hotel messages
                </button>
                <button className="btn" onClick={() => setPanel('settings')}>
                  Hotels and rooms
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setProgress(emptyProgress());
                    setError(null);
                    setScreen('start');
                  }}
                >
                  Pull again
                </button>
                <button
                  className="btn solid"
                  disabled={exporting || !groups.length}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await exportPlan(plan, groups, dataset.meta, names);
                    } finally {
                      setExporting(false);
                    }
                  }}
                >
                  {exporting ? 'Building the file' : 'Download Excel'}
                </button>
              </div>
            </div>
          </header>
          <AnimatePresence initial={false}>
            {pending ? (
              <motion.div
                key="pending"
                className="pending-bar"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="pending-inner">
                  <span>
                    Rooms or hotel choices changed for {pending} {pending === 1 ? 'tour' : 'tours'}. The plan below does not include them yet.
                  </span>
                  <button className="btn solid" onClick={refresh}>
                    Refresh plan
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {dataset.meta.source === 'sample' ? (
            <div className="banner">Sample groups, not NKERP. Pull again to load the real tours.</div>
          ) : null}

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}>
            <PlanView groups={groups} plan={plan} meta={dataset.meta} inputs={inputs} onInput={onInput} onOpenMessages={() => setPanel('messages')} />
          </motion.div>
          <span className="sr" aria-live="polite">
            {flagged ? `${flagged} groups are not in ${names.ruya}.` : `Every group is in ${names.ruya}.`}
          </span>
        </div>
      ) : null}

      <AnimatePresence>
        {panel === 'settings' ? (
          <SettingsDrawer
            key="settings"
            prefs={prefs}
            beds={settings.ruyaCapacity}
            onChange={setPrefs}
            onClose={() => setPanel(null)}
            typedCount={Object.keys(typed).length}
            onClearInputs={() => {
              setTyped({});
              setApplied({});
              remove(KEY.inputs);
              remove(KEY.applied);
              shared.put('inputs', {});
              shared.put('applied', {});
            }}
          />
        ) : panel === 'messages' && plan ? (
          <HotelMessages key="messages" groups={groups} plan={plan} pending={pending} onRefresh={refresh} onClose={() => setPanel(null)} />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {night ? (
          <Night
            key="night"
            mode={screen === 'pulling' ? 'pulling' : screen === 'failed' ? 'failed' : 'start'}
            from={range.from}
            to={range.to}
            onFrom={(from) => setRange((r) => ({ from, to: r.to && r.to < from ? '' : r.to }))}
            onTo={(to) => setRange((r) => ({ ...r, to }))}
            onPull={pull}
            onCancel={() => {
              cancel.current?.();
              setScreen(dataset ? 'app' : 'start');
            }}
            onResume={dataset ? () => setScreen('app') : null}
            resumeLabel={dataset ? `Back to the plan from ${dayMonth(dataset.meta.from)}` : null}
            server={server}
            source={source}
            progress={progress}
            error={error}
          />
        ) : null}
      </AnimatePresence>
    </NamesContext.Provider>
  );
}
