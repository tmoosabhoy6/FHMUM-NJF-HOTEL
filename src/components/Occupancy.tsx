import { useState, type CSSProperties } from 'react';
import { dayLabel, dayNumber, monthShort, weekdayShort } from '../../shared/dates';

export interface OccSeries {
  /** Colour hook: ruya, ruya-new, araf or c. */
  id: string;
  label: string;
}

export interface OccDay {
  date: string;
  /** Guests per series, in the same order as `series`. */
  values: number[];
  /** Extra words for the readout, e.g. "71 Ruya beds free". */
  note?: string;
}

interface Props {
  series: OccSeries[];
  days: OccDay[];
  /** Beds in the first hotel, drawn as a line across the chart. */
  capacity: number;
  capLabel: string;
  selected?: string | null;
  onPick?: (date: string) => void;
}

const STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Guests in each hotel, night by night: one stacked column per night against the first hotel's beds. */
export function Occupancy({ series, days, capacity, capLabel, selected, onPick }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(capacity, ...days.map((d) => d.values.reduce((a, b) => a + b, 0)));
  const step = STEPS.find((s) => (peak * 1.12) / s <= 5) ?? 2000;
  const top = Math.ceil((peak * 1.12) / step) * step;
  const pct = (n: number) => `${(n / top) * 100}%`;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const shown = hover !== null ? days[hover] : null;

  return (
    <div className="occ" data-dense={days.length > 45}>
      <div className="occ-head">
        <ul className="occ-legend">
          {series.map((s) => (
            <li key={s.id} data-s={s.id}>
              <i aria-hidden="true" />
              {s.label}
            </li>
          ))}
          <li data-s="cap">
            <i aria-hidden="true" />
            {capLabel}
          </li>
        </ul>
        <p className="occ-read">
          {shown ? (
            <>
              <b>{dayLabel(shown.date)}</b>
              {series.map((s, i) => (
                <span key={s.id}>
                  {s.label} {shown.values[i]}
                </span>
              ))}
              {shown.note ? <span>{shown.note}</span> : null}
            </>
          ) : onPick ? (
            'Point at a night for its numbers. Click to open it.'
          ) : (
            'Point at a night for its numbers.'
          )}
        </p>
      </div>
      <div className="occ-scroll">
        <div className="occ-plot" style={{ '--n': days.length } as CSSProperties}>
          <div className="occ-grid" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: pct(t) }}>
                <em>{t}</em>
              </span>
            ))}
            <span className="occ-capline" style={{ bottom: pct(capacity) }} />
          </div>
          <div className="occ-cols">
            {days.map((d, i) => {
              const total = d.values.reduce((a, b) => a + b, 0);
              const first = i === 0 || d.date.endsWith('-01');
              const text = `${dayLabel(d.date)}: ${series.map((s, j) => `${s.label} ${d.values[j]}`).join(', ')}${d.note ? `, ${d.note}` : ''}`;
              const body = (
                <>
                  <span className="occ-bar">
                    {total ? <b className="occ-total">{total}</b> : null}
                    <span className="occ-stack" style={{ height: pct(total) }}>
                      {d.values.map((v, j) => (v > 0 ? <i key={series[j].id} data-s={series[j].id} style={{ flexGrow: v }} /> : null))}
                    </span>
                  </span>
                  <span className="occ-x" data-fri={new Date(`${d.date}T00:00:00Z`).getUTCDay() === 5}>
                    <b>{dayNumber(d.date)}</b>
                    <small>{weekdayShort(d.date).slice(0, 2)}</small>
                    <em>{first ? monthShort(d.date) : ''}</em>
                  </span>
                </>
              );
              const common = {
                className: 'occ-col',
                'data-on': selected === d.date,
                'data-hover': hover === i,
                onMouseEnter: () => setHover(i),
                onMouseLeave: () => setHover((h) => (h === i ? null : h)),
              };
              return onPick ? (
                <button key={d.date} type="button" {...common} aria-label={text} onFocus={() => setHover(i)} onBlur={() => setHover((h) => (h === i ? null : h))} onClick={() => onPick(d.date)}>
                  {body}
                </button>
              ) : (
                <div key={d.date} {...common} role="img" aria-label={text}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
