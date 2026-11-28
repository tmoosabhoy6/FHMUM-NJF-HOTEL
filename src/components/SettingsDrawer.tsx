import { OPENING_BALANCE, RUYA_SHEET, RUYA_WITHHELD } from '../../shared/config';
import { dayMonth } from '../../shared/dates';
import { DEFAULT_HOTEL_NAMES, HOTEL_ORDER, hotelNames } from '../../shared/engine';
import type { HotelNames } from '../../shared/types';
import { useAlerts } from '../lib/alerts';
import { MonitorLine } from './TourChanges';
import { Drawer } from './ui';

/** What a person can change, saved on this device. */
export interface Prefs {
  arafCapacity: number;
  departureDayRule: boolean;
  /** Ruya room numbers left out of the plan. */
  withheld: string[];
  /** The hotels' names as shown everywhere (blank = the default name). */
  names?: Partial<HotelNames>;
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
  const out = new Set(prefs.withheld);
  const rooms = RUYA_SHEET.filter((r) => !out.has(r.no)).length;
  const floors = [...new Set(RUYA_SHEET.map((r) => r.floor))];
  const toggle = (no: string) =>
    onChange({ ...prefs, withheld: out.has(no) ? prefs.withheld.filter((n) => n !== no) : [...prefs.withheld, no].sort() });
  const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
  const isDefault = [...prefs.withheld].sort().join() === [...RUYA_WITHHELD].sort().join();
  const names = hotelNames(prefs.names);
  const ROLE = { ruya: 'Filled first, room by room', araf: 'Used when the first hotel cannot take a group', c: 'Takes everyone else, no limit' } as const;

  return (
    <Drawer title="Hotels and rooms" onClose={onClose}>
      <section className="set">
        <h3>Hotel names</h3>
        <p>Shown everywhere in the plan and in the Excel file. Leave a name empty to go back to the original.</p>
        <div className="names">
          {HOTEL_ORDER.map((id) => (
            <label key={id} className="name-row" data-hotel={id}>
              <i aria-hidden="true" />
              <span>
                <input
                  type="text"
                  value={prefs.names?.[id] ?? ''}
                  placeholder={DEFAULT_HOTEL_NAMES[id]}
                  maxLength={40}
                  aria-label={`Name of the hotel that is ${ROLE[id].toLowerCase()}`}
                  onChange={(e) => onChange({ ...prefs, names: { ...prefs.names, [id]: e.target.value } })}
                />
                <small>{ROLE[id]}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="set">
        <h3>{names.ruya}</h3>
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
            <button className="btn ghost" type="button" onClick={() => onChange({ ...prefs, withheld: RUYA_WITHHELD })}>
              Back to rooms {RUYA_WITHHELD.join(', ')} left out
            </button>
          </div>
        ) : null}
      </section>

      <section className="set">
        <h3>{names.araf}</h3>
        <div className="set-grid">
          <label>
            Beds
            <input type="number" min={0} value={prefs.arafCapacity} onChange={(e) => onChange({ ...prefs, arafCapacity: whole(e.target.value, 0, 2000) })} />
          </label>
        </div>
        <p>
          Used when {names.ruya} cannot take a group. {names.c} takes everyone else and has no limit.
        </p>
      </section>

      <section className="set">
        <h3>Already in {names.ruya} on the first night</h3>
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
            Najaf Airport or Baghdad Airport.
          </span>
        </label>
      </section>

      <section className="set">
        <h3>Najaf pax, rooms and hotel choices</h3>
        <p>
          {typedCount ? `Saved for everyone for ${typedCount} ${typedCount === 1 ? 'tour' : 'tours'}.` : 'Nothing saved yet.'} They stay when you pull
          again.
        </p>
        <div className="room-actions">
          <button
            className="btn"
            disabled={!typedCount}
            onClick={() => {
              if (window.confirm('Clear all Najaf pax overrides, room requests and hotel choices?')) onClearInputs();
            }}
          >
            Clear them all
          </button>
        </div>
      </section>

      <ChangeAlerts />
    </Drawer>
  );
}

function ChangeAlerts() {
  const { monitor } = useAlerts();
  return (
    <section className="set">
      <h3>Tour change alerts</h3>
      <p>
        Every {monitor?.every ?? 15} minutes the server pulls NKERP again for the saved Najaf and Karbala ranges. When a tour&rsquo;s hotel pax, Faiz
        accommodation, dates, flights or status change, the plan updates, the row is highlighted until someone marks it seen, and an email goes out.
      </p>
      {monitor?.check ? <MonitorLine /> : <p>No automatic check has run yet.</p>}
      {monitor?.email?.ok ? <p>Last alert email: {new Date(monitor.email.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.</p> : null}
      {monitor && !monitor.emailOn ? <p>To turn on emails, run <code>npm run gmail:setup</code> once (see the README).</p> : null}
    </section>
  );
}
