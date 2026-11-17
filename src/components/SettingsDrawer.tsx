import { motion } from 'motion/react';
import { useEffect } from 'react';
import { OPENING_BALANCE, RUYA_SHEET, RUYA_WITHHELD } from '../../shared/config';
import { dayMonth } from '../../shared/dates';

/** What a person can change, saved on this device. */
export interface Prefs {
  arafCapacity: number;
  departureDayRule: boolean;
  /** Ruya room numbers left out of the plan. */
  withheld: string[];
}

interface Props {
  prefs: Prefs;
  /** Ruya beds in use with the current choice of rooms. */
  beds: number;
  onChange: (prefs: Prefs) => void;
  onClose: () => void;
  onClearInputs: () => void;
  typedCount: number;
}

const FLOOR = ['', 'First floor', 'Second floor', 'Third floor'];

export function SettingsDrawer({ prefs, beds, onChange, onClose, onClearInputs, typedCount }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const out = new Set(prefs.withheld);
  const rooms = RUYA_SHEET.filter((r) => !out.has(r.no)).length;
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const toggle = (no: string) =>
    onChange({ ...prefs, withheld: out.has(no) ? prefs.withheld.filter((n) => n !== no) : [...prefs.withheld, no].sort() });
  const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
  const isDefault = [...prefs.withheld].sort().join() === [...RUYA_WITHHELD].sort().join();

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Hotels and rooms"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="drawer-head">
          <h2>Hotels and rooms</h2>
          <button className="btn quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">
          <section className="set">
            <h3>Ruya</h3>
            <p>
              {rooms} rooms, <b>{beds} beds</b> in the plan. Tap a room to leave it out of the plan or put it back.
            </p>
            <div className="floors">
              {floors.map((floor) => (
                <div className="floor" key={floor}>
                  <span className="floor-name">{FLOOR[floor] ?? `Floor ${floor}`}</span>
                  <div className="floor-rooms">
                    {RUYA_SHEET.filter((r) => r.floor === floor).map((room) => (
                      <button
                        key={room.no}
                        type="button"
                        className="room-key"
                        data-out={out.has(room.no)}
                        aria-pressed={!out.has(room.no)}
                        title={out.has(room.no) ? `Room ${room.no} (${room.beds} beds): left out` : `Room ${room.no} (${room.beds} beds): in the plan`}
                        onClick={() => toggle(room.no)}
                      >
                        <b>{room.no}</b>
                        <span>{room.beds} beds</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {!isDefault ? (
              <div className="room-actions">
                <button className="btn quiet" onClick={() => onChange({ ...prefs, withheld: RUYA_WITHHELD })}>
                  Back to rooms {RUYA_WITHHELD.join(', ')} left out
                </button>
              </div>
            ) : null}
          </section>

          <section className="set">
            <h3>Araf</h3>
            <div className="set-grid">
              <label>
                Beds
                <input type="number" min={0} value={prefs.arafCapacity} onChange={(e) => onChange({ ...prefs, arafCapacity: whole(e.target.value, 0, 2000) })} />
              </label>
            </div>
            <p>Used when Ruya cannot take a group. Hotel C takes everyone else and has no limit.</p>
          </section>

          <section className="set">
            <h3>Already in Ruya on the first night</h3>
            {OPENING_BALANCE.map((hold) => (
              <p key={hold.id}>
                Rooms {hold.roomLabels?.join(', ')} are taken until {dayMonth(hold.to)} ({hold.pax} beds).
              </p>
            ))}
          </section>

          <section className="set">
            <h3>Iraqi Airways departures</h3>
            <label className="switch">
              <input type="checkbox" checked={prefs.departureDayRule} onChange={(e) => onChange({ ...prefs, departureDayRule: e.target.checked })} />
              <span>
                Count the departure day as a night when Najaf is the second half of the trip and the group flies Iraqi Airways from
                Najaf Airport.
              </span>
            </label>
          </section>

          <section className="set">
            <h3>Room requests and hotel choices</h3>
            <p>
              {typedCount ? `Saved on this device for ${typedCount} ${typedCount === 1 ? 'tour' : 'tours'}.` : 'Nothing saved yet.'} They stay when you pull
              again.
            </p>
            <div className="room-actions">
              <button
                className="btn"
                disabled={!typedCount}
                onClick={() => {
                  if (window.confirm('Clear the room requests and hotel choices saved for every tour?')) onClearInputs();
                }}
              >
                Clear them all
              </button>
            </div>
          </section>
        </div>
      </motion.aside>
    </>
  );
}
