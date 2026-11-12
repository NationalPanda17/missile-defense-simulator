// Tactical scenarios: presets and player-built setups for the campaign's tactical layer, with versioned
// export/import. Every scenario here is fictional; none recreates or is named after a real attack.
import { TACTICAL_CONFIG } from './config';
import { THREAT_CLASSES } from './equipment';
import type { TacticalSettings, ThreatClass } from './types';

export const TACTICAL_SCENARIO_VERSION = 1;
const KIND = 'mds-tactical-scenario';

/** Allowed range for each setting; imports and the builder are clamped to these. */
export const TACTICAL_LIMITS = {
  waveCount: [0.5, 2],
  waveSize: [0.5, 2.5],
  mix: [0, 3],
  surpriseRate: [0, 0.6],
  forecastRegions: [1, 3],
  decoys: [0, 3],
  budget: [-600, 1500],
} as const;

export interface TacticalPreset { id: string; name: string; description: string; settings: TacticalSettings }

const unitMix = (): Record<ThreatClass, number> => ({ slowDrone: 1, fastDrone: 1, cruise: 1, rocket: 1, ballistic: 1 });

/** Standard reproduces the campaign exactly as it plays with no tactical settings. */
export function standardTactical(): TacticalSettings {
  return {
    preset: 'standard', waveCount: 1, waveSize: 1, mix: unitMix(),
    surpriseRate: TACTICAL_CONFIG.surpriseRate, forecastRegions: TACTICAL_CONFIG.forecastRegions, decoys: 1, budget: 0,
  };
}

export const TACTICAL_PRESETS: TacticalPreset[] = [
  {
    id: 'standard', name: 'Standard', description: 'The campaign as designed: two forecast regions per phase, a mixed threat picture, occasional surprises.',
    settings: standardTactical(),
  },
  {
    id: 'coastal-saturation', name: 'Coastal Saturation',
    description: 'Big swarms of cheap drones and heavy decoy traffic. Counter-drone systems and good sensors pay off; expensive interceptors run dry.',
    settings: { ...standardTactical(), preset: 'coastal-saturation', waveSize: 1.8, mix: { slowDrone: 2.2, fastDrone: 1.8, cruise: 0.6, rocket: 0.5, ballistic: 0.2 }, decoys: 2, budget: 150 },
  },
  {
    id: 'long-night', name: 'Long Night',
    description: 'Twice as many waves, cruise-missile heavy, spread over three forecast regions. Magazines and resupply decide it.',
    settings: { ...standardTactical(), preset: 'long-night', waveCount: 2, waveSize: 0.8, mix: { slowDrone: 0.8, fastDrone: 1, cruise: 2.5, rocket: 0.6, ballistic: 0.6 }, forecastRegions: 3, budget: 300 },
  },
  {
    id: 'high-arc', name: 'High Arc',
    description: 'Fewer, heavier waves with many ballistic missiles. Upper-tier and long-range systems carry the defense.',
    settings: { ...standardTactical(), preset: 'high-arc', waveCount: 0.75, waveSize: 1.4, mix: { slowDrone: 0.5, fastDrone: 0.5, cruise: 1, rocket: 1.2, ballistic: 3 }, budget: 400 },
  },
  {
    id: 'thin-budget', name: 'Thin Budget',
    description: 'Less money, one forecast region and more surprises. Every credit spent on defenses is a credit not spent on the network.',
    settings: { ...standardTactical(), preset: 'thin-budget', forecastRegions: 1, surpriseRate: 0.45, budget: -400 },
  },
];

const clampTo = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Fill in and clamp any (possibly partial or untrusted) tactical settings. */
export function normalizeTactical(x: unknown): TacticalSettings {
  const d = standardTactical();
  const t = (x && typeof x === 'object' ? x : {}) as Partial<TacticalSettings>;
  const mixIn = (t.mix && typeof t.mix === 'object' ? t.mix : {}) as Partial<Record<ThreatClass, number>>;
  const mix = Object.fromEntries(THREAT_CLASSES.map((c) => [c, clampTo(mixIn[c], TACTICAL_LIMITS.mix, 1)])) as Record<ThreatClass, number>;
  if (THREAT_CLASSES.every((c) => mix[c] === 0)) mix.slowDrone = 1; // a scenario needs some threat
  return {
    preset: typeof t.preset === 'string' && t.preset.length <= 40 ? t.preset : 'custom',
    waveCount: clampTo(t.waveCount, TACTICAL_LIMITS.waveCount, d.waveCount),
    waveSize: clampTo(t.waveSize, TACTICAL_LIMITS.waveSize, d.waveSize),
    mix,
    surpriseRate: clampTo(t.surpriseRate, TACTICAL_LIMITS.surpriseRate, d.surpriseRate),
    forecastRegions: Math.round(clampTo(t.forecastRegions, TACTICAL_LIMITS.forecastRegions, d.forecastRegions)),
    decoys: clampTo(t.decoys, TACTICAL_LIMITS.decoys, d.decoys),
    budget: Math.round(clampTo(t.budget, TACTICAL_LIMITS.budget, d.budget)),
  };
}

export interface TacticalScenarioFile { kind: typeof KIND; v: number; name: string; tactical: TacticalSettings }

export function exportTacticalScenario(name: string, tactical: TacticalSettings): string {
  const file: TacticalScenarioFile = { kind: KIND, v: TACTICAL_SCENARIO_VERSION, name: name.slice(0, 80), tactical: normalizeTactical(tactical) };
  return JSON.stringify(file, null, 2);
}

/** Parse a scenario file. Returns null for anything that isn't a tactical scenario of a supported version. */
export function importTacticalScenario(text: string): { name: string; tactical: TacticalSettings } | null {
  try {
    const f = JSON.parse(text) as Partial<TacticalScenarioFile>;
    if (!f || f.kind !== KIND || f.v !== TACTICAL_SCENARIO_VERSION) return null;
    const name = typeof f.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 80) : 'Imported scenario';
    return { name, tactical: { ...normalizeTactical(f.tactical), preset: 'custom' } };
  } catch {
    return null;
  }
}
