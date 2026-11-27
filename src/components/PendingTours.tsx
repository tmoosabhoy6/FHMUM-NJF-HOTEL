import { useState } from 'react';
import { dayMonth, rangeLabel } from '../../shared/dates';
import type { PendingTour, PullMeta } from '../../shared/types';
import { tourInput, type InputChange, type TourInputs } from '../lib/inputs';
import { ChangeBadge, PaxInput, ReapprovalBadge, useChanged } from './TourChanges';
import { Drawer, TourTag } from './ui';

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
  const changed = useChanged(meta);

  const count = (tour: PendingTour) => tourInput(inputs, tour, meta)?.pax ?? tour.needHotel;
  const withGuests = tours.filter((t) => (count(t) ?? 0) > 0);
  const guests = withGuests.reduce((n, t) => n + (count(t) ?? 0), 0);
  const shown = onlyHotel ? withGuests : tours;

  return (
    <Drawer title="Pending tours" size="xl" onClose={onClose}>
      <section className="set">
        <p>
          {tours.length} {tours.length === 1 ? 'tour is' : 'tours are'} not approved in NKERP yet, or waiting for re-approval after a change, so they are not in the approved plan.{' '}
          {withGuests.length} of them {withGuests.length === 1 ? 'has' : 'have'} guests who will need a hotel ({guests} guests). They join the approved plan
          by themselves once approved and pulled again.
        </p>
        <label className="switch">
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
              <th scope="col">Need a hotel</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const input = tourInput(inputs, t, meta);
              const pax = input?.pax ?? t.needHotel;
              return (
                <tr key={t.tourId} data-quiet={!pax} data-changed={changed(t.tourId)}>
                  <th scope="row" className="tour">
                    <TourTag no={t.tourNo} />
                  </th>
                  <td>{t.reapproval ? 'Awaiting re-approval' : t.status}</td>
                  <td>{t.start ? dayMonth(t.start) : '–'}</td>
                  <td>{t.end ? dayMonth(t.end) : '–'}</td>
                  <td className="when">
                    {t.entryPort || '?'}
                    {t.exitPort && t.exitPort !== t.entryPort ? <small>to {t.exitPort}</small> : null}
                  </td>
                  <td className="when">
                    {(t.stays ?? t.najaf).length ? (
                      <>
                        {(t.stays ?? t.najaf).map((n) => rangeLabel(n.checkIn, n.checkOut)).join(', ')}
                        {t.route ? <small>{t.route}</small> : null}
                      </>
                    ) : (
                      <small>No dates in NKERP yet</small>
                    )}
                  </td>
                  <td className="n">{t.pax}</td>
                  <td>
                    <PaxInput tourNo={t.tourNo} pax={pax} nkerpPax={input?.pax !== undefined ? t.needHotel : undefined}
                      paxBefore={input?.paxBefore} onChange={(change) => onEdit(t, change)} />
                  </td>
                  <td className="notes">
                    <ChangeBadge tourId={t.tourId} meta={meta} />
                    <ReapprovalBadge change={meta.reapprovals?.[t.tourId]} />
                    {t.remarks ? <span className="note">{t.remarks}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
