import { DEFAULT_HOTEL_NAMES, HOTEL_ORDER, reasonLabel } from '../../shared/engine';
import { dayLabel, fullDate } from '../../shared/dates';
import { describeRooms } from '../../shared/roomSpec';
import type { Group, HotelNames, Plan, PullMeta } from '../../shared/types';
import { bookingRows, legText } from './bookings';

const INK = 'FF13233B';
const FILL: Record<string, string> = { ruya: 'FFDCEFEC', araf: 'FFF6EBCF', c: 'FFF5DDE5' };

/** Builds the Excel report and hands it to the browser as a download. */
export async function exportPlan(plan: Plan, groups: Group[], meta: PullMeta, names: HotelNames = DEFAULT_HOTEL_NAMES) {
  const { Workbook } = (await import('exceljs')).default as unknown as typeof import('exceljs');
  const book = new Workbook();
  book.created = new Date();
  const byId = new Map(groups.map((g) => [g.id, g]));
  const tours = (ids: string[]) => ids.map((id) => byId.get(id)?.tourNo ?? id).join(', ');

  const head = (sheet: import('exceljs').Worksheet) => {
    const row = sheet.getRow(1);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    row.height = 22;
    row.alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // ---- one row per date ----------------------------------------------------
  const daily = book.addWorksheet('Daily plan');
  daily.columns = [
    { header: 'Date', key: 'date', width: 18 },
    { header: `${names.ruya} (of ${plan.capacity.ruya})`, key: 'ruya', width: 16 },
    { header: `${names.araf} (of ${plan.capacity.araf})`, key: 'araf', width: 16 },
    { header: names.c, key: 'c', width: 12 },
    { header: 'All guests', key: 'total', width: 12 },
    { header: `${names.ruya} beds free`, key: 'free', width: 15 },
    { header: 'Arriving (tours)', key: 'in', width: 26 },
    { header: 'Leaving (tours)', key: 'out', width: 26 },
    { header: `In ${names.araf} (tours)`, key: 'arafTours', width: 26 },
    { header: `In ${names.c} (tours)`, key: 'cTours', width: 26 },
    { header: `Why ${names.araf} or ${names.c}`, key: 'why', width: 48 },
  ];
  const why = (ids: string[]) => {
    const reasons = new Map<string, string[]>();
    for (const id of ids) {
      const p = plan.placements[id];
      if (!p) continue;
      const label = p.overbooked ? 'Does not fit' : reasonLabel(p.reason, names);
      reasons.set(label, [...(reasons.get(label) ?? []), byId.get(id)?.tourNo ?? id]);
    }
    return [...reasons].map(([label, list]) => `${label}: ${list.join(', ')}`).join('; ');
  };
  for (const day of plan.days) {
    const row = daily.addRow({
      date: dayLabel(day.date),
      ruya: day.hotels.ruya.pax,
      araf: day.hotels.araf.pax,
      c: day.hotels.c.pax,
      total: day.total,
      free: plan.capacity.ruya - (plan.rooms.length ? day.hotels.ruya.beds : day.hotels.ruya.pax),
      in: tours(day.arrivals),
      out: tours(day.departures),
      arafTours: tours(day.hotels.araf.groups),
      cTours: tours(day.hotels.c.groups),
      why: why([...day.hotels.araf.groups, ...day.hotels.c.groups]),
    });
    for (const hotel of HOTEL_ORDER) {
      if (day.hotels[hotel].pax > 0) {
        row.getCell(hotel).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[hotel] } };
      }
    }
  }
  head(daily);

  // ---- what to book: one row per tour per hotel stay --------------------------
  const bookings = book.addWorksheet('Bookings to make');
  bookings.columns = [
    { header: 'Hotel', key: 'hotel', width: 12 },
    { header: 'Tour', key: 'tour', width: 9 },
    { header: 'Group leader', key: 'leader', width: 30 },
    { header: 'First night', key: 'from', width: 16 },
    { header: 'Last night', key: 'to', width: 16 },
    { header: 'Nights', key: 'nights', width: 9 },
    { header: 'Guests', key: 'pax', width: 9 },
    { header: 'Arrival (flight)', key: 'arrival', width: 36 },
    { header: 'Departure (flight)', key: 'departure', width: 36 },
  ];
  for (const r of bookingRows(plan, byId)) {
    bookings.addRow({
      hotel: names[r.hotel],
      tour: Number(r.group.tourNo) || r.group.tourNo,
      leader: r.group.leader,
      from: fullDate(r.from),
      to: fullDate(r.lastNight),
      nights: r.nights,
      pax: r.group.pax,
      arrival: legText(r.group.arrival, r.group.arrivalAt, r.group.checkIn, 'From'),
      departure: legText(r.group.departure, r.group.departureAt, r.group.checkOut, 'To'),
    });
  }
  head(bookings);

  // ---- one row per group ---------------------------------------------------
  const list = book.addWorksheet('Groups');
  list.columns = [
    { header: 'Tour', key: 'tour', width: 9 },
    { header: 'Group leader', key: 'leader', width: 34 },
    { header: 'Guests', key: 'pax', width: 9 },
    { header: 'Arrives', key: 'in', width: 14 },
    { header: 'Leaves', key: 'out', width: 14 },
    { header: 'Nights', key: 'nights', width: 9 },
    { header: 'Departure', key: 'dep', width: 26 },
    { header: 'Hotel', key: 'hotel', width: 11 },
    { header: 'Why', key: 'why', width: 60 },
    { header: 'Rooms asked for', key: 'spec', width: 26 },
    { header: `${names.ruya} rooms`, key: 'rooms', width: 30 },
  ];
  for (const g of groups) {
    const p = plan.placements[g.id];
    if (!p) continue;
    const row = list.addRow({
      tour: Number(g.tourNo) || g.tourNo,
      leader: g.leader,
      pax: g.pax,
      in: fullDate(g.checkIn),
      out: fullDate(g.checkOut),
      nights: p.nights.length,
      dep: g.departure.kind === 'airport' ? `${g.departure.place} ${g.departure.flight ?? ''}`.trim() : `To ${g.departure.place || 'Karbala'}`,
      hotel: names[p.hotel],
      why: [p.hotel === 'ruya' && !p.overbooked ? '' : `${p.overbooked ? 'Does not fit' : reasonLabel(p.reason, names)}.`, p.reason === 'fits' ? '' : p.detail, p.staysDepartureDay ? 'Departure day counted as a night.' : '']
        .filter(Boolean)
        .join(' '),
      spec: p.spec && p.specSource === 'typed' ? describeRooms(p.spec) : '',
      rooms: p.rooms.map((r) => r.label).join(', '),
    });
    row.getCell('hotel').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[p.hotel] } };
  }
  head(list);

  // ---- tours not approved yet ----------------------------------------------
  if (meta.pending?.length) {
    const pending = book.addWorksheet('Pending tours');
    pending.columns = [
      { header: 'Tour', key: 'tour', width: 9 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Arrives', key: 'start', width: 14 },
      { header: 'Leaves', key: 'end', width: 14 },
      { header: 'Ports', key: 'ports', width: 32 },
      { header: 'Najaf', key: 'najaf', width: 26 },
      { header: 'Guests', key: 'pax', width: 9 },
      { header: 'Need a hotel', key: 'need', width: 13 },
      { header: 'Housed by NKERP', key: 'housed', width: 16 },
      { header: 'Note', key: 'note', width: 30 },
    ];
    for (const t of meta.pending) {
      pending.addRow({
        tour: Number(t.tourNo) || t.tourNo,
        status: t.status,
        start: t.start ? fullDate(t.start) : '',
        end: t.end ? fullDate(t.end) : '',
        ports: t.exitPort && t.exitPort !== t.entryPort ? `${t.entryPort} → ${t.exitPort}` : t.entryPort,
        najaf: t.najaf.length ? t.najaf.map((n) => `${fullDate(n.checkIn)} – ${fullDate(n.checkOut)}`).join('; ') : 'No dates in NKERP yet',
        pax: t.pax,
        need: t.needHotel ?? '',
        housed: t.housed ?? '',
        note: t.remarks,
      });
    }
    head(pending);
  }

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `najaf-stays-${meta.from}-to-${plan.range.to}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
