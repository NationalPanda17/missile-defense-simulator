// Advisor mode: a complete defense for a region, proposed from the forecast, that the player can accept, change or
// ignore. Also used to defend against a player-written raid. Pure: nothing is placed until the caller does it.
import { TACTICAL_CONFIG } from './config';
import { EQUIPMENT_MAP, equipmentCost } from './equipment';
import { forecastTargets, inCity, placementError, previewDefense, spotNear } from './tactical';
import { execute } from './actions';
import { raidSettings } from './training';
import { createInitialState, defaultSettings } from './world';
import type { DefensePreview } from './tactical';
import type { Raid, RegionId, SimState, ThreatClass } from './types';

export interface Placement { equipmentId: string; x: number; y: number; cost: number; why: string }

/**
 * A layered defense for a region within a budget: medium-range batteries and guns on the sites the forecast waves
 * aim at, a sharp radar and a weather-proof one, and the specialists the forecast calls for. Most important first,
 * so a small budget still buys the pieces that matter most.
 */
export function proposeDefense(s: SimState, region: RegionId, budget: number): Placement[] {
  const t = s.tactical;
  if (!t?.enabled) return [];
  const targets = forecastTargets(s, region).map((x) => x.site);
  const sites = targets.length ? targets : t.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance);
  if (!sites.length) return [];
  const mix: Partial<Record<ThreatClass, number>> = previewDefense(s, region, 1)?.mix ?? {};
  const here = t.deployments.filter((d) => d.region === region);
  const has = (id: string, x: number, y: number, within: number) => here.some((d) => d.equipmentId === id && Math.hypot(d.x - x, d.y - y) <= within);
  const terrain = t.terrain?.[region];
  const wants: { id: string; site: number; why: string; skip?: boolean }[] = [
    { id: 'iris-t-slm', site: 0, why: 'medium-range cover over the most-threatened site' },
    { id: 'skynex', site: 0, why: 'guns for the drones there' },
    { id: 'sentinel', site: 0, why: 'a sharp radar to track low fliers and pick out decoys' },
    { id: 'iron-dome', site: 0, why: 'rockets are forecast', skip: !mix.rocket },
    { id: 'patriot-pac3', site: 0, why: 'ballistic missiles or gliders are forecast', skip: !mix.ballistic && !mix.hypersonic },
    { id: 'iris-t-slm', site: 1, why: 'medium-range cover over the next site' },
    { id: 'skynex', site: 1, why: 'guns for the drones there' },
    { id: 'iris-t-slm', site: 2, why: 'medium-range cover over a third site' },
    { id: 'skynex', site: 2, why: 'guns for the drones there' },
    { id: 'skynex', site: 3, why: 'guns on a fourth site' },
    { id: 'gm400', site: 0, why: 'a long-wave radar that sees through storms' },
    { id: 'decoy-emitter', site: 0, why: 'a lure for missiles that hunt radars', skip: s.settings.mode !== 'campaign' || s.phaseIndex === 0 },
  ];
  const out: Placement[] = [];
  let left = budget;
  let crew = Math.floor(s.personnel / TACTICAL_CONFIG.deployPersonnel);
  for (const w of wants) {
    const site = sites[w.site];
    const spec = EQUIPMENT_MAP.get(w.id);
    if (w.skip || !site || !spec) continue;
    const cost = equipmentCost(spec);
    if (cost > left || crew <= 0 || has(w.id, site.x, site.y, 12)) continue;
    // Beside the site, clear of systems already there and, for guns, clear of the city's buildings.
    let p: [number, number] | null = null;
    for (let ring = 0; ring < 5 && !p; ring++) {
      for (let a = 0; a < 8 && !p; a++) {
        const r = TACTICAL_CONFIG.urban.km + 1 + ring * 2;
        const q = spotNear(s, spec, region, site.x + Math.cos((a / 8) * Math.PI * 2 + out.length) * r, site.y + Math.sin((a / 8) * Math.PI * 2 + out.length) * r);
        if (!q || inCity(terrain, spec, q[0], q[1])) continue;
        if ([...here, ...out].some((d) => Math.hypot(d.x - q[0], d.y - q[1]) < 3)) continue;
        if (!placementError(s, spec, region, q[0], q[1])) p = q;
      }
    }
    if (!p) continue;
    out.push({ equipmentId: w.id, x: p[0], y: p[1], cost, why: `${w.why} (${site.name})` });
    left -= cost;
    crew -= 1;
  }
  return out;
}

/** Credits the computer keeps back for resupply when it defends a raid. */
const RAID_RESERVE = 150;

/** The defense the computer builds against a player-written raid: from the forecast alone, as a player would. */
export const computerDefense = (s: SimState, region: RegionId): Placement[] => proposeDefense(s, region, s.credits - RAID_RESERVE);

/**
 * A rehearsal for a raid's author: the raid is flown many times against the computer's defense on the raid's own
 * map, without starting a battle. The estimate counts every wave, including those kept out of the forecast.
 */
export function rehearseRaid(raid: Raid, runs = 30): { preview: DefensePreview; systems: number } | null {
  const s = createInitialState(raidSettings(raid, defaultSettings('training')));
  const plan = computerDefense(s, raid.region);
  for (const p of plan) execute(s, { type: 'deploy', equipmentId: p.equipmentId, region: raid.region, x: p.x, y: p.y });
  const preview = previewDefense(s, raid.region, runs, true);
  return preview ? { preview, systems: plan.length } : null;
}
