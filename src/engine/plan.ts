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
  const forecast = forecastTargets(s, region);
  const targets = forecast.map((x) => x.site);
  const sites = targets.length ? targets : t.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance);
  if (!sites.length) return [];
  const mix: Partial<Record<ThreatClass, number>> = previewDefense(s, region, 1)?.mix ?? {};
  const here = t.deployments.filter((d) => d.region === region);
  const has = (id: string, x: number, y: number, within: number) => here.some((d) => d.equipmentId === id && Math.hypot(d.x - x, d.y - y) <= within);
  const terrain = t.terrain?.[region];
  // How much of the expected damage each kind of threat carries, and how much of it is aimed at each site: what is
  // bought first follows the forecast, so a raid of gliders gets an upper-tier battery before any gun.
  const D = TACTICAL_CONFIG.threatDamage;
  const dmg = (c: ThreatClass) => (mix[c] ?? 0) * D[c];
  const all = (Object.keys(D) as ThreatClass[]).reduce((a, c) => a + dmg(c), 0) || 1;
  const share = { drones: (dmg('slowDrone') + dmg('fastDrone')) / all, cruise: dmg('cruise') / all, rocket: dmg('rocket') / all, high: (dmg('ballistic') + dmg('hypersonic')) / all };
  const threatAll = forecast.reduce((a, x) => a + x.threat, 0) || 1;
  const siteShare = (i: number) => (forecast[i] ? forecast[i].threat / threatAll : i === 0 ? 1 : 0.5 / (i + 1));
  const aimedAt = (i: number, cs: ThreatClass[]) => !forecast[i] || cs.some((c) => forecast[i].classes.includes(c));
  type Want = { id: string; site: number; why: string; skip?: boolean; value: number };
  const wants: Want[] = [];
  const known = forecast.length > 0;
  for (let i = 0; i < Math.min(4, sites.length); i++) {
    const w = siteShare(i);
    const low = known ? share.cruise + share.drones * 0.6 : 1;
    if (i < 3) wants.push({ id: 'iris-t-slm', site: i, why: i === 0 ? 'medium-range cover over the most-threatened site' : 'medium-range cover over another threatened site', value: low * w * 1.2, skip: known && !aimedAt(i, ['slowDrone', 'fastDrone', 'cruise']) });
    wants.push({ id: 'skynex', site: i, why: 'guns for the drones there', value: (known ? share.drones : 0.8) * w, skip: known && !aimedAt(i, ['slowDrone', 'fastDrone']) });
    wants.push({ id: 'iron-dome', site: i, why: 'rockets are forecast there', value: share.rocket * w * 1.3, skip: !mix.rocket || !aimedAt(i, ['rocket']) });
    wants.push({ id: 'patriot-pac3', site: i, why: 'ballistic missiles or gliders are forecast there', value: share.high * w * (i === 0 ? 1.1 : 0.7), skip: (!mix.ballistic && !mix.hypersonic) || !aimedAt(i, ['ballistic', 'hypersonic']) });
  }
  // Gliders need the upper tier: one battery that reaches the whole region, bought first when they are most of the raid.
  wants.push({ id: 'thaad', site: 0, why: 'gliders are forecast: an upper-tier battery that covers the whole region', value: share.high * 1.4, skip: !mix.hypersonic });
  wants.push({ id: 'sentinel', site: 0, why: 'a sharp radar to track low fliers and pick out decoys', value: known ? 0.12 + (share.drones + share.cruise) * 0.25 : 0.7 });
  wants.push({ id: 'gm400', site: 0, why: 'a long-wave radar that sees through storms', value: 0.04 });
  wants.push({ id: 'decoy-emitter', site: 0, why: 'a lure for missiles that hunt radars', value: 0.03, skip: s.settings.mode !== 'campaign' || s.phaseIndex === 0 });
  wants.sort((a, b) => b.value - a.value);
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
