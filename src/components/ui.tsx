import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

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
      duration: 0.7,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => {
        shown.current = Math.round(v);
        el.textContent = String(shown.current);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={node} className="num">
      {value}
    </span>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        {[1, 0, 0, 0, 1, 0, 0, 0, 1].map((on, i) => (
          <i key={i} className={on ? 'on' : ''} />
        ))}
      </span>
      Najaf stays
    </span>
  );
}

export const Chevron = ({ dir = 'down', size = 14 }: { dir?: 'down' | 'left' | 'right'; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: dir === 'left' ? 'rotate(90deg)' : dir === 'right' ? 'rotate(-90deg)' : undefined }}
  >
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </svg>
);

export const guests = (n: number) => `${n} ${n === 1 ? 'guest' : 'guests'}`;
export const nightsText = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;
export const groupsText = (n: number) => `${n} ${n === 1 ? 'group' : 'groups'}`;

/** Soft tints for telling groups apart on the room board. */
const TINTS: [string, string][] = [
  ['#cfe8e4', '#0a4f4d'],
  ['#f3e2b6', '#6a4705'],
  ['#f1d3dd', '#73203c'],
  ['#d6dcf2', '#27366e'],
  ['#dfe9c8', '#3f5212'],
  ['#f5d9c4', '#7a3b12'],
  ['#d9e6f0', '#1f4a66'],
  ['#e6d8ee', '#55306e'],
  ['#d3ece0', '#135438'],
  ['#ecdcc6', '#5e4420'],
];
export function tint(key: string): { background: string; ink: string } {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [background, ink] = TINTS[h % TINTS.length];
  return { background, ink };
}
