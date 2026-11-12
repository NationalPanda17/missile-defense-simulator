// Weather and daylight in each theater. Decided from the scenario seed (never from the game's random streams), so the
// same campaign always has the same storms, and the briefing's forecast check can account for them exactly.
import type { RegionId, SimState } from './types';

/** Effects, in the game's own terms. */
export const WEATHER = {
  /** Sensors see this much of their normal range in a storm (rain, clutter, wind noise). */
  stormDetection: 0.6,
  /** Optically or infrared-aimed point defense hits this much less often at night. */
  nightKill: 0.75,
  /** Systems aimed by eye or infrared seeker, without their own radar. */
  nightLimited: ['zu-23-2', 'stinger', 'avenger'],
  /** Chance a 12-hour block brings a storm, by region. */
  stormChance: { NAM: 0.12, SAM: 0.18, EUR: 0.15, AFR: 0.12, MDE: 0.08, IPA: 0.25, POL: 0.22 } as Record<RegionId, number>,
  /** Local night: from 20:00 to 05:00. */
  night: [20, 5] as [number, number],
  /** Share of campaign waves moved to arrive at night. */
  nightRaids: 0.4,
};

/** Longitude of each theater's centre, for local time. */
const LON: Record<RegionId, number> = { NAM: -100, SAM: -60, EUR: 15, AFR: 20, MDE: 48, IPA: 108, POL: -40 };

/** Well-mixed hash of small integers → [0, 1) (MurmurHash3's finalizer after each input). */
export function hash01(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = (h ^ (x >>> 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h / 4294967296;
}

const REGION_NUM: Record<RegionId, number> = { NAM: 1, SAM: 2, EUR: 3, AFR: 4, MDE: 5, IPA: 6, POL: 7 };

/** Local hour of day (0-24) in a theater at a sim hour. The scenario starts at 06:00 UTC. */
export function localHour(s: SimState, region: RegionId, hour: number): number {
  const startUtc = new Date(s.startDate).getUTCHours() + new Date(s.startDate).getUTCMinutes() / 60;
  return (((startUtc + hour + LON[region] / 15) % 24) + 24) % 24;
}

export function isNight(s: SimState, region: RegionId, hour: number): boolean {
  const h = localHour(s, region, hour);
  return h >= WEATHER.night[0] || h < WEATHER.night[1];
}

/** A storm over the theater: the region's weather pattern, or a storm event the network is dealing with there. */
export function isStorm(s: SimState, region: RegionId, hour: number): boolean {
  const block = Math.floor(hour / 12);
  if (hash01(s.settings.seed, REGION_NUM[region], block, 0x57) < WEATHER.stormChance[region]) return true;
  return s.events.some((e) => e.templateId === 'storm' && e.region === region && e.isGenuine
    && e.occurredAt <= hour && (e.resolvedAt ?? e.deadline) >= hour && e.status !== 'dismissed' && e.status !== 'expired');
}

export interface Conditions { night: boolean; storm: boolean }
export const conditionsAt = (s: SimState, region: RegionId, hour: number): Conditions => ({ night: isNight(s, region, hour), storm: isStorm(s, region, hour) });

/** Storm windows (start, end hours) in a region between two hours, for forecasts. */
export function stormWindows(s: SimState, region: RegionId, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let h = Math.floor(from); h < to; h++) {
    if (!isStorm(s, region, h)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === h) last[1] = h + 1;
    else out.push([h, h + 1]);
  }
  return out;
}

/** The next night hour at or after `hour` (within a day). */
/** The night hour closest to `hour` within [lo, hi] (later wins a tie), or `hour` itself when there is none. */
export function nearestNightHour(s: SimState, region: RegionId, hour: number, lo: number, hi: number): number {
  for (let d = 0; d <= 12; d++) {
    for (const h of [hour + d, hour - d]) if (h >= lo && h <= hi && isNight(s, region, h)) return h;
  }
  return hour;
}

export function nextNightHour(s: SimState, region: RegionId, hour: number): number {
  for (let h = hour; h < hour + 24; h++) if (isNight(s, region, h)) return h;
  return hour;
}
