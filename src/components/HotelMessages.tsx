import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { dayLabel } from '../../shared/dates';
import { HOTEL_ORDER } from '../../shared/engine';
import { hotelMessage, type HotelMessage } from '../../shared/messages';
import type { Group, HotelId, Plan } from '../../shared/types';
import { useNames } from '../lib/names';
import { copy } from '../lib/copy';
import { load, save } from '../lib/storage';

const KIND_KEY = 'njf.messageKind.v1';

interface Props {
  groups: Group[];
  plan: Plan;
  onClose: () => void;
}

type Item = HotelMessage & { hotel: HotelId; leader: string };

/** The room-request messages to send to the hotels, one per group, by arrival date. */
export function HotelMessages({ groups, plan, onClose }: Props) {
  const names = useNames();
  const [hotel, setHotel] = useState<HotelId | 'all'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [kind, setKind] = useState<'plain' | 'rooms'>(() => (load<string>(KIND_KEY, 'plain') === 'rooms' ? 'rooms' : 'plain'));
  useEffect(() => save(KIND_KEY, kind), [kind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = useMemo(() => {
    const list: Item[] = [];
    for (const g of groups) {
      const p = plan.placements[g.id];
      const m = p ? hotelMessage(g, p, { roomNumbers: kind === 'rooms' }) : null;
      if (p && m) list.push({ ...m, hotel: p.hotel, leader: g.leader });
    }
    return list.sort(
      (a, b) => a.from.localeCompare(b.from) || HOTEL_ORDER.indexOf(a.hotel) - HOTEL_ORDER.indexOf(b.hotel) || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true }),
    );
  }, [groups, plan, kind]);
  const shown = hotel === 'all' ? items : items.filter((m) => m.hotel === hotel);
  const byDate = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const m of shown) map.set(m.from, [...(map.get(m.from) ?? []), m]);
    return [...map];
  }, [shown]);

  const flash = async (key: string, text: string) => {
    if (await copy(text)) {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    }
  };

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer wide"
        role="dialog"
        aria-modal="true"
        aria-label="Hotel messages"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="drawer-head">
          <h2>Hotel messages</h2>
          <button className="btn quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">
          <section className="set">
            <p>One message per group, ready to send to its hotel, by the day the group checks in. Copy one, or every message for a day.</p>
            <div className="msg-kind" role="radiogroup" aria-label="Message type">
              {(
                [
                  ['plain', 'Requirements only', 'Bed sizes and number of rooms'],
                  ['rooms', 'With room numbers', 'Adds the rooms planned for each line'],
                ] as const
              ).map(([id, label, hint]) => (
                <button key={id} type="button" role="radio" aria-checked={kind === id} className="kind" onClick={() => setKind(id)}>
                  <b>{label}</b>
                  <span>{hint}</span>
                </button>
              ))}
            </div>
            <div className="msg-filter" role="group" aria-label="Hotel">
              {(['all', ...HOTEL_ORDER] as const).map((id) => {
                const count = id === 'all' ? items.length : items.filter((m) => m.hotel === id).length;
                return (
                  <button key={id} type="button" className="chip-btn" data-hotel={id === 'all' ? undefined : id} aria-pressed={hotel === id} disabled={!count} onClick={() => setHotel(id)}>
                    {id === 'all' ? 'All hotels' : names[id]} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {byDate.length ? (
            byDate.map(([date, list]) => {
              const key = `day-${date}`;
              return (
                <section className="msg-day" key={date}>
                  <div className="msg-day-head">
                    <h3>{dayLabel(date)}</h3>
                    <span>
                      {list.length} {list.length === 1 ? 'message' : 'messages'}
                    </span>
                    {list.length > 1 ? (
                      <button className="btn" onClick={() => flash(key, list.map((m) => m.text).join('\n\n'))}>
                        {copied === key ? 'Copied' : `Copy all ${list.length}`}
                      </button>
                    ) : null}
                  </div>
                  {list.map((m) => (
                    <article className="msg" key={m.groupId} data-hotel={m.hotel}>
                      <div className="msg-head">
                        <span className="chip" data-hotel={m.hotel}>
                          {names[m.hotel]}
                        </span>
                        <b>Tour {m.tourNo}</b>
                        <span className="msg-who">{m.leader}</span>
                        <button className="btn solid msg-copy" data-done={copied === m.groupId} onClick={() => flash(m.groupId, m.text)}>
                          {copied === m.groupId ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      {m.rooms ? null : <p className="msg-warn">No rooms yet: type or choose them in the Groups table.</p>}
                      {kind === 'rooms' && m.rooms && !m.numbered ? (
                        <p className="msg-note">No room numbers: the plan only numbers {names.ruya} rooms.</p>
                      ) : null}
                      <pre className="msg-text">{m.text}</pre>
                    </article>
                  ))}
                </section>
              );
            })
          ) : (
            <p className="read-empty">No messages for this hotel.</p>
          )}
        </div>
      </motion.aside>
    </>
  );
}
