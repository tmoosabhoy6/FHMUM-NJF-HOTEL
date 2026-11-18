import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { dayMonth, rangeLabel } from '../../shared/dates';
import type { PendingTour } from '../../shared/types';

interface Props {
  tours: PendingTour[];
  /** The city pulled, for the dates column. */
  city?: 'Najaf' | 'Karbala';
  /** What the tours are left out of. */
  outOf?: string;
  onClose: () => void;
}

/** Tours NKERP has not approved yet: shown for information, not planned. */
export function PendingTours({ tours, city = 'Najaf', outOf = 'the plan', onClose }: Props) {
  const [onlyHotel, setOnlyHotel] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const withGuests = tours.filter((t) => (t.needHotel ?? 0) > 0);
  const guests = withGuests.reduce((n, t) => n + (t.needHotel ?? 0), 0);
  const shown = useMemo(() => (onlyHotel ? withGuests : tours), [onlyHotel, tours, withGuests]);

  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="drawer xwide"
        role="dialog"
        aria-modal="true"
        aria-label="Pending tours"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
      >
        <div className="drawer-head">
          <h2>Pending tours</h2>
          <button className="btn quiet" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">
          <section className="set">
            <p>
              {tours.length} {tours.length === 1 ? 'tour is' : 'tours are'} not approved in NKERP yet, or waiting for re-approval after a change, so they are not in {outOf}.{' '}
              {withGuests.length} of them {withGuests.length === 1 ? 'has' : 'have'} guests who will need a hotel ({guests} guests). They join {outOf}
              by themselves once approved and pulled again.
            </p>
            <label className="switch" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={onlyHotel} onChange={(e) => setOnlyHotel(e.target.checked)} />
              <span>Only tours with guests who need a hotel</span>
            </label>
          </section>
          <div className="sheet-wrap">
            <table className="sheet pending">
              <thead>
                <tr>
                  <th scope="col">Tour</th>
                  <th scope="col">Status</th>
                  <th scope="col">Arrives</th>
                  <th scope="col">Leaves</th>
                  <th scope="col">Ports</th>
                  <th scope="col">{city}</th>
                  <th scope="col" className="n">
                    Guests
                  </th>
                  <th scope="col" className="n">
                    Need a hotel
                  </th>
                  <th scope="col" className="n">
                    Housed by NKERP
                  </th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.tourId} data-quiet={!t.needHotel}>
                    <th scope="row" className="tour">
                      {t.tourNo}
                    </th>
                    <td>{t.status}</td>
                    <td>{t.start ? dayMonth(t.start) : '–'}</td>
                    <td>{t.end ? dayMonth(t.end) : '–'}</td>
                    <td className="ports">
                      {t.entryPort || '?'}
                      {t.exitPort && t.exitPort !== t.entryPort ? ` → ${t.exitPort}` : ''}
                    </td>
                    <td>
                      {(t.stays ?? t.najaf).length ? (
                        <>
                          {(t.stays ?? t.najaf).map((n) => rangeLabel(n.checkIn, n.checkOut)).join(', ')}
                          {t.route ? <small className="route">{t.route}</small> : null}
                        </>
                      ) : (
                        <span className="muted">No dates in NKERP yet</span>
                      )}
                    </td>
                    <td className="n">{t.pax}</td>
                    <td className="n strong">{t.needHotel ?? '–'}</td>
                    <td className="n">{t.housed ?? '–'}</td>
                    <td className="notes">
                      <span className="note">{t.remarks}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
