import { describe, expect, it } from 'vitest';
import { assignHues, HUES } from '../src/lib/tags';

const tour = (tourNo: string, from: string, to: string) => ({ tourNo, from, to });

describe('tag colours', () => {
  it('gives tours in the same nights different colours', () => {
    const spans = Array.from({ length: 12 }, (_, i) => tour(String(4100 + i), '2026-12-01', '2026-12-05'));
    const hues = assignHues(spans);
    expect(new Set(hues.values()).size).toBe(12);
    for (const hue of hues.values()) expect(HUES).toContain(hue);
  });

  it('keeps overlapping tours apart across a busy month', () => {
    const spans = Array.from({ length: 40 }, (_, i) => {
      const day = 1 + ((i * 7) % 26);
      const from = `2026-12-${String(day).padStart(2, '0')}`;
      const to = `2026-12-${String(Math.min(31, day + 2 + (i % 3))).padStart(2, '0')}`;
      return tour(String(4200 + i * 3), from, to);
    });
    const hues = assignHues(spans);
    for (const a of spans) {
      const near = spans.filter((b) => b !== a && b.from <= a.to && b.to >= a.from);
      if (near.length < HUES.length) for (const b of near) expect(hues.get(b.tourNo), `${a.tourNo} and ${b.tourNo}`).not.toBe(hues.get(a.tourNo));
    }
  });

  it('gives a tour one colour for both its cities, and the same colours on every run', () => {
    const spans = [tour('4300', '2026-12-01', '2026-12-04'), tour('4300', '2026-12-04', '2026-12-08'), tour('4301', '2026-12-07', '2026-12-09')];
    const hues = assignHues(spans);
    expect(hues.size).toBe(2);
    expect(hues.get('4300')).not.toBe(hues.get('4301'));
    expect([...assignHues([...spans].reverse())]).toEqual(expect.arrayContaining([...hues]));
  });
});
