/// <reference types="node" />
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlan } from '../shared/engine';
import type { Group, PullMeta } from '../shared/types';
import { editInput, inputKey, tourInput, withHotelPax } from '../src/lib/inputs';
// @ts-expect-error plain JS module shared with the server
import { refreshFromNkerp } from '../server/pull.mjs';
// @ts-expect-error plain JS module shared with the server
import { fileStore, handleState } from '../server/state.mjs';

const office = 'Fayz E Husayni Trust Mumbai';
const from = '2026-12-01';
const to = '2026-12-15';
const rooms = { rooms: [{ beds: 2, count: 7 }], ruyaCapacity: 14, arafCapacity: 60, departureDayRule: true };
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const leg = (Id: number, SubvenueName: string, start: string, end: string) => ({
  Id, SubvenueName, StartDateTimeZone: `${start}T12:00:00`, EndDateTimeZone: `${end}T00:00:00`,
});
const normal = [leg(1, 'Najaf', '2026-12-03', '2026-12-07'), leg(2, 'Karbala', '2026-12-07', '2026-12-11')];
const changed = [leg(11, 'Karbala', '2026-12-03', '2026-12-09'), leg(12, 'Najaf', '2026-12-09', '2026-12-13')];

function upstream() {
  let plans = normal;
  let tourId = 401;
  let status = 'Approved';
  let pax = 28;
  let invalid = false;
  let omit = false;
  const client = {
    requests: 0,
    async login() {},
    async read(path: string) {
      this.requests += 1;
      const row = { TourId: tourId, ReferenceNo: 'TOUR/2026/100', Status: status, OfficeName: office, StartDate: '2026-12-03', EndDate: '2026-12-13', lstSubVenuePlan: status === 'Pending' ? [] : plans };
      if (path.endsWith('GeneralSearchGroups')) return invalid ? {} : { lstGeneralGroupsSearch: omit ? [] : [row], TotalRows: omit ? 0 : 1 };
      if (path.includes('getTourSubVenue')) return { TourPlan: { IsReApproval: status === 'Pending', TourSubvenuePlan: plans } };
      return { Applicants: Array.from({ length: pax }, () => ({ AccomodationOptionId: 3 })) };
    },
  };
  return {
    client,
    set(options: { plans?: typeof plans; tourId?: number; status?: string; pax?: number; invalid?: boolean; omit?: boolean }) {
      ({ plans = plans, tourId = tourId, status = status, pax = pax, invalid = invalid, omit = omit } = options);
    },
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'stays-test-'));
  roots.push(root);
  const path = join(root, 'state.json');
  const store = await fileStore(path);
  const request = (method: string, route: string, body?: unknown) => {
    const url = new URL(`http://test/api/state${route}`);
    return handleState(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url, store);
  };
  const api = upstream();
  const pull = (venue = 'najaf', first = from, last = to) => refreshFromNkerp({ store, client: api.client, from: first, to: last, venue, office });
  return { store, path, request, api, pull };
}

describe('shared NKERP planning', () => {
  it('preserves independent room and pax edits, applies them to the plan and flags the same tour after a route swap', async () => {
    const { request, api, pull, path } = await setup();
    const initial = await pull();
    expect(initial.groups[0]).toMatchObject({ tourId: 401, pax: 28, checkIn: '2026-12-03' });
    expect(initial.meta.changes).toEqual([]);
    const oldPlan = buildPlan({ groups: initial.groups, inputs: {}, settings: rooms, from, to });
    expect(oldPlan.placements['401:1'].hotel).toBe('araf');

    await Promise.all([
      request('PATCH', '/inputs/tour-401', { legacyKey: null, changes: { pax: 10, paxBefore: 28 } }),
      request('PATCH', '/inputs/tour-401', { legacyKey: null, changes: { spec: '2x5' } }),
      request('PATCH', '/karbalaInputs/tour-401', { legacyKey: null, changes: { pax: 8, paxBefore: 28 } }),
    ]);
    api.set({ plans: changed, pax: 30 });
    const refreshed = await pull();
    const { values } = await (await request('GET', '?since=0')).json();
    expect(values.karbalaDataset.groups[0]).toMatchObject({ tourId: 401, checkIn: '2026-12-03', checkOut: '2026-12-09' });
    expect(values.karbalaDataset.meta.changes[0].tourId).toBe(401);
    expect(values.karbalaInputs['tour-401'].pax).toBe(8);
    expect(values.inputs['tour-401']).toEqual({ pax: 10, paxBefore: 28, spec: '2x5' });
    expect(values).not.toHaveProperty('pullHistory');
    expect(refreshed.meta.changes).toEqual([expect.objectContaining({ tourId: 401, before: expect.arrayContaining(['Najaf 2026-12-03 to 2026-12-07']), after: expect.arrayContaining(['Najaf 2026-12-09 to 2026-12-13']) })]);
    const effective = withHotelPax(refreshed.groups, values.inputs);
    expect(effective[0]).toMatchObject({ pax: 10, nkerpPax: 30, paxBefore: 28, checkIn: '2026-12-09' });
    const plan = buildPlan({ groups: effective, inputs: { [effective[0].id]: tourInput(values.inputs, effective[0]) }, settings: rooms, from, to });
    expect(plan.placements['401:12']).toMatchObject({ hotel: 'ruya', beds: 10 });
    expect(plan.days.find((day) => day.date === '2026-12-09')!.hotels.ruya.pax).toBe(10);

    api.set({ plans: changed.map((stay) => ({ ...stay, Id: stay.Id + 10 })) });
    const sameDates = await pull();
    expect(sameDates.meta.changes).toEqual([]);
    expect(sameDates.meta.reapprovals[401]).toEqual(refreshed.meta.reapprovals[401]);
    const reopened = await fileStore(path);
    expect((await reopened.readPull()).values.dataset.groups[0].checkIn).toBe('2026-12-09');
    expect((await reopened.list(0)).rows.some((row: { key: string }) => row.key === 'inputs')).toBe(true);
  });

  it('keeps the prior state after an incomplete pull, and tracks pending tours and moves beyond the range', async () => {
    const { request, api, pull } = await setup();
    await pull();
    api.set({ plans: changed, status: 'Pending' });
    const pending = await pull();
    expect(pending.groups).toEqual([]);
    expect(pending.meta.pending[0]).toMatchObject({ tourId: 401, reapproval: true, stays: [{ checkIn: '2026-12-09', checkOut: '2026-12-13' }] });
    expect(pending.meta.awaiting).toEqual([{ tourId: 401, tourNo: '100' }]);
    expect(pending.meta.changes).toHaveLength(1);

    api.set({ status: 'Approved' });
    await pull();
    api.set({ invalid: true });
    const before = await (await request('GET', '')).json();
    await expect(pull()).rejects.toThrow(/incomplete tour list/);
    expect(await (await request('GET', '')).json()).toEqual(before);

    api.set({ invalid: false, omit: true, plans: [leg(20, 'Najaf', '2026-12-22', '2026-12-25')] });
    const moved = await pull();
    expect(moved.groups).toEqual([]);
    expect(moved.meta.changes).toEqual([expect.objectContaining({ tourId: 401, after: ['Najaf 2026-12-22 to 2026-12-25'] })]);
  });

  it('keeps separate city ranges and treats a matching display number with a new tour ID as a new tour', async () => {
    const { api, pull, store } = await setup();
    const original = await pull();
    await store.put('dataset', JSON.stringify({ ...original, meta: { ...original.meta, legacyInputKeys: undefined } }));
    const karbala = await pull('karbala', '2026-12-05', '2026-12-14');
    expect(karbala.meta.from).toBe('2026-12-05');
    expect((await store.readPull()).values.dataset.meta.from).toBe(from);
    api.set({ tourId: 402, plans: changed });
    const next = await pull();
    const newTour = next.groups[0];
    expect(newTour).toMatchObject({ tourId: 402, tourNo: '100' });
    expect(next.meta.changes.some((change: { tourId: number }) => change.tourId === 402)).toBe(false);
    expect(tourInput({ '100': { spec: '2x3' }, 'tour-401': { pax: 7 } }, newTour, next.meta)).toBeUndefined();
  });

  it('does not let an older concurrent pull replace both snapshots after another pull saves', async () => {
    const { store, api, pull } = await setup();
    let release!: () => void;
    let started!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const stale = refreshFromNkerp({
      store, client: { ...api.client, login: async () => { started(); await wait; } }, from, to, venue: 'najaf', office,
    });
    const rejected = expect(stale).rejects.toThrow(/Another NKERP pull saved first/);
    await entered;
    const winner = await pull('najaf', '2026-12-02');
    release();
    await rejected;
    expect((await store.readPull()).values.dataset.meta.from).toBe(winner.meta.from);
  });

  it('keeps zero pax editable and can restore the NKERP count without resurrecting an old room request', () => {
    const group = { id: '401:1', tourId: 401, tourNo: '100', pax: 28 } as Group;
    const meta = { legacyInputKeys: { 401: '100' } } as unknown as PullMeta;
    const edited = editInput({ '100': { spec: '2x5' } }, inputKey(group), '100', { pax: 0, spec: null });
    expect(withHotelPax([group], edited, meta)[0]).toMatchObject({ pax: 0, nkerpPax: 28 });
    const restored = editInput(edited, inputKey(group), '100', { pax: null });
    expect(withHotelPax([group], restored, meta)[0]).toBe(group);
    expect(tourInput(restored, group, meta)).toEqual({});
  });
});
