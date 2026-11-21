import { useState } from 'react';
import type { DateChange, PullMeta } from '../../shared/types';
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
