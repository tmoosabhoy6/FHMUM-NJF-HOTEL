import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, OPENING_BALANCE, PLANNING_START } from '../shared/config';
import { dayMonth, fullDate } from '../shared/dates';
import { buildPlan } from '../shared/engine';
import type { Group, GroupInput, PullMeta, Settings } from '../shared/types';
import { SettingsDrawer } from './components/SettingsDrawer';
import { Brand } from './components/ui';
import { exportPlan } from './lib/export';
import { load, remove, save } from './lib/storage';
import { checkServer, emptyProgress, startPull, type PullProgress, type ServerState } from './lib/sync';
import { Groups } from './screens/Groups';
import { Night } from './screens/Night';
import { PlanView } from './screens/PlanView';

interface Dataset {
  groups: Group[];
  meta: PullMeta;
}

const KEY = { data: 'njf.dataset.v1', inputs: 'njf.inputs.v1', settings: 'njf.settings.v1', range: 'njf.range.v1' };
/** Typed rooms are kept per tour, so they survive a new pull and a reissued plan. */
const inputKey = (group: Group) => String(group.tourId);

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
  const [typed, setTyped] = useState<Record<string, GroupInput>>(() => load(KEY.inputs, {}));
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(KEY.settings, {}) }));
  const [range, setRange] = useState(() => load(KEY.range, { from: PLANNING_START, to: '' }));
  const [screen, setScreen] = useState<'start' | 'pulling' | 'failed' | 'app'>(() => (load<Dataset | null>(KEY.data, null) ? 'app' : 'start'));
  const [view, setView] = useState<'groups' | 'plan'>('groups');
  const [progress, setProgress] = useState<PullProgress>(emptyProgress);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<ServerState>('checking');
  const [source, setSource] = useState<'nkerp' | 'sample'>('nkerp');
  const [drawer, setDrawer] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const cancel = useRef<(() => void) | null>(null);

  useEffect(() => {
    checkServer().then(setServer);
  }, []);
  useEffect(() => save(KEY.inputs, typed), [typed]);
  useEffect(() => save(KEY.settings, settings), [settings]);
  useEffect(() => save(KEY.range, range), [range]);
  useEffect(() => () => cancel.current?.(), []);

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
            // Let the last windows light before the night lifts.
            window.setTimeout(() => {
              setDataset(result);
              setDate(null);
              setView('groups');
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
    [range],
  );

  const groups = dataset?.groups ?? [];
  const inputs = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, typed[inputKey(g)]])), [groups, typed]);
  const plan = useMemo(
    () =>
      dataset
        ? buildPlan({ groups, inputs, settings, holds: OPENING_BALANCE, from: dataset.meta.from, to: dataset.meta.to })
        : null,
    [dataset, groups, inputs, settings],
  );

  const onInput = useCallback((group: Group, patch: GroupInput) => {
    setTyped((all) => {
      const next = { ...all[inputKey(group)], ...patch };
      if (!next.spec?.trim()) delete next.spec;
      if (!next.pin) delete next.pin;
      const copy = { ...all };
      if (Object.keys(next).length) copy[inputKey(group)] = next;
      else delete copy[inputKey(group)];
      return copy;
    });
  }, []);

  // Open the plan on the first night that needs a booking elsewhere.
  const selected = useMemo(() => {
    if (!plan) return null;
    if (date && plan.days.some((d) => d.date === date)) return date;
    return plan.bookings[0]?.from ?? plan.days.find((d) => d.total > 0)?.date ?? plan.days[0]?.date ?? null;
  }, [plan, date]);

  const night = screen !== 'app';
  const flagged = plan?.totals.flagged ?? 0;

  return (
    <>
      {dataset && plan ? (
        <div className="app" aria-hidden={night}>
          <header className="app-top">
            <div className="app-top-inner">
              <Brand />
              <LayoutGroup>
                <nav className="tabs" role="tablist" aria-label="Views">
                  {(
                    [
                      ['groups', 'Groups', plan.totals.groups],
                      ['plan', 'Plan', null],
                    ] as const
                  ).map(([id, label, count]) => (
                    <button key={id} role="tab" className="tab" aria-selected={view === id} onClick={() => setView(id)}>
                      {label}
                      {count !== null ? <span className="tab-count">{count}</span> : null}
                      {view === id ? <motion.span layoutId="tab-line" className="tab-line" transition={{ type: 'spring', stiffness: 520, damping: 40 }} /> : null}
                    </button>
                  ))}
                </nav>
              </LayoutGroup>
              <div className="top-actions">
                <div className="pulled">
                  <b>
                    From {dayMonth(dataset.meta.from)}
                    {dataset.meta.to ? ` to ${dayMonth(dataset.meta.to)}` : ''}
                  </b>
                  Pulled {ago(dataset.meta.fetchedAt)}
                </div>
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
                <button className="btn" onClick={() => setDrawer(true)}>
                  Hotels and rooms
                </button>
                <button
                  className="btn solid"
                  disabled={exporting || !groups.length}
                  onClick={async () => {
                    setExporting(true);
                    try {
                      await exportPlan(plan, groups, dataset.meta);
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
          {dataset.meta.source === 'sample' ? (
            <div className="banner">Sample groups, not NKERP. Pull again to load the real tours.</div>
          ) : null}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {view === 'groups' ? (
                <Groups
                  groups={groups}
                  plan={plan}
                  from={dataset.meta.from}
                  inputs={inputs}
                  onInput={onInput}
                  onOpenPlan={() => setView('plan')}
                  onOpenSettings={() => setDrawer(true)}
                />
              ) : (
                <PlanView
                  groups={groups}
                  plan={plan}
                  date={selected ?? dataset.meta.from}
                  onDate={setDate}
                  onOpenSettings={() => setDrawer(true)}
                  onOpenGroups={() => setView('groups')}
                />
              )}
            </motion.div>
          </AnimatePresence>
          <span className="sr" aria-live="polite">
            {flagged ? `${flagged} groups are not in Ruya.` : 'Every group is in Ruya.'}
          </span>
        </div>
      ) : null}

      <AnimatePresence>
        {drawer ? (
          <SettingsDrawer
            key="drawer"
            settings={settings}
            onChange={setSettings}
            onClose={() => setDrawer(false)}
            typedCount={Object.keys(typed).length}
            onClearInputs={() => {
              setTyped({});
              remove(KEY.inputs);
            }}
          />
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
    </>
  );
}
