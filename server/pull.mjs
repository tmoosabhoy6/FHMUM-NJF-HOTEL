import { NkerpError } from './nkerp/client.mjs';
import { runSync } from './nkerp/sync.mjs';

const KEY = { najaf: 'dataset', karbala: 'karbalaDataset' };
const CITY = { najaf: 'Najaf', karbala: 'Karbala' };
const date = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
};

export const validPullRange = (from, to) => date(from) && (!to || (date(to) && to >= from));

function previousRoutes(datasets) {
  const routes = {};
  for (const [venue, key] of Object.entries(KEY)) {
    const data = datasets[key];
    if (data?.meta.source !== 'nkerp') continue;
    for (const group of data.groups) {
      const route = (routes[group.tourId] ??= []);
      route.push({ city: CITY[venue], from: group.checkIn, to: group.checkOut });
    }
    for (const tour of data.meta.pending ?? []) {
      const route = (routes[tour.tourId] ??= []);
      for (const stay of tour.stays ?? tour.najaf ?? []) {
        route.push({ city: CITY[venue], from: stay.checkIn, to: stay.checkOut });
      }
    }
  }
  return routes;
}

const labels = (route) => route.map(({ city, from, to }) => `${city} ${from} to ${to}`);
const sameRoute = (a, b) => JSON.stringify(labels(a).sort()) === JSON.stringify(labels(b).sort());
const listedTours = (data) => [...data.groups, ...(data.meta.pending ?? [])];
const idsIn = (data) => new Set(listedTours(data).map((t) => String(t.tourId)));

function legacyInputKeys(data) {
  if (data?.meta.source !== 'nkerp') return {};
  if (data.meta.legacyInputKeys) return data.meta.legacyInputKeys;
  const byNumber = new Map();
  for (const { tourId, tourNo } of listedTours(data)) {
    const number = String(Number(tourNo) || tourNo).trim();
    const owner = byNumber.get(number);
    byNumber.set(number, owner === undefined || owner === tourId ? tourId : null);
  }
  return Object.fromEntries([...byNumber].filter(([number, owner]) => number && owner != null).map(([number, owner]) => [owner, number]));
}

export function reconcilePull(saved, datasets, observations) {
  const before = previousRoutes(saved);
  const visible = new Set(datasets.flatMap((data) => [...idsIn(data)]));
  const history = { ...saved.pullHistory };
  const changed = {};
  for (const [id, next] of Object.entries(observations)) {
    if (!visible.has(id) && !before[id] && !history[id]) continue;
    const previous = history[id];
    const legacy = before[id];
    // Old datasets only kept the selected city's stays. Compare those dates
    // against the same city in the new route when establishing a baseline.
    const oldRoute = previous?.route ?? legacy;
    const newComparison = previous || !legacy
      ? next.route
      : next.route.filter(({ city, from, to }) => {
        const old = saved[KEY[city.toLowerCase()]]?.meta;
        return old && legacy.some((leg) => leg.city === city) && to >= old.from && (!old.to || from <= old.to);
      });
    const differs = oldRoute?.length && !sameRoute(oldRoute, newComparison);
    if (differs) {
      changed[id] = { tourNo: next.tourNo, before: labels(oldRoute), after: labels(next.route), at: datasets[0].meta.fetchedAt };
    }
    history[id] = { ...next, change: changed[id] ?? previous?.change };
  }
  const values = { pullHistory: history };
  for (const data of datasets) {
    const key = KEY[data.meta.venue];
    const relevant = idsIn(data);
    if (saved[key]?.meta.source === 'nkerp') {
      for (const id of idsIn(saved[key])) relevant.add(id);
    }
    const changes = [...relevant].filter((id) => changed[id]).map((id) => ({ tourId: Number(id), ...changed[id] }));
    const reapprovals = Object.fromEntries([...idsIn(data)].filter((id) => history[id]?.change).map((id) => [id, history[id].change]));
    const awaiting = (data.meta.pending ?? []).filter((t) => t.reapproval && !saved[key]?.meta.pending?.some((old) => old.tourId === t.tourId && old.reapproval));
    values[key] = { ...data, meta: { ...data.meta, legacyInputKeys: legacyInputKeys(saved[key]), changes, reapprovals, awaiting: awaiting.map(({ tourId, tourNo }) => ({ tourId, tourNo })) } };
  }
  return values;
}

/** Saves both city views together, against the exact baseline this pull read. */
export async function refreshFromNkerp({ store, client, from, to, venue, office, emit, signal }) {
  const { values: saved, version } = await store.readPull();
  const otherVenue = venue === 'najaf' ? 'karbala' : 'najaf';
  const other = saved[KEY[otherVenue]]?.meta;
  const otherRange = other?.source === 'nkerp' && validPullRange(other.from, other.to)
    ? { from: other.from, to: other.to }
    : { from, to };
  const tracked = Object.entries(KEY).flatMap(([city, key]) => {
    const data = saved[key];
    if (data?.meta.source !== 'nkerp') return [];
    const pending = (data.meta.pending ?? []).flatMap((t) => {
      const stays = t.stays ?? t.najaf ?? [];
      const dated = stays.length ? stays : (t.start && t.end ? [{ checkIn: t.start, checkOut: t.end }] : []);
      return dated.map((stay) => ({ ...stay, tourId: t.tourId, tourNo: t.tourNo }));
    });
    return [...data.groups, ...pending].map((g) => ({
      venue: city, tourId: Number(g.tourId), tourNo: g.tourNo, checkIn: g.checkIn, checkOut: g.checkOut,
    }));
  });
  const { companion, observations, ...primary } = await runSync({
    client, from, to, venue, otherRange, tracked, office, emit, signal,
  });
  signal?.throwIfAborted();
  const values = reconcilePull(saved, [primary, companion], observations);
  if (!await store.savePull(version, values)) {
    throw new NkerpError('Another NKERP pull saved first. Its plan is available now. Pull again if you still need this date range.', { status: 409, code: 'pull-conflict' });
  }
  return values[KEY[venue]];
}
