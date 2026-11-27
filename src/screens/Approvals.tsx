import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { approvalCity, type ApprovalPlan, type ApprovalRequest, type Recommendation } from '../../shared/approvals';
import { OPENING_BALANCE, PLANNING_START } from '../../shared/config';
import { addDays, dayLabel, dayMonth, daysBetween, fullDate, isIsoDate } from '../../shared/dates';
import { buildPlan } from '../../shared/engine';
import type { HotelNames, PendingTour, PullMeta, Settings } from '../../shared/types';
import { Occupancy } from '../components/Occupancy';
import { PendingTours } from '../components/PendingTours';
import { PageBar, PullStatus, Shell } from '../components/Shell';
import { PullChanges, ReapprovalBadge, TourAlerts } from '../components/TourChanges';
import { HotelChip, Icon, TourTag } from '../components/ui';
import { copy } from '../lib/copy';
import { tourInput, withHotelPax, type InputChange, type TourInputs } from '../lib/inputs';
import { useNames } from '../lib/names';
import type { SaveStatus } from '../lib/shared';
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
  return (
    <div className="sheet-wrap">
      <table className="sheet proposals stack">
        <thead>
          <tr>
            <th scope="col">Tour</th>
            <th scope="col" className="n">
              Hotel pax
            </th>
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
            const recorded = previousStay(r);
            return (
              <tr key={r.tour.tourId} data-flag={Boolean(r.issue)}>
                <th scope="row" className="tour" data-label="Tour">
                  <TourTag no={r.tour.tourNo} title={r.tour.ref || undefined} />
                  <span className="leader">{r.tour.reapproval ? 'Awaiting re-approval' : r.tour.status}</span>
                </th>
                <td className="n strong" data-label="Hotel pax">
                  {r.pax ?? '–'}
                  {manual && <small>Adjusted from {adjustment.paxBefore ?? r.tour.needHotel ?? 'unconfirmed'}</small>}
                  {manual && adjustment.paxBefore !== undefined && adjustment.paxBefore !== r.tour.needHotel && <small>NKERP now {r.tour.needHotel ?? 'unconfirmed'}</small>}
                </td>
                <td className="when" data-label="Trip">
                  {r.tour.start && isIsoDate(r.tour.start) ? dayMonth(r.tour.start) : '–'} to {r.tour.end && isIsoDate(r.tour.end) ? dayMonth(r.tour.end) : '–'}
                </td>
                <td data-label="Proposed city stays">
                  {r.route ? (
                    <span className="legs">
                      {r.route.segments.map((leg) => (
                        <span className="leg" key={leg.city} data-city={leg.city} title={`${fullDate(leg.from)} to ${fullDate(leg.to)}`}>
                          <b>{approvalCity(leg.city)}</b>
                          {dayMonth(leg.from)} to {dayMonth(leg.to)}
                          <small>{daysBetween(leg.from, leg.to)} nights</small>
                        </span>
                      ))}
                    </span>
                  ) : (
                    'Review needed'
                  )}
                </td>
                <td data-label="Najaf hotel">
                  {r.hotel ? <HotelChip hotel={r.hotel} /> : '–'}
                  {r.rooms.length > 0 && <small className="room-list">Rooms {r.rooms.map((room) => room.label).join(', ')}</small>}
                </td>
                <td className="notes" data-label="Review notes">
                  <ReapprovalBadge change={meta.reapprovals?.[r.tour.tourId]} />
                  {r.issue && (
                    <span className="note" data-warn>
                      <Icon name="alert" size={14} />
                      {r.issue}
                    </span>
                  )}
                  {r.route?.needsFlightCheck && (
                    <span className="note" data-warn>
                      <Icon name="alert" size={14} />
                      Confirm the departure flight. An Iraqi Airways departure from Najaf or Baghdad would require one more hotel night.
                    </span>
                  )}
                  {recorded && <span className="note">{recorded}</span>}
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
      <table className="sheet capacity">
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col" className="n" data-hotel="ruya">
              Committed {names.ruya}
            </th>
            <th scope="col" className="n" data-hotel="ruya">
              Proposed {names.ruya}
            </th>
            <th scope="col" className="n">
              {names.ruya} guests <small>of {plan.capacity}</small>
            </th>
            <th scope="col" className="n">
              {names.ruya} beds free
            </th>
            <th scope="col" className="n" data-hotel="araf">
              Proposed {names.araf}
            </th>
            <th scope="col" className="n" data-hotel="c">
              Proposed {names.c}
            </th>
            <th scope="col" className="wide">
              Proposed Najaf arrivals
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.days.map((day) => {
            const pax = day.fixedRuya + day.proposedRuya;
            return (
              <tr key={day.date} data-fri={new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5}>
                <th scope="row" className="date">
                  {dayLabel(day.date)}
                </th>
                <td className="n">{day.fixedRuya || '–'}</td>
                <td className="n cell" data-hotel="ruya" data-on={day.proposedRuya > 0}>
                  {day.proposedRuya || '–'}
                </td>
                <td className="n cell" data-hotel="ruya" data-on={pax > 0}>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, (pax / Math.max(1, plan.capacity)) * 100)}%` }} />
                  </span>
                  {pax || '–'}
                </td>
                <td className="n free" data-low={day.fixedRoomConflict || plan.capacity - day.ruyaBedsUsed <= 0}>
                  {day.fixedRoomConflict ? 'Review committed rooms' : Math.max(0, plan.capacity - day.ruyaBedsUsed)}
                </td>
                <td className="n cell" data-hotel="araf" data-on={day.proposedAraf > 0}>
                  {day.proposedAraf || '–'}
                </td>
                <td className="n cell" data-hotel="c" data-on={day.proposedOverflow > 0}>
                  {day.proposedOverflow || '–'}
                </td>
                <td className="moves wide">
                  {day.arrivals.map((arrival) => (
                    <span key={arrival.tourNo}>
                      <TourTag no={arrival.tourNo} />
                      {arrival.pax} to {names[arrival.hotel]}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Planner({ dataset, inputs, settings, onEditPax }: { dataset: PullResult; inputs: TourInputs; settings: Settings; onEditPax: (() => void) | null }) {
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

  const plan = result?.request === request ? result?.plan : undefined;
  const occDays = useMemo(
    () =>
      (plan?.days ?? []).map((d) => ({
        date: d.date,
        values: [d.fixedRuya, d.proposedRuya, d.proposedAraf, d.proposedOverflow],
        note: d.fixedRoomConflict ? 'review committed rooms' : `${Math.max(0, (plan?.capacity ?? 0) - d.ruyaBedsUsed)} ${names.ruya} beds free`,
      })),
    [plan, names.ruya],
  );

  return (
    <>
      <PageBar
        title="Najaf hotel approval plan"
        sections={plan ? [
          { id: 'a-overview', label: 'Overview' },
          { id: 'a-proposals', label: 'Proposed approvals', count: plan.recommendations.length },
          { id: 'a-capacity', label: 'Nightly capacity' },
        ] : []}
        actions={
          <>
            {onEditPax ? (
              <button className="btn" type="button" onClick={onEditPax}>
                Edit pending hotel pax
              </button>
            ) : null}
            {plan ? (
              <button
                className="btn primary"
                type="button"
                disabled={!plan.recommendations.length}
                onClick={async () => {
                  if (await copy(proposalText(plan, names, from, to, inputs, meta))) {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} />
                {copied ? 'Copied' : 'Copy proposal'}
              </button>
            ) : null}
          </>
        }
      />
      <main className="page">
        <div className="lead">
          <p>
            Keeps approved stays fixed and fits pending tours into {names.ruya} as whole groups. Trips split evenly between Karbala and Najaf, with the extra night in
            Karbala on odd-length trips.
          </p>
        </div>
        {!rangeAvailable ? (
          <p className="empty">Pull a date range that includes the Najaf planning period starting {fullDate(PLANNING_START)}.</p>
        ) : (
          <>
            <div className="filters">
              <label className="field">
                Tour arrivals from
                <input type="date" value={from} min={coveredFrom} max={coveredThrough} onChange={(event) => setDates({ from: event.target.value || coveredFrom, to })} />
              </label>
              <label className="field">
                Tour arrivals through
                <input type="date" value={to} min={from} max={coveredThrough} onChange={(event) => setDates({ from, to: event.target.value || coveredThrough })} />
              </label>
              <p>
                NKERP data pulled {pullTime.format(new Date(meta.fetchedAt))}, Najaf local time.
                <br />
                Coverage through {fullDate(coveredThrough)}.
              </p>
            </div>
            {!meta.coveredThrough && (
              <p className="notice" data-tone="warn">
                <Icon name="alert" />
                This saved pull predates the approval planner. Refresh NKERP data to verify pending hotel pax, trip dates and departure flights.
              </p>
            )}
            {plan === undefined && (
              <p className="empty" role="status">
                Building the approval plan…
              </p>
            )}
            {plan === null && (
              <p className="notice" data-tone="bad" role="alert">
                <Icon name="alert" />
                The approval planner could not finish. Try a shorter date range.
              </p>
            )}
            {plan && (
              <>
                {plan.limited && (
                  <p className="notice" data-tone="warn">
                    <Icon name="alert" />
                    Showing the best feasible plan found within the search limit.
                  </p>
                )}
                <TourAlerts meta={meta} />
                <PullChanges meta={meta} />
                <section className="block" id="a-overview" aria-label="Overview">
                  <div className="panel">
                    <dl className="stats">
                      <div>
                        <dt>{names.ruya} guest-nights</dt>
                        <dd>{plan.fixedGuestNights + plan.ruyaGuestNights}</dd>
                        <small>
                          {plan.fixedGuestNights} committed + {plan.ruyaGuestNights} proposed
                        </small>
                      </div>
                      <div>
                        <dt>Pending tours in {names.ruya}</dt>
                        <dd>{plan.ruyaTours}</dd>
                        <small>{plan.capacity} beds in service</small>
                      </div>
                      <div>
                        <dt>Pending tours in other hotels</dt>
                        <dd>{plan.arafTours + plan.overflowTours}</dd>
                        <small>
                          {plan.arafTours} {names.araf} · {plan.overflowTours} {names.c}
                        </small>
                      </div>
                      <div data-hot={plan.heldTours > 0}>
                        <dt>Tours to review</dt>
                        <dd>{plan.heldTours}</dd>
                        <small>{plan.heldTours ? 'See the review notes below' : 'Nothing held back'}</small>
                      </div>
                    </dl>
                    <Occupancy
                      series={[
                        { id: 'ruya', label: `Committed ${names.ruya}` },
                        { id: 'ruya-new', label: `Proposed ${names.ruya}` },
                        { id: 'araf', label: `Proposed ${names.araf}` },
                        { id: 'c', label: `Proposed ${names.c}` },
                      ]}
                      days={occDays}
                      capacity={plan.capacity}
                      capLabel={`${names.ruya} beds (${plan.capacity})`}
                    />
                  </div>
                </section>
                <section className="block" id="a-proposals">
                  <div className="block-head">
                    <div>
                      <h2>Proposed approvals</h2>
                      <p>Check-in and check-out dates share one transfer day. Review the proposals in NKERP before approving.</p>
                    </div>
                  </div>
                  {plan.recommendations.length ? <Recommendations plan={plan} inputs={inputs} meta={meta} /> : <p className="empty">No pending tours with hotel pax to plan in this range.</p>}
                </section>
                <section className="block" id="a-capacity">
                  <div className="block-head">
                    <div>
                      <h2>Najaf nightly capacity</h2>
                      <p>Occupancy counts guests. Free beds account for entire rooms reserved for each group.</p>
                    </div>
                  </div>
                  <DailyCapacity plan={plan} />
                </section>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

export function ApprovalsView({ tabs, dataset, inputs, settings, loaded, saveStatus, onEdit, onPull }: Props) {
  const [editPax, setEditPax] = useState(false);
  return (
    <Shell
      tabs={tabs}
      status={dataset ? <PullStatus meta={dataset.meta} saveStatus={saveStatus} loaded={loaded} /> : null}
      actions={
        <button className="btn on-rail" type="button" onClick={onPull}>
          <Icon name="refresh" />
          {dataset ? 'Refresh NKERP data' : 'Pull from NKERP'}
        </button>
      }
    >
      {dataset ? (
        <Planner dataset={dataset} inputs={inputs} settings={settings} onEditPax={dataset.meta.pending?.length ? () => setEditPax(true) : null} />
      ) : (
        <>
          <PageBar title="Najaf hotel approval plan" />
          <main className="page">
            <div className="empty" role="status">
              <h2>{loaded ? 'No Najaf pull yet' : 'Looking for the saved Najaf pull…'}</h2>
              {loaded ? <p>Pull Najaf data from NKERP to plan pending hotel stays.</p> : null}
            </div>
          </main>
        </>
      )}
      {editPax && dataset?.meta.pending && <PendingTours tours={dataset.meta.pending} meta={dataset.meta} inputs={inputs} onEdit={onEdit} onClose={() => setEditPax(false)} />}
    </Shell>
  );
}
