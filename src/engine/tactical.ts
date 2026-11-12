// Tactical layer state helpers. Engine rules for deployment and threat waves arrive in later stages.
import { EQUIPMENT_MAP } from './equipment';
import { TACTICAL_CONFIG } from './config';
import type { SimState, TacticalState } from './types';
import { REGION_IDS } from './types';

export function emptyTactical(): TacticalState {
  return { deployments: [] };
}

/** Give a state from before the tactical layer an empty tactical state. Safe to call on any state. */
export function ensureTactical(state: SimState): TacticalState {
  state.tactical ??= emptyTactical();
  return state.tactical;
}

/** Structural check for the optional tactical state. Returns an error message or null. */
export function tacticalShapeError(t: unknown): string | null {
  if (t === undefined) return null;
  const tac = t as TacticalState;
  if (!tac || typeof tac !== 'object' || !Array.isArray(tac.deployments)) return 'state.tactical is invalid';
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  for (const d of tac.deployments) {
    if (!d || typeof d.id !== 'string' || !EQUIPMENT_MAP.has(d.equipmentId)) return 'state.tactical deployment has unknown equipment';
    if (!REGION_IDS.includes(d.region)) return 'state.tactical deployment has an invalid region';
    if (!(d.x >= 0 && d.x <= width && d.y >= 0 && d.y <= height)) return 'state.tactical deployment is outside the theater';
    if (!Number.isFinite(d.stock) || d.stock < 0) return 'state.tactical deployment stock is invalid';
  }
  return null;
}
