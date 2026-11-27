import { useMemo } from 'react';
import { addDays, dayMonth, dayNumber, eachDate, fullDate, monthShort } from '../../shared/dates';
import type { Venue } from '../../shared/types';
import { useNames } from '../lib/names';
import { STEP_ORDER, stepTitle, type PullProgress, type ServerState } from '../lib/sync';
import { Icon, Num } from './ui';

interface Props {
  venue: Venue;
  mode: 'start' | 'pulling' | 'failed';
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onPull: (source: 'nkerp' | 'sample') => void;
  /** Stops a running pull. */
  onStop: () => void;
  /** Goes back to the saved plan without pulling, when there is one. */
  onBack: (() => void) | null;
  backLabel: string | null;
  server: ServerState;
  source?: 'nkerp' | 'sample';
  progress: PullProgress;
  error: string | null;
  /** Offer made-up groups for trying the planner without NKERP (Najaf only). */
  sample?: boolean;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayIndex = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The days of the range: each one is marked once every group arriving by then has been counted. */
function Days({ dates, progress, pulling }: { dates: string[]; progress: PullProgress; pulling: boolean }) {
  const lead = dates.length ? weekdayIndex(dates[0]) : 0;
  const readCount = Object.keys(progress.read).length;
  return (
    <div className="pull-days" aria-hidden={!pulling}>
      <div className="days-head">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="days" data-dense={dates.length > 63}>
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className="day blank" />
        ))}
        {dates.map((date) => {
          const day = progress.read[date];
          const first = date.endsWith('-01') || date === dates[0];
          return (
            <span key={date} className="day" data-read={Boolean(day)} data-quiet={day ? day.arriving === 0 : undefined}>
              <b>{first ? `${dayNumber(date)} ${monthShort(date)}` : dayNumber(date)}</b>
              <span>{day && day.arriving > 0 ? `+${day.arriving}` : ''}</span>
            </span>
          );
        })}
      </div>
      <p className="days-caption">
        {pulling ? (
          <>
            <span>
              {readCount} of {dates.length} days read
            </span>
            <span className="days-key">
              <i data-k="in" /> guests arriving
              <i data-k="quiet" /> no arrivals
            </span>
          </>
        ) : (
          'Each square is one day. It is marked once every group arriving by then has been counted.'
        )}
      </p>
    </div>
  );
}

/** Choosing the dates and pulling from NKERP, the same on the Najaf and Karbala tabs. */
export function PullPanel(props: Props) {
  const names = useNames();
  const { venue, mode, from, to, progress, error, server } = props;
  const pulling = mode === 'pulling';
  const city = venue === 'karbala' ? 'Karbala' : 'Najaf';
  const previewDates = useMemo(() => {
    if (progress.dates.length) return progress.dates;
    if (!from) return [];
    const end = to && to >= from ? to : addDays(from, 34);
    const capped = addDays(from, 104) < end ? addDays(from, 104) : end;
    return eachDate(from, capped);
  }, [progress.dates, from, to]);

  return (
    <main className="page pull">
      <section className="pull-card" aria-live="polite">
        {pulling ? (
          <>
            <h1>{props.source === 'sample' ? 'Making sample groups' : `Reading NKERP for ${city}`}</h1>
            <p className="pull-lede">
              From {fullDate(from)}
              {to ? ` to ${fullDate(to)}` : ', as far ahead as tours are approved'}.
            </p>
            <ol className="steps">
              {STEP_ORDER.map((id, i) => {
                const step = progress.steps[id];
                return (
                  <li key={id} className="step" data-status={step.status}>
                    <span className="step-dot">{step.status === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
                    <div>
                      <div className="step-title">{stepTitle(id, venue)}</div>
                      <div className="step-detail">{step.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <dl className="pull-tally">
              <div>
                <dd>
                  <Num value={progress.groups} />
                </dd>
                <dt>groups with guests who need a hotel</dt>
              </div>
              <div>
                <dd>
                  <Num value={progress.guests} />
                </dd>
                <dt>guests</dt>
              </div>
            </dl>
            <div className="pull-actions">
              <button className="btn" type="button" onClick={props.onStop}>
                Stop the pull
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Pull {city} tours from NKERP</h1>
            <p className="pull-lede">
              {venue === 'karbala'
                ? 'Reads every approved FH Mumbai tour staying in Karbala, the same way as Najaf: the guests who need a hotel, and the tours still pending. Edit hotel pax and rooms, then copy the updated messages.'
                : `Reads every approved FH Mumbai tour staying in Najaf, counts the guests who need a hotel, then places each group in ${names.ruya}, ${names.araf} or ${names.c}, night by night.`}
            </p>
            <form
              className="pull-form"
              onSubmit={(e) => {
                e.preventDefault();
                props.onPull('nkerp');
              }}
            >
              <div className="pull-dates">
                <label className="field">
                  First night
                  <input type="date" value={from} required onChange={(e) => props.onFrom(e.target.value)} />
                </label>
                <label className="field">
                  Last night
                  <input type="date" value={to} min={from} onChange={(e) => props.onTo(e.target.value)} />
                  <small>{to ? `Through ${dayMonth(to)}` : 'Empty: everything approved so far'}</small>
                </label>
              </div>
              {error ? (
                <p className="notice" data-tone="bad" role="alert">
                  <Icon name="alert" />
                  {error}
                </p>
              ) : null}
              {server === 'no-login' ? (
                <p className="notice" data-tone="warn">
                  <Icon name="alert" />
                  NKERP sign-in is not set up on the server. Add NKERP_LOGIN_ID and NKERP_PASSWORD to its settings, then reload.
                </p>
              ) : server === 'no-server' ? (
                <p className="notice" data-tone="warn">
                  <Icon name="alert" />
                  The NKERP connection is not reachable right now{props.sample ? ', so only sample groups are available' : ''}. Reload to try again.
                </p>
              ) : null}
              <div className="pull-actions">
                {server === 'no-server' && props.sample ? (
                  <button className="btn primary lg" type="button" disabled={!from} onClick={() => props.onPull('sample')}>
                    Try with sample groups
                  </button>
                ) : (
                  <>
                    <button className="btn primary lg" type="submit" disabled={server !== 'ready' || !from}>
                      <Icon name="refresh" />
                      {mode === 'failed' || error ? 'Pull again' : 'Pull from NKERP'}
                    </button>
                    {props.sample ? (
                      <button className="btn lg" type="button" disabled={!from} onClick={() => props.onPull('sample')}>
                        Try with sample groups
                      </button>
                    ) : null}
                  </>
                )}
                {props.onBack ? (
                  <button className="btn ghost lg" type="button" onClick={props.onBack}>
                    {props.backLabel}
                  </button>
                ) : null}
              </div>
            </form>
          </>
        )}
      </section>
      <Days dates={previewDates} progress={progress} pulling={pulling} />
    </main>
  );
}
