import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the server
import { airlineOf, collapseReissues, reconcile, selfHousedPax, stayFromCensusRow, dashboardFact } from '../server/nkerp/normalize.mjs';

const row = (over: Record<string, unknown> = {}, tour: Record<string, unknown> = {}) => ({
  TourId: 1,
  TourSubVenuePlanId: 10,
  ArrivalDate: '2026-12-07T11:00:00',
  DepartureDate: '2026-12-11T21:00:00',
  GroupLead: 'Leader',
  Tour: {
    ReferenceNo: 'NKERP/TOUR/2026/2757',
    OfficeName: 'Fayz E Husayni Trust Mumbai',
    PaxCount: 64,
    PaxRequiredAcc: 0,
    PaxNotRequiredAcc: 64,
    IsApprovedWithAccommodation: false,
    EntryPortName: 'Najaf Airport',
    ExitPortName: 'Najaf Airport',
    TransportItinerary: [{ Id: 1, IsActive: true, ArrivalTransportCode: 'IA 450', DepartureTransportCode: 'IA 449', ArrivalDateTimeZone: '2026-12-01T06:30:00', DepartureDateTimeZone: '2026-12-11T21:00:00' }],
    TourIternerayBreakUp: [
      { From: 'Najaf Airport', To: 'KARBALA', TravelType: 'A', Date: '2026-12-01T00:00:00', IsActive: true },
      { From: 'NAJAF', To: 'Najaf Airport', TravelType: 'D', Date: '2026-12-11T00:00:00', IsActive: true },
      { From: 'KARBALA', To: 'NAJAF', TravelType: 'S', Date: '2026-12-07T00:00:00', IsActive: true },
    ],
    ...tour,
  },
  ...over,
});

describe('reading a Najaf tour row', () => {
  it('finds the stay, the Karbala leg and the Iraqi Airways departure', () => {
    const stay = stayFromCensusRow(row());
    expect(stay).toMatchObject({
      tourNo: '2757',
      pax: 64,
      checkIn: '2026-12-07',
      checkOut: '2026-12-11',
      secondLeg: true,
      arrival: { kind: 'transfer', place: 'KARBALA' },
      departure: { kind: 'airport', place: 'Najaf Airport', flight: 'IA 449', airline: 'IA' },
    });
  });
  it('treats an airport arrival into Najaf as the first leg', () => {
    const stay = stayFromCensusRow(
      row(
        { ArrivalDate: '2026-12-08T07:00:00', DepartureDate: '2026-12-12T08:00:00' },
        {
          TourIternerayBreakUp: [
            { From: 'Najaf Airport', To: 'NAJAF', TravelType: 'A', Date: '2026-12-08T00:00:00' },
            { From: 'NAJAF', To: 'KARBALA', TravelType: 'S', Date: '2026-12-12T00:00:00' },
            { From: 'KARBALA', To: 'Najaf Airport', TravelType: 'D', Date: '2026-12-17T00:00:00' },
          ],
        },
      ),
    );
    expect(stay.secondLeg).toBe(false);
    expect(stay.arrival).toMatchObject({ kind: 'airport', flight: 'IA 450' });
    expect(stay.departure).toMatchObject({ kind: 'transfer', place: 'KARBALA', airline: null });
  });
  it('counts only the guests who arrange their own hotel', () => {
    expect(selfHousedPax({ pax: 31, required: 8, notRequired: 23, approvedWithAccommodation: true })).toBe(23);
    expect(selfHousedPax({ pax: 12, required: 0, notRequired: 0, approvedWithAccommodation: false })).toBe(12);
    expect(selfHousedPax({ pax: 12, required: 12, notRequired: 0, approvedWithAccommodation: true })).toBe(0);
  });
  it('reads airline codes', () => {
    expect(airlineOf('IA 441')).toBe('IA');
    expect(airlineOf('IA441')).toBe('IA');
    expect(airlineOf('FZ 221 EVE')).toBe('FZ');
    expect(airlineOf('G9 374')).toBe('G9');
    expect(airlineOf('')).toBeNull();
  });
  it('keeps the newest plan when a tour was reissued for overlapping dates', () => {
    const a = stayFromCensusRow(row());
    const b = stayFromCensusRow(row({ TourSubVenuePlanId: 11, ArrivalDate: '2026-12-08T11:00:00' }));
    expect(collapseReissues([a, b]).map((s: { planId: number }) => s.planId)).toEqual([11]);
  });
});

describe('checking against the transport dashboards', () => {
  it('notes a different departure date and adds a group the lists missed', () => {
    const stay = stayFromCensusRow(row());
    const dep = { ...dashboardFact('departure', { TourId: 1, TourReferenceNo: 'NKERP/TOUR/2026/2757', OfficeName: 'x', NoOfPax: 64, PaxRequiredAcc: 0, PaxNotRequiredAcc: 64, Accommodation: false, FlightCode: 'IA 449', DeparturePort: 'Najaf Airport', DepartureTimeWithTimeZone: '2026-12-12T21:00:00' }), queried: '2026-12-12' };
    const strayIn = { ...dashboardFact('transfer-in', { TourId: 2, TourReferenceNo: 'NKERP/TOUR/2026/3000', OfficeName: 'x', NoOfPax: 9, PaxRequiredAcc: 0, PaxNotRequiredAcc: 9, Accommodation: false, SubVenueFrom: 'KARBALA', SubVenueTo: 'NAJAF', ArrivalDepartureTime: '2026-12-09T11:00:00' }), queried: '2026-12-09' };
    const strayOut = { ...dashboardFact('departure', { TourId: 2, TourReferenceNo: 'NKERP/TOUR/2026/3000', OfficeName: 'x', NoOfPax: 9, PaxRequiredAcc: 0, PaxNotRequiredAcc: 9, Accommodation: false, FlightCode: 'IA 441', DeparturePort: 'Najaf Airport', DepartureTimeWithTimeZone: '2026-12-13T18:30:00' }), queried: '2026-12-13' };
    const out = reconcile([stay], [dep, strayIn, strayOut], { from: '2026-12-01' });
    expect(out[0].notes.join(' ')).toContain('2026-12-12');
    expect(out[1]).toMatchObject({ tourNo: '3000', pax: 9, checkIn: '2026-12-09', checkOut: '2026-12-13', secondLeg: true, seenIn: { tourList: false, dashboard: true } });
    expect(out[1].departure.airline).toBe('IA');
  });
});
