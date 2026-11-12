import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInitialState, defaultSettings, execute, computeScore, isActive, TEMPLATE_MAP, exportJSON, importJSON,
  EQUIPMENT, THREAT_CLASSES, LAYER_LABELS, equipmentCost, equipmentUpkeep, isEffector, stateShapeError,
  TACTICAL_CONFIG, EQUIPMENT_MAP, chordInside, ensureTactical, regionProtection, warningHours, incomingWaves,
} from '../src/engine';
import type { SimState } from '../src/engine';

function runCampaign(policy: (s: SimState) => void, seed = 7) {
  const s = createInitialState(defaultSettings('campaign', { seed }));
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 2000) {
    if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
    policy(s);
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

const passive = () => {};
const active = (s: SimState) => {
  for (const e of s.events.filter((e) => isActive(e) && e.reportedAt <= s.hour)) {
    if (e.status !== 'reported') continue;
    if (e.confidence < 55) { execute(s, { type: 'confirm', eventId: e.id }); continue; }
    const t = TEMPLATE_MAP.get(e.templateId)!;
    const r = t.responses.filter((r) => !r.passive).sort((a, b) => a.credits - b.credits)[0];
    if (r) execute(s, { type: 'respond', eventId: e.id, responseId: r.id });
  }
  for (const a of s.assets) if (a.hoursToService < 0 || a.condition < 60) execute(s, { type: 'maintain', assetId: a.id });
  if (s.credits > 900) execute(s, { type: 'invest', investmentId: 'resilience' });
};

describe('simulation engine', () => {
  it('runs a full campaign deterministically', () => {
    const a = runCampaign(passive, 11);
    const b = runCampaign(passive, 11);
    expect(a.status).toBe('complete');
    expect(a.hour).toBe(240);
    expect(a.metrics.globalReadiness).toBeCloseTo(b.metrics.globalReadiness, 6);
    expect(a.events.length).toBeGreaterThan(10);
  });

  it('an active commander outscores a passive one', () => {
    const scores = [3, 5, 9].map((seed) => {
      const p = computeScore(runCampaign(passive, seed));
      const act = runCampaign(active, seed);
      const q = computeScore(act);
      console.log(`seed ${seed}: passive ${p.total.toFixed(1)} (${p.grade}) active ${q.total.toFixed(1)} (${q.grade}) events ${act.events.length} esc ${act.counters.escalations} credits ${Math.round(act.credits)} ready ${act.metrics.globalReadiness.toFixed(0)}`);
      console.log('  passive', JSON.stringify(Object.fromEntries(Object.entries(p.components).map(([k, v]) => [k, Math.round(v)]))));
      console.log('  active ', JSON.stringify(Object.fromEntries(Object.entries(q.components).map(([k, v]) => [k, Math.round(v)]))));
      return [p.total, q.total];
    });
    for (const [p, q] of scores) expect(q).toBeGreaterThan(p);
  });

  it('rejects unaffordable commands and logs spending', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 1 }));
    execute(s, { type: 'beginPhase' });
    s.credits = 10;
    expect(execute(s, { type: 'invest', investmentId: 'modernize' }).ok).toBe(false);
    s.credits = 1000;
    expect(execute(s, { type: 'maintain', assetId: s.assets[0].id }).ok).toBe(true);
    expect(s.commands.at(-1)?.credits).toBeGreaterThan(0);
    expect(s.crewsBusy).toBe(1);
  });

  it('round-trips through JSON save', () => {
    const s = runCampaign(active, 2);
    const t = importJSON(exportJSON(s))!;
    expect(t.hour).toBe(s.hour);
    expect(t.events.length).toBe(s.events.length);
  });
});

describe('tactical layer: equipment catalog', () => {
  it('has unique ids and complete, sane figures', () => {
    expect(new Set(EQUIPMENT.map((e) => e.id)).size).toBe(EQUIPMENT.length);
    expect(EQUIPMENT.length).toBeGreaterThanOrEqual(30);
    for (const e of EQUIPMENT) {
      expect(e.name, e.id).toBeTruthy();
      expect(e.description, e.id).toBeTruthy();
      expect(LAYER_LABELS[e.layer], e.id).toBeTruthy();
      expect(e.rangeKm, e.id).toBeGreaterThan(0);
      expect(e.altitudeKm, e.id).toBeGreaterThan(0);
      expect(e.unitCostUsdM, e.id).toBeGreaterThan(0);
      expect(e.reactionSec, e.id).toBeGreaterThan(0);
      for (const t of THREAT_CLASSES) {
        expect(e.killRate[t], `${e.id} ${t}`).toBeGreaterThanOrEqual(0);
        expect(e.killRate[t], `${e.id} ${t}`).toBeLessThanOrEqual(1);
      }
      if (e.radar) expect(e.radar.rangeKm, e.id).toBeGreaterThan(0);
    }
  });

  it('sensors engage nothing and effectors carry a magazine', () => {
    for (const e of EQUIPMENT) {
      if (e.layer === 'detection') expect(isEffector(e), e.id).toBe(false);
      else {
        expect(isEffector(e), e.id).toBe(true);
        expect(e.magazine, e.id).toBeGreaterThan(0);
      }
    }
  });

  it('every threat class can be engaged by something', () => {
    for (const t of THREAT_CLASSES) expect(EQUIPMENT.some((e) => e.killRate[t] > 0), t).toBe(true);
  });

  it('named products list their official references', () => {
    // The ZU-23-2 is widely built with no single official source, so its figures are game values.
    for (const e of EQUIPMENT.filter((e) => !e.generic && e.id !== 'zu-23-2')) expect(e.sources.length, e.id).toBeGreaterThan(0);
  });

  it('compresses real costs into an affordable credit range', () => {
    const costs = EQUIPMENT.map(equipmentCost);
    expect(Math.min(...costs)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...costs)).toBeLessThan(400);
    for (const e of EQUIPMENT) expect(equipmentUpkeep(e), e.id).toBeGreaterThan(0);
  });
});

describe('tactical layer: state and saves', () => {
  it('new games carry a tactical state with a theater per region', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    const t = s.tactical!;
    expect(t.deployments).toEqual([]);
    const perRegion = TACTICAL_CONFIG.siteMix.reduce((a, m) => a + m.count, 0);
    expect(t.sites.length).toBe(perRegion * 7);
    for (const site of t.sites) expect(site.integrity).toBe(100);
  });

  it('is switched off by default, so campaigns play exactly as before', () => {
    expect(TACTICAL_CONFIG.enabledInCampaign).toBe(false);
    const s = runCampaign(passive, 11);
    expect(s.tactical!.enabled).toBe(false);
    expect(s.tactical!.waves).toEqual([]);
    expect(s.assets.some((a) => a.role === 'defense')).toBe(false);
  });

  it('loads a save made before the tactical layer', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    delete s.tactical;
    const t = importJSON(exportJSON(s))!;
    expect(t).not.toBeNull();
    expect(t.tactical!.sites.length).toBeGreaterThan(0);
    expect(t.tactical!.deployments).toEqual([]);
  });

  it('upgrades the first-release tactical shape', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    s.tactical = { deployments: [] } as never;
    const t = ensureTactical(s);
    expect(t.sites.length).toBeGreaterThan(0);
    expect(t.stats.tracks).toBe(0);
  });

  it('rejects malformed tactical state', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    const dep = { id: 'd1', equipmentId: 'iris-t-slm', assetId: 'TAC-1', region: 'EUR' as const, x: 100, y: 100, stock: 24, deployedAt: 0 };
    s.tactical!.deployments = [dep];
    expect(stateShapeError(s)).toBeNull();
    s.tactical!.deployments = [{ ...dep, equipmentId: 'not-real' }];
    expect(stateShapeError(s)).toMatch(/unknown equipment/);
    s.tactical!.deployments = [{ ...dep, x: 9999 }];
    expect(stateShapeError(s)).toMatch(/outside the theater/);
  });
});

describe('tactical layer: engine', () => {
  beforeAll(() => { TACTICAL_CONFIG.enabledInCampaign = true; });
  afterAll(() => { TACTICAL_CONFIG.enabledInCampaign = false; });

  const centroid = (s: SimState, r: string) => {
    const sites = s.tactical!.sites.filter((x) => x.region === r);
    return { x: sites.reduce((a, x) => a + x.x, 0) / sites.length, y: sites.reduce((a, x) => a + x.y, 0) / sites.length };
  };

  /** Area defense in every forecast region: a long-range system at the centre and point defense at the top site. */
  const areaDefense = (s: SimState) => {
    const t = s.tactical!;
    for (const r of t.forecast) {
      if (t.deployments.some((d) => d.region === r)) continue;
      const c = centroid(s, r);
      const top = t.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance)[0];
      execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: r, x: c.x, y: c.y });
      execute(s, { type: 'deploy', equipmentId: 'coyote', region: r, x: top.x, y: top.y });
    }
  };
  const resupplyLow = (s: SimState) => {
    for (const d of s.tactical!.deployments) {
      if (d.stock < EQUIPMENT_MAP.get(d.equipmentId)!.magazine / 2) execute(s, { type: 'resupply', deploymentId: d.id });
    }
  };

  function runTactical(seed: number, deploy: boolean) {
    const s = createInitialState(defaultSettings('campaign', { seed }));
    let guard = 0;
    while (s.status !== 'complete' && guard++ < 2000) {
      if (s.status === 'briefing') {
        if (deploy) areaDefense(s);
        execute(s, { type: 'beginPhase' });
      }
      active(s);
      if (deploy) resupplyLow(s);
      execute(s, { type: 'advance', hours: 1 });
    }
    return s;
  }

  it('forecasts and schedules each phase\'s waves at the briefing', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    const t = s.tactical!;
    expect(t.enabled).toBe(true);
    expect(t.forecast.length).toBe(TACTICAL_CONFIG.forecastRegions);
    expect(t.waves.length).toBe(TACTICAL_CONFIG.waves[0].count);
    for (const w of t.waves) {
      expect(w.atHour).toBeGreaterThanOrEqual(6);
      expect(w.atHour).toBeLessThan(s.phases[0].hours);
      expect(w.tracks.length).toBeGreaterThan(0);
      if (w.forecast) expect(t.forecast).toContain(w.region);
    }
  });

  it('sends at least one wave to every forecast region, in every phase', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = createInitialState(defaultSettings('campaign', { seed }));
      while (s.status !== 'complete') {
        const t = s.tactical!;
        const phaseWaves = t.waves.filter((w) => w.phaseIndex === s.phaseIndex);
        for (const r of t.forecast) expect(phaseWaves.some((w) => w.region === r), `seed ${seed} phase ${s.phaseIndex} ${r}`).toBe(true);
        expect(phaseWaves.filter((w) => !w.forecast).length).toBeLessThanOrEqual(Math.max(0, phaseWaves.length - t.forecast.length));
        execute(s, { type: 'beginPhase' });
        execute(s, { type: 'advance', hours: s.phases[s.phaseIndex].hours });
      }
    }
  });

  it('numbers units per system type', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 100, y: 100 });
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 200, y: 100 });
    const names = s.assets.filter((a) => a.role === 'defense').map((a) => a.name);
    expect(names).toEqual(['NASAMS 1', 'NASAMS 2']);
  });

  it('stays off outside the campaign', () => {
    const s = createInitialState(defaultSettings('crisis', { seed: 4 }));
    expect(s.tactical!.enabled).toBe(false);
    expect(s.tactical!.waves).toEqual([]);
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 100, y: 100 }).ok).toBe(false);
  });

  it('deploys only during a briefing, charging cost and adding a defense asset', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    const before = s.credits;
    const readiness = s.metrics.globalReadiness;
    const regionReady = s.regions.EUR.readiness;
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 300, y: 200 }).ok).toBe(true);
    expect(s.credits).toBe(before - equipmentCost(EQUIPMENT_MAP.get('nasams')!));
    const d = s.tactical!.deployments[0];
    const a = s.assets.find((x) => x.id === d.assetId)!;
    expect(a.role).toBe('defense');
    expect(a.capability).toBe(0);
    // Equipment doesn't inflate readiness metrics.
    expect(s.metrics.globalReadiness).toBeCloseTo(readiness, 6);
    expect(s.regions.EUR.readiness).toBeCloseTo(regionReady, 6);

    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 900, y: 200 }).ok).toBe(false);
    expect(execute(s, { type: 'deploy', equipmentId: 'no-such-thing', region: 'EUR', x: 1, y: 1 }).ok).toBe(false);
    expect(execute(s, { type: 'relocate', deploymentId: d.id, x: 50, y: 60 }).ok).toBe(true);
    expect([d.x, d.y]).toEqual([50, 60]);
    expect(execute(s, { type: 'redeploy', assetId: a.id, region: 'NAM' }).ok).toBe(false);

    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: 300, y: 200 }).ok).toBe(false);
    expect(execute(s, { type: 'relocate', deploymentId: d.id, x: 10, y: 10 }).ok).toBe(false);

    const credits = s.credits;
    expect(execute(s, { type: 'withdraw', deploymentId: d.id }).ok).toBe(true);
    expect(s.credits).toBe(credits + Math.floor(equipmentCost(EQUIPMENT_MAP.get('nasams')!) * TACTICAL_CONFIG.withdrawRefund));
    expect(s.assets.some((x) => x.id === a.id)).toBe(false);
    expect(s.tactical!.deployments).toEqual([]);
  });

  it('resupplies magazines over time and refuses pointless resupply', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: 'EUR', x: 300, y: 200 });
    execute(s, { type: 'deploy', equipmentId: 'ew-jammer', region: 'EUR', x: 300, y: 200 });
    const [missiles, jammer] = s.tactical!.deployments;
    expect(execute(s, { type: 'resupply', deploymentId: missiles.id }).ok).toBe(false); // full
    expect(execute(s, { type: 'resupply', deploymentId: jammer.id }).ok).toBe(false); // unlimited
    execute(s, { type: 'beginPhase' });
    missiles.stock = 3;
    expect(execute(s, { type: 'resupply', deploymentId: missiles.id }).ok).toBe(true);
    expect(execute(s, { type: 'resupply', deploymentId: missiles.id }).ok).toBe(false); // already underway
    execute(s, { type: 'advance', hours: EQUIPMENT_MAP.get('iris-t-slm')!.reloadHours });
    expect(missiles.stock).toBe(EQUIPMENT_MAP.get('iris-t-slm')!.magazine);
  });

  it('resolves every wave, and replays identically for the same seed', () => {
    const a = runTactical(7, true);
    const b = runTactical(7, true);
    expect(a.tactical!.waves.every((w) => w.resolved)).toBe(true);
    expect(a.tactical!.stats).toEqual(b.tactical!.stats);
    expect(a.tactical!.sites.map((x) => x.integrity)).toEqual(b.tactical!.sites.map((x) => x.integrity));
    expect(a.tactical!.stats.tracks).toBeGreaterThan(50);
  });

  it('draws only from its own random stream', () => {
    TACTICAL_CONFIG.enabledInCampaign = false;
    const off = createInitialState(defaultSettings('campaign', { seed: 11 }));
    TACTICAL_CONFIG.enabledInCampaign = true;
    const on = createInitialState(defaultSettings('campaign', { seed: 11 }));
    expect(on.rng).toBe(off.rng); // sites and wave scheduling used tactical.rng only
    const r = on.tactical!.forecast[0];
    execute(on, { type: 'deploy', equipmentId: 'davids-sling', region: r, x: 300, y: 200 });
    execute(on, { type: 'beginPhase' });
    const firstWave = on.tactical!.waves[0].atHour;
    // Up to the first wave, both runs are identical apart from the deployment.
    execute(off, { type: 'beginPhase' });
    execute(on, { type: 'advance', hours: firstWave - 1 });
    execute(off, { type: 'advance', hours: firstWave - 1 });
    expect(on.rng).toBe(off.rng);
    // The wave hour itself: threats resolve with tactical.rng; the main stream advances exactly as without them.
    execute(on, { type: 'advance', hours: 1 });
    execute(off, { type: 'advance', hours: 1 });
    expect(on.tactical!.waves[0].resolved).toBe(true);
    expect(on.rng).toBe(off.rng);
  });

  it('sensible area defense protects sites far better than none', () => {
    for (const seed of [2, 5, 7, 9, 11]) {
      const none = runTactical(seed, false).tactical!.stats;
      const defended = runTactical(seed, true).tactical!.stats;
      expect(none.stopped, `seed ${seed}`).toBe(0);
      expect(defended.stopped / defended.tracks, `seed ${seed}`).toBeGreaterThan(0.4);
      expect(defended.siteDamage, `seed ${seed}`).toBeLessThan(none.siteDamage * 0.7);
    }
  });

  it('rates regional protection by covered site value', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    expect(regionProtection(s, 'EUR').level).toBe('exposed');
    // A 300 km system mid-theater reaches every site.
    execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', x: 300, y: 200 });
    expect(regionProtection(s, 'EUR')).toEqual({ coverage: 1, level: 'protected' });
    // Out of rounds means it no longer counts.
    s.tactical!.deployments[0].stock = 0;
    expect(regionProtection(s, 'EUR').level).toBe('exposed');
    // Sensors alone protect nothing.
    execute(s, { type: 'deploy', equipmentId: 'gm400', region: 'NAM', x: 300, y: 200 });
    expect(regionProtection(s, 'NAM').level).toBe('exposed');
  });

  it('warns of waves earlier when awareness is better', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    s.regions.EUR.awareness = 0;
    expect(warningHours(s, 'EUR')).toBe(TACTICAL_CONFIG.warningHours.base);
    s.regions.EUR.awareness = 100;
    expect(warningHours(s, 'EUR')).toBe(TACTICAL_CONFIG.warningHours.base + TACTICAL_CONFIG.warningHours.atFullAwareness);
    expect(incomingWaves(s)).toEqual([]); // nothing is announced during a briefing
    execute(s, { type: 'beginPhase' });
    const w = s.tactical!.waves[0];
    s.hour = w.atHour - 1;
    const inbound = incomingWaves(s);
    expect(inbound[0].wave.id).toBe(w.id);
    expect(inbound[0].eta).toBe(1);
  });

  it('measures the part of a path inside a circle', () => {
    expect(chordInside([0, 0], [100, 0], [50, 0], 10)).toBeCloseTo(20, 6);
    expect(chordInside([0, 0], [100, 0], [50, 30], 10)).toBe(0);
    expect(chordInside([0, 0], [100, 0], [100, 0], 10)).toBeCloseTo(10, 6); // target inside the circle
  });
});
