import { useMemo, useState } from 'react';
import type { DateChange, PullMeta } from '../../shared/types';
import { FIELD_LABEL, unseen, unseenTours, useAlerts } from '../lib/alerts';
import type { InputChange } from '../lib/inputs';
import { ago, plainDates } from '../lib/time';
import { Icon, TourTag } from './ui';

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
    <div className="pax" data-adjusted={nkerpPax !== undefined}>
      <span className="pax-row">
        <input
          type="number"
          min={0}
          max={9999}
          step={1}
          inputMode="numeric"
          aria-label={`Hotel pax for tour ${tourNo}`}
          aria-invalid={draft !== null}
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
        {infants > 0 && <small title={`${infants} ${infants === 1 ? 'infant shares' : 'infants share'} a bed`}>+{infants} inf</small>}
      </span>
      {draft !== null && <small className="pax-error">Enter 0–9999</small>}
      {nkerpPax !== undefined && (
        <>
          <small className="pax-note" title={`NKERP currently shows ${nkerpPax ?? 'unconfirmed'} hotel pax`}>
            Adjusted from {original ?? 'unconfirmed'}
            {original !== nkerpPax ? `, NKERP now ${nkerpPax ?? 'unconfirmed'}` : ''}
          </small>
          <button
            className="link"
            type="button"
            onClick={() => {
              setDraft(null);
              onChange({ pax: null, paxBefore: null });
            }}
          >
            Use NKERP ({nkerpPax ?? 'unconfirmed'})
          </button>
        </>
      )}
    </div>
  );
}

const route = (legs: string[]) => (legs.length ? legs.map(plainDates).join(' → ') : 'No stay dates recorded');

export function ReapprovalBadge({ change }: { change: DateChange | undefined }) {
  if (!change) return null;
  return (
    <span className="flag" data-tone="info" title={`Previously: ${route(change.before)}. Updated: ${route(change.after)}.`}>
      Re-approval · dates changed
    </span>
  );
}

/** Tours whose itinerary changed on this pull, or that wait for NKERP to re-approve them. */
export function PullChanges({ meta }: { meta: PullMeta }) {
  const changed = meta.changes ?? [];
  const awaiting = meta.awaiting ?? [];
  if (!changed.length && !awaiting.length) return null;
  const total = new Set([...changed, ...awaiting].map((t) => t.tourId)).size;
  return (
    <details className="inbox quiet" key={meta.fetchedAt}>
      <summary>
        <Icon name="chevron" />
        <b>
          {total} {total === 1 ? 'tour needs' : 'tours need'} re-approval review
        </b>
        <span>Dates or route changed, or waiting for NKERP to re-approve</span>
      </summary>
      <ul className="inbox-list">
        {changed.map((change) => (
          <li key={change.tourId}>
            <TourTag no={change.tourNo} />
            <div className="inbox-what">
              <span className="delta">
                <b>Dates or route</b>
                <s>{route(change.before)}</s>
                <span>{route(change.after)}</span>
              </span>
            </div>
          </li>
        ))}
        {awaiting.map((tour) => (
          <li key={`awaiting-${tour.tourId}`}>
            <TourTag no={tour.tourNo} />
            <div className="inbox-what">Awaiting NKERP re-approval</div>
          </li>
        ))}
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

function Deltas({ changes }: { changes: { field: keyof typeof FIELD_LABEL; before: string; after: string }[] }) {
  return (
    <>
      {changes.map((c) => (
        <span className="delta" key={c.field}>
          <b>{FIELD_LABEL[c.field]}</b>
          <s>{plainDates(c.before)}</s>
          <span>{plainDates(c.after)}</span>
        </span>
      ))}
    </>
  );
}

/** What changed on this tour in NKERP, in the row's notes, with a button to mark it seen. */
export function ChangeBadge({ tourId, meta }: { tourId: number; meta: PullMeta | undefined }) {
  const { seen, markSeen } = useAlerts();
  const change = unseen(tourId, meta?.alerts?.[tourId], seen);
  if (!change?.changes.length) return null;
  return (
    <span className="change" role="note">
      <span className="flag" data-tone="info">
        Changed in NKERP
      </span>
      <Deltas changes={change.changes} />
      <button type="button" className="link" onClick={() => markSeen([{ tourId, at: change.at }])}>
        Mark seen
      </button>
    </span>
  );
}

/** One line on the automatic check and the alert emails. */
export function MonitorLine() {
  const { monitor } = useAlerts();
  if (!monitor?.check) return null;
  const { check, email } = monitor;
  return (
    <p className="monitor-line" data-ok={check.ok && (!email || email.ok)}>
      NKERP checked automatically every {monitor.every ?? 15} min · last check {ago(check.at)}
      {check.ok ? '' : `: ${check.message}`}
      {' · '}
      {!monitor.emailOn ? 'email alerts not set up' : email && !email.ok ? `email failed (${email.message}), will retry` : 'email alerts on'}
    </p>
  );
}

/** Tours NKERP changed since someone last looked, at the top of the page. */
export function TourAlerts({ meta }: { meta: PullMeta | undefined }) {
  const { seen, markSeen } = useAlerts();
  const tours = unseenTours(meta, seen);
  if (!tours.length) return null;
  return (
    <section className="inbox" aria-label="Tour changes in NKERP">
      <div className="inbox-head">
        <h2>
          {tours.length} {tours.length === 1 ? 'tour' : 'tours'} changed in NKERP
        </h2>
        <p>The plan already uses the new numbers and dates. Changed rows are highlighted below.</p>
        <button type="button" className="btn" onClick={() => markSeen(tours.map(({ tourId, at }) => ({ tourId, at })))}>
          <Icon name="check" />
          Mark all seen
        </button>
      </div>
      <ul className="inbox-list">
        {tours.map((t) => (
          <li key={t.tourId}>
            <TourTag no={t.tourNo} />
            <div className="inbox-what">
              <Deltas changes={t.changes} />
            </div>
            <small>{ago(t.at)}</small>
            <button type="button" className="btn sm" onClick={() => markSeen([{ tourId: t.tourId, at: t.at }])}>
              Mark seen
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
