import { motion } from 'motion/react';
import { useEffect } from 'react';
import { EXAMPLE_ROOMS, OPENING_BALANCE } from '../../shared/config';
import type { RoomType, Settings } from '../../shared/types';

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  onClearInputs: () => void;
  typedCount: number;
}

export function SettingsDrawer({ settings, onChange, onClose, onClearInputs, typedCount }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rooms = settings.rooms;
  const beds = rooms.reduce((sum, r) => sum + r.beds * r.count, 0);
  const count = rooms.reduce((sum, r) => sum + r.count, 0);
  const setRooms = (next: RoomType[]) => onChange({ ...settings, rooms: next });
  const patchRoom = (i: number, patch: Partial<RoomType>) => setRooms(rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const whole = (value: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

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
            <h3>Beds</h3>
            <p>Hotels fill in this order: Ruya, then Araf, then Hotel C, which has no limit.</p>
            <div className="set-grid">
              <label>
                Ruya
                <input
                  type="number"
                  min={0}
                  value={rooms.length ? beds : settings.ruyaCapacity}
                  disabled={rooms.length > 0}
                  onChange={(e) => onChange({ ...settings, ruyaCapacity: whole(e.target.value, 0, 2000) })}
                />
              </label>
              <label>
                Araf
                <input type="number" min={0} value={settings.arafCapacity} onChange={(e) => onChange({ ...settings, arafCapacity: whole(e.target.value, 0, 2000) })} />
              </label>
            </div>
            {rooms.length ? <p>Ruya’s beds come from the room list below.</p> : null}
          </section>

          <section className="set">
            <h3>Ruya room list</h3>
            <p>
              One line per room size. With a room list, each group gets exact rooms and you can see who is in which room every
              night. Without one, Ruya is planned by head count.
            </p>
            <div className="room-rows">
              {rooms.map((room, i) => (
                <div className="room-row" key={i}>
                  <label>
                    Beds in the room
                    <input type="number" min={1} max={20} value={room.beds} onChange={(e) => patchRoom(i, { beds: whole(e.target.value, 1, 20) })} />
                  </label>
                  <label>
                    Rooms like this
                    <input type="number" min={0} max={200} value={room.count} onChange={(e) => patchRoom(i, { count: whole(e.target.value, 0, 200) })} />
                  </label>
                  <button className="btn quiet" aria-label={`Remove the ${room.beds}-bed line`} onClick={() => setRooms(rooms.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="room-actions">
              <button className="btn" onClick={() => setRooms([...rooms, { beds: (rooms[rooms.length - 1]?.beds ?? 1) + 1, count: 1 }])}>
                Add a room size
              </button>
              {rooms.length ? (
                <button className="btn quiet" onClick={() => setRooms([])}>
                  Clear the list
                </button>
              ) : (
                <button className="btn quiet" onClick={() => setRooms(EXAMPLE_ROOMS)}>
                  Use an example list
                </button>
              )}
              {rooms.length ? (
                <span className="room-sum">
                  {count} rooms · {beds} beds
                </span>
              ) : null}
            </div>
            {!rooms.length ? <p style={{ marginTop: 10 }}>The example is made up to preview the room view. It is not Ruya’s real list.</p> : null}
          </section>

          <section className="set">
            <h3>Iraqi Airways departures</h3>
            <label className="switch">
              <input type="checkbox" checked={settings.departureDayRule} onChange={(e) => onChange({ ...settings, departureDayRule: e.target.checked })} />
              <span>
                Count the departure day as a night when Najaf is the second half of the trip and the group flies Iraqi Airways from
                Najaf Airport.
              </span>
            </label>
          </section>

          <section className="set">
            <h3>Opening balance</h3>
            <p>
              {OPENING_BALANCE.length
                ? `${OPENING_BALANCE.length} entries carried in from before the first night.`
                : 'None loaded yet. Guests already in a hotel before the first night are placed by the planner like everyone else until the end-of-November counts are added.'}
            </p>
          </section>

          <section className="set">
            <h3>Typed rooms and hotel choices</h3>
            <p>
              {typedCount ? `Saved on this device for ${typedCount} ${typedCount === 1 ? 'group' : 'groups'}.` : 'Nothing typed yet.'} They stay when you pull
              again.
            </p>
            <div className="room-actions">
              <button
                className="btn"
                disabled={!typedCount}
                onClick={() => {
                  if (window.confirm('Clear the rooms and hotel choices typed for every group?')) onClearInputs();
                }}
              >
                Clear what was typed
              </button>
            </div>
          </section>
        </div>
      </motion.aside>
    </>
  );
}
