import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OPENING_BALANCE, PLANNING_START, RUYA_WITHHELD, ruyaRooms } from '../shared/config';
import { dayMonth } from '../shared/dates';
import { buildPlan, hotelNames } from '../shared/engine';
import type { Group, MonitorState, Settings } from '../shared/types';
import { HotelMessages } from './components/HotelMessages';
import { PullPanel } from './components/PullPanel';
import { SettingsDrawer, type Prefs } from './components/SettingsDrawer';
import { PullStatus, Shell } from './components/Shell';
import { CityTabs, Icon, type PlannerTab } from './components/ui';
import { AlertsContext, type Alerts, type SeenAlerts } from './lib/alerts';
import { exportPlan } from './lib/export';
import { editInput, inputKey, legacyKey, tourInput, withHotelPax, type InputChange, type TourInputs } from './lib/inputs';
import { useKarbala } from './lib/karbala';
import { NamesContext } from './lib/names';
import { assignHues, TagContext } from './lib/tags';
import { SharedState, type SaveStatus, type Values } from './lib/shared';
import { load, save } from './lib/storage';
import { checkServer, emptyProgress, startPull, type PullProgress, type PullResult, type ServerState } from './lib/sync';
import { ApprovalsView } from './screens/Approvals';
import { KarbalaView } from './screens/Karbala';
import { PlanView } from './screens/PlanView';

// v2: guests are counted person by person, and room requests are written bed size first.
// Local copies only: the shared copy everyone sees is on the server (lib/shared.ts).
const KEY = { data: 'njf.dataset.v2', inputs: 'njf.inputs.v2', prefs: 'njf.prefs.v2', range: 'njf.range.v2', tab: 'fh.tab.v1' };
const POLL_MS = 15_000;

const DEFAULT_PREFS: Prefs = { arafCapacity: 100, departureDayRule: true, withheld: RUYA_WITHHELD };

export function App() {
  const [savedDataset, setSavedDataset] = useState<PullResult | null>(() => {
    const data = load<PullResult | null>(KEY.data, null);
    return data?.meta.source === 'nkerp' ? data : null;
  });
  const [sample, setSample] = useState<PullResult | null>(null);
  const [sampleInputs, setSampleInputs] = useState<TourInputs>({});
  const dataset = sample ?? savedDataset;
  const [typed, setTyped] = useState<TourInputs>(() => load(KEY.inputs, {}));
  const [prefs, setPrefs] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>(KEY.prefs, {}) }));
  const [range, setRange] = useState(() => load(KEY.range, { from: PLANNING_START, to: '' }));
  const [screen, setScreen] = useState<'start' | 'pulling' | 'failed' | 'app'>(() => (savedDataset ? 'app' : 'start'));
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
  const [seen, setSeen] = useState<SeenAlerts>({});
  const [monitor, setMonitor] = useState<MonitorState | null>(null);
  const [tab, setTab] = useState<PlannerTab>(() => {
    const saved = load<string>(KEY.tab, 'najaf');
    return saved === 'approvals' || saved === 'karbala' ? saved : 'najaf';
  });
  const returnToApprovals = useRef(false);
  useEffect(() => save(KEY.tab, tab), [tab]);
  const pollNow = useRef<() => void>(() => {});
  // Karbala: the hotel-message generator (screens/Karbala.tsx). Lives here so its shared data keeps arriving on the other tabs.
  const karbala = useKarbala(shared, range, () => pollNow.current());
  const karbalaApply = useRef(karbala.apply);
  karbalaApply.current = karbala.apply;
  const latest = useRef({ savedDataset, screen });
  latest.current = { savedDataset, screen };

  useEffect(() => {
    checkServer().then(setServer);
  }, []);
  useEffect(() => save(KEY.inputs, typed), [typed]);
  useEffect(() => save(KEY.prefs, prefs), [prefs]);
  useEffect(() => save(KEY.range, range), [range]);

  useEffect(() => {
    shared.onStatus = setSaveStatus;
    let stopped = false;
    let first = true;
    const apply = (values: Values) => {
      const next = values.dataset as PullResult | undefined;
      if (next?.meta.source === 'nkerp' && next.meta.fetchedAt >= (latest.current.savedDataset?.meta.fetchedAt ?? '')) {
        if (!latest.current.savedDataset && latest.current.screen === 'start') setScreen('app');
        latest.current.savedDataset = next;
        save(KEY.data, next);
        setSavedDataset(next);
      }
      if ('inputs' in values || first) setTyped(shared.withPending('inputs', (values.inputs ?? {}) as TourInputs));
      if ('prefs' in values && !shared.pending('prefs')) setPrefs({ ...DEFAULT_PREFS, ...values.prefs as Partial<Prefs> });
      if (values.range && !shared.pending('range')) setRange(values.range as typeof range);
      if ('seenAlerts' in values) setSeen(shared.withPendingFields('seenAlerts', (values.seenAlerts ?? {}) as SeenAlerts));
      if ('monitor' in values) setMonitor((values.monitor ?? null) as MonitorState | null);
      karbalaApply.current(values, first);
      first = false;
      setLoaded(true);
    };
    const tick = async () => {
      const values = await shared.poll();
      if (values && !stopped) {
        const initial = first;
        apply(values);
        if (initial) shared.resume();
      }
    };
    pollNow.current = () => void tick();
    void tick();
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') void tick();
      else void shared.flush(true);
    };
    const timer = window.setInterval(onFocus, POLL_MS);
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

  const changeRange = (next: typeof range) => {
    setRange(next);
    shared.put('range', next);
  };

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
            cancel.current = null;
            if (result.meta.source === 'sample') {
              setSample(result);
            } else {
              setSample(null);
              latest.current.savedDataset = result;
              save(KEY.data, result);
              setSavedDataset(result);
              pollNow.current();
              if (returnToApprovals.current) {
                returnToApprovals.current = false;
                setTab('approvals');
              }
            }
            setScreen('app');
          },
          onFailed: (message) => {
            setError(message);
            setScreen('failed');
            pollNow.current();
          },
        },
      );
    },
    [range],
  );

  const activeInputs = sample ? sampleInputs : typed;
  const groups = useMemo(() => withHotelPax(dataset?.groups ?? [], activeInputs, dataset?.meta), [dataset, activeInputs]);
  const inputs = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, tourInput(activeInputs, g, dataset?.meta)])), [groups, activeInputs, dataset]);
  const plan = useMemo(
    () =>
      dataset
        ? buildPlan({ groups, inputs, settings, holds: OPENING_BALANCE, from: dataset.meta.from, to: dataset.meta.to, start: PLANNING_START })
        : null,
    [dataset, groups, inputs, settings],
  );

  const onInput = (group: Pick<Group, 'tourId' | 'tourNo'>, changes: InputChange, data = dataset) => {
    const legacy = legacyKey(group, data?.meta);
    const update = (all: TourInputs) => editInput(all, inputKey(group), legacy, changes);
    if (data?.meta.source === 'sample') setSampleInputs(update);
    else {
      setTyped(update);
      shared.edit('inputs', group, legacy, changes);
    }
  };

  const alerts = useMemo<Alerts>(() => ({
    seen,
    monitor,
    markSeen: (tours) => {
      const fields = Object.fromEntries(tours.map(({ tourId, at }) => [String(tourId), at]));
      setSeen((all) => ({ ...all, ...fields }));
      shared.patch('seenAlerts', fields);
    },
  }), [seen, monitor, shared]);

  const names = settings.names ?? hotelNames();
  // A tour keeps one tag colour on every tab, so the colours come from every tour pulled for either city.
  const tagHues = useMemo(
    () =>
      assignHues([
        ...[...(dataset?.groups ?? []), ...(karbala.dataset?.groups ?? [])].map((g) => ({ tourNo: g.tourNo, from: g.checkIn, to: g.checkOut })),
        ...[...(dataset?.meta.pending ?? []), ...(karbala.dataset?.meta.pending ?? [])]
          .filter((t) => t.start && t.end)
          .map((t) => ({ tourNo: t.tourNo, from: t.start as string, to: t.end as string })),
      ]),
    [dataset, karbala.dataset],
  );
  const flagged = plan?.totals.flagged ?? 0;
  const openPull = () => {
    setProgress(emptyProgress());
    setError(null);
    setScreen('start');
  };
  const changeTab = (next: PlannerTab) => {
    returnToApprovals.current = false;
    setTab(next);
  };
  const closePull = () => {
    setScreen(dataset ? 'app' : 'start');
    if (returnToApprovals.current) changeTab('approvals');
  };
  const tabs = <CityTabs tab={tab} onTab={changeTab} />;

  if (tab === 'karbala') {
    return (
      <AlertsContext.Provider value={alerts}><NamesContext.Provider value={names}><TagContext.Provider value={tagHues}>
        <KarbalaView k={karbala} tabs={tabs} server={server} departureDayRule={prefs.departureDayRule} saveStatus={saveStatus} loaded={loaded} />
      </TagContext.Provider></NamesContext.Provider></AlertsContext.Provider>
    );
  }

  if (tab === 'approvals') {
    return (
      <AlertsContext.Provider value={alerts}><NamesContext.Provider value={names}><TagContext.Provider value={tagHues}>
        <ApprovalsView
          tabs={tabs}
          dataset={savedDataset}
          inputs={typed}
          settings={settings}
          loaded={loaded}
          saveStatus={saveStatus}
          onEdit={(tour, change) => onInput(tour, change, savedDataset)}
          onPull={() => {
            returnToApprovals.current = true;
            setTab('najaf');
            openPull();
          }}
        />
      </TagContext.Provider></NamesContext.Provider></AlertsContext.Provider>
    );
  }

  const showPlan = screen === 'app' && dataset && plan;
  return (
    <AlertsContext.Provider value={alerts}><NamesContext.Provider value={names}><TagContext.Provider value={tagHues}>
      <Shell
        tabs={tabs}
        status={showPlan ? <PullStatus meta={dataset.meta} saveStatus={saveStatus} loaded={loaded} sample={Boolean(sample)} /> : null}
        actions={
          showPlan ? (
            <>
              <button className="btn on-rail" type="button" onClick={openPull}>
                <Icon name="refresh" />
                Pull again
              </button>
              <button className="btn on-rail" type="button" onClick={() => setPanel('settings')}>
                <Icon name="sliders" />
                Hotels and rooms
              </button>
            </>
          ) : null
        }
        banner={
          showPlan && dataset.meta.source === 'sample' ? (
            <p className="banner">
              <Icon name="alert" />
              Sample groups, not NKERP. Pull again to load the real tours.
            </p>
          ) : null
        }
      >
        {showPlan ? (
          <>
            <PlanView
              groups={groups}
              plan={plan}
              meta={dataset.meta}
              inputs={inputs}
              tourInputs={activeInputs}
              onInput={onInput}
              actions={
                <>
                  <button className="btn" type="button" onClick={() => setPanel('messages')}>
                    <Icon name="message" />
                    Hotel messages
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={exporting || !groups.length}
                    onClick={async () => {
                      setExporting(true);
                      try {
                        await exportPlan(plan, groups, dataset.meta, names, activeInputs);
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    <Icon name="download" />
                    {exporting ? 'Building the file' : 'Download Excel'}
                  </button>
                </>
              }
            />
            <span className="sr" aria-live="polite">
              {flagged ? `${flagged} groups are not in ${names.ruya}.` : `Every group is in ${names.ruya}.`}
            </span>
          </>
        ) : (
          <PullPanel
            venue="najaf"
            mode={screen === 'pulling' ? 'pulling' : screen === 'failed' ? 'failed' : 'start'}
            from={range.from}
            to={range.to}
            onFrom={(from) => changeRange({ from, to: range.to && range.to < from ? '' : range.to })}
            onTo={(to) => changeRange({ ...range, to })}
            onPull={pull}
            onStop={() => {
              cancel.current?.();
              closePull();
            }}
            onBack={dataset ? closePull : null}
            backLabel={dataset ? (returnToApprovals.current ? 'Back to approvals' : `Back to the plan from ${dayMonth(dataset.meta.from)}`) : null}
            server={server}
            source={source}
            progress={progress}
            error={screen === 'failed' ? error : null}
            sample
          />
        )}
      </Shell>

      <AnimatePresence>
        {panel === 'settings' ? (
          <SettingsDrawer
            key="settings"
            prefs={prefs}
            beds={settings.ruyaCapacity}
            onChange={(next) => {
              setPrefs(next);
              shared.put('prefs', next);
            }}
            onClose={() => setPanel(null)}
            typedCount={Object.values(activeInputs).filter((input) => Object.keys(input).length).length}
            onClearInputs={() => {
              if (sample) setSampleInputs({});
              else {
                setTyped({});
                shared.put('inputs', {});
              }
            }}
          />
        ) : panel === 'messages' && plan ? (
          <HotelMessages key="messages" groups={groups} plan={plan} onClose={() => setPanel(null)} />
        ) : null}
      </AnimatePresence>
    </TagContext.Provider></NamesContext.Provider></AlertsContext.Provider>
  );
}
