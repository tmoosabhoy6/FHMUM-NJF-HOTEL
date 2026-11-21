import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { dayMonth, rangeLabel } from '../../shared/dates';
import { PaxInput, ReapprovalBadge } from './TourChanges';
import type { PendingTour, PullMeta } from '../../shared/types';
import { tourInput, type InputChange, type TourInputs } from '../lib/inputs';

interface Props {
  tours: PendingTour[];
  meta: PullMeta;
  inputs: TourInputs;
  onEdit: (tour: PendingTour, change: InputChange) => void;
  onClose: () => void;
  /** The city pulled, for the dates column. */
  city?: 'Najaf' | 'Karbala';
}

/** Tours NKERP has not approved yet: shown for information, not planned. */
export function PendingTours({ tours, meta, inputs, onEdit, onClose, city = 'Najaf' }: Props) {
  const [onlyHotel, setOnlyHotel] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const count = (tour: PendingTour) => tourInput(inputs, tour, meta)?.pax ?? tour.needHotel;
  const withGuests = tours.filter((t) => (count(t) ?? 0) > 0);
  const guests = withGuests.reduce((n, t) => n + (count(t) ?? 0), 0);
  const shown = onlyHotel ? withGuests : tours;

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
              {tours.length} {tours.length === 1 ? 'tour is' : 'tours are'} not approved in NKERP yet, or waiting for re-approval after a change, so they are not in the approved plan.{' '}
              {withGuests.length} of them {withGuests.length === 1 ? 'has' : 'have'} guests who will need a hotel ({guests} guests). They join the approved plan
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
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const input = tourInput(inputs, t, meta);
                  const pax = input?.pax ?? t.needHotel;
                  return (
                    <tr key={t.tourId} data-quiet={!pax}>
                      <th scope="row" className="tour">
                        {t.tourNo}
                        <ReapprovalBadge change={meta.reapprovals?.[t.tourId]} />
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
                      <td className="n strong">
                        <PaxInput tourNo={t.tourNo} pax={pax} nkerpPax={input?.pax !== undefined ? t.needHotel : undefined}
                          paxBefore={input?.paxBefore} onChange={(change) => onEdit(t, change)} />
                      </td>
                      <td className="notes">
                        <span className="note">{t.remarks}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </motion.aside>
    </>
  );
}
