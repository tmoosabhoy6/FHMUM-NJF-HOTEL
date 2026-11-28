import { useEffect, useMemo, useState } from 'react';
import { dayLabel } from '../../shared/dates';
import { HOTEL_ORDER } from '../../shared/engine';
import { hotelMessage, type HotelMessage } from '../../shared/messages';
import type { Group, HotelId, Plan } from '../../shared/types';
import { copy } from '../lib/copy';
import { useNames } from '../lib/names';
import { load, save } from '../lib/storage';
import { Drawer, HotelChip, Icon, Segmented, TourTag } from './ui';

const KIND_KEY = 'njf.messageKind.v1';

interface Props {
  groups: Group[];
  plan: Plan;
  onClose: () => void;
}

type Item = HotelMessage & { hotel: HotelId; leader: string };

/** A copy button that confirms for a moment. */
export function CopyButton({ done, label = 'Copy', onClick }: { done: boolean; label?: string; onClick: () => void }) {
  return (
    <button className="btn sm copy" type="button" data-done={done} onClick={onClick}>
      <Icon name={done ? 'check' : 'copy'} size={14} />
      {done ? 'Copied' : label}
    </button>
  );
}

/** The room-request messages to send to the hotels, one per group, by arrival date. */
export function HotelMessages({ groups, plan, onClose }: Props) {
  const names = useNames();
  const [hotel, setHotel] = useState<HotelId | 'all'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [kind, setKind] = useState<'plain' | 'rooms'>(() => (load<string>(KIND_KEY, 'plain') === 'rooms' ? 'rooms' : 'plain'));
  useEffect(() => save(KIND_KEY, kind), [kind]);

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
    <Drawer title="Hotel messages" size="lg" onClose={onClose}>
      <section className="set">
        <p>One message per group, ready to send to its hotel, by the day the group checks in. Copy one, or every message for a day.</p>
        <div className="msg-tools">
          <Segmented
            label="Message type"
            value={kind}
            onChange={setKind}
            options={[
              { id: 'plain', label: 'Requirements only' },
              { id: 'rooms', label: 'With room numbers' },
            ]}
          />
          <Segmented
            label="Hotel"
            value={hotel}
            onChange={setHotel}
            options={(['all', ...HOTEL_ORDER] as const).map((id) => {
              const count = id === 'all' ? items.length : items.filter((m) => m.hotel === id).length;
              return { id, label: id === 'all' ? 'All hotels' : names[id], count, disabled: !count };
            })}
          />
        </div>
        <p className="set-hint">{kind === 'plain' ? 'Bed sizes and number of rooms.' : `Adds the ${names.ruya} room numbers planned for each line.`}</p>
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
                {list.length > 1 ? <CopyButton done={copied === key} label={`Copy all ${list.length}`} onClick={() => flash(key, list.map((m) => m.text).join('\n\n'))} /> : null}
              </div>
              {list.map((m) => (
                <article className="msg" key={m.groupId}>
                  <div className="msg-head">
                    <TourTag no={m.tourNo} />
                    <span className="msg-who">{m.leader}</span>
                    <HotelChip hotel={m.hotel} />
                    <CopyButton done={copied === m.groupId} onClick={() => flash(m.groupId, m.text)} />
                  </div>
                  {m.rooms ? null : (
                    <p className="msg-warn">
                      <Icon name="alert" size={14} />
                      No rooms yet: type or choose them in the Groups table.
                    </p>
                  )}
                  {kind === 'rooms' && m.rooms && !m.numbered ? <p className="msg-note">No room numbers: the plan only numbers {names.ruya} rooms.</p> : null}
                  <pre className="msg-text">{m.text}</pre>
                </article>
              ))}
            </section>
          );
        })
      ) : (
        <p className="empty">No messages for this hotel.</p>
      )}
    </Drawer>
  );
}
