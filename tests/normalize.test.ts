import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module shared with the server
import { isAllowedRead } from '../server/nkerp/client.mjs';
// @ts-expect-error plain JS module shared with the server
import { airlineOf, countGuests, countsFromTour, endDateOf, isApprovedTour, pendingTour, reapprovalRow, staysFromGroupRow, withGuests } from '../server/nkerp/normalize.mjs';
// @ts-expect-error plain JS module shared with the server
import { runSync } from '../server/nkerp/sync.mjs';

const OFFICE = 'Fayz E Husayni Trust Mumbai';
const plan = (id: number, venue: 'NAJAF' | 'KARBALA', start: string, end: string, extra: Record<string, unknown> = {}) => ({
  Id: id,
  SubvenueId: venue === 'NAJAF' ? 3 : 4,
  SubvenueName: venue,
  StartDateTimeZone: `${start}T00:00:00`,
  EndDateTimeZone: end,
  IsActive: true,
  IsRemoved: false,
  ...extra,
});

/** A General search → Groups row, shaped as NKERP sends it (made-up tour). */
const tourRow = (over: Record<string, unknown> = {}) => ({
  TourId: 5001,
  ReferenceNo: 'NKERP/TOUR/2026/9001',
  OfficeName: OFFICE,
  Status: 'Approved',
  IsActive: true,
  PaxCount: 6,
  StartDate: '2026-12-03T11:00:00',
  EntryPort: 'Najaf Airport',
  ExitPort: 'Najaf Airport',
  lstTransportItinerary: [
    {
      Id: 1,
      IsActive: true,
      ArrivalTransportCode: 'IA 442',
      ArrivalDateTimeZone: '2026-12-03T06:30:00',
      DepartureTransportCode: 'IA 441',
      DepartureDateTimeZone: '2026-12-11T21:00:00',
    },
  ],
  lstSubVenuePlan: [plan(11, 'KARBALA', '2026-12-03', '2026-12-06T23:59:59.997'), plan(12, 'NAJAF', '2026-12-07', '2026-12-11T00:00:00')],
  ...over,
});

const person = (over: Record<string, unknown>) => ({
  IsActive: true,
  IsCancellation: false,
  IsDummy: false,
  IsInfant: false,
  IsLead: false,
  AccomodationOptionId: 2,
  FirstName: 'Guest',
  LastName: 'Sample',
  ...over,
});

describe('reading a tour from General search', () => {
  it('finds the Najaf stay after Karbala, flying Iraqi Airways out of Najaf', () => {
    const [stay] = staysFromGroupRow(tourRow());
    expect(stay).toMatchObject({
      id: '5001:12',
      tourNo: '9001',
      checkIn: '2026-12-07',
      checkOut: '2026-12-11',
      secondLeg: true,
      arrival: { kind: 'transfer', place: 'KARBALA' },
      departure: { kind: 'airport', place: 'Najaf Airport', flight: 'IA 441', airline: 'IA' },
      departureAt: '2026-12-11T21:00:00',
    });
  });
  it('rolls a 23:59 plan end over to the moving day, and reads a first-leg Najaf stay', () => {
    expect(endDateOf('2026-11-23T23:59:59.997')).toBe('2026-11-24');
    expect(endDateOf('2026-11-24T00:00:00')).toBe('2026-11-24');
    const [stay] = staysFromGroupRow(
      tourRow({
        EntryPort: 'Baghdad Airport',
        lstSubVenuePlan: [plan(21, 'NAJAF', '2026-12-01', '2026-12-04T23:59:59.997'), plan(22, 'KARBALA', '2026-12-05', '2026-12-09T00:00:00')],
      }),
    );
    expect(stay).toMatchObject({ checkIn: '2026-12-01', checkOut: '2026-12-05', secondLeg: false, arrival: { kind: 'airport', place: 'Baghdad Airport' } });
    expect(stay.departure).toMatchObject({ kind: 'transfer', place: 'KARBALA', airline: null });
  });
  it('gives each Najaf visit of a tour its own stay and skips removed plans', () => {
    const stays = staysFromGroupRow(
      tourRow({
        lstSubVenuePlan: [
          plan(31, 'NAJAF', '2026-12-01', '2026-12-03T23:59:59.997'),
          plan(32, 'KARBALA', '2026-12-04', '2026-12-06T23:59:59.997'),
          plan(33, 'NAJAF', '2026-12-07', '2026-12-10T00:00:00'),
          plan(34, 'NAJAF', '2026-12-20', '2026-12-22T00:00:00', { IsRemoved: true }),
        ],
      }),
    );
    expect(stays.map((s: { checkIn: string; checkOut: string }) => `${s.checkIn}→${s.checkOut}`)).toEqual(['2026-12-01→2026-12-04', '2026-12-07→2026-12-10']);
  });
  it('treats Approved, Current and Completed as approved, nothing else', () => {
    expect(['Approved', 'Current', 'Completed'].map((Status) => isApprovedTour({ Status, IsActive: true }))).toEqual([true, true, true]);
    expect(['Pending', 'Draft', 'Deleted'].map((Status) => isApprovedTour({ Status, IsActive: true }))).toEqual([false, false, false]);
    expect(isApprovedTour({ Status: 'Approved', IsActive: false })).toBe(false);
  });
  it('reads airline codes', () => {
    expect(['IA 441', 'FZ 221 EVE', 'G9 374', 'Iraqi Airways 12', ''].map(airlineOf)).toEqual(['IA', 'FZ', 'G9', 'IA', null]);
  });
});

describe('tours awaiting re-approval', () => {
  // Shaped like tour 2217: approved, updated, now Pending with every plan version inactive.
  const plans = [
    plan(1, 'KARBALA', '2026-11-26', '2026-11-30T23:59:59.997', { IsActive: false, CreatedOn: '2026-11-05T15:01:55.68' }),
    plan(2, 'NAJAF', '2026-12-01', '2026-12-06T00:00:00', { IsActive: false, CreatedOn: '2026-11-05T15:01:55.68' }),
    plan(3, 'KARBALA', '2026-11-26', '2026-12-01T23:59:59.997', { IsActive: false, CreatedOn: '2026-11-10T09:51:43.623' }),
    plan(4, 'NAJAF', '2026-12-02', '2026-12-06T00:00:00', { IsActive: false, CreatedOn: '2026-11-10T09:51:43.623' }),
    plan(5, 'KARBALA', '2026-11-26', '2026-11-30T23:59:59.997', { IsActive: false, CreatedOn: '2026-11-12T07:06:10.1' }),
    plan(6, 'NAJAF', '2026-12-01', '2026-12-06T00:00:00', { IsActive: false, CreatedOn: '2026-11-12T07:06:10.1' }),
  ];
  const pendingRow = tourRow({ Status: 'Pending', lstSubVenuePlan: [], ExitPort: 'Baghdad Airport' });
  it('plans it from the newest version of its plans, arriving from Karbala', () => {
    const row = reapprovalRow(pendingRow, { IsReApproval: true, TourSubvenuePlan: plans });
    const stays = staysFromGroupRow(row);
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ id: '5001:6', checkIn: '2026-12-01', checkOut: '2026-12-06', secondLeg: true, arrival: { kind: 'transfer', place: 'KARBALA' }, status: 'Awaiting re-approval' });
    expect(stays[0].notes.join(' ')).toMatch(/awaiting re-approval/);
  });
  it('describes a pending tour for the pending table', () => {
    const row = tourRow({ Status: 'Pending', StartDate: '2026-11-26T18:00:00', EndDate: '2026-12-06T01:00:00', EntryPort: 'Baghdad Airport', ExitPort: 'Baghdad Airport', PaxCount: 50 });
    const t = pendingTour(row, { IsReApproval: false, PaxNotRequiredAcc: 14, PaxRequiredAcc: 36, Remarks: 'Tour has been updated', TourSubvenuePlan: plans });
    expect(t).toMatchObject({
      tourNo: '9001',
      status: 'Pending',
      start: '2026-11-26',
      end: '2026-12-06',
      route: 'Karbala → Najaf',
      najaf: [{ checkIn: '2026-12-01', checkOut: '2026-12-06' }],
      pax: 50,
      needHotel: 14,
      housed: 36,
      remarks: 'Tour has been updated',
    });
    expect(pendingTour(tourRow({ Status: 'Pending' }), null)).toMatchObject({ najaf: [], needHotel: null, route: '' });
  });
  it('lists a tour awaiting re-approval as pending, with its latest Najaf dates', () => {
    const t = pendingTour(pendingRow, { IsReApproval: true, PaxNotRequiredAcc: 15, PaxRequiredAcc: 0, TourSubvenuePlan: plans });
    expect(t).toMatchObject({ status: 'Awaiting re-approval', reapproval: true, najaf: [{ checkIn: '2026-12-01', checkOut: '2026-12-06' }], needHotel: 15 });
  });
  it('leaves out a pending tour that was never approved', () => {
    expect(reapprovalRow(pendingRow, { IsReApproval: false, TourSubvenuePlan: plans })).toBeNull();
    expect(reapprovalRow(pendingRow, { IsReApproval: true, TourSubvenuePlan: [] })).toBeNull();
  });
});

describe('counting guests person by person', () => {
  const guests = [
    person({ IsLead: true, FirstName: 'Lead', LastName: 'Person', AccomodationOptionId: 2 }),
    person({ AccomodationOptionId: 2 }),
    person({ AccomodationOptionId: 3 }),
    person({ AccomodationOptionId: 3 }),
    person({ AccomodationOptionId: 3, IsInfant: true }),
    person({ AccomodationOptionId: 3, IsCancellation: true }),
    person({ AccomodationOptionId: 3, IsDummy: true }),
    person({ AccomodationOptionId: 3, IsActive: false }),
  ];
  it('counts only active guests marked "accommodation not required", infants apart, on a tour NKERP otherwise houses', () => {
    expect(countGuests(guests)).toMatchObject({ total: 5, required: 2, notRequired: 2, infants: 1, cancelled: 3, leader: 'Lead Person' });
  });
  it('fills the stay with those numbers', () => {
    const [stay] = staysFromGroupRow(tourRow());
    const filled = withGuests(stay, countGuests(guests));
    expect(filled).toMatchObject({ pax: 2, infants: 1, paxTotal: 5, paxNkerpHoused: 2, leader: 'Lead Person' });
    expect(filled.notes.join(' ')).toMatch(/1 infant/);
  });
  it('uses the tour’s own totals when an approved tour has no guest list yet', () => {
    const [stay] = staysFromGroupRow(tourRow());
    const filled = withGuests(stay, countsFromTour({ PaxNotRequiredAcc: 50, PaxRequiredAcc: 0, PaxCount: 50 }));
    expect(filled).toMatchObject({ pax: 50, paxTotal: 50, paxNkerpHoused: 0, infants: 0 });
    expect(filled.notes.join(' ')).toMatch(/Guest list not in NKERP yet/);
  });
});

describe('NKERP stays read-only', () => {
  it('allows only the group search and guest-list reads', () => {
    expect(isAllowedRead('api/tours/GeneralSearchGroups', 'POST')).toBe(true);
    expect(isAllowedRead('api/tours/getApplicants/428789642', 'GET')).toBe(true);
    expect(isAllowedRead('api/tours/getApplicants/42; drop', 'GET')).toBe(false);
    expect(isAllowedRead('api/tours/UpdateZiyaratStatus/1/false/4', 'GET')).toBe(false);
    expect(isAllowedRead('api/Property/saveRoomallocationApplicantsDetails', 'POST')).toBe(false);
    expect(isAllowedRead('api/tours/getApplicants/1', 'POST')).toBe(false);
    expect(isAllowedRead('api/tours/getTourSubVenue/428789641', 'GET')).toBe(true);
  });
});

describe('the pull', () => {
  /** A stand-in for NKERP: one page of tours and a guest list per tour. */
  function fakeClient(rows: Record<string, unknown>[], lists: Record<number, Record<string, unknown>[]>, subVenue: Record<number, unknown> = {}) {
    const calls: string[] = [];
    return {
      calls,
      requests: 0,
      async login() {
        return { reused: false };
      },
      async read(path: string, body?: unknown) {
        this.requests += 1;
        calls.push(`${body === undefined ? 'GET' : 'POST'} ${path}`);
        if (path === 'api/tours/GeneralSearchGroups') return { lstGeneralGroupsSearch: rows, TotalRows: rows.length };
        if (path.startsWith('api/tours/getTourSubVenue/')) return { TourPlan: subVenue[Number(path.split('/').pop())] ?? null };
        const id = Number(path.split('/').pop());
        return { Applicants: lists[id] ?? [] };
      },
    };
  }

  it('keeps approved tours with guests who need a hotel, including part-housed tours, and counts pending ones', async () => {
    const rows = [
      tourRow(), // mixed: 2 of 4 need a hotel
      tourRow({ TourId: 5002, ReferenceNo: 'NKERP/TOUR/2026/9002' }), // all housed by NKERP
      tourRow({ TourId: 5003, ReferenceNo: 'NKERP/TOUR/2026/9003', Status: 'Pending', lstSubVenuePlan: [] }),
      tourRow({ TourId: 5004, ReferenceNo: 'NKERP/TOUR/2026/9004', OfficeName: 'Another office' }),
      tourRow({ TourId: 5005, ReferenceNo: 'NKERP/TOUR/2026/9005', lstSubVenuePlan: [plan(51, 'NAJAF', '2026-10-01', '2026-10-04T00:00:00')] }), // out of range
    ];
    const lists = {
      5001: [person({ IsLead: true, FirstName: 'A', LastName: 'B' }), person({}), person({ AccomodationOptionId: 3 }), person({ AccomodationOptionId: 3 })],
      5002: [person({}), person({})],
    };
    const client = fakeClient(rows, lists);
    const events: string[] = [];
    const lit: string[] = [];
    const result = await runSync({
      client,
      from: '2026-12-01',
      office: OFFICE,
      emit: (event: string, data: { date?: string }) => {
        events.push(event);
        if (event === 'day' && data.date) lit.push(data.date);
      },
    });
    expect(result.groups).toHaveLength(2);
    expect(result.groups).toContainEqual(expect.objectContaining({ tourId: 5002, pax: 0 }));
    expect(result.groups[0]).toMatchObject({ tourNo: '9001', pax: 2, paxNkerpHoused: 2, leader: 'A B' });
    expect(result.meta).toMatchObject({ approvedStays: 2, nkerpHousedOnly: 1, notApproved: 1, toursRead: 2 });
    expect(client.calls.filter((c) => c.startsWith('GET api/tours/getApplicants')).sort()).toEqual([
      'GET api/tours/getApplicants/5001', 'GET api/tours/getApplicants/5002', 'GET api/tours/getApplicants/5003',
    ]);
    // Every day of the range lights, in order.
    expect(lit[0]).toBe('2026-12-01');
    expect(lit[lit.length - 1]).toBe('2026-12-11');
    expect(lit).toEqual([...lit].sort());
    expect(events).toContain('tours');
  });

  it('uses Baghdad dates for pending tours crossing midnight UTC and counts only hotel guests', async () => {
    const row = tourRow({ Status: 'Pending', StartDate: '2026-12-01T22:05:00', EndDate: '2026-12-05T22:10:00', lstSubVenuePlan: [] });
    const applicants = [
      person({ AccomodationOptionId: 3 }), person({ AccomodationOptionId: 3, IsInfant: true }),
      person({ AccomodationOptionId: 3, IsCancellation: true }), person({ AccomodationOptionId: 2 }),
    ];
    const detail = { PaxNotRequiredAcc: 8, TourSubvenuePlan: [] };
    const result = await runSync({ client: fakeClient([row], { 5001: applicants }, { 5001: detail }), from: '2026-12-06', to: '2026-12-07', office: OFFICE });
    expect(result.meta.pending).toMatchObject([{ start: '2026-12-02', end: '2026-12-06', needHotel: 1, hotelPaxSource: 'applicants' }]);
    expect(pendingTour({ ...row, StartDateTimeZone: '2026-12-01T22:05:00' }, detail).start).toBe('2026-12-01');
  });

  it('lists a tour awaiting re-approval as pending, not planned', async () => {
    const rows = [tourRow({ TourId: 6001, ReferenceNo: 'NKERP/TOUR/2026/2217', Status: 'Pending', StartDate: '2026-11-26T18:00:00', EndDate: '2026-12-06T01:00:00', lstSubVenuePlan: [] })];
    const subVenue = {
      6001: {
        IsReApproval: true,
        TourSubvenuePlan: [
          plan(61, 'KARBALA', '2026-11-26', '2026-11-30T23:59:59.997', { IsActive: false, CreatedOn: '2026-11-12T07:06:10' }),
          plan(62, 'NAJAF', '2026-12-01', '2026-12-06T00:00:00', { IsActive: false, CreatedOn: '2026-11-12T07:06:10' }),
        ],
      },
    };
    const lists = { 6001: [person({ AccomodationOptionId: 2 }), person({ AccomodationOptionId: 3 }), person({ AccomodationOptionId: 3, IsInfant: true })] };
    const result = await runSync({ client: fakeClient(rows, lists, subVenue), from: '2026-12-01', office: OFFICE });
    expect(result.groups).toHaveLength(0);
    expect(result.meta).toMatchObject({ reapproval: 1, notApproved: 1 });
    expect(result.meta.pending).toEqual([expect.objectContaining({ tourNo: '2217', status: 'Awaiting re-approval', najaf: [{ checkIn: '2026-12-01', checkOut: '2026-12-06' }] })]);
  });
});
