import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { dayLabel, dayMonth, fullDate, rangeLabel } from '../../shared/dates';
import { karbalaRows, type KarbalaRow } from '../../shared/karbala';
import { describeRooms, parseRoomSpec } from '../../shared/roomSpec';
import { PendingTours } from '../components/PendingTours';
import { Brand, groupsText, guests, Num } from '../components/ui';
import { howText } from '../lib/bookings';
import { copy } from '../lib/copy';
import { inputKey } from '../lib/inputs';
import type { Karbala } from '../lib/karbala';
import type { SaveStatus } from '../lib/shared';
import { STEP_ORDER, stepTitle, type ServerState } from '../lib/sync';

interface Props {
  k: Karbala;
  tabs: ReactNode;
  server: ServerState;
  departureDayRule: boolean;
  saveStatus: SaveStatus;
  loaded: boolean;
  ago: (iso: string) => string;
}

// ---- pull ------------------------------------------------------------------------

function PullPanel({ k, server, onClose }: { k: Karbala; server: ServerState; onClose: (() => void) | null }) {
  const { range, progress } = k;
  return (
    <section className="k-pull" aria-live="polite">
      {k.pulling ? (
        <>
          <h1>Reading NKERP for Karbala</h1>
          <p className="k-lede">
            From {fullDate(range.from)}
            {range.to ? ` to ${fullDate(range.to)}` : ', as far ahead as tours are approved'}.
          </p>
          <ol className="steps k-steps">
            {STEP_ORDER.map((id, i) => {
              const step = progress.steps[id];
              return (
                <li key={id} className="step" data-status={step.status}>
                  <span className="step-dot">{step.status === 'done' ? '✓' : i + 1}</span>
                  <div>
                    <div className="step-title">{stepTitle(id, 'karbala')}</div>
                    <div className="step-detail">{step.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="k-tally">
            <b>
              <Num value={progress.groups} />
            </b>{' '}
            groups, <Num value={progress.guests} /> guests who need a hotel so far
          </p>
          <button className="btn" onClick={k.stop}>
            Stop the pull
          </button>
        </>
      ) : (
        <>
          <h1>Karbala hotel messages</h1>
          <p className="k-lede">
            Pulls every approved FH Mumbai tour staying in Karbala from NKERP, the same way as Najaf: the guests who need a hotel, and the
            tours still pending. Type each group’s rooms, press <b>Refresh messages</b>, and copy the messages.
          </p>
          <form
            className="k-form"
            onSubmit={(e) => {
              e.preventDefault();
              k.pull();
            }}
          >
            <label className="k-field">
              First night
              <input type="date" value={range.from} required onChange={(e) => k.setRange((r) => ({ from: e.target.value, to: r.to && r.to < e.target.value ? '' : r.to }))} />
            </label>
            <label className="k-field">
              Last night
              <input type="date" value={range.to} min={range.from} onChange={(e) => k.setRange((r) => ({ ...r, to: e.target.value }))} />
              <small>{range.to ? `Through ${dayMonth(range.to)}` : 'Empty: everything approved so far'}</small>
            </label>
            <div className="k-actions">
              <button className="btn solid" type="submit" disabled={server !== 'ready' || !range.from}>
                {k.error ? 'Pull again' : 'Pull Karbala from NKERP'}
              </button>
              {onClose ? (
                <button className="btn quiet" type="button" onClick={onClose}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
          {k.error ? (
            <p className="k-warn" role="alert">
              {k.error}
            </p>
          ) : null}
          {server === 'no-login' ? (
            <p className="k-warn">NKERP sign-in is not set up on the server. Add NKERP_LOGIN_ID and NKERP_PASSWORD to its settings, then reload.</p>
          ) : server === 'no-server' ? (
            <p className="k-warn">The NKERP connection is not reachable right now. Reload to try again.</p>
          ) : null}
        </>
      )}
    </section>
  );
}

// ---- groups ------------------------------------------------------------------------

function RoomsInput({ row, spec, onInput }: { row: KarbalaRow; spec: string; onInput: Karbala['onInput'] }) {
  const parsed = parseRoomSpec(spec);
  const typed = Boolean(spec.trim());
  const read = parsed.error ? { text: parsed.error, bad: true } : typed ? { text: `${describeRooms(parsed.rooms)} = ${parsed.beds}`, bad: parsed.beds < row.group.pax } : null;
  return (
    <div className="rooms-cell" data-bad={read?.bad}>
      <input
        type="text"
        value={spec}
        placeholder="e.g. 2x6, 3x1"
        aria-label={`Rooms tour ${row.group.tourNo} needs in Karbala`}
        spellCheck={false}
        onChange={(e) => onInput(row.group.tourNo, e.target.value)}
      />
      {read ? <small>{read.text}</small> : null}
    </div>
  );
}

function GroupsTable({ rows, typed, onInput }: { rows: KarbalaRow[]; typed: Karbala['typed']; onInput: Karbala['onInput'] }) {
  return (
    <div className="sheet-wrap">
      <table className="sheet groups">
        <thead>
          <tr>
            <th scope="col">Tour</th>
            <th scope="col">Group leader</th>
            <th scope="col" className="n">
              Guests
            </th>
            <th scope="col">Arrives</th>
            <th scope="col">Leaves</th>
            <th scope="col" className="n">
              Nights
            </th>
            <th scope="col">Rooms asked for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { group } = row;
            return (
              <tr key={group.id}>
                <th scope="row" className="tour">
                  {group.tourNo}
                </th>
                <td className="leader">{group.leader || '–'}</td>
                <td className="n strong">
                  {group.pax}
                  {group.infants ? <small> +{group.infants} inf</small> : null}
                </td>
                <td className="when">
                  {dayMonth(group.checkIn)}
                  <small>{howText(group.arrival, group.arrivalAt)}</small>
                </td>
                <td className="when">
                  {dayMonth(group.checkOut)}
                  <small>{howText(group.departure, group.departureAt)}</small>
                </td>
                <td className="n">
                  {row.nights.length}
                  {row.departureDay ? <small className="k-depday" title="Flies Iraqi Airways after Karbala: the departure day counts as a night, as in Najaf">incl. departure day</small> : null}
                </td>
                <td className="rooms">
                  <RoomsInput row={row} spec={typed[inputKey(group)]?.spec ?? ''} onInput={onInput} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- messages ------------------------------------------------------------------------

function Messages({ rows, pending, onRefresh }: { rows: KarbalaRow[]; pending: number; onRefresh: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const byDate = useMemo(() => {
    const map = new Map<string, KarbalaRow[]>();
    for (const row of rows) if (row.message) map.set(row.message.from, [...(map.get(row.message.from) ?? []), row]);
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const noNights = rows.filter((r) => !r.message);
  const flash = async (key: string, text: string) => {
    if (await copy(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    }
  };

  return (
    <div className="k-messages">
      {pending ? (
        <p className="msg-stale">
          Rooms changed for {pending} {pending === 1 ? 'tour' : 'tours'} since the messages were made.{' '}
          <button className="linkish" onClick={onRefresh}>
            Refresh messages
          </button>{' '}
          to include them.
        </p>
      ) : null}
      {noNights.length ? (
        <p className="msg-note">No night in Karbala, so no message: tour {noNights.map((r) => r.group.tourNo).join(', ')}.</p>
      ) : null}
      {byDate.map(([date, list]) => {
        const key = `day-${date}`;
        return (
          <section className="msg-day" key={date}>
            <div className="msg-day-head">
              <h3>{dayLabel(date)}</h3>
              <span>
                {list.length} {list.length === 1 ? 'message' : 'messages'}
              </span>
              {list.length > 1 ? (
                <button className="btn" onClick={() => flash(key, list.map((r) => r.message!.text).join('\n\n'))}>
                  {copied === key ? 'Copied' : `Copy all ${list.length}`}
                </button>
              ) : null}
            </div>
            {list.map(({ group, message, issue }) => (
              <article className="msg" key={group.id} data-city="karbala">
                <div className="msg-head">
                  <b>Tour {group.tourNo}</b>
                  <span className="msg-who">{group.leader}</span>
                  <button className="btn solid msg-copy" data-done={copied === group.id} onClick={() => flash(group.id, message!.text)}>
                    {copied === group.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {issue ? <p className="msg-warn">{issue}</p> : message!.rooms ? null : <p className="msg-warn">No rooms yet: type them in the Groups table, then refresh the messages.</p>}
                <pre className="msg-text">{message!.text}</pre>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// ---- the page --------------------------------------------------------------------

/** Rooms typed per tour number → per group id. */
const byGroup = (groups: Karbala['groups'], inputs: Karbala['typed']) => Object.fromEntries(groups.map((g) => [g.id, inputs[inputKey(g)]]));

export function KarbalaView({ k, tabs, server, departureDayRule, saveStatus, loaded, ago }: Props) {
  const [pullOpen, setPullOpen] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const { dataset, groups, typed, applied, pending } = k;
  // The table shows what is typed; the messages are built from the rooms as of the last "Refresh messages".
  const rows = useMemo(() => karbalaRows(groups, byGroup(groups, typed), { departureDayRule }), [groups, typed, departureDayRule]);
  const messageRows = useMemo(() => karbalaRows(groups, byGroup(groups, applied), { departureDayRule }), [groups, applied, departureDayRule]);
  // A pull that finished closes the pull panel.
  useEffect(() => {
    if (!k.pulling && !k.error) setPullOpen(false);
  }, [k.pulling, k.error]);
  const meta = dataset?.meta;
  const showPull = !dataset || pullOpen || k.pulling || Boolean(k.error);
  const asked = rows.filter((r) => typed[inputKey(r.group)]?.spec?.trim()).length;
  const guestCount = rows.reduce((n, r) => n + r.group.pax, 0);
  const messageCount = messageRows.filter((r) => r.message).length;

  return (
    <div className="app karbala">
      <header className="app-top">
        <div className="app-top-inner">
          <Brand name="Karbala stays" />
          {tabs}
          {meta ? (
            <div className="pulled">
              <b>
                From {dayMonth(meta.from)}
                {meta.to ? ` to ${dayMonth(meta.to)}` : ''}
              </b>
              Pulled {ago(meta.fetchedAt)}
              <span className="save-status" data-status={saveStatus} title="Rooms typed for Karbala are shared by every device and link">
                {saveStatus === 'saving' ? ' · Saving…' : saveStatus === 'offline' ? ' · Not saved yet, retrying' : loaded ? ' · Saved for everyone' : ''}
              </span>
            </div>
          ) : null}
          {meta ? (
            <div className="top-actions">
              <button className="btn refresh" data-pending={pending > 0} onClick={k.refresh} title="Rebuild the hotel messages with the rooms typed since the last refresh">
                {k.refreshed && !pending ? 'Messages refreshed' : 'Refresh messages'}
                {pending ? <span className="badge">{pending}</span> : null}
              </button>
              <a className="btn" href="#k-messages">
                Hotel messages
              </a>
              <button className="btn" onClick={() => setPullOpen(true)} disabled={k.pulling}>
                Pull again
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <AnimatePresence initial={false}>
        {pending && !showPull ? (
          <motion.div key="pending" className="pending-bar" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="pending-inner">
              <span>
                Rooms changed for {pending} {pending === 1 ? 'tour' : 'tours'}. The messages below do not include them yet.
              </span>
              <button className="btn solid" onClick={k.refresh}>
                Refresh messages
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <main className="page">
        {showPull ? (
          <PullPanel
            k={k}
            server={server}
            onClose={
              dataset && !k.pulling
                ? () => {
                    setPullOpen(false);
                    k.stop();
                  }
                : null
            }
          />
        ) : null}

        {dataset && meta && !k.pulling ? (
          <>
            <section className="overview k-overview">
              <div className="overview-head">
                <h1>Karbala · {rangeLabel(meta.from, meta.to ?? meta.through)}</h1>
                <p>
                  {groupsText(rows.length)}, {guests(guestCount)} who need a hotel. {messageCount} {messageCount === 1 ? 'message' : 'messages'} below.
                </p>
                {meta.notApproved ? (
                  <p className="overview-note">
                    {meta.notApproved} more {meta.notApproved === 1 ? 'tour' : 'tours'} in this period {meta.notApproved === 1 ? 'is' : 'are'} still pending in NKERP. They
                    join once approved and pulled again.{' '}
                    {meta.pending?.length ? (
                      <button className="linkish" onClick={() => setShowPending(true)}>
                        See the pending tours
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </section>

            {rows.length ? (
              <>
                <section className="block">
                  <div className="block-head">
                    <h2>Groups</h2>
                    <p>
                      One row per group staying in Karbala. {asked} of {rows.length} have rooms typed. Type rooms as bed size × rooms (2x6 is six 2-bed rooms), then
                      press <b>Refresh messages</b>.
                    </p>
                  </div>
                  <GroupsTable rows={rows} typed={typed} onInput={k.onInput} />
                </section>

                <section className="block" id="k-messages">
                  <div className="block-head">
                    <h2>Hotel messages</h2>
                    <p>One message per group, by the day it checks in. Copy one, or every message for a day.</p>
                  </div>
                  <Messages rows={messageRows} pending={pending} onRefresh={k.refresh} />
                </section>
              </>
            ) : (
              <div className="empty">
                <h2>No groups in this range</h2>
                <p>No approved tour staying in Karbala in this range has guests who need a hotel. Pull again with other dates, or once more tours are approved in NKERP.</p>
              </div>
            )}
          </>
        ) : null}
      </main>

      <AnimatePresence>
        {showPending && meta?.pending ? (
          <PendingTours key="pending" tours={meta.pending} city="Karbala" outOf="the messages" onClose={() => setShowPending(false)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
