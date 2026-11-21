import { describe, expect, it } from 'vitest';
import { balancedSegments, buildApprovalPlan, type ApprovalRequest } from '../shared/approvals';
import { daysBetween } from '../shared/dates';
import { buildPlan } from '../shared/engine';
import type { Group, GroupInput, PendingTour, Settings } from '../shared/types';

function pending(tourId: number, start: string, end: string, pax: number, other: Partial<PendingTour> = {}): PendingTour {
  return {
    tourId, ref: `NKERP/TOUR/2026/${tourId}`, tourNo: String(tourId), status: 'Pending', reapproval: false,
    start, end, entryPort: '', exitPort: '', route: '', najaf: [], pax, needHotel: pax, housed: 0, remarks: '',
    ...other,
  };
}

function approved(tourId: number, checkIn: string, checkOut: string, pax: number): Group {
  return {
    id: `${tourId}:1`, tourId, planId: 1, ref: `NKERP/TOUR/2026/${tourId}`, tourNo: String(tourId),
    office: '', leader: '', pax, infants: 0, paxTotal: pax, paxNkerpHoused: 0, status: 'Approved',
    checkIn, checkOut, arrivalAt: null, departureAt: null, arrival: { kind: 'unknown', place: '', flight: null },
    departure: { kind: 'unknown', place: '', flight: null, airline: null }, secondLeg: false, notes: [],
  };
}

const defaults: Settings = {
  rooms: [{ beds: 4, count: 1, labels: ['101'] }], ruyaCapacity: 4, arafCapacity: 4, departureDayRule: true,
};

function request(
  tours: PendingTour[],
  groups: Group[] = [],
  overrides: Partial<Settings> = {},
  inputs: ApprovalRequest['inputs'] = {},
  extra: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  const settings = { ...defaults, ...overrides };
  const coveredFrom = '2026-12-01';
  const coveredThrough = '2026-12-20';
  const fixed: Record<string, GroupInput | undefined> = Object.fromEntries(groups.map((g) => [g.id, inputs[g.tourId]]));
  const baseline = buildPlan({ groups, inputs: fixed, settings, from: coveredFrom, to: coveredThrough });
  return { pending: tours, approved: groups, baseline, inputs, settings, from: coveredFrom, to: coveredThrough, coveredFrom, coveredThrough, today: '2026-11-21', ...extra };
}

describe('Najaf hotel approval plans', () => {
  it('splits nights evenly, with exactly one extra Karbala night for odd trips', () => {
    for (const first of ['karbala', 'najaf'] as const) {
      const odd = balancedSegments('2026-12-28', '2027-01-04', first);
      expect(odd[0].city).toBe(first);
      expect(odd[0].from).toBe('2026-12-28');
      expect(odd[0].to).toBe(odd[1].from);
      expect(odd[1].to).toBe('2027-01-04');
      expect(odd.map((leg) => [leg.city, daysBetween(leg.from, leg.to)]).sort()).toEqual([['karbala', 4], ['najaf', 3]]);
      expect(balancedSegments('2026-12-01', '2026-12-11', first).map((leg) => daysBetween(leg.from, leg.to))).toEqual([5, 5]);
    }
  });

  it('backtracks on earlier recommendations to place both groups around approved occupancy', () => {
    const fixed = approved(1, '2026-12-03', '2026-12-05', 4);
    const tours = [
      pending(2, '2026-12-05', '2026-12-09', 4, { reapproval: true, route: 'Najaf → Karbala' }),
      pending(3, '2026-12-03', '2026-12-07', 4),
    ];
    const input = request(tours, [fixed]);
    const old = structuredClone(input.baseline);
    const proposal = buildApprovalPlan(input);
    expect(input.baseline).toEqual(old);
    expect(proposal.limited).toBe(false);
    expect(proposal).toMatchObject({ ruyaTours: 2, arafTours: 0, overflowTours: 0, heldTours: 0, ruyaGuestNights: 16 });
    expect(proposal.recommendations.map((r) => r.route?.nights)).toEqual([
      ['2026-12-07', '2026-12-08'], ['2026-12-05', '2026-12-06'],
    ]);
    expect(proposal.days.find((day) => day.date === '2026-12-04')).toMatchObject({ fixedRuya: 4, proposedRuya: 0, ruyaBedsUsed: 4 });
    expect(proposal.days.find((day) => day.date === '2026-12-05')).toMatchObject({ proposedRuya: 4, arrivals: [{ tourNo: '3', pax: 4, hotel: 'ruya' }] });
  });

  it('chooses opposite orders in an all-pending batch and keeps larger groups whole', () => {
    const tours = [pending(2, '2026-12-03', '2026-12-07', 4), pending(3, '2026-12-03', '2026-12-07', 3)];
    const plan = buildApprovalPlan(request(tours));
    expect(plan.ruyaTours).toBe(2);
    expect(new Set(plan.recommendations.map((r) => r.route?.segments[0].city)).size).toBe(2);
    expect(plan.days.every((day) => day.fixedRuya + day.proposedRuya <= plan.capacity)).toBe(true);

    const large = buildApprovalPlan(request([pending(4, '2026-12-03', '2026-12-07', 5)], [], { arafCapacity: 5 }));
    expect(large.recommendations[0]).toMatchObject({ pax: 5, hotel: 'araf', rooms: [] });
    expect(large.days.some((day) => day.proposedAraf === 5 && day.proposedRuya === 0)).toBe(true);
  });

  it('treats rooms as continuous inventory, including room and hotel pins', () => {
    const groups = [
      approved(11, '2026-12-03', '2026-12-04', 4), approved(12, '2026-12-04', '2026-12-05', 4),
      approved(13, '2026-12-05', '2026-12-06', 4), approved(14, '2026-12-06', '2026-12-07', 4),
    ];
    const settings = { rooms: [{ beds: 4, count: 2, labels: ['101', '102'] }], ruyaCapacity: 8 };
    const inputs = { 11: { roomNos: ['101'] }, 12: { roomNos: ['102'] }, 13: { roomNos: ['101'] }, 14: { roomNos: ['102'] } };
    const tour = pending(2, '2026-12-03', '2026-12-07', 4);
    expect(buildApprovalPlan(request([tour], groups, settings, inputs)).recommendations[0].hotel).toBe('araf');
    const pinned = buildApprovalPlan(request([tour], groups, settings, { ...inputs, 2: { roomNos: ['102'] } }));
    expect(pinned.recommendations[0]).toMatchObject({ hotel: null, issue: expect.stringContaining('exact rooms') });
  });

  it('honors saved counts and the Iraqi Airways departure-night rule without changing the split', () => {
    const tour = pending(2, '2026-12-02', '2026-12-09', 8, { exitPort: 'Najaf Airport', departureAirline: 'IA', departureFlight: 'IA 430' });
    const plan = buildApprovalPlan(request([tour], [], {}, { 2: { pax: 4 } }, { to: '2026-12-02' }));
    const [recommendation] = plan.recommendations;
    expect(recommendation).toMatchObject({ pax: 4, hotel: 'ruya', route: { hasDepartureDay: true } });
    expect(recommendation.route?.segments.map((leg) => daysBetween(leg.from, leg.to))).toEqual([4, 3]);
    expect(recommendation.route?.nights).toEqual(['2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09']);
    expect(plan.days.at(-1)).toMatchObject({ date: '2026-12-09', proposedRuya: 4 });
    expect(plan.ruyaGuestNights).toBe(16);
  });

  it('flags an unknown departure flight for review using the same booked nights as the Najaf plan', () => {
    const tour = pending(2, '2026-12-03', '2026-12-07', 4, { exitPort: 'Najaf Airport', route: 'Karbala → Najaf' });
    const early = approved(10, '2026-12-03', '2026-12-05', 4);
    const plan = buildApprovalPlan(request([tour], [early]));
    expect(plan.ruyaGuestNights).toBe(8);
    expect(plan.recommendations[0].route).toMatchObject({ needsFlightCheck: true, hasDepartureDay: false });
    expect(plan.days.find((d) => d.date === tour.end)).toMatchObject({ proposedRuya: 0 });
  });

  it('reconsiders room mixes when a later group needs the only four-bed room', () => {
    const settings = { rooms: [{ beds: 2, count: 2 }, { beds: 4, count: 1 }], ruyaCapacity: 8 };
    const fixed = approved(10, '2026-12-05', '2026-12-07', 8);
    const tours = [pending(2, '2026-12-03', '2026-12-07', 4, { reapproval: true }), pending(3, '2026-12-03', '2026-12-07', 4)];
    const plan = buildApprovalPlan(request(tours, [fixed], settings, { 3: { spec: '4x1' } }));
    expect(plan.ruyaTours).toBe(2);
    expect(plan.recommendations.map((r) => r.rooms.map((room) => room.beds))).toEqual([[2, 2], [4]]);
  });

  it('keeps a started re-approval’s balanced dates and holds unresolved tours for review', () => {
    const tour = pending(2, '2026-12-03', '2026-12-07', 4, {
      reapproval: true, route: 'Karbala → Najaf', najaf: [{ checkIn: '2026-12-05', checkOut: '2026-12-07' }],
    });
    const plan = buildApprovalPlan(request([
      tour,
      pending(3, '2026-12-02', '2026-12-07', 4, { reapproval: true }),
      pending(4, '2026-12-06', '2026-12-07', 4),
      pending(5, '2026-12-06', '2026-12-09', 0, { unclassified: 3 }),
      pending(6, '2026-12-06', '2026-12-10', 0),
      pending(7, '2026-12-19', '2026-12-25', 4),
    ], [], {}, {}, { from: '2026-12-04', today: '2026-12-04' }));
    expect(plan.recommendations.find((r) => r.tour.tourId === 2)?.route?.nights).toEqual(['2026-12-05', '2026-12-06']);
    expect(plan.recommendations.find((r) => r.tour.tourId === 6)).toBeUndefined();
    expect(plan.heldTours).toBe(4);
  });

  it('sends an itinerary with another city for review without replacing its recorded stops', () => {
    const tour = pending(2, '2026-12-03', '2026-12-09', 3, { route: 'Karbala → Kadhimiya → Najaf' });
    const proposal = buildApprovalPlan(request([tour]));
    expect(proposal.heldTours).toBe(1);
    expect(proposal.recommendations[0]).toMatchObject({ route: null, issue: expect.stringContaining('recorded itinerary') });
  });

  it('returns a feasible proposal when the optimization budget is reached', () => {
    const tours = Array.from({ length: 6 }, (_, i) => pending(i + 1, '2026-12-03', '2026-12-07', 4));
    const plan = buildApprovalPlan(request(tours), 1);
    expect(plan.limited).toBe(true);
    expect(plan.heldTours).toBe(0);
    expect(plan.recommendations).toHaveLength(6);
    expect(plan.days.every((day) => day.fixedRuya + day.proposedRuya <= plan.capacity)).toBe(true);
  });
});
