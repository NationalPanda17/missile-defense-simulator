// Save / load. Browser localStorage for the prototype; the same JSON payload is what a PostgreSQL backend would store.
import { ensureTactical, tacticalShapeError } from './tactical';
import type { SimState } from './types';

export const SLOTS = ['auto', 'autoacademy', 'autocrisis', 'autosandbox', 'slot1', 'slot2', 'slot3'] as const;
export type Slot = (typeof SLOTS)[number];

/** Each kind of play autosaves to its own slot, so a drill never overwrites a campaign ('auto' is the campaign's). */
export function autosaveSlot(s: { settings: { mode: string } }): Slot {
  switch (s.settings.mode) {
    case 'training': return 'autoacademy';
    case 'crisis': return 'autocrisis';
    case 'sandbox': return 'autosandbox';
    default: return 'auto';
  }
}

export const isAutosaveSlot = (slot: string) => slot.startsWith('auto');

/** A slot's name for people: "Autosave · Campaign", "SLOT1". */
export function slotLabel(slot: string): string {
  const auto: Record<string, string> = { auto: 'Campaign', autoacademy: 'Academy', autocrisis: 'Crisis', autosandbox: 'Sandbox' };
  return slot in auto ? `Autosave · ${auto[slot]}` : slot.toUpperCase();
}
const KEY = (slot: string) => `mds.save.${slot}`;
export const SAVE_VERSION = 1;

export interface SaveMeta { slot: string; name: string; mode: string; hour: number; phase: string; savedAt: number }
interface SaveFile { v: number; meta: SaveMeta; state: SimState }
/** A save whose state is packed so it does not read as plain text (see `pack`). */
interface SealedFile { v: number; meta: SaveMeta; sealed: string }

/**
 * A battle against another player's raid holds the whole raid, hidden waves included. Its saves are packed so the
 * defender cannot read the raid by opening the file. This keeps honest players honest; it is not encryption.
 */
const secret = (s: SimState) => !!s.settings.raid && !s.settings.raid.attacker && s.status !== 'complete';
function pack(state: SimState, slot: string): string {
  if (!secret(state)) return JSON.stringify({ v: SAVE_VERSION, meta: metaOf(state, slot), state } satisfies SaveFile);
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ (0x5a + (i % 7)));
  return JSON.stringify({ v: SAVE_VERSION, meta: metaOf(state, slot), sealed: btoa(bin) } satisfies SealedFile);
}
function unpack(sealed: string): SimState {
  const bin = atob(sealed);
  const bytes = Uint8Array.from(bin, (ch, i) => ch.charCodeAt(0) ^ (0x5a + (i % 7)));
  return JSON.parse(new TextDecoder().decode(bytes)) as SimState;
}

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
  try {
    st.setItem(KEY(slot), pack(state, slot));
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
  return pack(state, 'export');
}

export function importJSON(text: string): SimState | null {
  try {
    return validate(JSON.parse(text));
  } catch {
    return null;
  }
}

function validate(f: unknown): SimState | null {
  const raw = f as SaveFile | SealedFile;
  if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION) return null;
  const file = ('sealed' in raw && typeof raw.sealed === 'string' ? { ...raw, state: unpack(raw.sealed) } : raw) as SaveFile;
  const err = stateShapeError(file.state);
  if (err) return null;
  ensureTactical(file.state);
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
  if (s.settings.tactical !== undefined && (typeof s.settings.tactical !== 'object' || s.settings.tactical === null)) return 'state.settings.tactical is invalid';
  if (!STATUSES.includes(s.status)) return 'state.status is invalid';
  if (!Array.isArray(s.phases) || !s.phases.length || !Number.isInteger(s.phaseIndex) || !s.phases[s.phaseIndex]) return 'state.phases is invalid';
  if (!s.regions || typeof s.regions !== 'object' || Object.keys(s.regions).length !== 7) return 'state.regions is invalid';
  if (!Array.isArray(s.assets) || !s.assets.length) return 'state.assets is invalid';
  if (!Array.isArray(s.events) || !Array.isArray(s.history) || !Array.isArray(s.commands)) return 'state collections are invalid';
  if (!s.metrics || !s.counters) return 'state.metrics/counters missing';
  return tacticalShapeError(s.tactical);
}
