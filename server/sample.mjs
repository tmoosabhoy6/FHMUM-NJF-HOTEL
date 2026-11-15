/**
 * Made-up groups for trying the planner without NKERP. Deterministic for a
 * given start date so screenshots and tests are repeatable. None of these
 * tours exist.
 */
import { addDays, airlineOf } from './nkerp/normalize.mjs';

const LEADERS = [
  'Shk Mustafa bhai Rangwala', 'M Huzaifa bhai Lokhandwala', 'Shk Aliasgar bhai Poonawala', 'M Burhanuddin bhai Kapasi',
  'Shk Taher bhai Electricwala', 'M Yusuf bhai Motiwala', 'Shk Abbas bhai Zaveri', 'M Hatim bhai Chitalwala',
  'Shk Murtaza bhai Dahodwala', 'M Idris bhai Kagalwala', 'Shk Qusai bhai Saifee', 'M Ammar bhai Vohra',
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runSample({ from, to = null, emit = () => {} }) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const step = (id, status, detail) => emit('step', { id, status, detail });
  const random = rng(Number(from.replaceAll('-', '')));
  const span = to ? Math.max(7, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1) : 31;

  step('signin', 'active', 'Opening sample data');
  await wait(350);
  step('signin', 'done', 'Sample data, not NKERP');
  step('tours', 'active', 'Making up approved Najaf tours');

  const groups = [];
  const sizes = [4, 6, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 34, 38, 45];
  const count = Math.round(span * 1.15);
  for (let i = 0; i < count; i += 1) {
    const offset = Math.floor(random() * (span + 4)) - 4;
    const nights = 2 + Math.floor(random() * 5);
    const checkIn = addDays(from, offset);
    const checkOut = addDays(checkIn, nights);
    const secondLeg = random() < 0.62;
    const route = random();
    const departure =
      !secondLeg
        ? { kind: 'transfer', place: 'KARBALA', flight: null }
        : route < 0.45
          ? { kind: 'airport', place: 'Najaf Airport', flight: random() < 0.5 ? 'IA 441' : 'IA 449' }
          : route < 0.7
            ? { kind: 'airport', place: 'Najaf Airport', flight: random() < 0.5 ? 'G9 374' : 'FZ 222' }
            : { kind: 'airport', place: 'Baghdad Airport', flight: random() < 0.5 ? 'MS 628' : 'RJ 841' };
    departure.airline = airlineOf(departure.flight);
    const pax = sizes[Math.floor(random() * sizes.length)];
    const tourNo = String(4100 + i * 7 + Math.floor(random() * 5));
    groups.push({
      id: `sample-${tourNo}`,
      tourId: 900000 + i,
      planId: 1,
      ref: `SAMPLE/TOUR/2026/${tourNo}`,
      tourNo,
      office: 'Sample office',
      leader: LEADERS[i % LEADERS.length],
      pax,
      paxTotal: pax + (random() < 0.25 ? Math.floor(random() * 8) : 0),
      paxNkerpHoused: 0,
      checkIn,
      checkOut,
      arrivalAt: `${checkIn}T${secondLeg ? '11:00' : '07:30'}:00`,
      departureAt: `${checkOut}T${departure.kind === 'transfer' ? '08:00' : '21:30'}:00`,
      arrival: secondLeg
        ? { kind: 'transfer', place: 'KARBALA', flight: null }
        : { kind: 'airport', place: random() < 0.6 ? 'Najaf Airport' : 'Baghdad Airport', flight: 'IA 442' },
      departure,
      secondLeg,
      seenIn: { tourList: true, dashboard: true },
      notes: [],
    });
  }
  const kept = groups
    .filter((g) => g.checkOut >= from && (!to || g.checkIn <= to))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.tourNo.localeCompare(b.tourNo));
  await wait(500);
  step('tours', 'done', `${kept.length} sample groups`);
  emit('tours', { approved: kept.length, selfHoused: kept.length, guests: kept.reduce((s, g) => s + g.pax, 0) });

  const through = to ?? kept.reduce((max, g) => (g.checkOut > max ? g.checkOut : max), from);
  const days = [];
  for (let d = from; d <= through; d = addDays(d, 1)) days.push(d);
  emit('days', { dates: days });
  step('transport', 'active', `Reading arrivals and departures for ${days.length} days`);
  for (let i = 0; i < days.length; i += 1) {
    await wait(45);
    emit('day', {
      date: days[i],
      read: i + 1,
      total: days.length,
      arriving: kept.filter((g) => g.checkIn === days[i]).reduce((s, g) => s + g.pax, 0),
      leaving: kept.filter((g) => g.checkOut === days[i]).reduce((s, g) => s + g.pax, 0),
    });
  }
  step('transport', 'done', `Arrivals and departures read for ${days.length} days`);
  step('match', 'active', 'Matching tours with their flights');
  await wait(300);
  step('match', 'done', `${kept.length} groups ready`);

  return {
    groups: kept,
    meta: {
      source: 'sample',
      office: 'Sample office',
      from,
      to,
      through,
      fetchedAt: new Date().toISOString(),
      approvedStays: kept.length,
      nkerpHousedOnly: 0,
      daysRead: days.length,
      requests: 0,
      seconds: 0,
    },
  };
}
