import { useMemo, type CSSProperties } from 'react';
import { OPENING_BALANCE, RUYA_SHEET } from '../../shared/config';
import { dayNumber, monthShort, rangeLabel, weekdayShort } from '../../shared/dates';
import type { Group, HotelId, Plan } from '../../shared/types';
import { useNames } from '../lib/names';
import { guests, hueStyle, TourTag } from './ui';

interface Bar {
  id: string;
  start: number;
  span: number;
  from: string;
  to: string;
  group: Group | undefined;
  label: string;
  pax: number;
}

/** Every Ruya room against every night: each tour's stay is a bar in its tag colour. Groups in the other hotels follow, one row each. */
export function StayBoard({ plan, byId, onPick }: { plan: Plan; byId: Map<string, Group>; onPick: (groupId: string) => void }) {
  const names = useNames();
  const dates = useMemo(() => plan.days.map((d) => d.date), [plan.days]);
  const { byRoom, lanes } = useMemo(() => {
    const col = new Map(dates.map((d, i) => [d, i]));
    const holds = new Map(OPENING_BALANCE.map((h) => [h.id, h]));
    const byRoom = new Map<string, Bar[]>();
    const lanes: Record<HotelId, Bar[]> = { ruya: [], araf: [], c: [] };
    for (const p of Object.values(plan.placements)) {
      const nights = p.nights.filter((n) => col.has(n)).sort();
      if (!nights.length) continue;
      const group = byId.get(p.groupId);
      const hold = holds.get(p.groupId);
      const bar: Bar = {
        id: p.groupId,
        start: col.get(nights[0])!,
        span: nights.length,
        from: nights[0],
        to: nights[nights.length - 1],
        group,
        label: group?.tourNo ?? 'Nov',
        pax: group?.pax ?? hold?.pax ?? 0,
      };
      if (p.hotel === 'ruya' && p.rooms.length) for (const room of p.rooms) byRoom.set(room.label, [...(byRoom.get(room.label) ?? []), bar]);
      else if (group) lanes[p.hotel].push(bar);
    }
    for (const list of Object.values(lanes)) list.sort((a, b) => a.start - b.start || a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { byRoom, lanes };
  }, [plan.placements, dates, byId]);

  const inPlan = new Set(plan.rooms.map((r) => r.label));
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const holdLabel = new Map(OPENING_BALANCE.map((h) => [h.id, h.label]));
  const stay = (bar: Bar) => `${rangeLabel(bar.from, bar.to)}, ${bar.span} ${bar.span === 1 ? 'night' : 'nights'}`;

  return (
    <div className="sb-scroll" data-scroll={dates.length > 42} tabIndex={0} role="region" aria-label={`${names.ruya} rooms by night`}>
      <div className="sb" style={{ '--n': dates.length } as CSSProperties}>
        <div className="sb-row sb-dates">
          <div className="sb-label">Room</div>
          <div className="sb-track">
            {dates.map((d, i) => (
              <span key={d} className="sb-date" data-fri={new Date(`${d}T00:00:00Z`).getUTCDay() === 5}>
                <em>{i === 0 || d.endsWith('-01') ? monthShort(d) : ''}</em>
                <b>{dayNumber(d)}</b>
                <small>{weekdayShort(d).slice(0, 2)}</small>
              </span>
            ))}
          </div>
        </div>

        {floors.map((floor) => (
          <div className="sb-floor" key={floor}>
            <div className="sb-band">
              <span>
                {names.ruya} · floor {floor}
              </span>
            </div>
            {RUYA_SHEET.filter((r) => r.floor === floor).map((room) => {
              const out = !inPlan.has(room.no);
              return (
                <div className="sb-row" key={room.no} data-out={out}>
                  <div className="sb-label">
                    <b>{room.no}</b>
                    <small>{out ? 'left out' : `${room.beds} beds`}</small>
                  </div>
                  <div className="sb-track">
                    {(byRoom.get(room.no) ?? []).map((bar) =>
                      bar.group ? (
                        <button
                          key={bar.id}
                          type="button"
                          className="sb-bar"
                          style={{ gridColumn: `${bar.start + 1} / span ${bar.span}`, ...hueStyle(bar.label) }}
                          title={`Tour ${bar.label} · ${bar.group.leader || 'no leader'} · ${guests(bar.pax)} · ${stay(bar)}. Click to choose its rooms.`}
                          onClick={() => onPick(bar.id)}
                        >
                          <b>{bar.label}</b>
                        </button>
                      ) : (
                        <span key={bar.id} className="sb-bar held" style={{ gridColumn: `${bar.start + 1} / span ${bar.span}` }} title={`${holdLabel.get(bar.id) ?? 'Taken'} · ${stay(bar)}`}>
                          <b>{bar.label}</b>
                        </span>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {(['araf', 'c'] as const).map((hotel) =>
          lanes[hotel].length ? (
            <div className="sb-floor" key={hotel} data-hotel={hotel}>
              <div className="sb-band">
                <span>
                  {names[hotel]} · {lanes[hotel].length} {lanes[hotel].length === 1 ? 'group' : 'groups'}
                </span>
              </div>
              {lanes[hotel].map((bar) => (
                <div className="sb-row" key={bar.id}>
                  <div className="sb-label">
                    <TourTag no={bar.label} />
                  </div>
                  <div className="sb-track">
                    <button
                      type="button"
                      className="sb-bar lane"
                      data-hotel={hotel}
                      style={{ gridColumn: `${bar.start + 1} / span ${bar.span}` }}
                      title={`Tour ${bar.label} · ${bar.group?.leader || 'no leader'} · ${guests(bar.pax)} in ${names[hotel]} · ${stay(bar)}. Click to choose ${names.ruya} rooms by hand.`}
                      onClick={() => onPick(bar.id)}
                    >
                      <b>{bar.pax}</b>
                      <span>{bar.group?.leader}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
