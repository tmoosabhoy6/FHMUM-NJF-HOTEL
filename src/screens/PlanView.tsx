import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HOTEL_NAME, HOTEL_ORDER } from '../../shared/engine';
import { dayMonth, dayNumber, daysBetween, fullDate, monthShort, rangeLabel, weekdayLong, weekdayShort } from '../../shared/dates';
import type { Booking, DayRow, Group, HotelId, Placement, Plan } from '../../shared/types';
import { Chevron, guests, groupsText, nightsText, Num, tint } from '../components/ui';

interface Props {
  groups: Group[];
  plan: Plan;
  date: string;
  onDate: (date: string) => void;
  onOpenSettings: () => void;
  onOpenGroups: () => void;
}

const SHORT_REASON: Partial<Record<Placement['reason'], string>> = {
  'room-mix': 'Rooms not available in Ruya',
  'ruya-full': 'Ruya full',
  'araf-full': 'Ruya and Araf full',
  pinned: 'Kept by hand',
  held: 'Opening balance',
};

function BookingCard({ booking, tours, onOpen }: { booking: Booking; tours: string; onOpen: () => void }) {
  const checkout = rangeLabel(booking.from, booking.lastNight);
  return (
    <motion.button
      layout
      className="booking"
      data-hotel={booking.hotel}
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="booking-hotel">Book {HOTEL_NAME[booking.hotel]}</div>
      <div className="booking-dates">{checkout}</div>
      <div className="booking-meta">
        {nightsText(booking.nights)} · up to {guests(booking.peak)} · tours {tours}
      </div>
      {booking.steps.length > 1 ? (
        <ul className="booking-steps">
          {booking.steps.map((step) => (
            <li key={step.from}>
              <span>{rangeLabel(step.from, step.lastNight)}</span>
              <b>{guests(step.pax)}</b>
            </li>
          ))}
        </ul>
      ) : null}
    </motion.button>
  );
}

/** One lane per hotel, one column per night. Click a night to open it. */
function Ledger({ plan, date, onDate, byId }: { plan: Plan; date: string; onDate: (d: string) => void; byId: Map<string, Group> }) {
  const scroller = useRef<HTMLDivElement>(null);
  // One scale for all three lanes, so bar heights compare across hotels.
  const top = Math.max(plan.capacity.ruya, plan.capacity.araf, plan.totals.byHotel.ruya.peak, plan.totals.byHotel.araf.peak, 1);
  const unit = 96 / top;
  const PAD = 40; // room for the number above the bar and the gap below it
  const laneMax: Record<HotelId, number> = {
    ruya: Math.max(plan.capacity.ruya, plan.totals.byHotel.ruya.peak),
    araf: Math.max(plan.capacity.araf, plan.totals.byHotel.araf.peak),
    c: Math.max(30, Math.min(plan.totals.byHotel.c.peak, top * 1.6)),
  };
  const laneHeight = (h: HotelId) => Math.round(laneMax[h] * unit) + PAD;
  const capOf = (h: HotelId) => (h === 'ruya' ? plan.capacity.ruya : h === 'araf' ? plan.capacity.araf : null);
  const lanes = { '--lane-ruya': `${laneHeight('ruya')}px`, '--lane-araf': `${laneHeight('araf')}px`, '--lane-c': `${laneHeight('c')}px` } as CSSProperties;

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [date]);

  const sum = (ids: string[]) => ids.reduce((total, id) => total + (byId.get(id)?.pax ?? 0), 0);

  return (
    <div className="ledger" style={lanes}>
      <div className="ledger-labels">
        <div className="ledger-head-space" />
        {HOTEL_ORDER.map((h) => (
          <div key={h} className={`lane-label lane-${h}`} data-hotel={h}>
            {capOf(h) ? (
              <span className="cap-tick" style={{ bottom: 10 + Math.round((capOf(h) as number) * unit) }}>
                {capOf(h)}
              </span>
            ) : null}
            <b>{HOTEL_NAME[h]}</b>
            <span>{h === 'ruya' ? `${plan.capacity.ruya} beds` : h === 'araf' ? `${plan.capacity.araf} beds` : 'no limit'}</span>
          </div>
        ))}
        <div className="moves-label">
          In
          <br />
          Out
        </div>
      </div>
      <div className="ledger-scroll" ref={scroller}>
        <div className="ledger-track" role="tablist" aria-label="Nights">
          {plan.days.map((day, i) => {
            const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
            const monthStart = i === 0 || day.date.endsWith('-01');
            const arriving = sum(day.arrivals);
            const leaving = sum(day.departures);
            return (
              <button
                key={day.date}
                role="tab"
                className="col"
                data-date={day.date}
                data-weekend={weekday === 5}
                data-month-start={monthStart && i > 0}
                aria-selected={day.date === date}
                aria-label={`${weekdayLong(day.date)} ${fullDate(day.date)}: Ruya ${day.hotels.ruya.pax}, Araf ${day.hotels.araf.pax}, Hotel C ${day.hotels.c.pax}`}
                onClick={() => onDate(day.date)}
                style={{ '--i': Math.min(i, 60) } as CSSProperties}
              >
                <div className="col-head">
                  <span className="col-month">{monthStart ? monthShort(day.date) : ''}</span>
                  <span>{weekdayShort(day.date)}</span>
                  <b>{dayNumber(day.date)}</b>
                </div>
                {HOTEL_ORDER.map((h) => {
                  const cell = day.hotels[h];
                  const cap = capOf(h);
                  const px = cell.pax ? Math.max(4, Math.round(Math.min(cell.pax, laneMax[h]) * unit)) : 0;
                  const full = cap !== null && cell.pax >= cap;
                  return (
                    <div key={h} className={`lane lane-${h}`} data-hotel={h}>
                      {cap ? <span className="cap-line" style={{ bottom: 10 + Math.round(cap * unit) }} /> : null}
                      {cell.pax ? (
                        <>
                          <span className="bar-n">{cell.pax}</span>
                          <span className="bar" data-full={full} style={{ height: px }} />
                        </>
                      ) : (
                        <span className="lane-zero" />
                      )}
                    </div>
                  );
                })}
                <div className="moves">
                  <span className="in">{arriving ? `+${arriving}` : '·'}</span>
                  <span className="out">{leaving ? `−${leaving}` : '·'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StayItem({ group, placement, date, active, onHover }: { group: Group; placement: Placement; date: string; active: boolean; onHover: (id: string | null) => void }) {
  const last = placement.nights[placement.nights.length - 1];
  const left = daysBetween(date, group.checkOut);
  return (
    <li className="stay" data-active={active} onMouseEnter={() => onHover(group.id)} onMouseLeave={() => onHover(null)}>
      <span className="stay-tour">{group.tourNo}</span>
      <span className="stay-who" title={group.leader}>
        {group.leader}
      </span>
      <span className="stay-pax">{group.pax}</span>
      <div className="stay-line">
        <span>{rangeLabel(group.checkIn, group.checkOut)}</span>
        {group.checkIn === date ? <span className="tag teal">arrives today</span> : null}
        {date === last ? (
          <span className="tag">{placement.staysDepartureDay ? 'flies out today' : 'last night'}</span>
        ) : left > 0 ? (
          <span>· leaves in {left} {left === 1 ? 'day' : 'days'}</span>
        ) : null}
        {placement.staysDepartureDay && date !== last ? <span className="tag gold">+ departure day</span> : null}
        {placement.hotel !== 'ruya' || placement.overbooked ? (
          <span className={`tag ${placement.hotel === 'c' ? 'rose' : 'gold'}`} title={placement.detail}>
            {placement.overbooked ? 'Does not fit' : SHORT_REASON[placement.reason]}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function RoomBoard({ plan, day, byId, hot, onHover }: { plan: Plan; day: DayRow; byId: Map<string, Group>; hot: string | null; onHover: (id: string | null) => void }) {
  const occupant = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of day.hotels.ruya.groups) for (const room of plan.placements[id]?.rooms ?? []) map.set(room.id, id);
    return map;
  }, [plan, day]);
  const sizes = useMemo(() => [...new Set(plan.rooms.map((r) => r.beds))].sort((a, b) => a - b), [plan.rooms]);
  const free = plan.rooms.length - occupant.size;
  return (
    <div className="board">
      <div className="board-title">
        <b>Rooms tonight</b>
        <span>
          {occupant.size} in use · {free} free
        </span>
      </div>
      {sizes.map((beds) => (
        <div className="board-size" key={beds}>
          <span>{beds}-bed</span>
          <div className="board-rooms">
            {plan.rooms
              .filter((r) => r.beds === beds)
              .map((room) => {
                const id = occupant.get(room.id);
                const group = id ? byId.get(id) : undefined;
                const colour = id ? tint(id) : null;
                return (
                  <span
                    key={room.id}
                    className="room"
                    data-taken={Boolean(id)}
                    data-hot={Boolean(id) && hot === id}
                    data-dim={hot !== null && hot !== id}
                    style={colour ? ({ '--tint': colour.background, '--tint-ink': colour.ink } as CSSProperties) : undefined}
                    title={group ? `Room ${room.label}: tour ${group.tourNo}, ${group.leader}, ${guests(group.pax)}` : `Room ${room.label}: free`}
                    onMouseEnter={() => onHover(id ?? null)}
                    onMouseLeave={() => onHover(null)}
                  >
                    <b>{group ? group.tourNo : 'free'}</b>
                    {room.label}
                  </span>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanView({ groups, plan, date, onDate, onOpenSettings, onOpenGroups }: Props) {
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const [hot, setHot] = useState<string | null>(null);
  const index = Math.max(0, plan.days.findIndex((d) => d.date === date));
  const day = plan.days[index];
  const previous = useRef(index);
  const direction = index >= previous.current ? 1 : -1;
  useEffect(() => {
    previous.current = index;
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|SELECT|TEXTAREA/.test(target.tagName)) return;
      if (e.key === 'ArrowLeft' && index > 0) onDate(plan.days[index - 1].date);
      if (e.key === 'ArrowRight' && index < plan.days.length - 1) onDate(plan.days[index + 1].date);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, plan.days, onDate]);

  if (!day || !groups.length) {
    return (
      <main className="page">
        <div className="empty">
          <h2>Nothing to plan yet</h2>
          <p>There are no groups in this range. Pull again with an earlier first night, or once more tours are approved in NKERP.</p>
          <button className="btn" onClick={onOpenGroups}>
            Back to groups
          </button>
        </div>
      </main>
    );
  }

  const sum = (ids: string[]) => ids.reduce((total, id) => total + (byId.get(id)?.pax ?? 0), 0);
  const tours = (ids: string[]) => ids.map((id) => byId.get(id)?.tourNo ?? '?').join(', ');
  const { totals } = plan;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{rangeLabel(plan.range.from, plan.range.to)}</h1>
          <p>
            {groupsText(totals.groups)}, {guests(totals.guests)}. Ruya takes {groupsText(totals.byHotel.ruya.groups)}
            {totals.byHotel.araf.groups ? `, Araf ${totals.byHotel.araf.groups}` : ''}
            {totals.byHotel.c.groups ? `, Hotel C ${totals.byHotel.c.groups}` : ''}.
          </p>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>
        <h2>Bookings to make</h2>
        <p>Every run of nights when Ruya alone is not enough.</p>
      </div>
      {plan.bookings.length ? (
        <div className="bookings">
          <AnimatePresence>
            {plan.bookings.map((b) => (
              <BookingCard key={`${b.hotel}-${b.from}`} booking={b} tours={tours(b.groupIds)} onOpen={() => onDate(b.from)} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="all-ruya">Ruya covers every night in this range. Nothing to book at Araf or Hotel C.</div>
      )}

      <div className="section-title">
        <h2>Night by night</h2>
        <p>Guests sleeping in each hotel. Pick a night to see who and which rooms.</p>
      </div>
      <Ledger plan={plan} date={day.date} onDate={onDate} byId={byId} />

      <section className="day" aria-live="polite">
        <div className="day-bar">
          <button className="round" aria-label="Previous night" disabled={index === 0} onClick={() => onDate(plan.days[index - 1].date)}>
            <Chevron dir="left" size={16} />
          </button>
          <h2>
            {weekdayShort(day.date)} {dayMonth(day.date)}
          </h2>
          <button className="round" aria-label="Next night" disabled={index === plan.days.length - 1} onClick={() => onDate(plan.days[index + 1].date)}>
            <Chevron dir="right" size={16} />
          </button>
          <div className="day-moves">
            <span>
              <b>{sum(day.arrivals)}</b> arriving{day.arrivals.length ? ` (${tours(day.arrivals)})` : ''}
            </span>
            <span>
              <b>{sum(day.departures)}</b> leaving{day.departures.length ? ` (${tours(day.departures)})` : ''}
            </span>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={day.date}
            className="day-cols"
            initial={{ opacity: 0, x: 28 * direction }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 * direction }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {HOTEL_ORDER.map((h) => {
              const cell = day.hotels[h];
              const cap = h === 'ruya' ? plan.capacity.ruya : h === 'araf' ? plan.capacity.araf : null;
              const list = cell.groups.map((id) => byId.get(id)).filter((g): g is Group => Boolean(g));
              const heldPax = cell.pax - list.reduce((s, g) => s + g.pax, 0);
              return (
                <div key={h} className="hotel-card" data-hotel={h}>
                  <div className="hotel-card-head">
                    <h3>{HOTEL_NAME[h]}</h3>
                    <span className="hotel-count">
                      <b>
                        <Num value={cell.pax} />
                      </b>
                      {cap ? `of ${cap}` : cell.pax === 1 ? 'guest' : 'guests'}
                    </span>
                  </div>
                  {cap ? (
                    <div className="meter">
                      <i style={{ width: `${Math.min(100, (cell.pax / cap) * 100)}%` }} />
                    </div>
                  ) : null}
                  {cap ? (
                    <div className="hotel-note">
                      {cell.pax > cap
                        ? `Over by ${cell.pax - cap}`
                        : h === 'ruya' && plan.rooms.length
                          ? `${cap - cell.beds} beds free${cell.beds > cell.pax ? ` · ${cell.beds - cell.pax} blocked but empty` : ''}`
                          : `${cap - cell.pax} beds free`}
                    </div>
                  ) : (
                    <div className="hotel-note">{cell.pax ? 'Needs booking for tonight' : 'Not needed tonight'}</div>
                  )}
                  {list.length ? (
                    <ul className="stays">
                      {list.map((g) => (
                        <StayItem key={g.id} group={g} placement={plan.placements[g.id]} date={day.date} active={hot === g.id} onHover={setHot} />
                      ))}
                    </ul>
                  ) : (
                    <div className="nobody">Nobody here tonight</div>
                  )}
                  {heldPax > 0 ? <div className="hotel-note">Plus {guests(heldPax)} from the opening balance.</div> : null}
                  {h === 'ruya' ? (
                    plan.rooms.length ? (
                      <RoomBoard plan={plan} day={day} byId={byId} hot={hot} onHover={setHot} />
                    ) : (
                      <div className="board-empty">
                        Room numbers appear here once Ruya’s room list is added.{' '}
                        <button className="linkish" style={{ color: 'var(--ruya-ink)' }} onClick={onOpenSettings}>
                          Add the room list
                        </button>
                      </div>
                    )
                  ) : null}
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </section>
    </main>
  );
}
