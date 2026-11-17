import { HOTEL_NAME, HOTEL_ORDER, REASON_LABEL } from '../../shared/engine';
import { dayLabel, fullDate } from '../../shared/dates';
import { describeRooms } from '../../shared/roomSpec';
import type { Group, Plan, PullMeta } from '../../shared/types';

const INK = 'FF13233B';
const FILL: Record<string, string> = { ruya: 'FFDCEFEC', araf: 'FFF6EBCF', c: 'FFF5DDE5' };

/** Builds the Excel report and hands it to the browser as a download. */
export async function exportPlan(plan: Plan, groups: Group[], meta: PullMeta) {
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
    { header: `Ruya (of ${plan.capacity.ruya})`, key: 'ruya', width: 16 },
    { header: `Araf (of ${plan.capacity.araf})`, key: 'araf', width: 16 },
    { header: 'Hotel C', key: 'c', width: 12 },
    { header: 'All guests', key: 'total', width: 12 },
    { header: 'Ruya beds free', key: 'free', width: 15 },
    { header: 'Arriving (tours)', key: 'in', width: 26 },
    { header: 'Leaving (tours)', key: 'out', width: 26 },
    { header: 'In Araf (tours)', key: 'arafTours', width: 26 },
    { header: 'In Hotel C (tours)', key: 'cTours', width: 26 },
    { header: 'Why Araf or Hotel C', key: 'why', width: 48 },
  ];
  const why = (ids: string[]) => {
    const reasons = new Map<string, string[]>();
    for (const id of ids) {
      const p = plan.placements[id];
      if (!p) continue;
      const label = p.overbooked ? 'Does not fit' : REASON_LABEL[p.reason];
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

  // ---- what to book --------------------------------------------------------
  const bookings = book.addWorksheet('Bookings to make');
  bookings.columns = [
    { header: 'Hotel', key: 'hotel', width: 12 },
    { header: 'First night', key: 'from', width: 16 },
    { header: 'Last night', key: 'to', width: 16 },
    { header: 'Nights', key: 'nights', width: 9 },
    { header: 'Guests', key: 'pax', width: 9 },
    { header: 'Tours', key: 'tours', width: 40 },
  ];
  for (const b of plan.bookings) {
    for (const step of b.steps) {
      const ids = b.groupIds.filter((id) => plan.placements[id]?.nights.some((n) => n >= step.from && n <= step.lastNight));
      bookings.addRow({
        hotel: HOTEL_NAME[b.hotel],
        from: fullDate(step.from),
        to: fullDate(step.lastNight),
        nights: Math.round((Date.parse(step.lastNight) - Date.parse(step.from)) / 86_400_000) + 1,
        pax: step.pax,
        tours: tours(ids),
      });
    }
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
    { header: 'Ruya rooms', key: 'rooms', width: 30 },
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
      hotel: HOTEL_NAME[p.hotel],
      why: [p.hotel === 'ruya' && !p.overbooked ? '' : `${p.overbooked ? 'Does not fit' : REASON_LABEL[p.reason]}.`, p.reason === 'fits' ? '' : p.detail, p.staysDepartureDay ? 'Departure day counted as a night.' : '']
        .filter(Boolean)
        .join(' '),
      spec: p.spec && p.specSource === 'typed' ? describeRooms(p.spec) : '',
      rooms: p.rooms.map((r) => r.label).join(', '),
    });
    row.getCell('hotel').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[p.hotel] } };
  }
  head(list);

  const buffer = await book.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `najaf-stays-${meta.from}-to-${plan.range.to}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
