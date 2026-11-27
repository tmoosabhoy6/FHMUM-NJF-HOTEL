import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { HotelId } from '../../shared/types';
import { useNames } from '../lib/names';
import { useHue } from '../lib/tags';

/** A whole number that counts to its new value when it changes. */
export function Num({ value }: { value: number }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = node.current;
    if (!el) return;
    if (reduce || shown.current === value) {
      el.textContent = String(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shown.current = Math.round(v);
        el.textContent = String(shown.current);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return <span ref={node}>{value}</span>;
}

// ---- icons: one 16px set, 1.75 stroke ------------------------------------------------

const PATHS = {
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  sliders: 'M2.5 4.5h6m3 0h2m-11 7h2m3 0h6M10 3v3M6 10v3',
  message: 'M2.5 3.5h11v8h-6l-3 2.5v-2.5h-2z',
  download: 'M8 2.5v7.5m-3-3 3 3 3-3M3 13h10',
  copy: 'M5.5 5.5v-3h8v8h-3m-8-5h8v8h-8z',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  close: 'M4 4l8 8m0-8l-8 8',
  search: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zm3.6-1.4L14 14',
  chevron: 'M4 6l4 4 4-4',
  alert: 'M8 2.5 14 13H2zM8 6.5v3m0 1.8v.2',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zm0-9v3.2l2 1.3',
} as const;

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---- brand and tabs ----------------------------------------------------------------------

export function Brand() {
  return (
    <span className="brand">
      <svg className="brand-mark" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <path d="M11.4 2.5h7.2a2 2 0 0 1 1.5.7l5.4 6.2a2 2 0 0 1 .5 1.3V24a3.5 3.5 0 0 1-3.5 3.5h-15A3.5 3.5 0 0 1 4 24V10.7a2 2 0 0 1 .5-1.3l5.4-6.2a2 2 0 0 1 1.5-.7z" fill="currentColor" />
        <circle cx="15" cy="9.6" r="2.4" fill="var(--rail)" />
        <path d="M9.5 17h11M9.5 21.5h7" stroke="var(--rail)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="brand-name">
        <b>FH-MUM NJF</b>
        <span>Hotel Accommodation Planner</span>
      </span>
    </span>
  );
}

export type PlannerTab = 'najaf' | 'karbala' | 'approvals';
/** The tabs at the top: Najaf (the full planner), Karbala (hotel messages only) and Approvals. */
export function CityTabs({ tab, onTab }: { tab: PlannerTab; onTab: (tab: PlannerTab) => void }) {
  return (
    <nav className="city-tabs" aria-label="Planner">
      {(
        [
          ['najaf', 'Najaf'],
          ['karbala', 'Karbala Hotel Messages'],
          ['approvals', 'Najaf Approvals'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>
          {label}
        </button>
      ))}
    </nav>
  );
}

// ---- the tour tag ------------------------------------------------------------------------

/** A tour number as a luggage tag in that tour's colour (lib/tags.ts). */
export function TourTag({ no, title }: { no: string; title?: string }) {
  const hue = useHue();
  return (
    <span className="tag" style={hue(no)} title={title}>
      {no}
    </span>
  );
}

export function HotelChip({ hotel }: { hotel: HotelId }) {
  const names = useNames();
  return (
    <span className="chip" data-hotel={hotel}>
      {names[hotel]}
    </span>
  );
}

// ---- controls ---------------------------------------------------------------------------------

export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { id: T; label: string; count?: number; disabled?: boolean }[]; onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} disabled={o.disabled} onClick={() => onChange(o.id)}>
          {o.label}
          {o.count !== undefined ? <span className="seg-n">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A side panel that holds keyboard focus while it is open and gives it back when it closes. */
export function Drawer({ title, size = 'md', onClose, children }: { title: string; size?: 'md' | 'lg' | 'xl'; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current();
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [tabindex="0"]')].filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      <motion.aside
        ref={panel}
        className="drawer"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </motion.aside>
    </>
  );
}

export const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;
export const nightsText = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
export const groupsText = (n: number) => `${n} ${n === 1 ? 'group' : 'groups'}`;
