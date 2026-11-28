import { AnimatePresence } from 'motion/react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { OPENING_BALANCE, RUYA_SHEET } from '../../shared/config';
import { dayLabel, dayMonth, daysBetween, fullDate, rangeLabel } from '../../shared/dates';
import { HOTEL_ORDER, reasonLabel } from '../../shared/engine';
import { describeRooms, parseRoomSpec } from '../../shared/roomSpec';
import type { DateChange, DayRow, Group, GroupInput, HotelId, HotelNames, Placement, Plan, PullMeta } from '../../shared/types';
import { Occupancy } from '../components/Occupancy';
import { PendingTours } from '../components/PendingTours';
import { RoomPicker } from '../components/RoomPicker';
import { PageBar } from '../components/Shell';
import { StayBoard } from '../components/StayBoard';
import { ChangeBadge, PaxInput, PullChanges, ReapprovalBadge, TourAlerts, useChanged } from '../components/TourChanges';
import { guests, groupsText, HotelChip, Icon, nightsText, Num, Segmented, TourTag } from '../components/ui';
import { bookingRows, howText, legDetail } from '../lib/bookings';
import type { InputChange, TourInputs } from '../lib/inputs';
import { useNames } from '../lib/names';
import { useHue } from '../lib/tags';

interface Props {
  groups: Group[];
  plan: Plan;
  meta: PullMeta;
  inputs: Record<string, GroupInput | undefined>;
  tourInputs: TourInputs;
  onInput: (group: Pick<Group, 'tourId' | 'tourNo'>, patch: InputChange) => void;
  /** The page's buttons (hotel messages, Excel), shown in the bar that stays at the top. */
  actions: ReactNode;
}

/** Short reason shown next to a group that is not in the first hotel. */
const short = (reason: Placement['reason'] | undefined, names: HotelNames) =>
  reason === 'room-mix' || reason === 'ruya-full' || reason === 'araf-full' || reason === 'pinned' ? reasonLabel(reason, names) : '';

// ---- summary --------------------------------------------------------------

function HotelSummary({ plan }: { plan: Plan }) {
  const names = useNames();
  return (
    <dl className="hotels">
      {HOTEL_ORDER.map((hotel) => {
        const t = plan.totals.byHotel[hotel];
        const nightsUsed = plan.days.filter((d) => d.hotels[hotel].pax > 0).length;
        const cap = hotel === 'ruya' ? plan.capacity.ruya : hotel === 'araf' ? plan.capacity.araf : null;
        return (
          <div className="hotel-sum" key={hotel} data-hotel={hotel} data-idle={t.groups === 0}>
            <dt>
              <i aria-hidden="true" />
              {names[hotel]}
              <span>{cap ? `${cap} beds` : 'no limit'}</span>
            </dt>
            {t.groups ? (
              <dd>
                <b>
                  <Num value={t.guests} />
                </b>{' '}
                {t.guests === 1 ? 'guest' : 'guests'} in {groupsText(t.groups)}
                <span>
                  {nightsUsed} of {plan.days.length} nights · busiest night {t.peak}
                </span>
              </dd>
            ) : (
              <dd>
                <b className="none">Not needed</b>
                <span>{hotel === 'ruya' ? `No groups in ${names.ruya}` : `${names.ruya} covers every group`}</span>
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

// ---- one night, opened from the daily table --------------------------------------

function NightDetail({ day, plan, byId }: { day: DayRow; plan: Plan; byId: Map<string, Group> }) {
  const names = useNames();
  const hue = useHue();
  const holdLabel = new Map(OPENING_BALANCE.map((h) => [h.id, h.label]));
  const occupant = new Map<string, string>();
  for (const id of day.hotels.ruya.groups) for (const room of plan.placements[id]?.rooms ?? []) occupant.set(room.label, id);
  const inPlan = new Set(plan.rooms.map((r) => r.label));
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const name = (id: string) => (byId.get(id) ? `Tour ${byId.get(id)?.tourNo}` : (holdLabel.get(id) ?? id));
  const paxOf = (id: string) => byId.get(id)?.pax ?? OPENING_BALANCE.find((h) => h.id === id)?.pax ?? 0;

  return (
    <div className="night-detail">
      <div className="nd-board">
        <div className="nd-title">
          <b>{names.ruya} rooms</b>
          <span>
            {occupant.size} of {plan.rooms.length} rooms in use · {plan.capacity.ruya - day.hotels.ruya.beds} beds free
          </span>
        </div>
        {floors.map((floor) => (
          <div className="floor" key={floor}>
            <span className="floor-name">Floor {floor}</span>
            <div className="floor-rooms">
              {RUYA_SHEET.filter((r) => r.floor === floor).map((room) => {
                const id = occupant.get(room.no);
                const tourNo = id ? byId.get(id)?.tourNo : undefined;
                const out = !inPlan.has(room.no);
                return (
                  <span
                    key={room.no}
                    className="room"
                    data-taken={Boolean(tourNo)}
                    data-held={Boolean(id && !tourNo)}
                    data-out={out}
                    style={tourNo ? hue(tourNo) : undefined}
                    title={out ? `Room ${room.no}: not in the plan` : id ? `Room ${room.no}: ${name(id)}` : `Room ${room.no}: free`}
                  >
                    <b>{room.no}</b>
                    <span>{id ? (tourNo ?? 'Nov') : `${room.beds} beds`}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="nd-lists">
        {HOTEL_ORDER.filter((hotel) => day.hotels[hotel].groups.length).map((hotel) => {
          const ids = day.hotels[hotel].groups;
          return (
            <div key={hotel} className="nd-list" data-hotel={hotel}>
              <div className="nd-title">
                <HotelChip hotel={hotel} />
                <span>{guests(day.hotels[hotel].pax)}</span>
              </div>
              <ul>
                  {ids.map((id) => {
                    const g = byId.get(id);
                    const p = plan.placements[id];
                    return (
                      <li key={id}>
                        {g ? <TourTag no={g.tourNo} /> : <span className="tag held">Nov</span>}
                        <span className="nd-who">
                          {g?.leader || holdLabel.get(id) || ''}
                          {hotel === 'ruya' && p?.rooms.length ? <small>Rooms {p.rooms.map((r) => r.label).join(', ')}</small> : null}
                          {hotel !== 'ruya' && p ? <small>{p.overbooked ? 'Does not fit' : short(p.reason, names)}</small> : null}
                        </span>
                        <b className="nd-pax">{paxOf(id)}</b>
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
        {HOTEL_ORDER.some((hotel) => !day.hotels[hotel].groups.length) ? (
          <p className="nd-empty">
            Nobody in {HOTEL_ORDER.filter((hotel) => !day.hotels[hotel].groups.length).map((hotel) => names[hotel]).join(' or ')}.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---- daily plan ---------------------------------------------------------------

function DailyTable({ plan, byId, open, onOpen }: { plan: Plan; byId: Map<string, Group>; open: string | null; onOpen: (date: string | null) => void }) {
  const names = useNames();
  const tags = (ids: string[]) =>
    ids.map((id) => byId.get(id)?.tourNo).filter((no): no is string => Boolean(no)).map((no) => <TourTag key={no} no={no} />);
  const pax = (ids: string[]) => ids.reduce((sum, id) => sum + (byId.get(id)?.pax ?? 0), 0);
  const why = (day: DayRow) => {
    const reasons = new Map<string, string[]>();
    for (const hotel of ['araf', 'c'] as const) {
      for (const id of day.hotels[hotel].groups) {
        const p = plan.placements[id];
        const label = p?.overbooked ? 'Does not fit' : short(p?.reason, names);
        reasons.set(label, [...(reasons.get(label) ?? []), id]);
      }
    }
    return [...reasons];
  };

  return (
    <div className="sheet-wrap">
      <table className="sheet daily">
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col" className="n" data-hotel="ruya">
              {names.ruya} <small>of {plan.capacity.ruya}</small>
            </th>
            <th scope="col" className="n" data-hotel="araf">
              {names.araf} <small>of {plan.capacity.araf}</small>
            </th>
            <th scope="col" className="n" data-hotel="c">
              {names.c}
            </th>
            <th scope="col" className="n total">
              All guests
            </th>
            <th scope="col" className="n">
              {names.ruya} beds free
            </th>
            <th scope="col" className="wide">
              Arriving
            </th>
            <th scope="col" className="wide">
              Leaving
            </th>
            <th scope="col" className="wide">
              Outside {names.ruya}
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.days.map((day) => {
            const ruyaUsed = plan.rooms.length ? day.hotels.ruya.beds : day.hotels.ruya.pax;
            const free = plan.capacity.ruya - ruyaUsed;
            const isOpen = open === day.date;
            const reasons = why(day);
            return (
              <Fragment key={day.date}>
                <tr
                  id={`night-${day.date}`}
                  className="day-row"
                  data-open={isOpen}
                  data-fri={new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5}
                  data-month={day.date.endsWith('-01') && day.date !== plan.days[0].date}
                  onClick={() => onOpen(isOpen ? null : day.date)}
                >
                  <th scope="row" className="date">
                    <button type="button" className="day-toggle" aria-expanded={isOpen} aria-label={`${dayLabel(day.date)}: who is in which room`}>
                      <Icon name="chevron" size={14} />
                      {dayLabel(day.date)}
                    </button>
                  </th>
                  <td className="n cell" data-hotel="ruya" data-on={day.hotels.ruya.pax > 0}>
                    <span className="meter" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, (ruyaUsed / Math.max(1, plan.capacity.ruya)) * 100)}%` }} />
                    </span>
                    <span className="meter-n">{day.hotels.ruya.pax || '–'}</span>
                  </td>
                  <td className="n cell" data-hotel="araf" data-on={day.hotels.araf.pax > 0}>
                    {day.hotels.araf.pax || '–'}
                  </td>
                  <td className="n cell" data-hotel="c" data-on={day.hotels.c.pax > 0}>
                    {day.hotels.c.pax || '–'}
                  </td>
                  <td className="n total">{day.total || '–'}</td>
                  <td className="n free" data-low={free <= 0}>
                    {free}
                  </td>
                  <td className="moves wide">
                    {day.arrivals.length ? (
                      <>
                        <b>+{pax(day.arrivals)}</b>
                        {tags(day.arrivals)}
                      </>
                    ) : null}
                  </td>
                  <td className="moves wide">
                    {day.departures.length ? (
                      <>
                        <b>−{pax(day.departures)}</b>
                        {tags(day.departures)}
                      </>
                    ) : null}
                  </td>
                  <td className="moves why wide">
                    {reasons.map(([label, ids]) => (
                      <span key={label}>
                        {tags(ids)}
                        {label}
                      </span>
                    ))}
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="detail-row">
                    <td colSpan={9}>
                      <NightDetail day={day} plan={plan} byId={byId} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- bookings ------------------------------------------------------------------

function BookingsTable({ rows }: { rows: ReturnType<typeof bookingRows> }) {
  const names = useNames();
  if (!rows.length) {
    return (
      <p className="all-clear">
        <Icon name="check" />
        {names.ruya} covers every night. Nothing to book at {names.araf} or {names.c}.
      </p>
    );
  }
  return (
    <div className="sheet-wrap">
      <table className="sheet bookings stack">
        <thead>
          <tr>
            <th scope="col">Hotel</th>
            <th scope="col">Tour</th>
            <th scope="col">First night</th>
            <th scope="col">Last night</th>
            <th scope="col" className="n">
              Nights
            </th>
            <th scope="col" className="n">
              Guests
            </th>
            <th scope="col">Arrival</th>
            <th scope="col">Departure</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, hotel, group, from, lastNight, nights }) => (
            <tr key={key}>
              <td data-label="Hotel">
                <HotelChip hotel={hotel} />
              </td>
              <th scope="row" className="tour" data-label="Tour">
                <TourTag no={group.tourNo} />
                {group.leader ? <span className="leader">{group.leader}</span> : null}
              </th>
              <td data-label="First night">{fullDate(from)}</td>
              <td data-label="Last night">{fullDate(lastNight)}</td>
              <td className="n" data-label="Nights">
                {nights}
              </td>
              <td className="n strong" data-label="Guests">
                {group.pax}
              </td>
              <td className="when" data-label="Arrival">
                {dayMonth(group.checkIn)}
                <small>{legDetail(group.arrival, group.arrivalAt, 'From')}</small>
              </td>
              <td className="when" data-label="Departure">
                {dayMonth(group.checkOut)}
                <small>{legDetail(group.departure, group.departureAt, 'To')}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- groups ---------------------------------------------------------------------

function RoomsCell({ group, input, placement, onInput }: { group: Group; input: GroupInput; placement: Placement | undefined; onInput: Props['onInput'] }) {
  const names = useNames();
  const parsed = parseRoomSpec(input.spec);
  const typed = Boolean(input.spec?.trim());
  let read: { text: string; bad: boolean } | null = null;
  if (parsed.error) read = { text: parsed.error, bad: true };
  else if (typed) read = { text: `${describeRooms(parsed.rooms)} = ${parsed.beds} beds${parsed.beds < group.pax ? ` for ${group.pax} guests` : ''}`, bad: parsed.beds < group.pax };
  else if (placement?.specSource === 'suggested' && placement.spec) read = { text: `Planned as ${describeRooms(placement.spec)}`, bad: false };
  return (
    <div className="rooms-cell" data-bad={read?.bad}>
      <input
        type="text"
        value={input.spec ?? ''}
        placeholder="e.g. 2x6, 3x1"
        aria-label={`Rooms tour ${group.tourNo} needs in ${names.ruya}`}
        aria-invalid={read?.bad || undefined}
        maxLength={1000}
        spellCheck={false}
        onChange={(e) => onInput(group, { spec: e.target.value.trim() ? e.target.value : null })}
      />
      {read ? <small>{read.text}</small> : null}
    </div>
  );
}

function notesFor(group: Group, placement: Placement | undefined, names: HotelNames): { text: string; warn: boolean }[] {
  const notes: { text: string; warn: boolean }[] = [];
  if (placement) {
    if (placement.overbooked) notes.push({ text: `Does not fit. ${placement.detail}`, warn: true });
    else if (placement.hotel !== 'ruya' || placement.reason === 'pinned') notes.push({ text: `${reasonLabel(placement.reason, names)}. ${placement.reason === 'pinned' ? '' : placement.detail}`.trim(), warn: placement.hotel !== 'ruya' });
    if (placement.specIssue) notes.push({ text: placement.specIssue, warn: true });
    if (placement.staysDepartureDay) {
      const airport = /baghdad/i.test(group.departure.place) ? 'Baghdad' : 'Najaf';
      notes.push({ text: `Flies ${group.departure.flight ?? 'Iraqi Airways'} from ${airport}: departure day counted as a night.`, warn: false });
    }
  }
  for (const note of group.notes) notes.push({ text: note, warn: false });
  return notes;
}

type Filter = 'all' | 'outside' | 'changed' | 'norooms';

function GroupsTable({ list, plan, meta, inputs, onInput, onPick, changes }: {
  list: Group[]; plan: Plan; meta: PullMeta; inputs: Props['inputs']; onInput: Props['onInput']; onPick: (groupId: string) => void; changes?: Record<number, DateChange>;
}) {
  const names = useNames();
  const changed = useChanged(meta);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const is: Record<Filter, (g: Group) => boolean> = {
    all: () => true,
    outside: (g) => Boolean(plan.placements[g.id] && (plan.placements[g.id].hotel !== 'ruya' || plan.placements[g.id].overbooked)),
    changed: (g) => changed(g.tourId) || Boolean(changes?.[g.tourId]),
    norooms: (g) => Boolean(plan.placements[g.id]) && !inputs[g.id]?.spec?.trim() && !inputs[g.id]?.roomNos?.length,
  };
  const q = query.trim().toLowerCase();
  const shown = list.filter((g) => is[filter](g) && (!q || g.tourNo.includes(q) || g.leader.toLowerCase().includes(q)));
  const count = (f: Filter) => list.filter(is[f]).length;

  return (
    <>
      <div className="table-tools">
        <Segmented
          label="Show groups"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All', count: list.length },
            { id: 'outside', label: `Outside ${names.ruya}`, count: count('outside') },
            { id: 'changed', label: 'Changed in NKERP', count: count('changed') },
            { id: 'norooms', label: 'No rooms typed', count: count('norooms') },
          ]}
        />
        <label className="search">
          <Icon name="search" />
          <span className="sr">Find a tour or group leader</span>
          <input type="search" value={query} placeholder="Find a tour or group leader" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="sheet-wrap">
        <table className="sheet groups stack">
          <colgroup>
            <col className="c-tour" />
            <col className="c-pax" />
            <col className="c-when" />
            <col className="c-when" />
            <col className="c-nights" />
            <col className="c-hotel" />
            <col className="c-rooms" />
            <col className="c-nos" />
            <col className="c-notes" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Tour and group leader</th>
              <th scope="col">Hotel pax</th>
              <th scope="col">Arrives</th>
              <th scope="col">Leaves</th>
              <th scope="col" className="n">
                Nights
              </th>
              <th scope="col">Hotel</th>
              <th scope="col">Rooms asked for</th>
              <th scope="col">{names.ruya} rooms</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((group) => {
              const placement = plan.placements[group.id];
              const input = inputs[group.id] ?? {};
              const hotel: HotelId | null = placement?.hotel ?? null;
              const notes = notesFor(group, placement, names);
              return (
                <tr key={group.id} data-flag={Boolean(placement && (placement.hotel !== 'ruya' || placement.overbooked))} data-changed={changed(group.tourId)}>
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
                    {placement ? placement.nights.length : daysBetween(group.checkIn, group.checkOut)}
                  </td>
                  <td data-label="Hotel">
                    <span className="hotel-pick" data-hotel={hotel ?? 'none'} data-overbooked={placement?.overbooked}>
                      <label className="sr" htmlFor={`pin-${group.id}`}>
                        Hotel for tour {group.tourNo}
                      </label>
                      <select
                        id={`pin-${group.id}`}
                        value={input.roomNos?.length ? 'rooms' : (input.pin ?? '')}
                        onChange={(e) => {
                          if (e.target.value === 'rooms') return onPick(group.id);
                          // Choosing a hotel replaces any rooms chosen by hand.
                          onInput(group, { pin: (e.target.value || null) as HotelId | null, roomNos: null });
                        }}
                      >
                        {input.roomNos?.length ? <option value="rooms">{names.ruya}, rooms by hand</option> : null}
                        <option value="">{hotel && !input.roomNos?.length ? names[hotel] : 'Planner picks'}</option>
                        {HOTEL_ORDER.map((h) => (
                          <option key={h} value={h}>
                            Keep in {names[h]}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td data-label="Rooms asked for">
                    <RoomsCell group={group} input={input} placement={placement} onInput={onInput} />
                  </td>
                  <td className="room-nos" data-label={`${names.ruya} rooms`}>
                    {placement?.rooms.length ? (
                      <span className="room-list">
                        {placement.rooms.map((r) => r.label).join(', ')}
                        {placement.specSource === 'manual' ? <em> · by hand</em> : null}
                      </span>
                    ) : null}
                    <button type="button" className="btn sm" disabled={!placement?.nights.length} onClick={() => onPick(group.id)}>
                      {input.roomNos?.length ? 'Change rooms' : 'Choose rooms'}
                    </button>
                  </td>
                  <td className="notes" data-label="Notes">
                    <ChangeBadge tourId={group.tourId} meta={meta} />
                    <ReapprovalBadge change={changes?.[group.tourId]} />
                    {notes.map((n) => (
                      <span key={n.text} className="note" data-warn={n.warn}>
                        {n.warn ? <Icon name="alert" size={14} /> : null}
                        {n.text}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
            {!shown.length ? (
              <tr className="none-row">
                <td colSpan={9}>
                  No groups match.{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setFilter('all');
                      setQuery('');
                    }}
                  >
                    Show all {list.length}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- the page --------------------------------------------------------------------

export function PlanView({ groups, plan, meta, inputs, tourInputs, onInput, actions }: Props) {
  const names = useNames();
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  // Groups that reached Najaf before the first night are covered by the opening balance (rooms 109, 110, 201, 202).
  const before = new Set(plan.before);
  const editable = groups.filter((g) => !before.has(g.id) || g.nkerpPax !== undefined);
  const planned = editable.filter((g) => plan.placements[g.id]);
  const { totals } = plan;
  const asked = planned.filter((g) => inputs[g.id]?.spec?.trim()).length;
  const [picking, setPicking] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const [view, setView] = useState<'night' | 'room'>('night');
  const [open, setOpen] = useState<string | null>(null);
  const pickingGroup = picking ? byId.get(picking) : undefined;
  const otherNights = plan.days.filter((d) => d.hotels.araf.pax + d.hotels.c.pax > 0).length;
  const bookings = useMemo(() => bookingRows(plan, byId), [plan, byId]);
  const occDays = useMemo(
    () =>
      plan.days.map((d) => ({
        date: d.date,
        values: HOTEL_ORDER.map((h) => d.hotels[h].pax),
        note: `${plan.capacity.ruya - (plan.rooms.length ? d.hotels.ruya.beds : d.hotels.ruya.pax)} ${names.ruya} beds free`,
      })),
    [plan, names.ruya],
  );
  const openNight = (date: string) => {
    setView('night');
    setOpen(date);
    requestAnimationFrame(() => document.getElementById(`night-${date}`)?.scrollIntoView({ block: 'center' }));
  };

  return (
    <>
      <PageBar
        title={rangeLabel(plan.range.from, plan.range.to)}
        note={meta.source === 'sample' ? 'Sample data' : undefined}
        sections={[
          { id: 'overview', label: 'Overview' },
          { id: 'daily', label: 'Daily plan' },
          { id: 'bookings', label: 'Bookings to make', count: bookings.length },
          { id: 'groups', label: 'Groups', count: editable.length },
        ]}
        actions={actions}
      />
      <main className="page">
        <div className="lead">
          <p>
            <b>
              {groupsText(totals.groups)}, {guests(totals.guests)}
            </b>{' '}
            who need a hotel.{' '}
            {otherNights ? (
              <>
                {names.ruya} is not enough on <b className="hot">{nightsText(otherNights)}</b>.
              </>
            ) : (
              `${names.ruya} covers every night.`
            )}
          </p>
          {meta.notApproved ? (
            <p className="lead-note">
              <Icon name="clock" />
              {meta.notApproved} more {meta.notApproved === 1 ? 'tour' : 'tours'} in this period {meta.notApproved === 1 ? 'is' : 'are'} still pending in NKERP. They join
              the plan once approved.{' '}
              {meta.pending?.length ? (
                <button className="link" type="button" onClick={() => setShowPending(true)}>
                  See the pending tours
                </button>
              ) : (
                <span>Pull again to see their details.</span>
              )}
            </p>
          ) : null}
        </div>

        <TourAlerts meta={meta} />
        <PullChanges meta={meta} />

        <section className="block" id="overview" aria-label="Overview">
          <div className="panel">
            <Occupancy
              series={HOTEL_ORDER.map((h) => ({ id: h, label: names[h] }))}
              days={occDays}
              capacity={plan.capacity.ruya}
              capLabel={`${names.ruya} beds (${plan.capacity.ruya})`}
              selected={open}
              onPick={openNight}
            />
            <HotelSummary plan={plan} />
          </div>
        </section>

        <section className="block" id="daily">
          <div className="block-head">
            <div>
              <h2>Daily plan</h2>
              <p>
                {view === 'night'
                  ? 'Guests sleeping in each hotel, night by night. Click a night to see who is in which room.'
                  : `Every ${names.ruya} room against every night. Each bar is one tour's stay. Click a bar to choose its rooms.`}
              </p>
            </div>
            <Segmented
              label="Daily plan view"
              value={view}
              onChange={setView}
              options={[
                { id: 'night', label: 'By night' },
                { id: 'room', label: 'By room' },
              ]}
            />
          </div>
          {view === 'night' ? <DailyTable plan={plan} byId={byId} open={open} onOpen={setOpen} /> : <StayBoard plan={plan} byId={byId} onPick={setPicking} />}
        </section>

        <section className="block" id="bookings">
          <div className="block-head">
            <div>
              <h2>Bookings to make</h2>
              <p>
                One row per tour staying in {names.araf} or {names.c}, with its nights there and its arrival and departure.
              </p>
            </div>
          </div>
          <BookingsTable rows={bookings} />
        </section>

        <section className="block" id="groups">
          <div className="block-head">
            <div>
              <h2>Groups</h2>
              <p>
                Edit hotel pax or rooms and the plan updates by itself. Enter 0 to skip booking for a tour. Use 2x6 for six 2-bed rooms, or choose exact {names.ruya}{' '}
                rooms. {asked} of {planned.length} planned groups have rooms typed.
              </p>
            </div>
          </div>
          {editable.length ? (
            <GroupsTable list={editable} plan={plan} meta={meta} inputs={inputs} onInput={onInput} onPick={setPicking} changes={meta.reapprovals} />
          ) : (
            <p className="empty">No approved stays in this range.</p>
          )}
        </section>

        <AnimatePresence>{showPending && meta.pending ? <PendingTours key="pending" tours={meta.pending} meta={meta} inputs={tourInputs} onEdit={onInput} onClose={() => setShowPending(false)} /> : null}</AnimatePresence>
        <AnimatePresence>
          {pickingGroup ? (
            <RoomPicker
              key={pickingGroup.id}
              group={pickingGroup}
              plan={plan}
              groups={groups}
              current={inputs[pickingGroup.id]?.roomNos}
              onChange={(roomNos) => onInput(pickingGroup, { roomNos: roomNos?.length ? roomNos : null, pin: null })}
              onClose={() => setPicking(null)}
            />
          ) : null}
        </AnimatePresence>
      </main>
    </>
  );
}
