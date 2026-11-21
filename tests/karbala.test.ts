import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the server
import { pendingTour, staysFromGroupRow } from '../server/nkerp/normalize.mjs';
// @ts-expect-error plain JS module shared with the server
import { runSync } from '../server/nkerp/sync.mjs';
import { karbalaRows } from '../shared/karbala';
import { hotelMessage, karbalaMessage } from '../shared/messages';
import type { Group, Placement } from '../shared/types';

const OFFICE = 'Fayz E Husayni Trust Mumbai';
const plan = (id: number, venue: 'NAJAF' | 'KARBALA', start: string, end: string, extra: Record<string, unknown> = {}) => ({
  Id: id,
  SubvenueId: venue === 'NAJAF' ? 3 : 4,
  SubvenueName: venue === 'NAJAF' ? 'Najaf' : 'Karbala',
  StartDateTimeZone: `${start}T00:00:00`,
  EndDateTimeZone: end,
  IsActive: true,
  IsRemoved: false,
  ...extra,
});

/** A General search → Groups row (made-up tour). */
const tourRow = (over: Record<string, unknown> = {}) => ({
  TourId: 7001,
  ReferenceNo: 'NKERP/TOUR/2026/9101',
  OfficeName: OFFICE,
  Status: 'Approved',
  IsActive: true,
  PaxCount: 6,
  StartDate: '2026-12-03T11:00:00',
  EntryPort: 'Najaf Airport',
  ExitPort: 'Baghdad Airport',
  lstTransportItinerary: [
    { Id: 1, IsActive: true, ArrivalTransportCode: 'FZ 221', ArrivalDateTimeZone: '2026-12-03T06:30:00', DepartureTransportCode: 'IA 441', DepartureDateTimeZone: '2026-12-11T21:00:00' },
  ],
  // Najaf first, then Karbala to the end of the trip.
  lstSubVenuePlan: [plan(11, 'NAJAF', '2026-12-03', '2026-12-06T23:59:59.997'), plan(12, 'KARBALA', '2026-12-07', '2026-12-11T00:00:00')],
  ...over,
});

const person = (over: Record<string, unknown>) => ({ IsActive: true, IsCancellation: false, IsDummy: false, IsInfant: false, IsLead: false, AccomodationOptionId: 2, FirstName: 'Guest', LastName: 'Sample', ...over });

describe('reading Karbala stays', () => {
  it('finds the Karbala stay after Najaf, as the second half of the trip', () => {
    const stays = staysFromGroupRow(tourRow(), 'karbala');
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({
      id: '7001:12',
      tourNo: '9101',
      checkIn: '2026-12-07',
      checkOut: '2026-12-11',
      arrival: { kind: 'transfer', place: 'NAJAF', flight: null },
      departure: { kind: 'airport', place: 'Baghdad Airport', flight: 'IA 441', airline: 'IA' },
      departureAt: '2026-12-11T21:00:00',
      secondLeg: true,
    });
  });

  it('reads Karbala first, then a transfer to Najaf', () => {
    const row = tourRow({ lstSubVenuePlan: [plan(21, 'KARBALA', '2026-12-03', '2026-12-05T23:59:59.997'), plan(22, 'NAJAF', '2026-12-06', '2026-12-11T00:00:00')] });
    const [stay] = staysFromGroupRow(row, 'karbala');
    expect(stay).toMatchObject({ checkIn: '2026-12-03', checkOut: '2026-12-06', arrival: { kind: 'airport', flight: 'FZ 221' }, arrivalAt: '2026-12-03T06:30:00', departure: { kind: 'transfer', place: 'NAJAF' }, secondLeg: false });
    // The Najaf reading of the same tour is unchanged.
    const [najaf] = staysFromGroupRow(row);
    expect(najaf).toMatchObject({ checkIn: '2026-12-06', checkOut: '2026-12-11', arrival: { kind: 'transfer', place: 'KARBALA' }, secondLeg: true });
  });

  it('finds no Karbala stay on a Najaf-only tour', () => {
    expect(staysFromGroupRow(tourRow({ lstSubVenuePlan: [plan(31, 'NAJAF', '2026-12-03', '2026-12-11T00:00:00')] }), 'karbala')).toEqual([]);
  });

  it('gives a pending tour its Karbala dates', () => {
    const t = pendingTour(
      { TourId: 7002, ReferenceNo: 'NKERP/TOUR/2026/9102', Status: 'Pending' },
      { IsReApproval: false, PaxNotRequiredAcc: 4, PaxRequiredAcc: 2, TourSubvenuePlan: tourRow().lstSubVenuePlan },
      'karbala',
    );
    expect(t).toMatchObject({ tourNo: '9102', route: 'Najaf → Karbala', stays: [{ checkIn: '2026-12-07', checkOut: '2026-12-11' }], najaf: [{ checkIn: '2026-12-03', checkOut: '2026-12-07' }], needHotel: 4 });
  });
});

describe('the Karbala pull', () => {
  function fakeClient(rows: Record<string, unknown>[], lists: Record<number, Record<string, unknown>[]>, subVenue: Record<number, unknown> = {}) {
    return {
      requests: 0,
      async login() {
        return { reused: false };
      },
      async read(path: string, body?: unknown) {
        this.requests += 1;
        if (path === 'api/tours/GeneralSearchGroups') return { lstGeneralGroupsSearch: rows, TotalRows: rows.length, body };
        if (path.startsWith('api/tours/getTourSubVenue/')) return { TourPlan: subVenue[Number(path.split('/').pop())] ?? null };
        return { Applicants: lists[Number(path.split('/').pop())] ?? [] };
      },
    };
  }

  it('counts the same guests as Najaf, lists pending tours with Karbala dates, and skips Najaf-only tours', async () => {
    const rows = [
      tourRow(), // Najaf then Karbala: 2 of 3 need a hotel
      tourRow({ TourId: 7003, ReferenceNo: 'NKERP/TOUR/2026/9103', lstSubVenuePlan: [plan(41, 'NAJAF', '2026-12-03', '2026-12-11T00:00:00')] }), // Najaf only
      tourRow({ TourId: 7004, ReferenceNo: 'NKERP/TOUR/2026/9104', Status: 'Pending', EndDate: '2026-12-12T00:00:00', lstSubVenuePlan: [] }),
      tourRow({ TourId: 7005, ReferenceNo: 'NKERP/TOUR/2026/9105' }), // all housed by NKERP
    ];
    const lists = {
      7001: [person({ IsLead: true, FirstName: 'Leader', LastName: 'One' }), person({ AccomodationOptionId: 3 }), person({ AccomodationOptionId: 3 }), person({ AccomodationOptionId: 3, IsInfant: true })],
      7005: [person({}), person({})],
    };
    const subVenue = { 7004: { PaxNotRequiredAcc: 5, PaxRequiredAcc: 0, TourSubvenuePlan: [plan(51, 'KARBALA', '2026-12-08', '2026-12-12T00:00:00', { IsActive: false, CreatedOn: '2026-11-12T07:06:10' })] } };
    const steps: string[] = [];
    const result = await runSync({
      client: fakeClient(rows, lists, subVenue),
      from: '2026-12-01',
      venue: 'karbala',
      office: OFFICE,
      emit: (event: string, data: { detail?: string }) => event === 'step' && data.detail && steps.push(data.detail),
    });
    expect(result.groups).toHaveLength(2);
    expect(result.groups).toContainEqual(expect.objectContaining({ tourId: 7005, pax: 0 }));
    expect(result.groups[0]).toMatchObject({ tourNo: '9101', pax: 2, infants: 1, leader: 'Leader One', checkIn: '2026-12-07', checkOut: '2026-12-11' });
    expect(result.meta).toMatchObject({ venue: 'karbala', approvedStays: 2, nkerpHousedOnly: 1, notApproved: 1 });
    expect(result.meta.pending).toEqual([expect.objectContaining({ tourNo: '9104', needHotel: 5, stays: [{ checkIn: '2026-12-08', checkOut: '2026-12-12' }] })]);
    expect(steps).toContain('2 approved tours staying in Karbala, 1 pending in NKERP');
  });
});

describe('Karbala messages', () => {
  const group = (over: Partial<Group> = {}): Group => ({
    id: '7001:12',
    tourId: 7001,
    planId: 12,
    ref: 'NKERP/TOUR/2026/9101',
    tourNo: '9101',
    office: OFFICE,
    leader: 'Leader One',
    status: 'Approved',
    pax: 7,
    infants: 0,
    paxTotal: 9,
    paxNkerpHoused: 2,
    checkIn: '2026-12-07',
    checkOut: '2026-12-10',
    arrivalAt: null,
    departureAt: null,
    arrival: { kind: 'transfer', place: 'NAJAF', flight: null },
    departure: { kind: 'airport', place: 'Najaf Airport', flight: 'FZ 222', airline: 'FZ' },
    secondLeg: true,
    notes: [],
    ...over,
  });

  it('is the Najaf message with KARBALA in the heading', () => {
    const rows = karbalaRows([group()], { '7001:12': { spec: '2x2, 3x1' } }, { departureDayRule: true });
    expect(rows[0]).toMatchObject({ nights: ['2026-12-07', '2026-12-08', '2026-12-09'], departureDay: false, rooms: [3, 2, 2], issue: null });
    expect(rows[0].message?.text).toBe(
      ['Tour id -9101', 'GL -  LEADER ONE', 'Hotel pax - 7', '', 'KARBALA (03 NIGHT)', '07-12-2026 TO 10-12-2026', '', 'Room Requirement:', '', ' 02 beds x   02 Rooms = 04 beds', ' 03 beds x   01 Rooms = 03 beds', '', 'TOTAL- 7 BEDS'].join('\n'),
    );
    // Same text as Najaf's for the same group, nights and rooms, apart from the city.
    const najaf = hotelMessage(group(), { nights: rows[0].nights, rooms: [], spec: [3, 2, 2] } as unknown as Placement);
    expect(rows[0].message?.text).toBe(najaf?.text.replace('NAJAF (', 'KARBALA ('));
  });

  it('says "To be confirmed" with no rooms, and flags rooms that cannot be read or are short', () => {
    expect(karbalaMessage(group(), ['2026-12-07'], null)?.text).toContain(' To be confirmed\n\nTOTAL- 7 BEDS');
    const [bad] = karbalaRows([group()], { '7001:12': { spec: 'lots' } }, { departureDayRule: true });
    expect(bad.rooms).toBeNull();
    expect(bad.issue).toMatch(/could not be read/);
    expect(bad.message?.text).toContain('To be confirmed');
    const [short] = karbalaRows([group()], { '7001:12': { spec: '2x3' } }, { departureDayRule: true });
    expect(short.issue).toBe('The rooms typed have 6 beds for 7 guests.');
  });

  it('counts the departure day for Iraqi Airways out of Najaf or Baghdad after Najaf, like Najaf does', () => {
    const ia = group({ departure: { kind: 'airport', place: 'Baghdad Airport', flight: 'IA 441', airline: 'IA' } });
    const [on] = karbalaRows([ia], {}, { departureDayRule: true });
    expect(on).toMatchObject({ nights: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10'], departureDay: true });
    expect(on.message?.text).toContain('KARBALA (04 NIGHT)\n07-12-2026 TO 11-12-2026');
    expect(karbalaRows([ia], {}, { departureDayRule: false })[0].nights).toHaveLength(3);
    // Karbala first (not the second half): no extra night.
    expect(karbalaRows([{ ...ia, secondLeg: false, arrival: { kind: 'airport', place: 'Najaf Airport', flight: 'IA 1' } }], {}, { departureDayRule: true })[0].nights).toHaveLength(3);
  });

  it('leaves out groups with no guests who need a hotel, and gives no message for a stay with no night', () => {
    const rows = karbalaRows([group({ id: 'a', pax: 0 }), group({ id: 'b', tourNo: '1', checkOut: '2026-12-07' })], {}, { departureDayRule: true });
    expect(rows.map((r) => r.group.id)).toEqual(['b']);
    expect(rows[0].message).toBeNull();
  });
});
