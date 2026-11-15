import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { HOTEL_NAME, HOTEL_ORDER, REASON_LABEL } from '../../shared/engine';
import { clock, dayLabel, dayMonth, rangeLabel } from '../../shared/dates';
import { describeRooms, parseRoomSpec } from '../../shared/roomSpec';
import type { Group, GroupInput, HotelId, Placement, Plan } from '../../shared/types';
import { Chevron, guests, groupsText, nightsText } from '../components/ui';

interface Props {
  groups: Group[];
  plan: Plan;
  from: string;
  inputs: Record<string, GroupInput | undefined>;
  onInput: (group: Group, patch: GroupInput) => void;
  onOpenPlan: () => void;
  onOpenSettings: () => void;
}

type Filter = 'all' | HotelId | 'look';

function route(group: Group): string {
  const arrive =
    group.arrival.kind === 'transfer'
      ? `From ${titleCase(group.arrival.place) || 'Karbala'}`
      : group.arrival.kind === 'airport'
        ? `Lands ${group.arrival.place}`
        : 'Arrival not listed';
  const leave =
    group.departure.kind === 'airport'
      ? `flies ${group.departure.place}${group.departure.flight ? ` ${group.departure.flight}` : ''}`
      : group.departure.kind === 'transfer'
        ? `goes on to ${titleCase(group.departure.place) || 'Karbala'}`
        : 'departure not listed';
  return `${arrive}, ${leave}`;
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

function Row({ group, placement, input, onInput }: { group: Group; placement: Placement; input: GroupInput; onInput: Props['onInput'] }) {
  const parsed = parseRoomSpec(input.spec);
  const typed = Boolean(input.spec?.trim());
  let read: { text: string; tone: '' | 'ok' | 'warn' } = { text: '', tone: '' };
  if (parsed.error) read = { text: parsed.error, tone: 'warn' };
  else if (typed && parsed.beds < group.pax) read = { text: `${describeRooms(parsed.rooms)} sleeps ${parsed.beds}, the group is ${group.pax}`, tone: 'warn' };
  else if (typed) read = { text: `${describeRooms(parsed.rooms)} · sleeps ${parsed.beds}`, tone: 'ok' };
  else if (placement.specSource === 'suggested' && placement.spec) read = { text: `Suggested: ${describeRooms(placement.spec)}`, tone: '' };

  const why = placement.hotel !== 'ruya' || placement.overbooked || placement.reason === 'pinned';
  return (
    <div className="g-row" data-hotel={placement.hotel}>
      <div className="g-tour">{group.tourNo}</div>
      <div className="g-who">
        <b title={group.leader}>{group.leader || 'Leader not listed'}</b>
        <span>{route(group)}</span>
      </div>
      <div className="g-guests">
        {group.pax}
        <small>{group.pax === group.paxTotal ? 'guests' : `of ${group.paxTotal}`}</small>
      </div>
      <div className="g-stay">
        <b>{rangeLabel(group.checkIn, group.checkOut)}</b>
        <span className="g-sub"> · {nightsText(placement.nights.length)}</span>
        <div className="g-tags">
          {placement.staysDepartureDay ? (
            <span className="tag gold" title="Second half of the trip, flying Iraqi Airways from Najaf: the departure day counts as a night.">
              + departure day · {group.departure.flight}
            </span>
          ) : (
            <span className="g-sub">
              {clock(group.arrivalAt) ? `in ${clock(group.arrivalAt)}` : ''}
              {clock(group.departureAt) ? ` · out ${clock(group.departureAt)}` : ''}
            </span>
          )}
          {placement.carriedOver ? <span className="tag">already in Najaf</span> : null}
        </div>
      </div>
      <div className="spec" data-bad={read.tone === 'warn'}>
        <label className="sr" htmlFor={`spec-${group.id}`}>
          Rooms tour {group.tourNo} needs in Ruya
        </label>
        <input
          id={`spec-${group.id}`}
          value={input.spec ?? ''}
          placeholder="Rooms needed, e.g. 5x2"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onInput(group, { spec: e.target.value })}
        />
        <div className={`spec-read ${read.tone}`}>{read.text}</div>
      </div>
      <div className="where" data-hotel={placement.hotel}>
        <span className="hotel-pill">
          <i />
          {HOTEL_NAME[placement.hotel]}
          {input.pin ? ' · kept' : ''}
          <Chevron />
          <select
            aria-label={`Hotel for tour ${group.tourNo}`}
            value={input.pin ?? ''}
            onChange={(e) => onInput(group, { pin: (e.target.value || null) as HotelId | null })}
          >
            <option value="">Let the planner decide</option>
            {HOTEL_ORDER.map((h) => (
              <option key={h} value={h}>
                Keep in {HOTEL_NAME[h]}
              </option>
            ))}
          </select>
        </span>
        {why ? (
          <div className="where-why" title={placement.detail}>
            <b>{placement.overbooked ? 'Does not fit' : REASON_LABEL[placement.reason]}</b>
            {placement.reason !== 'pinned' ? <> · {placement.detail}</> : null}
          </div>
        ) : placement.rooms.length ? (
          <div className="where-why">Rooms {placement.rooms.map((r) => r.label).join(', ')}</div>
        ) : null}
        {group.notes.length ? (
          <div className="where-why" style={{ color: 'var(--c-ink)' }}>
            {group.notes.join(' ')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Groups({ groups, plan, from, inputs, onInput, onOpenPlan, onOpenSettings }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const hasRooms = plan.rooms.length > 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      const p = plan.placements[g.id];
      if (!p) return false;
      if (filter === 'look' && !(p.hotel !== 'ruya' || p.overbooked || p.specIssue || g.notes.length)) return false;
      if (filter !== 'all' && filter !== 'look' && p.hotel !== filter) return false;
      return !q || g.tourNo.includes(q) || g.leader.toLowerCase().includes(q);
    });
  }, [groups, plan, filter, query]);

  const sections = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of shown) {
      const key = g.checkIn < from ? 'before' : g.checkIn;
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return [...map];
  }, [shown, from]);

  const { totals } = plan;
  const chip = (id: Filter, label: string, count: number, hotel?: HotelId) => (
    <button key={id} className="split-chip" data-hotel={hotel} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? 'all' : id)}>
      {hotel ? <i /> : null}
      <b>{count}</b> {label}
    </button>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>
            {groupsText(totals.groups)}, {guests(totals.guests)}
          </h1>
          <p>
            Type the rooms each group needs in Ruya. The plan updates as you type: a group that cannot get those exact rooms for
            its whole stay moves to Araf together, never split.
          </p>
        </div>
        <button className="btn solid" onClick={onOpenPlan}>
          See the plan by day
        </button>
      </div>

      <div className="toolbar">
        <div className="hotel-split" role="group" aria-label="Show groups by hotel">
          {HOTEL_ORDER.map((h) => chip(h, `in ${HOTEL_NAME[h]}`, totals.byHotel[h].groups, h))}
          {chip('look', 'not in Ruya or need a look', groups.filter((g) => {
            const p = plan.placements[g.id];
            return p && (p.hotel !== 'ruya' || p.overbooked || p.specIssue || g.notes.length);
          }).length)}
        </div>
        <input className="search" type="search" placeholder="Find a tour or leader" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a tour or leader" />
      </div>

      {!hasRooms ? (
        <p className="g-sub" style={{ marginBottom: 4 }}>
          Ruya’s room list has not been added yet, so Ruya is planned by head count ({plan.capacity.ruya} beds).{' '}
          <button className="linkish" style={{ color: 'var(--ruya-ink)' }} onClick={onOpenSettings}>
            Add the room list
          </button>
        </p>
      ) : null}

      {sections.length === 0 ? (
        <div className="empty">
          <h2>{groups.length ? 'No group matches' : 'No groups in this range'}</h2>
          <p>
            {groups.length
              ? 'Clear the filter or the search to see every group.'
              : 'NKERP has no approved FH Mumbai group arranging its own hotel in Najaf for these dates yet. Pull again with an earlier first night, or once more tours are approved.'}
          </p>
          {groups.length ? (
            <button className="btn" onClick={() => { setFilter('all'); setQuery(''); }}>
              Show every group
            </button>
          ) : null}
        </div>
      ) : (
        sections.map(([key, list], s) => (
          <motion.section
            className="day-group"
            key={key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: Math.min(s, 8) * 0.045, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="day-group-head">
              <h2>{key === 'before' ? `Already in Najaf on ${dayMonth(from)}` : `Arriving ${dayLabel(key)}`}</h2>
              <span>
                {groupsText(list.length)} · {guests(list.reduce((sum, g) => sum + g.pax, 0))}
              </span>
            </div>
            {list.map((g) => (
              <Row key={g.id} group={g} placement={plan.placements[g.id]} input={inputs[g.id] ?? {}} onInput={onInput} />
            ))}
          </motion.section>
        ))
      )}
    </main>
  );
}
