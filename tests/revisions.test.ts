import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MAP, QUICK_BATTLE_ID, SIM_CONFIG, TACTICAL_CONFIG, computeScore, coverageAt, createInitialState, defaultSettings, evaluateObjectives, execute,
  incomePerHour, lessonSettings, objectiveMet, objectiveValue, placementError, quickBattle, recomputeMetrics, resupplyCost, roundCost, spawnEvent, withLevel,
  type RegionId, type SimState,
} from '../src/engine';

function spotAt(s: SimState, id: string, region: RegionId, x: number, y: number, minDist = 0, maxDist = 400) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = minDist; r <= maxDist; r += 4) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
const campaign = (seed: number, level: 'recruit' | 'officer' | 'commander' = 'officer') => createInitialState(withLevel({ ...defaultSettings('campaign'), seed }, level));

describe('damage has consequences', () => {
  it('cuts income and regional capability until sites are rebuilt', () => {
    const s = campaign(7);
    execute(s, { type: 'beginPhase' });
    recomputeMetrics(s);
    const income = incomePerHour(s);
    const ready = s.regions.EUR.readiness;
    const aware = s.regions.EUR.awareness;
    const global = s.metrics.globalReadiness;
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) site.integrity = 20;
    recomputeMetrics(s);
    expect(incomePerHour(s)).toBeLessThan(income * 0.85);
    expect(s.regions.EUR.readiness).toBeLessThan(ready * 0.8); // power stations
    expect(s.regions.EUR.awareness).toBeLessThan(aware * 0.8); // command post
    expect(s.metrics.globalReadiness).toBeLessThan(global);
    for (const site of s.tactical!.sites) site.integrity = 100;
    recomputeMetrics(s);
    expect(incomePerHour(s)).toBeCloseTo(income, 6);
  });
});

describe('interceptor rounds are priced by what they are', () => {
  it('makes a long-range round dearer than a drone, and gun rounds nearly free', () => {
    const sling = EQUIPMENT_MAP.get('davids-sling')!;
    const skynex = EQUIPMENT_MAP.get('skynex')!;
    expect(roundCost(sling)).toBeGreaterThan(TACTICAL_CONFIG.threatCost.slowDrone * 2);
    expect(roundCost(skynex)).toBeLessThan(TACTICAL_CONFIG.threatCost.slowDrone / 4);
    expect(roundCost(EQUIPMENT_MAP.get('iron-beam')!)).toBe(0);
    const s = campaign(4);
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', ...spotAt(s, 'davids-sling', 'EUR', site.x, site.y) });
    const d = s.tactical!.deployments[0];
    d.stock = sling.magazine - 10;
    expect(resupplyCost(d)).toBe(Math.ceil(10 * sling.roundCr!));
  });
});

describe('aircraft cueing has a reach', () => {
  it('lets a battery engage low fliers at three horizons with an aircraft radar, not at any range', () => {
    const far = campaign(4);
    const site = far.tactical!.sites.find((x) => x.region === 'EUR' && x.type === 'city')!;
    const reach = TACTICAL_CONFIG.lowAltitude.horizonKm * TACTICAL_CONFIG.lowAltitude.cuedHorizonMult;
    execute(far, { type: 'deploy', equipmentId: 'e-2d', region: 'EUR', x: site.x, y: site.y });
    execute(far, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', ...spotAt(far, 'davids-sling', 'EUR', site.x, site.y, reach * 2 + 50) });
    expect(coverageAt(far, 'EUR', site.x, site.y).cruise).toBe(0);
    expect(coverageAt(far, 'EUR', site.x, site.y).ballistic).toBeGreaterThan(0); // high fliers are not horizon-limited
    const near = campaign(4);
    execute(near, { type: 'deploy', equipmentId: 'e-2d', region: 'EUR', x: site.x, y: site.y });
    execute(near, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', ...spotAt(near, 'davids-sling', 'EUR', site.x, site.y, 60, 70) });
    expect(coverageAt(near, 'EUR', site.x, site.y).cruise).toBeGreaterThan(0);
  });
});

describe('fire orders', () => {
  const swarm = (doctrine?: 'missiles') => {
    const s = createInitialState(lessonSettings('drill-swarm', defaultSettings('training')));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) {
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spotAt(s, 'nasams', 'EUR', site.x, site.y) });
    }
    if (doctrine) for (const d of s.tactical!.deployments) expect(execute(s, { type: 'setDoctrine', deploymentId: d.id, doctrine }).ok).toBe(true);
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 12 });
    return s;
  };
  it('holds fire against drones and decoys on "missiles only"', () => {
    expect(swarm().tactical!.stats.shots).toBeGreaterThan(0);
    const held = swarm('missiles');
    const first = held.tactical!.waves.find((w) => w.resolved)!;
    expect(first.tracks.filter((x) => x.cls === 'slowDrone' || x.cls === 'fastDrone').every((x) => x.shots === 0)).toBe(true);
    expect(first.tracks.some((x) => (x.why ?? []).some((w) => Array.isArray(w) && w[1] === 'hold'))).toBe(true);
  });
  it('are refused for sensors', () => {
    const s = campaign(4);
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'sentinel', region: 'EUR', ...spotAt(s, 'sentinel', 'EUR', site.x, site.y) });
    expect(execute(s, { type: 'setDoctrine', deploymentId: s.tactical!.deployments[0].id, doctrine: 'backup' }).ok).toBe(false);
  });
});

describe('Quick Battle', () => {
  it('builds a different three-wave battle in one region from each seed, and can be played through', () => {
    const a = quickBattle(11);
    expect(a.waves.length).toBe(3);
    expect(new Set(a.waves.map((w) => w.region)).size).toBe(1);
    expect(quickBattle(11)).toEqual(a);
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => `${quickBattle(k).region}:${quickBattle(k).name}`)).size).toBeGreaterThan(3);
    const s = createInitialState(lessonSettings(QUICK_BATTLE_ID, { ...defaultSettings('training'), seed: 11 }));
    expect(s.tactical!.enabled).toBe(true);
    expect(s.tactical!.forecast).toEqual([a.region]);
    expect(s.tactical!.waves.length).toBe(3);
    for (const site of s.tactical!.sites.filter((x) => x.region === a.region).slice(0, 4)) {
      execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: a.region, ...spotAt(s, 'iris-t-slm', a.region, site.x, site.y) });
    }
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 40 });
    expect(s.status).toBe('complete');
    expect(s.tactical!.stats.tracks).toBeGreaterThan(10);
    expect(s.tactical!.stats.stopped).toBeGreaterThan(0);
  });
});

describe('objectives mean what they say', () => {
  it('judges "average over the phase" on every hour, not the last one', () => {
    const s = campaign(5);
    s.phaseIndex = 1;
    s.status = 'briefing';
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 10 });
    const before = objectiveValue(s, 'stabilityAvg');
    for (const r of Object.values(s.regions)) r.stability = 5; // a collapse in the final hour
    recomputeMetrics(s);
    expect(objectiveValue(s, 'stability')).toBeLessThan(10);
    expect(objectiveValue(s, 'stabilityAvg')).toBeCloseTo(before, 6);
  });
  it('passes a "raise it" objective for a network already at a high level, and counts every objective in the score', () => {
    const s = campaign(5);
    execute(s, { type: 'beginPhase' });
    s.metrics.globalReadiness = 90;
    expect(objectiveMet('readinessGain', 0, 4)).toBe(false);
    expect(objectiveMet('readinessGain', 0, 4, s)).toBe(true);
    const all = s.phases.reduce((a, p) => a + p.objectives.length, 0);
    for (const p of s.phases) for (const r of evaluateObjectives(s, p)) s.objectiveResults.push({ ...r, met: true });
    expect(computeScore(s).objectiveBonus).toBe(SIM_CONFIG.objectiveBonus);
    s.objectiveResults = s.objectiveResults.slice(0, all / 2).concat(s.objectiveResults.slice(all / 2).map((r) => ({ ...r, met: false })));
    expect(computeScore(s).objectiveBonus).toBeCloseTo(SIM_CONFIG.objectiveBonus / 2, 1);
  });
  it('takes the phase starting line before the briefing, so briefing maintenance cannot lower it', () => {
    const s = campaign(5);
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: s.phases[0].hours });
    expect(s.status).toBe('briefing');
    const line = s.phaseStart!.readiness;
    for (const a of s.assets.slice(0, 4)) execute(s, { type: 'maintain', assetId: a.id });
    execute(s, { type: 'beginPhase' });
    expect(s.phaseStart!.readiness).toBe(line);
  });
});

describe('confirmation is not a sure thing', () => {
  const result = (seed: number, mode: 'campaign' | 'training') => {
    const s = createInitialState(defaultSettings(mode, { seed }));
    execute(s, { type: 'beginPhase' });
    const e = spawnEvent(s, 'false_contact', { region: 'SAM', scripted: true })!;
    expect(execute(s, { type: 'confirm', eventId: e.id }).ok).toBe(true);
    execute(s, { type: 'advance', hours: 14 });
    return e.log.some((l) => l.text.includes('INCONCLUSIVE'));
  };
  it('sometimes comes back inconclusive in a campaign, never in training', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const n = seeds.filter((k) => result(k, 'campaign')).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(seeds.length / 2);
    expect(seeds.slice(0, 10).some((k) => result(k, 'training'))).toBe(false);
  });
});

describe('Commander: the enemy jams the band you lean on', () => {
  it('names the most-used radar band in the next phase\'s plan and intel', () => {
    const s = campaign(6, 'commander');
    const r = s.tactical!.forecast[0];
    const sites = s.tactical!.sites.filter((x) => x.region === r);
    for (const site of sites.slice(0, 3)) execute(s, { type: 'deploy', equipmentId: 'giraffe-4a', region: r, ...spotAt(s, 'giraffe-4a', r, site.x, site.y) });
    execute(s, { type: 'deploy', equipmentId: 'sentinel', region: r, ...spotAt(s, 'sentinel', r, sites[0].x, sites[0].y) });
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: s.phases[0].hours });
    expect(s.status).toBe('briefing');
    const plan = s.tactical!.enemy!.find((p) => p.phaseIndex === 1)!;
    expect(plan.jam).toBe('S');
    expect(plan.intel.text).toContain('S-band');
  });
});
