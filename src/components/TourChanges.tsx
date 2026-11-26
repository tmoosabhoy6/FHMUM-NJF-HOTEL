import { useMemo, useState } from 'react';
import type { DateChange, PullMeta } from '../../shared/types';
import { changeText, unseen, unseenTours, useAlerts } from '../lib/alerts';
import type { InputChange } from '../lib/inputs';

interface PaxProps {
  tourNo: string;
  pax: number | null;
  nkerpPax?: number | null;
  paxBefore?: number;
  infants?: number;
  onChange: (change: InputChange) => void;
}

export function PaxInput({ tourNo, pax, nkerpPax, paxBefore, infants = 0, onChange }: PaxProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const original = paxBefore ?? nkerpPax;
  return (
    <div className="pax-edit">
      <input
        type="number"
        min={0}
        max={9999}
        step={1}
        inputMode="numeric"
        aria-label={`Hotel pax for tour ${tourNo}`}
        value={draft ?? pax ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          const next = event.target.valueAsNumber;
          const valid = /^\d{1,4}$/.test(raw) && event.target.validity.valid;
          setDraft(valid ? null : raw);
          if (valid && next !== pax) onChange({ pax: next, paxBefore: original ?? pax });
        }}
        onBlur={() => setDraft(null)}
      />
      {draft !== null && <small className="pax-error">Enter 0–9999</small>}
      {infants > 0 && <small>+{infants} inf</small>}
      {nkerpPax !== undefined && (
        <>
          <span className="tour-change pax" title={`NKERP currently shows ${nkerpPax ?? 'unconfirmed'} hotel pax`}>Pax adjusted: {original ?? 'unconfirmed'} → {pax}</span>
          {original !== nkerpPax && <small>NKERP now {nkerpPax ?? 'unconfirmed'}</small>}
          <button className="linkish" type="button" onClick={() => {
            setDraft(null);
            onChange({ pax: null, paxBefore: null });
          }}>
            Use NKERP ({nkerpPax ?? 'unconfirmed'})
          </button>
        </>
      )}
    </div>
  );
}

const route = (legs: string[]) => legs.length ? legs.join(' → ') : 'No stay dates recorded';

export function ReapprovalBadge({ change }: { change: DateChange | undefined }) {
  if (!change) return null;
  return <span className="tour-change" title={`Previously: ${route(change.before)}. Updated: ${route(change.after)}.`}>Re-approval · dates changed</span>;
}

export function PullChanges({ meta }: { meta: PullMeta }) {
  const changed = meta.changes ?? [];
  const awaiting = meta.awaiting ?? [];
  if (!changed.length && !awaiting.length) return null;
  const total = new Set([...changed, ...awaiting].map((t) => t.tourId)).size;
  return (
    <details className="pull-changes" key={meta.fetchedAt}>
      <summary>{total} {total === 1 ? 'tour needs' : 'tours need'} re-approval review</summary>
      <ul>
        {changed.map((change) => (
          <li key={change.tourId}>
            <b>Tour {change.tourNo} · dates or route changed</b>
            <span>Previously {route(change.before)}</span>
            <span>Updated {route(change.after)}</span>
          </li>
        ))}
        {awaiting.map((tour) => <li key={`awaiting-${tour.tourId}`}><b>Tour {tour.tourNo} · awaiting NKERP re-approval</b></li>)}
      </ul>
    </details>
  );
}

/** True when NKERP changed this tour and nobody has marked it seen: the row is highlighted. */
export function useChanged(meta: PullMeta | undefined) {
  const { seen } = useAlerts();
  return useMemo(() => {
    const ids = new Set(unseenTours(meta, seen).map((u) => u.tourId));
    return (tourId: number) => ids.has(tourId);
  }, [meta, seen]);
}

/** What changed on this tour in NKERP, under the tour number, with a button to mark it seen. */
export function ChangeBadge({ tourId, meta }: { tourId: number; meta: PullMeta | undefined }) {
  const { seen, markSeen } = useAlerts();
  const change = unseen(tourId, meta?.alerts?.[tourId], seen);
  if (!change?.changes.length) return null;
  return (
    <span className="tour-alert" role="note">
      <b>Changed in NKERP</b>
      {change.changes.map((c) => <span key={c.field}>{changeText(c)}</span>)}
      <button type="button" className="linkish" onClick={() => markSeen([{ tourId, at: change.at }])}>Mark seen</button>
    </span>
  );
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** One line on the automatic check and the alert emails. */
export function MonitorLine() {
  const { monitor } = useAlerts();
  if (!monitor?.check) return null;
  const { check, email } = monitor;
  return (
    <p className="monitor-line" data-ok={check.ok && (!email || email.ok)}>
      NKERP checked automatically every {monitor.every ?? 15} min · last check {ago(check.at)}{check.ok ? '' : `: ${check.message}`}
      {' · '}
      {!monitor.emailOn ? 'email alerts not set up' : email && !email.ok ? `email failed (${email.message}), will retry` : 'email alerts on'}
    </p>
  );
}

/** Tours NKERP changed since someone last looked, at the top of the page. */
export function TourAlerts({ meta }: { meta: PullMeta | undefined }) {
  const { seen, markSeen } = useAlerts();
  const tours = unseenTours(meta, seen);
  if (!tours.length) return <MonitorLine />;
  return (
    <section className="tour-alerts" aria-label="Tour changes in NKERP">
      <div className="tour-alerts-head">
        <h2>{tours.length} {tours.length === 1 ? 'tour' : 'tours'} changed in NKERP</h2>
        <button type="button" className="btn" onClick={() => markSeen(tours.map(({ tourId, at }) => ({ tourId, at })))}>Mark all seen</button>
      </div>
      <p>The plan already uses the new numbers and dates. Changed rows are highlighted below.</p>
      <ul>
        {tours.map((t) => (
          <li key={t.tourId}>
            <b>Tour {t.tourNo}</b>
            <span>{t.changes.map(changeText).join(' · ')}</span>
            <small>{ago(t.at)}</small>
            <button type="button" className="linkish" onClick={() => markSeen([{ tourId: t.tourId, at: t.at }])}>Mark seen</button>
          </li>
        ))}
      </ul>
      <MonitorLine />
    </section>
  );
}
