import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { approvalCity, type ApprovalPlan, type ApprovalRequest, type Recommendation } from '../../shared/approvals';
import { OPENING_BALANCE, PLANNING_START } from '../../shared/config';
import { addDays, dayLabel, dayMonth, daysBetween, fullDate, isIsoDate } from '../../shared/dates';
import { buildPlan } from '../../shared/engine';
import type { HotelNames, PendingTour, PullMeta, Settings } from '../../shared/types';
import { PendingTours } from '../components/PendingTours';
import type { SaveStatus } from '../lib/shared';
import { PullChanges, ReapprovalBadge, TourAlerts } from '../components/TourChanges';
import { Brand } from '../components/ui';
import { copy } from '../lib/copy';
import { tourInput, withHotelPax, type InputChange, type TourInputs } from '../lib/inputs';
import { useNames } from '../lib/names';
import type { PullResult } from '../lib/sync';

interface Props {
  tabs: ReactNode;
  dataset: PullResult | null;
  inputs: TourInputs;
  settings: Settings;
  loaded: boolean;
  saveStatus: SaveStatus;
  onEdit: (tour: PendingTour, change: InputChange) => void;
  onPull: () => void;
}

type Result = { request: ApprovalRequest; plan: ApprovalPlan | null };

const todayInBaghdad = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const pullTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' });

function routeText({ route }: Recommendation) {
  return route?.segments.map((leg) => `${approvalCity(leg.city)} ${leg.from} to ${leg.to} (${daysBetween(leg.from, leg.to)} nights)`).join(' → ') ?? '';
}

function previousStay(r: Recommendation) {
  if (!r.tour.reapproval || !r.route) return '';
  const leg = r.route.segments.find((s) => s.city === 'najaf')!;
  const recorded = r.tour.najaf;
  if (!recorded.length || (recorded.length === 1 && recorded[0].checkIn === leg.from && recorded[0].checkOut === leg.to)) return '';
  return 'Recorded Najaf stay: ' + recorded.map((s) => s.checkIn + ' to ' + s.checkOut).join(', ');
}

function proposalText(plan: ApprovalPlan, names: HotelNames, from: string, to: string, inputs: TourInputs, meta: PullMeta) {
  const summary = `Hotel approval proposal · arrivals ${fullDate(from)} to ${fullDate(to)}`;
  const searchNote = plan.limited ? 'Best feasible proposal found within the search limit.\n' : '';
  return summary + '\n' + searchNote + plan.recommendations.map((r) => {
    const booking = r.hotel ? names[r.hotel] : 'Review';
    const pax = r.pax === null ? 'hotel pax unconfirmed' : `${r.pax} hotel pax`;
    const saved = tourInput(inputs, r.tour, meta);
    const adjustment = saved?.pax !== undefined ? ` · pax adjusted from ${saved.paxBefore ?? r.tour.needHotel ?? 'unconfirmed'}` : '';
    const recorded = previousStay(r);
    const rooms = r.rooms.length ? ` · rooms ${r.rooms.map((room) => room.label).join(', ')}` : '';
    const departure = r.route?.needsFlightCheck ? ' · confirm departure flight before booking the final night' : r.route?.hasDepartureDay ? ' · includes departure day for hotel occupancy' : '';
    const remarks = r.tour.remarks ? ` · NKERP note: ${r.tour.remarks}` : '';
    return `${r.tour.ref || r.tour.tourNo} · ${pax} · ${booking} · ${r.issue ?? routeText(r)}${rooms}${adjustment}${recorded ? ' · ' + recorded : ''}${departure}${remarks}`;
  }).join('\n');
}

function Recommendations({ plan, inputs, meta }: { plan: ApprovalPlan; inputs: TourInputs; meta: PullMeta }) {
  const names = useNames();
  return (
    <div className="sheet-wrap">
      <table className="sheet approval-proposals">
        <thead>
          <tr>
            <th scope="col">Tour</th>
            <th scope="col" className="n">Hotel pax</th>
            <th scope="col">Trip</th>
            <th scope="col">Proposed city stays</th>
            <th scope="col">Najaf hotel</th>
            <th scope="col">Review notes</th>
          </tr>
        </thead>
        <tbody>
          {plan.recommendations.map((r) => {
            const adjustment = tourInput(inputs, r.tour, meta);
            const manual = adjustment?.pax !== undefined;
            return (
              <tr key={r.tour.tourId}>
                <th scope="row">
                  {r.tour.ref || r.tour.tourNo}
                  <ReapprovalBadge change={meta.reapprovals?.[r.tour.tourId]} />
                  <small>{r.tour.reapproval ? 'Awaiting re-approval' : r.tour.status}</small>
                </th>
                <td className="n strong">
                  <span>{r.pax ?? '—'}</span>
                  {manual && <small className="tour-change pax">Pax adjusted · {adjustment.paxBefore ?? r.tour.needHotel ?? 'unconfirmed'} → {r.pax}</small>}
                  {manual && adjustment.paxBefore !== undefined && adjustment.paxBefore !== r.tour.needHotel && <small>NKERP now {r.tour.needHotel ?? 'unconfirmed'}</small>}
                </td>
                <td className="when">
                  {r.tour.start && isIsoDate(r.tour.start) ? dayMonth(r.tour.start) : '—'} – {r.tour.end && isIsoDate(r.tour.end) ? dayMonth(r.tour.end) : '—'}
                </td>
                <td>
                  {r.route ? r.route.segments.map((leg) => (
                    <div className="approval-leg" key={leg.city} title={`${fullDate(leg.from)} to ${fullDate(leg.to)}`}>
                      <b>{approvalCity(leg.city)}</b> {dayMonth(leg.from)}–{dayMonth(leg.to)}
                      <small>{daysBetween(leg.from, leg.to)} nights</small>
                    </div>
                  )) : 'Review needed'}
                </td>
                <td>
                  {r.hotel ? <span className="chip" data-hotel={r.hotel}>{names[r.hotel]}</span> : '—'}
                  {r.rooms.length > 0 && <small className="approval-room-list">{r.rooms.map((room) => room.label).join(', ')}</small>}
                </td>
                <td className="notes">
                  {previousStay(r) && <span className="note">{previousStay(r)}</span>}
                  {r.issue && <span className="note" data-warn>{r.issue}</span>}
                  {r.route?.needsFlightCheck && <span className="note" data-warn>Confirm the departure flight. An Iraqi Airways departure from Najaf or Baghdad would require one more hotel night.</span>}
                  {r.route?.hasDepartureDay && <span className="note">Iraqi Airways departure day included in hotel occupancy.</span>}
                  {!manual && r.tour.hotelPaxSource === 'tour' && <span className="note">Hotel pax from NKERP tour totals.</span>}
                  {r.tour.remarks && <span className="note">{r.tour.remarks}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyCapacity({ plan }: { plan: ApprovalPlan }) {
  const names = useNames();
  return (
    <div className="sheet-wrap">
      <table className="sheet approval-days">
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col" className="n">Committed {names.ruya} pax</th>
            <th scope="col" className="n">Proposed {names.ruya} pax</th>
            <th scope="col">Projected occupancy</th>
            <th scope="col" className="n">{names.ruya} beds free</th>
            <th scope="col" className="n">Proposed {names.araf} pax</th>
            <th scope="col" className="n">Proposed {names.c} pax</th>
            <th scope="col">Proposed Najaf arrivals</th>
          </tr>
        </thead>
        <tbody>
          {plan.days.map((day) => {
            const pax = day.fixedRuya + day.proposedRuya;
            return (
              <tr key={day.date}>
                <th scope="row">{dayLabel(day.date)}</th>
                <td className="n">{day.fixedRuya}</td>
                <td className="n">{day.proposedRuya}</td>
                <td>
                  <div className="approval-occupancy">
                    <progress aria-label={`${names.ruya} occupancy on ${dayLabel(day.date)}`} value={pax} max={plan.capacity || 1} />
                    <span>{pax} / {plan.capacity}</span>
                  </div>
                </td>
                <td className="n">{day.fixedRoomConflict ? 'Review committed rooms' : Math.max(0, plan.capacity - day.ruyaBedsUsed)}</td>
                <td className="n">{day.proposedAraf}</td>
                <td className="n">{day.proposedOverflow}</td>
                <td>{day.arrivals.map((arrival) => `${arrival.tourNo} (${arrival.pax}, ${names[arrival.hotel]})`).join(', ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Planner({ dataset, inputs, settings }: { dataset: PullResult; inputs: TourInputs; settings: Settings }) {
  const names = useNames();
  const { meta } = dataset;
  const coveredFrom = meta.from < PLANNING_START ? PLANNING_START : meta.from;
  const coveredThrough = meta.coveredThrough ?? meta.to ?? addDays(meta.from, 150);
  const [dates, setDates] = useState({ from: coveredFrom, to: coveredThrough });
  const from = dates.from < coveredFrom ? coveredFrom : dates.from > coveredThrough ? coveredThrough : dates.from;
  const to = dates.to < from || dates.to > coveredThrough ? coveredThrough : dates.to;
  const rangeAvailable = coveredFrom <= coveredThrough;
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const request = useMemo<ApprovalRequest | null>(() => {
    if (!rangeAvailable) return null;
    const approved = withHotelPax(dataset.groups, inputs, meta);
    const baseline = buildPlan({
      groups: approved,
      inputs: Object.fromEntries(approved.map((g) => [g.id, tourInput(inputs, g, meta)])),
      settings, holds: OPENING_BALANCE, from: meta.from, to: coveredThrough, start: PLANNING_START,
    });
    const pending = meta.pending ?? [];
    return {
      pending, approved, baseline, settings, from, to, coveredFrom, coveredThrough, today: todayInBaghdad(),
      inputs: Object.fromEntries(pending.map((tour) => [tour.tourId, tourInput(inputs, tour, meta)])),
    };
  }, [dataset, meta, inputs, settings, from, to, coveredFrom, coveredThrough, rangeAvailable]);

  useEffect(() => {
    if (!request) return;
    const worker = new Worker(new URL('../lib/approval-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ApprovalPlan>) => setResult({ request, plan: event.data });
    worker.onerror = () => setResult({ request, plan: null });
    worker.postMessage(request);
    return () => worker.terminate();
  }, [request]);

  if (!rangeAvailable) return <p className="read-empty">Pull a date range that includes the Najaf planning period starting {fullDate(PLANNING_START)}.</p>;
  const plan = result?.request === request ? result?.plan : undefined;

  return (
    <>
      <div className="approval-filters">
        <label className="approval-field">
          Tour arrivals from
          <input type="date" value={from} min={coveredFrom} max={coveredThrough} onChange={(event) => setDates({ from: event.target.value || coveredFrom, to })} />
        </label>
        <label className="approval-field">
          Tour arrivals through
          <input type="date" value={to} min={from} max={coveredThrough} onChange={(event) => setDates({ from, to: event.target.value || coveredThrough })} />
        </label>
        <p>NKERP data pulled {pullTime.format(new Date(meta.fetchedAt))}, Najaf local time. Coverage through {fullDate(coveredThrough)}.</p>
      </div>
      {!meta.coveredThrough && <p className="approval-notice">This saved pull predates the approval planner. Refresh NKERP data to verify pending hotel pax, trip dates and departure flights.</p>}
      {plan === undefined && <p className="read-empty" role="status">Building the approval plan…</p>}
      {plan === null && <p className="read-empty" role="alert">The approval planner could not finish. Try a shorter date range.</p>}
      {plan && (
        <>
          <dl className="approval-summary">
            <div><dt>{names.ruya} guest-nights</dt><dd>{plan.fixedGuestNights + plan.ruyaGuestNights}</dd><small>{plan.fixedGuestNights} committed + {plan.ruyaGuestNights} proposed</small></div>
            <div><dt>Pending tours in {names.ruya}</dt><dd>{plan.ruyaTours}</dd><small>{plan.capacity} beds in service</small></div>
            <div><dt>Pending tours in other hotels</dt><dd>{plan.arafTours + plan.overflowTours}</dd><small>{plan.arafTours} {names.araf} · {plan.overflowTours} {names.c}</small></div>
            <div><dt>Tours to review</dt><dd>{plan.heldTours}</dd></div>
          </dl>
          {plan.limited && <p className="approval-notice">Showing the best feasible plan found within the search limit.</p>}
          <TourAlerts meta={meta} />
          <PullChanges meta={meta} />
          <section className="block">
            <div className="block-head approval-block-head">
              <div>
                <h2>Proposed approvals</h2>
                <p>Check-in and check-out dates share one transfer day. Review the proposals in NKERP before approving.</p>
              </div>
              <button className="btn" type="button" disabled={!plan.recommendations.length} onClick={async () => {
                if (await copy(proposalText(plan, names, from, to, inputs, meta))) {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                }
              }}>{copied ? 'Copied' : 'Copy proposal'}</button>
            </div>
            {plan.recommendations.length ? <Recommendations plan={plan} inputs={inputs} meta={meta} /> : <p className="read-empty">No pending tours with hotel pax to plan in this range.</p>}
          </section>
          <section className="block">
            <div className="block-head">
              <h2>Najaf nightly capacity</h2>
              <p>Occupancy counts guests. Free beds account for entire rooms reserved for each group.</p>
            </div>
            <DailyCapacity plan={plan} />
          </section>
        </>
      )}
    </>
  );
}

export function ApprovalsView({ tabs, dataset, inputs, settings, loaded, saveStatus, onEdit, onPull }: Props) {
  const names = useNames();
  const [editPax, setEditPax] = useState(false);
  return (
    <div className="app approvals">
      <header className="app-top">
        <div className="app-top-inner">
          <Brand />
          {tabs}
          <div className="top-actions">
            {loaded && <span className="save-status" role="status" data-status={saveStatus}>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'offline' ? 'Offline · retrying' : 'Saved for everyone'}</span>}
            {Boolean(dataset?.meta.pending?.length) && <button className="btn" type="button" onClick={() => setEditPax(true)}>Edit pending hotel pax</button>}
            <button className="btn" type="button" onClick={onPull}>{dataset ? 'Refresh NKERP data' : 'Pull from NKERP'}</button>
          </div>
        </div>
      </header>
      <main className="page">
        <div className="overview-head">
          <h1>Najaf hotel approval plan</h1>
          <p>Keep approved stays fixed and fit pending tours into {names.ruya} as whole groups. Trips split evenly between Karbala and Najaf, with the extra night in Karbala on odd-length trips.</p>
        </div>
        {dataset ? <Planner dataset={dataset} inputs={inputs} settings={settings} /> : (
          <p className="read-empty" role="status">{loaded ? 'Pull Najaf data from NKERP to plan pending hotel stays.' : 'Looking for the saved Najaf pull…'}</p>
        )}
      </main>
      {editPax && dataset?.meta.pending && <PendingTours tours={dataset.meta.pending} meta={dataset.meta} inputs={inputs} onEdit={onEdit} onClose={() => setEditPax(false)} />}
    </div>
  );
}
