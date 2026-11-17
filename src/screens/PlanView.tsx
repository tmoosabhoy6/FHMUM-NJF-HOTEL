import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { OPENING_BALANCE, RUYA_SHEET } from '../../shared/config';
import { dayLabel, dayMonth, daysBetween, fullDate, rangeLabel } from '../../shared/dates';
import { HOTEL_NAME, HOTEL_ORDER, REASON_LABEL } from '../../shared/engine';
import { describeRooms, parseRoomSpec } from '../../shared/roomSpec';
import type { DayRow, Group, GroupInput, HotelId, Placement, Plan, PullMeta } from '../../shared/types';
import { PendingTours } from '../components/PendingTours';
import { RoomPicker } from '../components/RoomPicker';
import { guests, groupsText, nightsText, Num, tint } from '../components/ui';

interface Props {
  groups: Group[];
  plan: Plan;
  meta: PullMeta;
  inputs: Record<string, GroupInput | undefined>;
  onInput: (tourNo: string, patch: GroupInput) => void;
  onOpenRequests: () => void;
}

const SHORT: Partial<Record<Placement['reason'], string>> = {
  'room-mix': 'Rooms not available in Ruya',
  'ruya-full': 'Ruya is full',
  'araf-full': 'Ruya and Araf are full',
  pinned: 'Kept here by hand',
};

const nightsBetween = (from: string, lastNight: string) => daysBetween(from, lastNight) + 1;

// ---- summary --------------------------------------------------------------

function HotelTile({ hotel, plan }: { hotel: HotelId; plan: Plan }) {
  const t = plan.totals.byHotel[hotel];
  const nightsUsed = plan.days.filter((d) => d.hotels[hotel].pax > 0).length;
  const cap = hotel === 'ruya' ? plan.capacity.ruya : hotel === 'araf' ? plan.capacity.araf : null;
  return (
    <div className="tile" data-hotel={hotel} data-idle={t.groups === 0}>
      <div className="tile-name">
        {HOTEL_NAME[hotel]}
        <span>{cap ? `${cap} beds` : 'no limit'}</span>
      </div>
      {t.groups ? (
        <>
          <div className="tile-big">
            <Num value={t.guests} />
            <small>{t.guests === 1 ? 'guest' : 'guests'}</small>
          </div>
          <div className="tile-sub">
            {groupsText(t.groups)} · {nightsUsed} of {plan.days.length} nights · busiest night {t.peak}
          </div>
        </>
      ) : (
        <>
          <div className="tile-big none">Not needed</div>
          <div className="tile-sub">{hotel === 'ruya' ? 'No groups in Ruya' : 'Ruya covers every group'}</div>
        </>
      )}
    </div>
  );
}

// ---- one night, opened from the daily table --------------------------------------

function NightDetail({ day, plan, byId }: { day: DayRow; plan: Plan; byId: Map<string, Group> }) {
  const holdLabel = new Map(OPENING_BALANCE.map((h) => [h.id, h.label]));
  const occupant = new Map<string, string>();
  for (const id of day.hotels.ruya.groups) for (const room of plan.placements[id]?.rooms ?? []) occupant.set(room.label, id);
  const inPlan = new Set(plan.rooms.map((r) => r.label));
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const name = (id: string) => (byId.get(id) ? `Tour ${byId.get(id)?.tourNo}` : (holdLabel.get(id) ?? id));
  const paxOf = (id: string) => byId.get(id)?.pax ?? OPENING_BALANCE.find((h) => h.id === id)?.pax ?? 0;

  return (
    <div className="night-detail">
      <div className="nd-ruya">
        <div className="nd-title" data-hotel="ruya">
          <b>Ruya rooms</b>
          <span>
            {occupant.size} of {plan.rooms.length} rooms in use · {plan.capacity.ruya - day.hotels.ruya.beds} beds free
          </span>
        </div>
        {floors.map((floor) => (
          <div className="nd-floor" key={floor}>
            <span className="nd-floor-name">Floor {floor}</span>
            <div className="nd-rooms">
              {RUYA_SHEET.filter((r) => r.floor === floor).map((room) => {
                const id = occupant.get(room.no);
                const held = id ? holdLabel.has(id) : false;
                const colour = id && !held ? tint(id) : held ? { background: 'var(--sunk)', ink: 'var(--ink-2)' } : null;
                const out = !inPlan.has(room.no);
                return (
                  <span
                    key={room.no}
                    className="nd-room"
                    data-taken={Boolean(id)}
                    data-out={out}
                    style={colour ? ({ '--tint': colour.background, '--tint-ink': colour.ink } as CSSProperties) : undefined}
                    title={out ? `Room ${room.no}: not in the plan` : id ? `Room ${room.no}: ${name(id)}` : `Room ${room.no}: free`}
                  >
                    <b>{room.no}</b>
                    {id ? <span className="nd-who-in">{byId.get(id)?.tourNo ?? 'Nov'}</span> : null}
                    <span className="nd-beds">{room.beds} beds</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="nd-lists">
        {HOTEL_ORDER.map((hotel) => {
          const ids = day.hotels[hotel].groups;
          return (
            <div key={hotel} className="nd-list" data-hotel={hotel}>
              <div className="nd-title" data-hotel={hotel}>
                <b>{HOTEL_NAME[hotel]}</b>
                <span>{guests(day.hotels[hotel].pax)}</span>
              </div>
              {ids.length ? (
                <ul>
                  {ids.map((id) => {
                    const g = byId.get(id);
                    const p = plan.placements[id];
                    return (
                      <li key={id}>
                        <span className="nd-tour">{g?.tourNo ?? 'Nov'}</span>
                        <span className="nd-who">{g?.leader || holdLabel.get(id) || ''}</span>
                        <span className="nd-pax">{paxOf(id)}</span>
                        {hotel === 'ruya' && p?.rooms.length ? <span className="nd-roomlist">{p.rooms.map((r) => r.label).join(', ')}</span> : null}
                        {hotel !== 'ruya' && p ? <span className="nd-why">{p.overbooked ? 'Does not fit' : SHORT[p.reason]}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="nd-empty">Nobody</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- daily plan ---------------------------------------------------------------

function DailyTable({ plan, byId }: { plan: Plan; byId: Map<string, Group> }) {
  const [open, setOpen] = useState<string | null>(null);
  const tours = (ids: string[]) => ids.map((id) => byId.get(id)?.tourNo).filter(Boolean).join(', ');
  const pax = (ids: string[]) => ids.reduce((sum, id) => sum + (byId.get(id)?.pax ?? 0), 0);
  const why = (day: DayRow) => {
    const reasons = new Map<string, string[]>();
    for (const hotel of ['araf', 'c'] as const) {
      for (const id of day.hotels[hotel].groups) {
        const p = plan.placements[id];
        const label = p?.overbooked ? 'Does not fit' : (SHORT[p?.reason ?? 'fits'] ?? '');
        reasons.set(label, [...(reasons.get(label) ?? []), byId.get(id)?.tourNo ?? id]);
      }
    }
    return [...reasons].map(([label, list]) => `${label}: ${list.join(', ')}`);
  };

  return (
    <div className="sheet-wrap">
      <table className="sheet daily">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col" className="n" data-hotel="ruya">
              Ruya <small>of {plan.capacity.ruya}</small>
            </th>
            <th scope="col" className="n" data-hotel="araf">
              Araf <small>of {plan.capacity.araf}</small>
            </th>
            <th scope="col" className="n" data-hotel="c">
              Hotel C
            </th>
            <th scope="col" className="n">
              All guests
            </th>
            <th scope="col" className="n">
              Ruya beds free
            </th>
            <th scope="col">Arriving</th>
            <th scope="col">Leaving</th>
            <th scope="col">Why Araf or Hotel C</th>
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
                  className="day-row"
                  data-open={isOpen}
                  data-weekend={new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5}
                  data-month={day.date.endsWith('-01') && day.date !== plan.days[0].date}
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : day.date)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpen(isOpen ? null : day.date);
                    }
                  }}
                >
                  <th scope="row" className="date">
                    <span className="caret" aria-hidden="true" />
                    {dayLabel(day.date)}
                  </th>
                  <td className="n cell-ruya" data-on={day.hotels.ruya.pax > 0}>
                    <span className="fill" style={{ width: `${Math.min(100, (ruyaUsed / Math.max(1, plan.capacity.ruya)) * 100)}%` }} />
                    <span className="v">{day.hotels.ruya.pax || '–'}</span>
                  </td>
                  <td className="n cell-araf" data-on={day.hotels.araf.pax > 0}>
                    {day.hotels.araf.pax || '–'}
                  </td>
                  <td className="n cell-c" data-on={day.hotels.c.pax > 0}>
                    {day.hotels.c.pax || '–'}
                  </td>
                  <td className="n total">{day.total || '–'}</td>
                  <td className="n" data-low={free <= 0}>
                    {free}
                  </td>
                  <td className="moves">{day.arrivals.length ? <>+{pax(day.arrivals)} <span>({tours(day.arrivals)})</span></> : ''}</td>
                  <td className="moves">{day.departures.length ? <>−{pax(day.departures)} <span>({tours(day.departures)})</span></> : ''}</td>
                  <td className="why">{reasons.join(' · ')}</td>
                </tr>
                {isOpen ? (
                  <tr className="detail-row">
                    <td colSpan={9}>
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <NightDetail day={day} plan={plan} byId={byId} />
                      </motion.div>
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

function BookingsTable({ plan, byId }: { plan: Plan; byId: Map<string, Group> }) {
  const rows = plan.bookings.flatMap((b) =>
    b.steps.map((step) => ({
      key: `${b.hotel}-${step.from}`,
      hotel: b.hotel,
      ...step,
      ids: b.groupIds.filter((id) => plan.placements[id]?.nights.some((n) => n >= step.from && n <= step.lastNight)),
    })),
  );
  if (!rows.length) return <div className="all-clear">Ruya covers every night. Nothing to book at Araf or Hotel C.</div>;
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead>
          <tr>
            <th scope="col">Hotel</th>
            <th scope="col">First night</th>
            <th scope="col">Last night</th>
            <th scope="col" className="n">
              Nights
            </th>
            <th scope="col" className="n">
              Guests
            </th>
            <th scope="col">Tours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <span className="chip" data-hotel={r.hotel}>
                  {HOTEL_NAME[r.hotel]}
                </span>
              </td>
              <td>{fullDate(r.from)}</td>
              <td>{fullDate(r.lastNight)}</td>
              <td className="n">{nightsBetween(r.from, r.lastNight)}</td>
              <td className="n strong">{r.pax}</td>
              <td>{r.ids.map((id) => byId.get(id)?.tourNo).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- groups ---------------------------------------------------------------------

function RoomsCell({ group, input, placement, onInput }: { group: Group; input: GroupInput; placement: Placement | undefined; onInput: Props['onInput'] }) {
  const parsed = parseRoomSpec(input.spec);
  const typed = Boolean(input.spec?.trim());
  let read: { text: string; bad: boolean } | null = null;
  if (parsed.error) read = { text: parsed.error, bad: true };
  else if (typed) read = { text: `${describeRooms(parsed.rooms)} = ${parsed.beds}`, bad: parsed.beds < group.pax };
  else if (placement?.specSource === 'suggested' && placement.spec) read = { text: `None asked for. Planned as ${describeRooms(placement.spec)}`, bad: false };
  return (
    <div className="rooms-cell" data-bad={read?.bad}>
      <input
        type="text"
        value={input.spec ?? ''}
        placeholder="e.g. 2x6, 3x1"
        aria-label={`Rooms tour ${group.tourNo} needs in Ruya`}
        spellCheck={false}
        onChange={(e) => onInput(group.tourNo, { spec: e.target.value })}
      />
      {read ? <small>{read.text}</small> : null}
    </div>
  );
}

function notesFor(group: Group, placement: Placement | undefined, input: GroupInput): { text: string; warn: boolean }[] {
  const notes: { text: string; warn: boolean }[] = [];
  if (placement) {
    if (placement.overbooked) notes.push({ text: `Does not fit. ${placement.detail}`, warn: true });
    else if (placement.hotel !== 'ruya' || placement.reason === 'pinned') notes.push({ text: `${REASON_LABEL[placement.reason]}. ${placement.reason === 'pinned' ? '' : placement.detail}`.trim(), warn: placement.hotel !== 'ruya' });
    if (placement.specIssue) notes.push({ text: placement.specIssue, warn: true });
    if (placement.staysDepartureDay) notes.push({ text: `Flies ${group.departure.flight ?? 'Iraqi Airways'} from Najaf: departure day counted as a night.`, warn: false });
  }
  const m = input.message;
  if (m && input.spec) {
    if (m.hotelPax !== null && m.hotelPax !== group.pax) notes.push({ text: `Room request says ${m.hotelPax} guests, NKERP has ${group.pax}.`, warn: true });
    if (m.from && m.to && (m.from !== group.checkIn || m.to !== group.checkOut)) notes.push({ text: `Room request says ${rangeLabel(m.from, m.to)}.`, warn: true });
  }
  if (group.paxNkerpHoused > 0) notes.push({ text: `${group.paxNkerpHoused} more on this tour are housed by NKERP.`, warn: false });
  for (const note of group.notes) notes.push({ text: note, warn: false });
  return notes;
}

function GroupsTable({ list, plan, inputs, onInput, onPick }: { list: Group[]; plan: Plan; inputs: Props['inputs']; onInput: Props['onInput']; onPick: (groupId: string) => void }) {
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
            <th scope="col">Hotel</th>
            <th scope="col">Rooms asked for</th>
            <th scope="col">Ruya rooms</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {list.map((group) => {
            const placement = plan.placements[group.id];
            const input = inputs[group.id] ?? {};
            const hotel: HotelId | null = placement?.hotel ?? null;
            const notes = notesFor(group, placement, input);
            return (
              <tr key={group.id} data-flag={Boolean(placement && (placement.hotel !== 'ruya' || placement.overbooked))}>
                <th scope="row" className="tour">
                  {group.tourNo}
                </th>
                <td className="leader">{group.leader || '–'}</td>
                <td className="n strong">
                  {group.pax}
                  {group.infants ? <small> +{group.infants} inf</small> : null}
                </td>
                <td>{dayMonth(group.checkIn)}</td>
                <td>{dayMonth(group.checkOut)}</td>
                <td className="n">{placement ? placement.nights.length : daysBetween(group.checkIn, group.checkOut)}</td>
                <td className="hotel-cell" data-hotel={hotel ?? 'none'} data-overbooked={placement?.overbooked}>
                  <label className="sr" htmlFor={`pin-${group.id}`}>
                    Hotel for tour {group.tourNo}
                  </label>
                  <select
                    id={`pin-${group.id}`}
                    value={input.roomNos?.length ? 'rooms' : (input.pin ?? '')}
                    onChange={(e) => {
                      if (e.target.value === 'rooms') return onPick(group.id);
                      // Choosing a hotel replaces any rooms chosen by hand.
                      onInput(group.tourNo, { pin: (e.target.value || null) as HotelId | null, roomNos: undefined });
                    }}
                  >
                    {input.roomNos?.length ? <option value="rooms">Ruya, rooms by hand</option> : null}
                    <option value="">{hotel && !input.roomNos?.length ? HOTEL_NAME[hotel] : 'Let the planner decide'}</option>
                    {HOTEL_ORDER.map((h) => (
                      <option key={h} value={h}>
                        Keep in {HOTEL_NAME[h]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="rooms">
                  <RoomsCell group={group} input={input} placement={placement} onInput={onInput} />
                </td>
                <td className="room-nos">
                  {placement?.rooms.length ? <span className="room-list">{placement.rooms.map((r) => r.label).join(', ')}</span> : null}
                  {placement?.specSource === 'manual' ? <span className="by-hand">by hand</span> : null}
                  <button type="button" className="pick-btn" onClick={() => onPick(group.id)}>
                    {input.roomNos?.length ? 'Change rooms' : 'Choose rooms'}
                  </button>
                </td>
                <td className="notes">
                  {notes.map((n) => (
                    <span key={n.text} className="note" data-warn={n.warn}>
                      {n.text}
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

// ---- the page --------------------------------------------------------------------

export function PlanView({ groups, plan, meta, inputs, onInput, onOpenRequests }: Props) {
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  // Groups that reached Najaf before the first night are covered by the opening balance (rooms 109, 110, 201, 202).
  const before = new Set(plan.before);
  const planned = groups.filter((g) => !before.has(g.id) && g.pax > 0);
  const { totals } = plan;
  const asked = planned.filter((g) => inputs[g.id]?.spec?.trim()).length;
  const [picking, setPicking] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const pickingGroup = picking ? byId.get(picking) : undefined;
  const otherNights = plan.days.filter((d) => d.hotels.araf.pax + d.hotels.c.pax > 0).length;

  if (!planned.length) {
    return (
      <main className="page">
        <div className="empty">
          <h2>No groups in this range</h2>
          <p>No approved tour in this range has guests who need a hotel. Pull again with other dates, or once more tours are approved in NKERP.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="overview">
        <div className="overview-head">
          <h1>{rangeLabel(plan.range.from, plan.range.to)}</h1>
          <p>
            {groupsText(totals.groups)}, {guests(totals.guests)} who need a hotel.{' '}
            {otherNights ? (
              <>
                Ruya is not enough on <b>{nightsText(otherNights)}</b>.
              </>
            ) : (
              'Ruya covers every night.'
            )}
          </p>
          {meta.notApproved ? (
            <p className="overview-note">
              {meta.notApproved} more {meta.notApproved === 1 ? 'tour' : 'tours'} in this period {meta.notApproved === 1 ? 'is' : 'are'} still pending in NKERP. They join
              the plan once approved.{' '}
              {meta.pending?.length ? (
                <button className="linkish" onClick={() => setShowPending(true)}>
                  See the pending tours
                </button>
              ) : (
                <span>Pull again to see their details.</span>
              )}
            </p>
          ) : null}
        </div>
        <div className="tiles">
          {HOTEL_ORDER.map((hotel) => (
            <HotelTile key={hotel} hotel={hotel} plan={plan} />
          ))}
        </div>
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Daily plan</h2>
          <p>Guests sleeping in each hotel, night by night. Click a night to see who is in which room.</p>
        </div>
        <DailyTable plan={plan} byId={byId} />
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Bookings to make</h2>
          <p>Every run of nights when Ruya alone is not enough.</p>
        </div>
        <BookingsTable plan={plan} byId={byId} />
      </section>

      <section className="block">
        <div className="block-head">
          <h2>Groups</h2>
          <p>
            One row per group. {asked} of {planned.length} have their rooms.{' '}
            <button className="linkish" onClick={onOpenRequests}>
              Paste room requests
            </button>{' '}
            or type them as bed size × rooms (2x6 is six 2-bed rooms). “Choose rooms” picks exact Ruya rooms by hand. Then press{' '}
            <b>Refresh plan</b> to rebuild the plan with them.
          </p>
        </div>
        <GroupsTable list={planned} plan={plan} inputs={inputs} onInput={onInput} onPick={setPicking} />
      </section>

      <AnimatePresence>{showPending && meta.pending ? <PendingTours key="pending" tours={meta.pending} onClose={() => setShowPending(false)} /> : null}</AnimatePresence>
      <AnimatePresence>
        {pickingGroup ? (
          <RoomPicker
            key={pickingGroup.id}
            group={pickingGroup}
            plan={plan}
            groups={groups}
            current={inputs[pickingGroup.id]?.roomNos}
            onSave={(roomNos) => onInput(pickingGroup.tourNo, { roomNos, pin: null })}
            onClose={() => setPicking(null)}
          />
        ) : null}
      </AnimatePresence>
    </main>
  );
}
