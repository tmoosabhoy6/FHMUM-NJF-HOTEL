import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { dayMonth, rangeLabel } from '../../shared/dates';
import { describeRooms, parseRoomMessages, parseRoomSpec, type RoomMessage } from '../../shared/roomSpec';
import type { Group, GroupInput } from '../../shared/types';
import { inputKey } from '../lib/inputs';

interface Props {
  groups: Group[];
  typed: Record<string, GroupInput>;
  onApply: (tourNo: string, patch: GroupInput) => void;
  onClose: () => void;
}

const EXAMPLE = `Tour id -2213
GL -  JUZER BHAI CHHAS
Hotel pax - 23

NAJAF (05 NIGHT)
19-11-2026 TO 24-11-2026

Room Requirement:

 02 beds x   06 Rooms = 12 beds
 03 beds x   01 Rooms = 03 beds
 04 beds x   02 Room  =  08 beds

TOTAL- 23 BEDS`;

interface Check {
  message: RoomMessage;
  group: Group | null;
  notes: { text: string; tone: 'ok' | 'warn' | 'info' }[];
}

/** Compares each pasted message with what NKERP says about the tour. */
function check(message: RoomMessage, groups: Group[], typed: Props['typed']): Check {
  const stays = groups.filter((g) => inputKey(g) === message.tourNo);
  const group = stays.find((g) => g.checkIn === message.from) ?? stays[0] ?? null;
  const notes: Check['notes'] = message.issues.map((text) => ({ text, tone: 'warn' as const }));
  if (!message.spec) notes.push({ text: 'No rooms could be read from this message.', tone: 'warn' });
  if (!group) {
    notes.push({ text: 'Not in this pull: not approved yet, or nobody on it needs a hotel. Saved for when it appears.', tone: 'info' });
  } else {
    if (message.hotelPax !== null && message.hotelPax !== group.pax) {
      notes.push({ text: `NKERP has ${group.pax} guests who need a hotel; the message says ${message.hotelPax}.`, tone: 'warn' });
    }
    if (message.spec && message.beds < group.pax) {
      notes.push({ text: `These rooms sleep ${message.beds}; NKERP has ${group.pax} guests.`, tone: 'warn' });
    }
    if (message.from && message.to && (message.from !== group.checkIn || message.to !== group.checkOut)) {
      notes.push({ text: `NKERP has ${rangeLabel(group.checkIn, group.checkOut)}; the message says ${rangeLabel(message.from, message.to)}.`, tone: 'warn' });
    }
    if (notes.length === 0) notes.push({ text: `Matches NKERP: ${group.pax} guests, ${rangeLabel(group.checkIn, group.checkOut)}.`, tone: 'ok' });
  }
  const saved = typed[message.tourNo]?.spec;
  if (saved && message.spec && parseRoomSpec(saved).rooms.join() !== message.rooms.join()) {
    notes.push({ text: `Replaces ${describeRooms(parseRoomSpec(saved).rooms)}.`, tone: 'info' });
  }
  return { message, group, notes };
}

export function RoomRequests({ groups, typed, onApply, onClose }: Props) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const checks = useMemo(() => parseRoomMessages(text).map((m) => check(m, groups, typed)), [text, groups, typed]);
  const ready = checks.filter((c) => c.message.spec);
  const savedList = useMemo(
    () =>
      Object.entries(typed)
        .filter(([, input]) => input.spec)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })),
    [typed],
  );
  const nameOf = (tourNo: string) => groups.find((g) => inputKey(g) === tourNo);

  const apply = () => {
    for (const { message } of ready) {
      onApply(message.tourNo, {
        spec: message.spec,
        message: { hotelPax: message.hotelPax, from: message.from, to: message.to, leader: message.leader },
      });
    }
    setSaved(ready.length);
    setText('');
  };

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer wide"
        role="dialog"
        aria-modal="true"
        aria-label="Room requests"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="drawer-head">
          <h2>Room requests</h2>
          <button className="btn quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">
          <section className="set">
            <p>
              Paste the room-request messages as they are, one or many at once. Each one is matched to its tour by the tour id and
              checked against NKERP.
            </p>
            <label className="sr" htmlFor="requests-text">
              Room-request messages
            </label>
            <textarea
              id="requests-text"
              className="paste"
              rows={9}
              placeholder={EXAMPLE}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(null);
              }}
            />
            {saved !== null ? (
              <p className="saved-note" role="status">
                {saved} room {saved === 1 ? 'request' : 'requests'} saved and shown in the Groups table. Press Refresh plan to rebuild the plan with them.
              </p>
            ) : null}
          </section>

          {checks.length ? (
            <section className="set">
              <h3>
                {checks.length} {checks.length === 1 ? 'message' : 'messages'} read
              </h3>
              <ul className="reads">
                {checks.map(({ message, group, notes }, i) => (
                  <li key={`${message.tourNo}-${i}`} className="read">
                    <div className="read-head">
                      <b>Tour {message.tourNo}</b>
                      <span>{group?.leader || message.leader || ''}</span>
                      {message.from && message.to ? <span className="read-dates">{rangeLabel(message.from, message.to)}</span> : null}
                    </div>
                    <div className="read-rooms">
                      {message.spec ? (
                        <>
                          {describeRooms(message.rooms)} <span>= {message.beds} beds</span>
                        </>
                      ) : (
                        <span>No rooms read</span>
                      )}
                    </div>
                    <ul className="read-notes">
                      {notes.map((note) => (
                        <li key={note.text} data-tone={note.tone}>
                          {note.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="room-actions">
                <button className="btn solid" disabled={!ready.length} onClick={apply}>
                  Save {ready.length} room {ready.length === 1 ? 'request' : 'requests'}
                </button>
                <button className="btn quiet" onClick={() => setText('')}>
                  Clear
                </button>
              </div>
            </section>
          ) : text.trim() ? (
            <section className="set">
              <p className="read-empty">No message with a “Tour id” line found yet.</p>
            </section>
          ) : null}

          <section className="set">
            <h3>Saved on this device</h3>
            {savedList.length ? (
              <ul className="saved-list">
                {savedList.map(([tourNo, input]) => {
                  const group = nameOf(tourNo);
                  const parsed = parseRoomSpec(input.spec);
                  return (
                    <li key={tourNo}>
                      <b>{tourNo}</b>
                      <span className="saved-who">{group?.leader || input.message?.leader || (group ? '' : 'not in this pull')}</span>
                      <span className="saved-rooms">{parsed.error ? input.spec : `${describeRooms(parsed.rooms)} = ${parsed.beds}`}</span>
                      {input.message?.from ? <span className="saved-dates">{dayMonth(input.message.from)}</span> : null}
                      <button className="btn quiet" aria-label={`Remove the room request for tour ${tourNo}`} onClick={() => onApply(tourNo, { spec: '' })}>
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>None yet.</p>
            )}
          </section>
        </div>
      </motion.aside>
    </>
  );
}
