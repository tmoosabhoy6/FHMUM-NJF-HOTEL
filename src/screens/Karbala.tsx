import { AnimatePresence } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { dayLabel, dayMonth, rangeLabel } from '../../shared/dates';
import { karbalaRows, type KarbalaRow } from '../../shared/karbala';
import { describeRooms, parseRoomSpec } from '../../shared/roomSpec';
import type { DateChange, PullMeta } from '../../shared/types';
import { CopyButton } from '../components/HotelMessages';
import { PendingTours } from '../components/PendingTours';
import { PullPanel } from '../components/PullPanel';
import { PageBar, PullStatus, Shell } from '../components/Shell';
import { ChangeBadge, PaxInput, PullChanges, ReapprovalBadge, TourAlerts, useChanged } from '../components/TourChanges';
import { groupsText, guests, Icon, TourTag } from '../components/ui';
import { howText } from '../lib/bookings';
import { copy } from '../lib/copy';
import type { Karbala } from '../lib/karbala';
import type { SaveStatus } from '../lib/shared';
import type { ServerState } from '../lib/sync';

interface Props {
  k: Karbala;
  tabs: ReactNode;
  server: ServerState;
  departureDayRule: boolean;
  saveStatus: SaveStatus;
  loaded: boolean;
}

// ---- groups ------------------------------------------------------------------------

function RoomsInput({ row, spec, onInput }: { row: KarbalaRow; spec: string; onInput: Karbala['onInput'] }) {
  const parsed = parseRoomSpec(spec);
  const typed = Boolean(spec.trim());
  const read = parsed.error ? { text: parsed.error, bad: true } : typed ? { text: `${describeRooms(parsed.rooms)} = ${parsed.beds} beds`, bad: parsed.beds < row.group.pax } : null;
  return (
    <div className="rooms-cell" data-bad={read?.bad}>
      <input
        type="text"
        value={spec}
        placeholder="e.g. 2x6, 3x1"
        aria-label={`Rooms tour ${row.group.tourNo} needs in Karbala`}
        aria-invalid={read?.bad || undefined}
        maxLength={1000}
        spellCheck={false}
        onChange={(e) => onInput(row.group, { spec: e.target.value.trim() ? e.target.value : null })}
      />
      {read ? <small>{read.text}</small> : null}
    </div>
  );
}

function GroupsTable({ rows, meta, inputs, onInput, changes }: {
  rows: KarbalaRow[]; meta: PullMeta; inputs: Karbala['inputs']; onInput: Karbala['onInput']; changes?: Record<number, DateChange>;
}) {
  const changed = useChanged(meta);
  return (
    <div className="sheet-wrap">
      <table className="sheet kgroups stack">
        <thead>
          <tr>
            <th scope="col">Tour and group leader</th>
            <th scope="col">Hotel pax</th>
            <th scope="col">Arrives</th>
            <th scope="col">Leaves</th>
            <th scope="col" className="n">
              Nights
            </th>
            <th scope="col">Rooms asked for</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { group } = row;
            return (
              <tr key={group.id} data-changed={changed(group.tourId)}>
                <th scope="row" className="tour" data-label="Tour">
                  <TourTag no={group.tourNo} />
                  <span className="leader">{group.leader || 'No group leader'}</span>
                </th>
                <td data-label="Hotel pax">
                  <PaxInput tourNo={group.tourNo} pax={group.pax} nkerpPax={group.nkerpPax} paxBefore={group.paxBefore}
                    infants={group.infants} onChange={(change) => onInput(group, change)} />
                </td>
                <td className="when" data-label="Arrives">
                  {dayMonth(group.checkIn)}
                  <small>{howText(group.arrival, group.arrivalAt)}</small>
                </td>
                <td className="when" data-label="Leaves">
                  {dayMonth(group.checkOut)}
                  <small>{howText(group.departure, group.departureAt)}</small>
                </td>
                <td className="n" data-label="Nights">
                  {row.nights.length}
                </td>
                <td data-label="Rooms asked for">
                  <RoomsInput row={row} spec={inputs[group.id]?.spec ?? ''} onInput={onInput} />
                </td>
                <td className="notes" data-label="Notes">
                  <ChangeBadge tourId={group.tourId} meta={meta} />
                  <ReapprovalBadge change={changes?.[group.tourId]} />
                  {row.departureDay ? <span className="note">Flies Iraqi Airways after Karbala: the departure day counts as a night, as in Najaf.</span> : null}
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

function Messages({ rows }: { rows: KarbalaRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const byDate = useMemo(() => {
    const map = new Map<string, KarbalaRow[]>();
    for (const row of rows) if (row.message) map.set(row.message.from, [...(map.get(row.message.from) ?? []), row]);
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const noNights = rows.filter((r) => r.group.pax > 0 && !r.message);
  const flash = async (key: string, text: string) => {
    if (await copy(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    }
  };

  return (
    <div className="k-messages">
      {noNights.length ? <p className="msg-note">No night in Karbala, so no message: tour {noNights.map((r) => r.group.tourNo).join(', ')}.</p> : null}
      {byDate.map(([date, list]) => {
        const key = `day-${date}`;
        return (
          <section className="msg-day" key={date}>
            <div className="msg-day-head">
              <h3>{dayLabel(date)}</h3>
              <span>
                {list.length} {list.length === 1 ? 'message' : 'messages'}
              </span>
              {list.length > 1 ? <CopyButton done={copied === key} label={`Copy all ${list.length}`} onClick={() => flash(key, list.map((r) => r.message!.text).join('\n\n'))} /> : null}
            </div>
            <div className="msg-grid">
              {list.map(({ group, message, issue }) => (
                <article className="msg" key={group.id}>
                  <div className="msg-head">
                    <TourTag no={group.tourNo} />
                    <span className="msg-who">{group.leader}</span>
                    <CopyButton done={copied === group.id} onClick={() => flash(group.id, message!.text)} />
                  </div>
                  {issue || !message!.rooms ? (
                    <p className="msg-warn">
                      <Icon name="alert" size={14} />
                      {issue ?? 'No rooms yet: type them in the Groups table.'}
                    </p>
                  ) : null}
                  <pre className="msg-text">{message!.text}</pre>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---- the page --------------------------------------------------------------------

export function KarbalaView({ k, tabs, server, departureDayRule, saveStatus, loaded }: Props) {
  const [pullOpen, setPullOpen] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const { dataset, groups, inputs } = k;
  const rows = useMemo(() => karbalaRows(groups, inputs, { departureDayRule }, true), [groups, inputs, departureDayRule]);
  // A pull that finished closes the pull panel.
  useEffect(() => {
    if (!k.pulling && !k.error) setPullOpen(false);
  }, [k.pulling, k.error]);
  const meta = dataset?.meta;
  const showPull = !dataset || !meta || pullOpen || k.pulling || Boolean(k.error);
  const planned = rows.filter((r) => r.group.pax > 0);
  const asked = planned.filter((r) => inputs[r.group.id]?.spec?.trim()).length;
  const guestCount = rows.reduce((n, r) => n + r.group.pax, 0);
  const messageCount = planned.filter((r) => r.message).length;

  return (
    <Shell
      tabs={tabs}
      status={!showPull ? <PullStatus meta={meta} saveStatus={saveStatus} loaded={loaded} /> : null}
      actions={
        !showPull ? (
          <button className="btn on-rail" type="button" onClick={() => setPullOpen(true)}>
            <Icon name="refresh" />
            Pull again
          </button>
        ) : null
      }
    >
      {showPull ? (
        <PullPanel
          venue="karbala"
          mode={k.pulling ? 'pulling' : k.error ? 'failed' : 'start'}
          from={k.range.from}
          to={k.range.to}
          onFrom={(from) => k.setRange((r) => ({ from, to: r.to && r.to < from ? '' : r.to }))}
          onTo={(to) => k.setRange((r) => ({ ...r, to }))}
          onPull={() => k.pull()}
          onStop={k.stop}
          onBack={
            dataset
              ? () => {
                  setPullOpen(false);
                  k.stop();
                }
              : null
          }
          backLabel={meta ? `Back to the messages from ${dayMonth(meta.from)}` : null}
          server={server}
          progress={k.progress}
          error={k.error}
        />
      ) : (
        <>
          <PageBar
            title={`Karbala · ${rangeLabel(meta.from, meta.to ?? meta.through)}`}
            sections={[
              { id: 'k-groups', label: 'Groups', count: rows.length },
              { id: 'k-messages', label: 'Hotel messages', count: messageCount },
            ]}
          />
          <main className="page">
            <div className="lead">
              <p>
                <b>
                  {groupsText(planned.length)}, {guests(guestCount)}
                </b>{' '}
                who need a hotel. {messageCount} {messageCount === 1 ? 'message' : 'messages'} to send.
              </p>
              {meta.notApproved ? (
                <p className="lead-note">
                  <Icon name="clock" />
                  {meta.notApproved} more {meta.notApproved === 1 ? 'tour' : 'tours'} in this period {meta.notApproved === 1 ? 'is' : 'are'} still pending in NKERP. They join once
                  approved and pulled again.{' '}
                  {meta.pending?.length ? (
                    <button className="link" type="button" onClick={() => setShowPending(true)}>
                      See the pending tours
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>
            <TourAlerts meta={meta} />
            <PullChanges meta={meta} />

            {rows.length ? (
              <>
                <section className="block" id="k-groups">
                  <div className="block-head">
                    <div>
                      <h2>Groups</h2>
                      <p>
                        Edit hotel pax or rooms and the messages update by themselves. Enter 0 to skip a tour. Use 2x6 for six 2-bed rooms. {asked} of {planned.length}{' '}
                        groups with hotel pax have rooms typed.
                      </p>
                    </div>
                  </div>
                  <GroupsTable rows={rows} meta={meta} inputs={inputs} onInput={k.onInput} changes={meta.reapprovals} />
                </section>

                <section className="block" id="k-messages">
                  <div className="block-head">
                    <div>
                      <h2>Hotel messages</h2>
                      <p>One message per group, by the day it checks in. Copy one, or every message for a day.</p>
                    </div>
                  </div>
                  <Messages rows={rows} />
                </section>
              </>
            ) : (
              <div className="empty">
                <h2>No groups in this range</h2>
                <p>No approved tour staying in Karbala in this range has guests who need a hotel. Pull again with other dates, or once more tours are approved in NKERP.</p>
              </div>
            )}
          </main>
        </>
      )}

      <AnimatePresence>
        {showPending && meta?.pending ? (
          <PendingTours key="pending" tours={meta.pending} meta={meta} inputs={k.typed} onEdit={k.onInput} city="Karbala" onClose={() => setShowPending(false)} />
        ) : null}
      </AnimatePresence>
    </Shell>
  );
}
