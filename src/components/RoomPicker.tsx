import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { OPENING_BALANCE, RUYA_SHEET } from '../../shared/config';
import { dayMonth, rangeLabel } from '../../shared/dates';
import type { Group, Placement, Plan } from '../../shared/types';
import { useNames } from '../lib/names';

interface Props {
  group: Group;
  plan: Plan;
  groups: Group[];
  /** Rooms already chosen by hand for this group, if any. */
  current: string[] | undefined;
  onChange: (roomNos: string[] | undefined) => void;
  onClose: () => void;
}

type Busy = { who: string; fixed: boolean; from: string; to: string };

/** Choose a group's exact Ruya rooms. Rooms held by hand or from November cannot be taken; rooms the planner gave someone else can. */
export function RoomPicker({ group, plan, groups, current, onChange, onClose }: Props) {
  const names = useNames();
  const placement: Placement | undefined = plan.placements[group.id];
  const nights = placement?.nights ?? [];
  const [edited, setEdited] = useState(false);
  const picked = current ?? (!edited && placement?.hotel === 'ruya' ? placement.rooms.map((r) => r.label) : []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inPlan = useMemo(() => new Set(plan.rooms.map((r) => r.label)), [plan.rooms]);
  /** Who else is in each room on any of this group's nights. */
  const busy = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const holds = new Map(OPENING_BALANCE.map((h) => [h.id, h.label]));
    const map = new Map<string, Busy>();
    const mine = new Set(nights);
    for (const p of Object.values(plan.placements)) {
      if (p.groupId === group.id || !p.rooms.length) continue;
      const shared = p.nights.filter((n) => mine.has(n));
      if (!shared.length) continue;
      const fixed = p.reason === 'held' || p.specSource === 'manual';
      const who = byId.get(p.groupId) ? `Tour ${byId.get(p.groupId)?.tourNo}` : (holds.get(p.groupId) ?? 'Taken');
      for (const room of p.rooms) {
        const before = map.get(room.label);
        if (!before || (fixed && !before.fixed)) map.set(room.label, { who, fixed, from: shared[0], to: shared[shared.length - 1] });
      }
    }
    return map;
  }, [plan.placements, groups, group.id, nights]);

  const chosen = new Set(picked);
  const beds = RUYA_SHEET.filter((r) => chosen.has(r.no)).reduce((n, r) => n + r.beds, 0);
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const moves = [...new Set(picked.map((no) => busy.get(no)).filter((b): b is Busy => Boolean(b && !b.fixed)).map((b) => b.who))];
  const changeRooms = (next: string[]) => {
    setEdited(true);
    onChange(next.length ? next : undefined);
  };
  const toggle = (no: string) => changeRooms(chosen.has(no)
    ? picked.filter((n) => n !== no)
    : [...picked, no].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer wide"
        role="dialog"
        aria-modal="true"
        aria-label={`${names.ruya} rooms for tour ${group.tourNo}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="drawer-head">
          <h2>Rooms for tour {group.tourNo}</h2>
          <button className="btn quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">
          <section className="set">
            <p>
              {group.leader ? `${group.leader}, ` : ''}
              {group.pax} guests, {nights.length ? rangeLabel(nights[0], nights[nights.length - 1]) : 'no nights'} ({nights.length}{' '}
              {nights.length === 1 ? 'night' : 'nights'}). Room choices save as you make them. Rooms marked with a tour are taken on some of these nights.
            </p>
            <div className="floors picker">
              {floors.map((floor) => (
                <div className="floor" key={floor}>
                  <span className="floor-name">Floor {floor}</span>
                  <div className="floor-rooms">
                    {RUYA_SHEET.filter((r) => r.floor === floor).map((room) => {
                      const out = !inPlan.has(room.no);
                      const b = busy.get(room.no);
                      const blocked = out || Boolean(b?.fixed);
                      const on = chosen.has(room.no);
                      return (
                        <button
                          key={room.no}
                          type="button"
                          className="pick"
                          data-on={on}
                          data-out={out}
                          data-fixed={Boolean(b?.fixed)}
                          data-soft={Boolean(b && !b.fixed)}
                          disabled={blocked && !on}
                          aria-pressed={on}
                          title={
                            out
                              ? `Room ${room.no}: not in the plan`
                              : b
                                ? `Room ${room.no}: ${b.who}, ${rangeLabel(b.from, b.to)}${b.fixed ? ' (fixed)' : ' (the planner will move them)'}`
                                : `Room ${room.no}: free on every night`
                          }
                          onClick={() => toggle(room.no)}
                        >
                          <b>{room.no}</b>
                          {b && !out ? <span className="pick-who">{b.who.replace('Tour ', '')}</span> : null}
                          <span>{room.beds} beds</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <ul className="pick-key">
              <li>
                <i className="k-free" /> free
              </li>
              <li>
                <i className="k-soft" /> planned for another tour, which will be moved
              </li>
              <li>
                <i className="k-fixed" /> chosen by hand or from November, cannot be taken
              </li>
            </ul>
          </section>
          <section className="set pick-foot">
            <p>
              {picked.length ? (
                <>
                  <b>{picked.join(', ')}</b> · {beds} beds for {group.pax} guests
                </>
              ) : (
                'No rooms chosen.'
              )}
            </p>
            {picked.length && beds < group.pax ? <p className="pick-warn">These rooms sleep {beds}; the group is {group.pax}.</p> : null}
            {moves.length ? <p className="pick-note">{moves.join(', ')} will be moved to other rooms or to {names.araf}.</p> : null}
            {current?.length ? (
              <div className="room-actions">
                <button className="btn" onClick={() => changeRooms([])}>
                  Let the planner choose
                </button>
              </div>
            ) : null}
            {nights.length ? <p className="pick-small">Checked against every night from {dayMonth(nights[0])} to {dayMonth(nights[nights.length - 1])}.</p> : null}
          </section>
        </div>
      </motion.aside>
    </>
  );
}
