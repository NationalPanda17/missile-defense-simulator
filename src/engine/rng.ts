// Deterministic, serializable RNG (mulberry32). The state lives inside SimState so saves replay identically.
import type { SimState } from './types';

export function rand(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (s: SimState, a: number, b: number) => a + rand(s) * (b - a);
export const randInt = (s: SimState, a: number, b: number) => Math.floor(randRange(s, a, b + 1));
export function pick<T>(s: SimState, arr: T[]): T {
  return arr[Math.floor(rand(s) * arr.length)];
}
export function weightedPick<T>(s: SimState, items: { item: T; w: number }[]): T | undefined {
  const total = items.reduce((a, b) => a + Math.max(0, b.w), 0);
  if (total <= 0) return undefined;
  let r = rand(s) * total;
  for (const it of items) {
    r -= Math.max(0, it.w);
    if (r <= 0) return it.item;
  }
  return items[items.length - 1].item;
}

export const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
