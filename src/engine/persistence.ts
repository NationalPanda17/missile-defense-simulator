// Save / load. Browser localStorage for the prototype; the same JSON payload is what a PostgreSQL backend would store.
import type { SimState } from './types';

export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type Slot = (typeof SLOTS)[number];
const KEY = (slot: string) => `mds.save.${slot}`;
export const SAVE_VERSION = 1;

export interface SaveMeta { slot: string; name: string; mode: string; hour: number; phase: string; savedAt: number }
interface SaveFile { v: number; meta: SaveMeta; state: SimState }

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveGame(state: SimState, slot: Slot): boolean {
  const st = storage();
  if (!st) return false;
  const file: SaveFile = { v: SAVE_VERSION, meta: metaOf(state, slot), state };
  try {
    st.setItem(KEY(slot), JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

function metaOf(state: SimState, slot: string): SaveMeta {
  return {
    slot, name: state.settings.name, mode: state.settings.mode, hour: state.hour,
    phase: state.phases[state.phaseIndex]?.name ?? '', savedAt: Date.now(),
  };
}

export function loadGame(slot: Slot): SimState | null {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(KEY(slot));
    if (!raw) return null;
    return validate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function listSaves(): SaveMeta[] {
  const st = storage();
  if (!st) return [];
  const out: SaveMeta[] = [];
  for (const slot of SLOTS) {
    try {
      const raw = st.getItem(KEY(slot));
      if (raw) out.push((JSON.parse(raw) as SaveFile).meta);
    } catch { /* ignore corrupt slot */ }
  }
  return out;
}

export function deleteSave(slot: Slot) {
  try { storage()?.removeItem(KEY(slot)); } catch { /* ignore */ }
}

export function exportJSON(state: SimState): string {
  return JSON.stringify({ v: SAVE_VERSION, meta: metaOf(state, 'export'), state } satisfies SaveFile);
}

export function importJSON(text: string): SimState | null {
  try {
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

function validate(f: unknown): SimState | null {
  const file = f as SaveFile;
  if (!file || typeof file !== 'object' || file.v !== SAVE_VERSION) return null;
  const err = stateShapeError(file.state);
  if (err) return null;
  file.state.paused = true;
  return file.state;
}

const MODES = ['campaign', 'sandbox', 'crisis', 'training'];
const STATUSES = ['briefing', 'running', 'complete'];

/** Structural check shared by the browser and the persistence service. Returns an error message or null. */
export function stateShapeError(x: unknown): string | null {
  const s = x as SimState;
  if (!s || typeof s !== 'object') return 'state must be an object';
  if (!Number.isInteger(s.hour) || s.hour < 0) return 'state.hour must be a non-negative integer';
  if (!s.settings || typeof s.settings.name !== 'string' || !MODES.includes(s.settings.mode)) return 'state.settings is invalid';
  if (!Number.isFinite(s.settings.seed)) return 'state.settings.seed is invalid';
  if (!STATUSES.includes(s.status)) return 'state.status is invalid';
  if (!Array.isArray(s.phases) || !s.phases.length || !Number.isInteger(s.phaseIndex) || !s.phases[s.phaseIndex]) return 'state.phases is invalid';
  if (!s.regions || typeof s.regions !== 'object' || Object.keys(s.regions).length !== 7) return 'state.regions is invalid';
  if (!Array.isArray(s.assets) || !s.assets.length) return 'state.assets is invalid';
  if (!Array.isArray(s.events) || !Array.isArray(s.history) || !Array.isArray(s.commands)) return 'state collections are invalid';
  if (!s.metrics || !s.counters) return 'state.metrics/counters missing';
  return null;
}
