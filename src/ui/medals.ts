// The player's medals, kept in this browser. Earned when a game ends; some unlock map themes.
import { MEDALS, THEME_UNLOCKS, earnedMedals, type SimState } from '../engine';

const KEY = 'mds.medals';
const listeners = new Set<() => void>();
let cache: string[] | null = null;

export function loadMedals(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && MEDALS.some((m) => m.id === x)) : [];
  } catch { cache = []; }
  return cache;
}

export function subscribeMedals(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Award whatever this finished game earned. Returns the medals that are new. */
export function awardMedals(s: SimState): { id: string; name: string }[] {
  if (s.status !== 'complete') return [];
  const have = loadMedals();
  const fresh = earnedMedals(s).filter((id) => !have.includes(id));
  if (!fresh.length) return [];
  cache = [...have, ...fresh];
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  listeners.forEach((f) => f());
  return fresh.map((id) => ({ id, name: MEDALS.find((m) => m.id === id)!.name }));
}

/** Is a map theme unlocked with the medals held? */
export const themeUnlocked = (id: string, medals = loadMedals().length) => (THEME_UNLOCKS.find((t) => t.id === id)?.medals ?? Infinity) <= medals;
