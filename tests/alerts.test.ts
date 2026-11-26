/// <reference types="node" />
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { unseen, unseenTours } from '../src/lib/alerts';
// @ts-expect-error plain JS module shared with the server
import { alertEmail, scheduledCheck, sendAlerts, startLease } from '../server/alerts.mjs';
// @ts-expect-error plain JS module shared with the server
import { mimeMessage } from '../server/gmail.mjs';
// @ts-expect-error plain JS module shared with the server
import { refreshFromNkerp } from '../server/pull.mjs';
// @ts-expect-error plain JS module shared with the server
import { fileStore, handleState } from '../server/state.mjs';

const office = 'Fayz E Husayni Trust Mumbai';
const from = '2026-12-01';
const to = '2026-12-15';
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const leg = (Id: number, SubvenueName: string, start: string, end: string) => ({
  Id, SubvenueName, StartDateTimeZone: `${start}T12:00:00`, EndDateTimeZone: `${end}T00:00:00`,
});

/** NKERP with one tour, 2696: `hotel` guests need a hotel, `faiz` are housed by NKERP. */
function upstream() {
  const state = { hotel: 42, faiz: 10, flight: 'FZ 123', plans: [leg(1, 'Najaf', '2026-12-03', '2026-12-07'), leg(2, 'Karbala', '2026-12-07', '2026-12-11')] };
  const client = {
    requests: 0,
    async login() {},
    async read(path: string) {
      this.requests += 1;
      const row = {
        TourId: 9001, ReferenceNo: 'FHM/2026/2696', Status: 'Approved', OfficeName: office, StartDate: '2026-12-03', EndDate: '2026-12-11',
        lstSubVenuePlan: state.plans,
        lstTransportItinerary: [{ Id: 1, ArrivalTransportCode: state.flight, ArrivalDateTimeZone: '2026-12-03T11:00:00', DepartureTransportCode: 'IA 441', DepartureDateTimeZone: '2026-12-11T09:00:00' }],
      };
      if (path.endsWith('GeneralSearchGroups')) return { lstGeneralGroupsSearch: [row], TotalRows: 1 };
      if (path.includes('getTourSubVenue')) return { TourPlan: { TourSubvenuePlan: state.plans } };
      return {
        Applicants: [
          ...Array.from({ length: state.hotel }, () => ({ AccomodationOptionId: 3 })),
          ...Array.from({ length: state.faiz }, () => ({ AccomodationOptionId: 2 })),
        ],
      };
    },
  };
  return { client, state };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'alerts-test-'));
  roots.push(root);
  const store = await fileStore(join(root, 'state.json'));
  const api = upstream();
  const sent: unknown[][] = [];
  const pull = () => refreshFromNkerp({ store, client: api.client, from, to, venue: 'najaf', office, onAlerts: async (alerts: unknown[]) => { sent.push(alerts); } });
  const request = (method: string, route: string, body?: unknown) => {
    const url = new URL(`http://test/api/state${route}`);
    return handleState(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url, store);
  };
  return { store, api, sent, pull, request };
}

const env = { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh', ALERT_EMAIL_TO: 'office@example.com' };

/** A stand-in for Google: records each email, or fails when told to. */
function fakeGoogle() {
  const emails: string[] = [];
  let fail = false;
  const fetchImpl = async (url: string, init: { body: string }) => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (fail) return new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 });
    const raw = JSON.parse(init.body).raw.replace(/-/g, '+').replace(/_/g, '/');
    emails.push(Buffer.from(raw, 'base64').toString('utf8'));
    return new Response('{}', { status: 200 });
  };
  return { emails, fetchImpl, setFail: (value: boolean) => { fail = value; } };
}

const decodeParts = (mime: string) =>
  [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)--/g)].map((m) => Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString('utf8'));

describe('tour change alerts', () => {
  it('finds a hotel pax change once, keeps it on the tour and updates the plan', async () => {
    const { api, sent, pull } = await setup();
    const first = await pull();
    expect(first.groups[0]).toMatchObject({ tourNo: '2696', pax: 42 });
    expect(sent).toEqual([]);

    api.state.hotel = 38;
    api.state.faiz = 14;
    const second = await pull();
    expect(second.groups[0].pax).toBe(38);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([expect.objectContaining({
      tourId: 9001, tourNo: '2696', route: 'Najaf 3 Dec–7 Dec, Karbala 7 Dec–11 Dec',
      changes: [{ field: 'hotelPax', before: '42', after: '38' }, { field: 'housed', before: '10', after: '14' }],
    })]);
    expect(second.meta.alerts[9001].entries).toHaveLength(1);

    const third = await pull();
    expect(sent).toHaveLength(1);
    expect(third.meta.alerts[9001].entries).toHaveLength(1);
  });

  it('reports date and flight changes, and ignores tours with nobody in a hotel', async () => {
    const { api, sent, pull } = await setup();
    await pull();
    api.state.plans = [leg(3, 'Najaf', '2026-12-04', '2026-12-08'), leg(4, 'Karbala', '2026-12-08', '2026-12-11')];
    api.state.flight = 'FZ 125';
    await pull();
    expect((sent[0] as { changes: unknown[] }[])[0].changes).toEqual([
      { field: 'dates', before: 'Najaf 3 Dec–7 Dec, Karbala 7 Dec–11 Dec', after: 'Najaf 4 Dec–8 Dec, Karbala 8 Dec–11 Dec' },
      { field: 'flights', before: 'in FZ 123, 3 Dec 11:00 · out IA 441, 11 Dec 09:00', after: 'in FZ 125, 3 Dec 11:00 · out IA 441, 11 Dec 09:00' },
    ]);

    api.state.hotel = 0;
    await pull();
    expect(sent).toHaveLength(2); // 38… → 0 still matters: the tour had hotel guests
    api.state.faiz = 30;
    await pull();
    expect(sent).toHaveLength(2); // all in Faiz accommodation before and after: not a hotel change
  });

  it('writes the email the way the office reads it', () => {
    const one = alertEmail([{ tourId: 1, tourNo: '2696', route: 'Najaf 3 Dec–7 Dec', at: '2026-11-26T09:15:00.000Z', changes: [{ field: 'hotelPax', before: '42', after: '38' }] }], 'https://app.test');
    expect(one.subject).toBe('Tour 2696: hotel pax changed from 42 to 38');
    expect(one.text).toContain('Tour 2696 (Najaf 3 Dec–7 Dec)\n- Hotel pax changed from 42 to 38');
    expect(one.text).toContain('Found 26 Nov 12:15 (Najaf time).');
    const many = alertEmail([
      { tourId: 1, tourNo: '2696', at: '2026-11-26T09:15:00.000Z', changes: [{ field: 'hotelPax', before: '42', after: '38' }] },
      { tourId: 2, tourNo: '2701', at: '2026-11-26T09:30:00.000Z', changes: [{ field: 'status', before: 'Approved', after: 'Awaiting re-approval' }] },
    ]);
    expect(many.subject).toBe('NKERP changes on 2 tours: 2696, 2701');

    const mime = mimeMessage({ to: ['a@example.com'], ...one });
    expect(mime).toMatch(/^To: a@example.com\r\nSubject: Tour 2696: hotel pax changed from 42 to 38\r\n/);
    expect(decodeParts(mime)[0]).toBe(one.text);
  });

  it('emails changes, keeps them when Gmail fails and sends them with the next check', async () => {
    const { store } = await setup();
    const google = fakeGoogle();
    const alert = (tourNo: string) => ({ tourId: Number(tourNo), tourNo, at: '2026-11-26T09:00:00.000Z', changes: [{ field: 'hotelPax', before: '42', after: '38' }] });

    google.setFail(true);
    await sendAlerts({ store, env, alerts: [alert('2696')], fetchImpl: google.fetchImpl });
    expect(await store.get('alertOutbox')).toHaveLength(1);
    expect(await store.get('monitor')).toMatchObject({ emailOn: true, email: { ok: false, message: expect.stringContaining('quota'), waiting: 1 } });

    google.setFail(false);
    await sendAlerts({ store, env, alerts: [alert('2701')], fetchImpl: google.fetchImpl });
    expect(google.emails).toHaveLength(1);
    expect(decodeParts(google.emails[0])[0]).toMatch(/Tour 2696[\s\S]*Tour 2701/);
    expect(await store.get('alertOutbox')).toEqual([]);
    expect((await store.get('monitor')).email).toMatchObject({ ok: true, tours: 2 });

    await sendAlerts({ store, env: {}, alerts: [alert('2702')], fetchImpl: google.fetchImpl });
    expect(google.emails).toHaveLength(1);
    expect((await store.get('monitor')).emailOn).toBe(false);
  });

  it('runs the scheduled check on the saved range, and waits while a staff pull is running', async () => {
    const { store, api, pull } = await setup();
    const google = fakeGoogle();
    const check = (at: string) => scheduledCheck({ store, client: api.client, env, office, fetchImpl: google.fetchImpl, now: () => at });

    await check('2026-11-26T09:00:00.000Z');
    expect((await store.get('monitor')).check).toMatchObject({ ok: false, message: expect.stringContaining('pull from NKERP once') });

    await pull();
    api.state.hotel = 38;
    await check('2026-11-26T09:15:00.000Z');
    expect(google.emails).toHaveLength(1);
    expect(google.emails[0]).toContain('Subject: Tour 2696: hotel pax changed from 42 to 38');
    expect((await store.readPull()).values.dataset).toMatchObject({ meta: { from, to }, groups: [{ pax: 38 }] });
    expect((await store.get('monitor')).check).toMatchObject({ ok: true, changed: 1 });

    await startLease(store, '2026-11-26T09:25:00.000Z');
    api.state.hotel = 30;
    await check('2026-11-26T09:30:00.000Z');
    expect((await store.get('monitor')).check.message).toMatch(/pull from the app was running/);
    expect(google.emails).toHaveLength(1);
  });

  it('shares "seen" marks, keeps server-only data private and combines unseen changes', async () => {
    const { request, store } = await setup();
    expect((await request('PATCH', '/seenAlerts', { 9001: '2026-11-26T09:00:00.000Z' })).status).toBe(200);
    expect((await request('PATCH', '/seenAlerts', { 9001: 'yesterday' })).status).toBe(400);
    expect((await request('PUT', '/monitor', { emailOn: true })).status).toBe(405);
    await store.put('alertOutbox', '[1]');
    await store.put('monitor', JSON.stringify({ every: 15 }));
    const { values } = await (await request('GET', '?since=0')).json();
    expect(values).toEqual({ seenAlerts: { 9001: '2026-11-26T09:00:00.000Z' }, monitor: { every: 15 } });

    const alert = {
      tourNo: '2696',
      entries: [
        { at: '2026-11-26T08:00:00.000Z', changes: [{ field: 'hotelPax' as const, before: '44', after: '42' }] },
        { at: '2026-11-26T09:00:00.000Z', changes: [{ field: 'hotelPax' as const, before: '42', after: '40' }] },
        { at: '2026-11-26T10:00:00.000Z', changes: [{ field: 'hotelPax' as const, before: '40', after: '38' }, { field: 'housed' as const, before: '10', after: '14' }] },
      ],
    };
    expect(unseen(9001, alert, {})!.changes[0]).toEqual({ field: 'hotelPax', before: '44', after: '38' });
    expect(unseen(9001, alert, { 9001: '2026-11-26T08:00:00.000Z' })).toMatchObject({ at: '2026-11-26T10:00:00.000Z', changes: [{ before: '42', after: '38' }, { field: 'housed' }] });
    expect(unseenTours({ alerts: { 9001: alert } } as never, { 9001: '2026-11-26T10:00:00.000Z' })).toEqual([]);
  });
});
