import { createContext, useContext, type CSSProperties } from 'react';

/** Twelve tag colours as hues, 30 degrees apart. */
export const HUES = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345];

const hash = (text: string) => {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
};
const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

export interface TagSpan {
  tourNo: string;
  /** First and last date the tour is in Iraq or in the city, YYYY-MM-DD. */
  from: string;
  to: string;
}

export type TagHues = Map<string, number>;

/**
 * One colour per tour, the same on every screen. Tours whose dates overlap never share a
 * colour while there are colours left, and each new tour takes the colour furthest from
 * the ones around it. The result only depends on the tours pulled, so it is stable.
 */
export function assignHues(spans: readonly TagSpan[]): TagHues {
  const tours = new Map<string, TagSpan>();
  for (const s of spans) {
    const seen = tours.get(s.tourNo);
    tours.set(s.tourNo, seen ? { tourNo: s.tourNo, from: s.from < seen.from ? s.from : seen.from, to: s.to > seen.to ? s.to : seen.to } : s);
  }
  const order = [...tours.values()].sort((a, b) => a.from.localeCompare(b.from) || a.tourNo.localeCompare(b.tourNo, undefined, { numeric: true }));
  const hues: TagHues = new Map();
  const placed: (TagSpan & { hue: number })[] = [];
  for (const tour of order) {
    const near = placed.filter((p) => p.from <= tour.to && p.to >= tour.from).map((p) => p.hue);
    const start = hash(tour.tourNo) % HUES.length;
    let best = HUES[start];
    let bestScore = -1;
    for (let i = 0; i < HUES.length; i += 1) {
      const hue = HUES[(start + i) % HUES.length];
      const uses = near.filter((n) => n === hue).length;
      // Unused colours first; among them, the one furthest from its neighbours.
      const score = (near.length ? Math.min(...near.map((n) => apart(n, hue))) : 0) - uses * 1000;
      if (score > bestScore || bestScore === -1) {
        best = hue;
        bestScore = score;
      }
    }
    hues.set(tour.tourNo, best);
    placed.push({ ...tour, hue: best });
  }
  return hues;
}

export const TagContext = createContext<TagHues>(new Map());

/** The tag colour of a tour, as a style that sets its hue. */
export function useHue() {
  const hues = useContext(TagContext);
  return (tourNo: string) => ({ '--h': hues.get(tourNo) ?? HUES[hash(tourNo) % HUES.length] }) as CSSProperties;
}
