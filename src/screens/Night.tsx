import { motion } from 'motion/react';
import { useMemo } from 'react';
import { addDays, dayMonth, dayNumber, eachDate, fullDate, monthShort } from '../../shared/dates';
import { Brand, Num } from '../components/ui';
import type { SnapshotInfo } from '../lib/snapshot';
import { STEP_ORDER, STEP_TITLE, type PullProgress, type ServerState, type Source } from '../lib/sync';

interface Props {
  mode: 'start' | 'pulling' | 'failed';
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onPull: (source: Source) => void;
  onCancel: () => void;
  onResume: (() => void) | null;
  resumeLabel: string | null;
  server: ServerState;
  source: Source;
  /** Published NKERP data (GitHub Pages copy). */
  snapshot: SnapshotInfo | null;
  passphrase: string;
  onPassphrase: (value: string) => void;
  remember: boolean;
  onRemember: (value: boolean) => void;
  refreshUrl: string;
  progress: PullProgress;
  error: string | null;
}

/** "12 minutes ago", "3 hours ago", or the date. */
export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return fullDate(iso.slice(0, 10));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayIndex = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** The building: one window per day, lit as that day is read from NKERP. */
function Facade({ dates, progress, pulling }: { dates: string[]; progress: PullProgress; pulling: boolean }) {
  const lead = dates.length ? weekdayIndex(dates[0]) : 0;
  const readCount = Object.keys(progress.read).length;
  return (
    <div className="facade-wrap" aria-hidden={!pulling}>
      <div className="facade">
        <div className="facade-days">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="windows" data-dense={dates.length > 63}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} className="window blank" />
          ))}
          {dates.map((date) => {
            const day = progress.read[date];
            const first = date.endsWith('-01') || date === dates[0];
            return (
              <span key={date} className="window" data-lit={Boolean(day)} data-quiet={day ? day.arriving === 0 : undefined}>
                <span className="w-day">{first ? `${dayNumber(date)} ${monthShort(date)}` : dayNumber(date)}</span>
                <span className="w-in">{day && day.arriving > 0 ? `+${day.arriving}` : ''}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="facade-ground">
        <span className="facade-door" />
      </div>
      <div className="facade-caption">
        {pulling ? (
          <>
            <span>
              {readCount} of {dates.length} days read
            </span>
            <span className="facade-key">
              <i /> guests arriving <i className="quiet" style={{ marginLeft: 8 }} /> no arrivals
            </span>
          </>
        ) : (
          <span>Each window is one day. They light up as the day is read from NKERP.</span>
        )}
      </div>
    </div>
  );
}

export function Night(props: Props) {
  const { mode, from, to, progress, error, snapshot } = props;
  const pulling = mode === 'pulling';
  const previewDates = useMemo(() => {
    if (progress.dates.length) return progress.dates;
    const end = to && to >= from ? to : addDays(from, 34);
    const capped = addDays(from, 104) < end ? addDays(from, 104) : end;
    return eachDate(from, capped);
  }, [progress.dates, from, to]);

  return (
    <motion.div
      className="night"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ y: '-100%', transition: { duration: 0.75, ease: [0.7, 0, 0.2, 1] } }}
      transition={{ duration: 0.35 }}
    >
      <div className="night-inner">
        <header className="night-top">
          <Brand />
          {pulling ? (
            <button className="linkish" onClick={props.onCancel}>
              Stop the pull
            </button>
          ) : props.onResume ? (
            <button className="linkish" onClick={props.onResume}>
              {props.resumeLabel}
            </button>
          ) : null}
        </header>

        <div className="night-copy">
          {pulling ? (
            <motion.div key="pulling" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <h1>{props.source === 'sample' ? 'Making sample groups' : props.source === 'snapshot' ? 'Opening NKERP data' : 'Reading NKERP'}</h1>
              <p className="lede">
                From {fullDate(from)}
                {to ? ` to ${fullDate(to)}` : ', as far ahead as tours are approved'}.
              </p>
              <ol className="steps">
                {STEP_ORDER.map((id, i) => {
                  const step = progress.steps[id];
                  return (
                    <li key={id} className="step" data-status={step.status}>
                      <span className="step-dot">{step.status === 'done' ? '✓' : i + 1}</span>
                      <div>
                        <div className="step-title">{STEP_TITLE[id]}</div>
                        <div className="step-detail">{step.detail}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="pull-tally" aria-live="polite">
                <div>
                  <b>
                    <Num value={progress.groups} />
                  </b>
                  <span>groups arranging their own hotel</span>
                </div>
                <div>
                  <b>
                    <Num value={progress.guests} />
                  </b>
                  <span>guests</span>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="start" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              <h1>Know which hotel, before they land.</h1>
              <p className="lede">
                Pulls every approved FH Mumbai group staying in Najaf from NKERP, then places each one in Ruya, Araf or Hotel C,
                night by night.
              </p>
              <form
                className="pull-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  props.onPull(snapshot ? 'snapshot' : 'nkerp');
                }}
              >
                <div className="dates">
                  <label className="field">
                    First night
                    <input type="date" value={from} required min={snapshot?.from} max={snapshot?.through} onChange={(e) => props.onFrom(e.target.value)} />
                  </label>
                  <label className="field">
                    Last night
                    <input type="date" value={to} min={from} max={snapshot?.through} onChange={(e) => props.onTo(e.target.value)} />
                    <small>{to ? `Through ${dayMonth(to)}` : 'Empty: everything approved so far'}</small>
                  </label>
                </div>
                {snapshot ? (
                  <>
                    <label className="field">
                      Team passphrase
                      <input
                        className="pass"
                        type="password"
                        value={props.passphrase}
                        required
                        autoComplete="current-password"
                        onChange={(e) => props.onPassphrase(e.target.value)}
                      />
                    </label>
                    <label className="remember">
                      <input type="checkbox" checked={props.remember} onChange={(e) => props.onRemember(e.target.checked)} />
                      Remember on this device
                    </label>
                  </>
                ) : null}
                {mode === 'failed' && error ? (
                  <p className="night-warning night-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {props.server === 'no-login' ? (
                  <p className="night-warning">
                    NKERP sign-in is not set up on the server. Add NKERP_LOGIN_ID and NKERP_PASSWORD to its settings, then reload.
                  </p>
                ) : props.server === 'no-server' && !snapshot ? (
                  <p className="night-warning">
                    This copy of the app is not connected to the NKERP server, so it can only show sample groups for now.
                  </p>
                ) : null}
                <div className="night-aside">
                  {snapshot ? (
                    <>
                      <button className="lamp-button" type="submit" disabled={!from || !props.passphrase}>
                        Open the plan
                      </button>
                      <button className="linkish" type="button" onClick={() => props.onPull('sample')}>
                        Try with sample groups
                      </button>
                    </>
                  ) : props.server === 'no-server' ? (
                    <button className="lamp-button" type="button" disabled={!from} onClick={() => props.onPull('sample')}>
                      Try with sample groups
                    </button>
                  ) : (
                    <>
                      <button className="lamp-button" type="submit" disabled={props.server !== 'ready' || !from}>
                        {mode === 'failed' ? 'Pull again' : 'Pull from NKERP'}
                      </button>
                      <button className="linkish" type="button" onClick={() => props.onPull('sample')}>
                        Try with sample groups
                      </button>
                    </>
                  )}
                </div>
                {snapshot ? (
                  <p className="snapshot-note">
                    NKERP data from {ago(snapshot.fetchedAt)}, refreshed every hour.{' '}
                    {props.refreshUrl ? (
                      <a className="linkish" href={props.refreshUrl} target="_blank" rel="noreferrer">
                        Refresh it now
                      </a>
                    ) : null}
                  </p>
                ) : null}
              </form>
            </motion.div>
          )}
        </div>

        <Facade dates={previewDates} progress={progress} pulling={pulling} />
      </div>
    </motion.div>
  );
}
