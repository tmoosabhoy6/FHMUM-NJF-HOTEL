/**
 * Tour change alerts: the email, the automatic check, and its status.
 *
 * A change is found once, by the pull that first sees it (pull.mjs), whether
 * staff pulled or the scheduled check did. It is emailed straight away; if
 * Gmail fails, it waits in `alertOutbox` and goes with the next check.
 * `monitor` (shown under "Hotels and rooms") records the last check and email.
 */
import { NkerpError } from './nkerp/client.mjs';
import { emailConfigured, recipients, sendGmail } from './gmail.mjs';
import { refreshFromNkerp } from './pull.mjs';

export const DEFAULT_APP_URL = 'https://najaf-stays.tmoosabhoy6.workers.dev';
/** Minutes between scheduled checks: keep in step with `triggers.crons` in wrangler.jsonc. */
export const CHECK_MINUTES = 15;
/** A staff pull started this recently (and not finished) makes the scheduled check wait for the next turn. */
const LEASE_MS = 10 * 60_000;
const MAX_QUEUE = 200;

export const FIELD_LABEL = {
  hotelPax: 'Hotel pax',
  housed: 'Faiz accommodation',
  infants: 'Infants (hotel)',
  status: 'Status',
  flights: 'Flights',
  dates: 'Dates',
};

const najafTime = (iso) => {
  const d = new Date(Date.parse(iso) + 3 * 3_600_000);
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()} ${month} ${d.toISOString().slice(11, 16)}`;
};
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const changeLine = ({ field, before, after }) => `${FIELD_LABEL[field] ?? field} changed from ${before} to ${after}`;

/** Groups queued alerts by tour, oldest first. */
function byTour(alerts) {
  const tours = new Map();
  for (const alert of alerts) {
    const tour = tours.get(alert.tourId) ?? { tourId: alert.tourId, tourNo: alert.tourNo, route: alert.route, changes: [] };
    tour.route = alert.route || tour.route;
    tour.changes.push(...alert.changes);
    tours.set(alert.tourId, tour);
  }
  return [...tours.values()];
}

/** The email: one line per change, grouped by tour. */
export function alertEmail(alerts, appUrl = DEFAULT_APP_URL) {
  const tours = byTour(alerts);
  const first = tours[0];
  const subject = tours.length === 1 && first.changes.length === 1
    ? `Tour ${first.tourNo}: ${changeLine(first.changes[0]).replace(/^./, (c) => c.toLowerCase())}`
    : tours.length === 1
      ? `Tour ${first.tourNo}: ${first.changes.length} changes in NKERP`
      : `NKERP changes on ${tours.length} tours: ${tours.slice(0, 4).map((t) => t.tourNo).join(', ')}${tours.length > 4 ? '…' : ''}`;
  const found = najafTime(alerts.at(-1).at);
  const text = [
    ...tours.flatMap((t) => [`Tour ${t.tourNo}${t.route ? ` (${t.route})` : ''}`, ...t.changes.map((c) => `- ${changeLine(c)}`), '']),
    `The plan is already updated. Open it: ${appUrl}`,
    `Found ${found} (Najaf time).`,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1d2a26;line-height:1.45">
${tours.map((t) => `<p style="margin:0 0 4px"><b>Tour ${escape(t.tourNo)}</b>${t.route ? ` <span style="color:#5b6b66">(${escape(t.route)})</span>` : ''}</p>
<ul style="margin:0 0 14px;padding-left:20px">${t.changes.map((c) => `<li>${escape(FIELD_LABEL[c.field] ?? c.field)} changed from <s style="color:#8a5a00">${escape(c.before)}</s> to <b>${escape(c.after)}</b></li>`).join('')}</ul>`).join('\n')}
<p style="margin:0 0 4px">The plan is already updated. <a href="${escape(appUrl)}">Open the planner</a>.</p>
<p style="margin:0;color:#5b6b66;font-size:12px">Found ${escape(found)} (Najaf time).</p>
</div>`;
  return { subject, text, html };
}

async function record(store, part) {
  const current = (await store.get('monitor')) ?? {};
  await store.put('monitor', JSON.stringify({ ...current, every: CHECK_MINUTES, ...part }));
}

/**
 * Emails `alerts` together with any that are still waiting from a failed
 * send. Never throws: a failure is kept in the outbox and shown in the app.
 */
export async function sendAlerts({ store, env, alerts = [], fetchImpl, now = () => new Date().toISOString() }) {
  try {
    const on = emailConfigured(env);
    const waiting = (await store.get('alertOutbox')) ?? [];
    const queue = [...waiting, ...alerts].slice(-MAX_QUEUE);
    if (!queue.length) {
      await record(store, { emailOn: on });
      return;
    }
    if (!on) {
      // Nothing to send with: keep the app's highlights only.
      await record(store, { emailOn: false });
      return;
    }
    try {
      await sendGmail(env, alertEmail(queue, env.APP_URL || DEFAULT_APP_URL), fetchImpl);
      await store.put('alertOutbox', '[]');
      await record(store, { emailOn: true, email: { at: now(), ok: true, tours: new Set(queue.map((a) => a.tourId)).size, to: recipients(env).length } });
    } catch (error) {
      await store.put('alertOutbox', JSON.stringify(queue));
      await record(store, { emailOn: true, email: { at: now(), ok: false, message: error.message, waiting: queue.length } });
    }
  } catch (error) {
    console.error('[alerts]', error);
  }
}

/** Marks a staff pull as running, so the scheduled check does not race it. */
export const startLease = (store, now = new Date().toISOString()) => store.put('pullLease', JSON.stringify({ at: now }));
export const endLease = (store) => store.put('pullLease', JSON.stringify({ at: null }));

/**
 * The scheduled check: pulls NKERP again for the saved Najaf and Karbala
 * ranges (exactly like "Pull again"), so the plan stays current and every
 * change is found and emailed without anyone opening the app.
 */
export async function scheduledCheck({ store, client, env, office, fetchImpl, now = () => new Date().toISOString() }) {
  const started = now();
  let sent = false;
  const onAlerts = async (alerts) => {
    sent = true;
    await sendAlerts({ store, env, alerts, fetchImpl, now });
  };
  try {
    const lease = await store.get('pullLease');
    if (lease?.at && Date.parse(started) - Date.parse(lease.at) < LEASE_MS) {
      await record(store, { check: { at: started, ok: true, message: 'Skipped: a pull from the app was running.' } });
      return;
    }
    const { values } = await store.readPull();
    const base = ['dataset', 'karbalaDataset']
      .map((key) => ({ key, meta: values[key]?.meta }))
      .find(({ meta }) => meta?.source === 'nkerp');
    if (!base) {
      await record(store, { check: { at: started, ok: false, message: 'Nothing to check yet: pull from NKERP once in the app.' } });
      return;
    }
    let changed = 0;
    await refreshFromNkerp({
      store, client, office, signal: undefined, emit: () => {},
      from: base.meta.from, to: base.meta.to, venue: base.key === 'dataset' ? 'najaf' : 'karbala',
      onAlerts: async (alerts) => {
        changed = new Set(alerts.map((a) => a.tourId)).size;
        await onAlerts(alerts);
      },
    });
    await record(store, { check: { at: started, ok: true, changed, message: changed ? `${changed} ${changed === 1 ? 'tour' : 'tours'} changed.` : 'No changes.' } });
  } catch (error) {
    const known = error instanceof NkerpError;
    if (!known) console.error('[check]', error);
    const conflict = known && error.code === 'pull-conflict';
    await record(store, {
      check: { at: started, ok: conflict, message: conflict ? 'Skipped: a pull from the app saved first.' : known ? error.message : 'The check stopped because of an unexpected error.' },
    }).catch(() => {});
  } finally {
    // Retry anything a failed email left waiting.
    if (!sent) await sendAlerts({ store, env, fetchImpl, now });
  }
}
