import { beforeAll, describe, expect, it } from 'vitest';
import {
  createInitialState, defaultSettings, execute, computeScore, isActive, TEMPLATE_MAP, exportJSON, importJSON,
  EQUIPMENT, THREAT_CLASSES, LAYER_LABELS, equipmentCost, equipmentUpkeep, isEffector, stateShapeError,
  TACTICAL_CONFIG, EQUIPMENT_MAP, chordInside, ensureTactical, regionProtection, warningHours, incomingWaves,
  tacticalReport, lessonsLearned, alertActive, alertCost, redeployHours, isSea, coverageAt, onMassif, masked, TERRAIN_PROFILES, TACTICAL_PRESETS, TACTICAL_LIMITS, normalizeTactical, standardTactical,
  exportTacticalScenario, importTacticalScenario,
} from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

/** The nearest land point to (x, y) in a region's theater: tests must not drop ground systems in the sea. */
function landNear(s: SimState, region: RegionId, x = 300, y = 200): { x: number; y: number } {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 600; r += 10) {
    for (let a = 0; a < 16; a++) {
      const p: [number, number] = [Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 16) * Math.PI * 2) * r)];
      if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
    }
  }
  throw new Error('no land');
}

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
    for (const e of EQUIPMENT.filter((e) => !e.generic && e.id !== 'zu-23-2')) {
      expect(e.sources.length, e.id).toBeGreaterThan(0);
      for (const src of e.sources) {
        expect(src.name, e.id).toBeTruthy();
        if (src.url) expect(src.url, e.id).toMatch(/^https:\/\//);
      }
    }
    // Most named products link at least one official page.
    expect(EQUIPMENT.filter((e) => e.sources.some((x) => x.url)).length).toBeGreaterThanOrEqual(18);
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

  it('is on in campaigns by default, and switching it off restores the old game', () => {
    expect(TACTICAL_CONFIG.enabledInCampaign).toBe(true);
    TACTICAL_CONFIG.enabledInCampaign = false;
    try {
      const s = runCampaign(passive, 11);
      expect(s.tactical!.enabled).toBe(false);
      expect(s.tactical!.waves).toEqual([]);
      expect(s.assets.some((a) => a.role === 'defense')).toBe(false);
      expect(computeScore(s).components.protection).toBeUndefined();
    } finally {
      TACTICAL_CONFIG.enabledInCampaign = true;
    }
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

  const centroid = (s: SimState, r: string) => {
    const sites = s.tactical!.sites.filter((x) => x.region === r);
    return { x: sites.reduce((a, x) => a + x.x, 0) / sites.length, y: sites.reduce((a, x) => a + x.y, 0) / sites.length };
  };

  /**
   * A layered defense in every forecast region: medium-range systems at the two most important sites, a gun system
   * and a counter-drone interceptor for close-in cover, and a long-range system near the middle for high threats.
   */
  const areaDefense = (s: SimState) => {
    const t = s.tactical!;
    for (const r of t.forecast) {
      if (t.deployments.some((d) => d.region === r)) continue;
      const ss = t.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
      execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: r, x: ss[0].x, y: ss[0].y });
      execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: r, x: ss[1].x, y: ss[1].y });
      execute(s, { type: 'deploy', equipmentId: 'skynex', region: r, x: ss[2].x, y: ss[2].y });
      execute(s, { type: 'deploy', equipmentId: 'coyote', region: r, x: ss[0].x, y: ss[0].y });
      const c = landNear(s, r as RegionId, centroid(s, r).x, centroid(s, r).y);
      execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: r, x: c.x, y: c.y });
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
    const [a, b] = s.tactical!.sites.filter((x) => x.region === 'EUR');
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: a.x, y: a.y });
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: b.x, y: b.y });
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
    const p = landNear(s, 'EUR');
    const q = landNear(s, 'EUR', 120, 300);
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', x: p.x, y: p.y }).ok).toBe(true);
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
    expect(execute(s, { type: 'relocate', deploymentId: d.id, x: q.x, y: q.y }).ok).toBe(true);
    expect([d.x, d.y]).toEqual([q.x, q.y]);
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
    const p = landNear(s, 'EUR');
    execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: 'EUR', x: p.x, y: p.y });
    execute(s, { type: 'deploy', equipmentId: 'ew-jammer', region: 'EUR', x: p.x, y: p.y });
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
    const p = landNear(on, r);
    execute(on, { type: 'deploy', equipmentId: 'davids-sling', region: r, x: p.x, y: p.y });
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
    // A 300 km system near the middle reaches most sites (for high threats, at least).
    const p = landNear(s, 'EUR');
    execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', x: p.x, y: p.y });
    expect(regionProtection(s, 'EUR').level).toBe('protected');
    // Out of rounds means it no longer counts.
    s.tactical!.deployments[0].stock = 0;
    expect(regionProtection(s, 'EUR').level).toBe('exposed');
    // Sensors alone protect nothing.
    const n = landNear(s, 'NAM');
    execute(s, { type: 'deploy', equipmentId: 'gm400', region: 'NAM', x: n.x, y: n.y });
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

  it('scores protection, and a sensible defense beats ignoring the tactical layer', () => {
    for (const seed of [2, 3, 7, 9, 13]) {
      const ignored = runTactical(seed, false);
      const defended = runTactical(seed, true);
      const a = computeScore(ignored);
      const b = computeScore(defended);
      expect(a.components.protection, `seed ${seed}`).toBe(0);
      expect(b.components.protection!, `seed ${seed}`).toBeGreaterThan(40);
      expect(b.total, `seed ${seed}`).toBeGreaterThan(a.total);
      const w = Object.values(b.weights).reduce((x, y) => x + y!, 0);
      expect(w).toBeCloseTo(1, 9);
    }
  });

  it('scores other modes on management alone', () => {
    const s = createInitialState(defaultSettings('crisis', { seed: 3 }));
    const sc = computeScore(s);
    expect(sc.components.protection).toBeUndefined();
    expect(Object.values(sc.weights).reduce((x, y) => x + y!, 0)).toBeCloseTo(1, 9);
  });

  it('reports tactical results for the AAR', () => {
    const s = runTactical(7, true);
    const r = tacticalReport(s)!;
    expect(r.stopRate).toBeCloseTo(s.tactical!.stats.stopped / s.tactical!.stats.tracks, 9);
    expect(r.byPhase.reduce((a, p) => a + p.tracks, 0)).toBe(s.tactical!.stats.tracks);
    expect(r.byRegion.reduce((a, p) => a + p.stopped, 0)).toBe(s.tactical!.stats.stopped);
    expect(r.kills.reduce((a, k) => a + k.kills, 0)).toBe(s.tactical!.stats.stopped);
    expect(r.undefendedForecastWaves).toBe(0); // the policy defends every forecast region
    expect(lessonsLearned(s).some((l) => l.text.includes('Tactical defenses stopped') || l.text.includes('threats were stopped'))).toBe(true);
  });

  it('measures the part of a path inside a circle', () => {
    expect(chordInside([0, 0], [100, 0], [50, 0], 10)).toBeCloseTo(20, 6);
    expect(chordInside([0, 0], [100, 0], [50, 30], 10)).toBe(0);
    expect(chordInside([0, 0], [100, 0], [100, 0], 10)).toBeCloseTo(10, 6); // target inside the circle
  });
});

describe('tactical layer: scenarios', () => {
  const waves = (s: SimState) => s.tactical!.waves.map((w) => [w.region, w.atHour, w.tracks.map((x) => x.cls).join(',')]);

  it('the standard preset plays exactly like no scenario', () => {
    const plain = createInitialState(defaultSettings('campaign', { seed: 21 }));
    const std = createInitialState(defaultSettings('campaign', { seed: 21, tactical: standardTactical() }));
    expect(waves(std)).toEqual(waves(plain));
    expect(std.credits).toBe(plain.credits);
  });

  it('presets are valid, fictional setups that change the threat picture', () => {
    for (const p of TACTICAL_PRESETS) {
      expect(normalizeTactical(p.settings), p.id).toEqual(p.settings);
      expect(p.description.length, p.id).toBeGreaterThan(20);
    }
    const count = (id: string) => {
      const p = TACTICAL_PRESETS.find((x) => x.id === id)!;
      let total = 0;
      let ballistic = 0;
      for (const seed of [1, 2, 3]) {
        const s = createInitialState(defaultSettings('campaign', { seed, tactical: p.settings }));
        for (const w of s.tactical!.waves) for (const tr of w.tracks) { total++; if (tr.cls === 'ballistic') ballistic++; }
      }
      return { total, ballistic, waves: createInitialState(defaultSettings('campaign', { seed: 1, tactical: p.settings })).tactical!.waves.length };
    };
    const std = count('standard');
    expect(count('long-night').waves).toBeGreaterThan(std.waves);
    expect(count('coastal-saturation').total).toBeGreaterThan(std.total);
    expect(count('high-arc').ballistic).toBeGreaterThanOrEqual(std.ballistic);
    const thin = createInitialState(defaultSettings('campaign', { seed: 1, tactical: TACTICAL_PRESETS.find((x) => x.id === 'thin-budget')!.settings }));
    expect(thin.tactical!.forecast.length).toBe(1);
    expect(thin.credits).toBe(1200 - 400);
  });

  it('applies the defense budget only when the tactical layer is on', () => {
    const tactical = { ...standardTactical(), budget: 500 };
    expect(createInitialState(defaultSettings('campaign', { seed: 2, tactical })).credits).toBe(1700);
    expect(createInitialState(defaultSettings('crisis', { seed: 2, tactical })).credits).toBe(defaultSettings('crisis').startCredits);
  });

  it('exports and imports scenarios, rejecting other files and clamping values', () => {
    const coastal = TACTICAL_PRESETS.find((x) => x.id === 'coastal-saturation')!.settings;
    const back = importTacticalScenario(exportTacticalScenario('My drills', coastal))!;
    expect(back.name).toBe('My drills');
    expect(back.tactical).toEqual({ ...coastal, preset: 'custom' });

    expect(importTacticalScenario('not json')).toBeNull();
    expect(importTacticalScenario(JSON.stringify({ kind: 'something-else', v: 1, tactical: {} }))).toBeNull();
    expect(importTacticalScenario(JSON.stringify({ kind: 'mds-tactical-scenario', v: 99, tactical: {} }))).toBeNull();
    // A save file is not a scenario file.
    expect(importTacticalScenario(exportJSON(createInitialState(defaultSettings('campaign', { seed: 1 }))))).toBeNull();

    const wild = importTacticalScenario(JSON.stringify({
      kind: 'mds-tactical-scenario', v: 1, name: '',
      tactical: { waveCount: 50, waveSize: -3, mix: { ballistic: 99, rocket: 'x' }, surpriseRate: 2, forecastRegions: 9, decoys: NaN, budget: 1e9 },
    }))!;
    expect(wild.name).toBe('Imported scenario');
    expect(wild.tactical.waveCount).toBe(TACTICAL_LIMITS.waveCount[1]);
    expect(wild.tactical.waveSize).toBe(TACTICAL_LIMITS.waveSize[0]);
    expect(wild.tactical.mix.ballistic).toBe(TACTICAL_LIMITS.mix[1]);
    expect(wild.tactical.mix.rocket).toBe(1);
    expect(wild.tactical.surpriseRate).toBe(TACTICAL_LIMITS.surpriseRate[1]);
    expect(wild.tactical.forecastRegions).toBe(TACTICAL_LIMITS.forecastRegions[1]);
    expect(wild.tactical.decoys).toBe(1);
    expect(wild.tactical.budget).toBe(TACTICAL_LIMITS.budget[1]);
  });

  it('never leaves a phase without possible threats', () => {
    const only = { ...standardTactical(), mix: { slowDrone: 0, fastDrone: 0, cruise: 0, rocket: 0, ballistic: 3 } };
    const s = createInitialState(defaultSettings('campaign', { seed: 5, tactical: only })); // phase 1 has no ballistic weight
    expect(s.tactical!.waves.every((w) => w.tracks.length > 0)).toBe(true);
  });
});

describe('tactical layer: terrain, altitude and cost', () => {
  const fresh = (seed = 4) => createInitialState(defaultSettings('campaign', { seed }));

  it('gives every region its own coast, massifs and land-based sites', () => {
    const s = fresh();
    const t = s.tactical!;
    const signatures = new Set<string>();
    for (const r of Object.keys(TERRAIN_PROFILES) as RegionId[]) {
      const ter = t.terrain![r];
      expect(ter.coast).toBe(TERRAIN_PROFILES[r].coast);
      expect(ter.massifs.length).toBeGreaterThan(0);
      signatures.add(`${ter.coast}:${ter.massifs.length}:${ter.coastline[0].join(',')}`);
      for (const site of t.sites.filter((x) => x.region === r)) {
        expect(isSea(ter, [site.x, site.y]), `${r} ${site.name}`).toBe(false);
      }
    }
    expect(signatures.size).toBe(7);
  });

  it('puts ships at sea and ground systems on land', () => {
    const s = fresh();
    const ter = s.tactical!.terrain!.IPA; // mostly ocean to the east
    const land = landNear(s, 'IPA', 60, 200);
    const sea = ter.coast === 'east' ? { x: 590, y: 200 } : { x: 10, y: 200 };
    expect(isSea(ter, [sea.x, sea.y])).toBe(true);
    expect(execute(s, { type: 'deploy', equipmentId: 'type-45', region: 'IPA', ...land }).ok).toBe(false);
    expect(execute(s, { type: 'deploy', equipmentId: 'type-45', region: 'IPA', ...sea }).ok).toBe(true);
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'IPA', ...sea }).ok).toBe(false);
    expect(execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'IPA', ...land }).ok).toBe(true);
    expect(execute(s, { type: 'deploy', equipmentId: 'e-7', region: 'IPA', ...sea }).ok).toBe(true); // aircraft fly anywhere
  });

  it('hides low-flying threats below the radar horizon unless airborne early warning cues', () => {
    const s = fresh();
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    // A long-range system 120 km from the site: in range of high threats, beyond the horizon for low ones.
    let p = { x: 0, y: 0 };
    for (const [dx, dy] of [[120, 0], [-120, 0], [0, 120], [0, -120], [85, 85], [-85, -85], [85, -85], [-85, 85]]) {
      const c = { x: site.x + dx, y: site.y + dy };
      if (c.x > 0 && c.x < 600 && c.y > 0 && c.y < 400 && !isSea(s.tactical!.terrain!.EUR, [c.x, c.y]) && !onMassif(s.tactical!.terrain!.EUR, [c.x, c.y])) { p = c; break; }
    }
    expect(p.x || p.y).toBeTruthy();
    execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', ...p });
    let k = coverageAt(s, 'EUR', site.x, site.y);
    expect(k.ballistic).toBeGreaterThan(0);
    expect(k.cruise).toBe(0);
    expect(k.slowDrone).toBe(0);
    execute(s, { type: 'deploy', equipmentId: 'e-7', region: 'EUR', x: site.x, y: site.y });
    k = coverageAt(s, 'EUR', site.x, site.y);
    expect(k.cruise).toBeGreaterThan(0);
  });

  it('lets massifs block low-level line of sight', () => {
    const s = fresh();
    const m = s.tactical!.terrain!.EUR.massifs[0];
    const a: [number, number] = [m.x - m.r - 30, m.y];
    const b: [number, number] = [m.x + m.r + 30, m.y];
    expect(masked(s.tactical!.terrain!.EUR, a, b)).toBe(true);
    expect(masked(s.tactical!.terrain!.EUR, a, [m.x - m.r - 30, m.y + 200])).toBe(false);
  });

  it('respects altitude ceilings', () => {
    const s = fresh();
    const p = landNear(s, 'EUR');
    execute(s, { type: 'deploy', equipmentId: 'iron-dome', region: 'EUR', ...p });
    // Iron Dome lists a small ballistic kill rate, but its 10 km ceiling is below where ballistic threats are engaged.
    expect(EQUIPMENT_MAP.get('iron-dome')!.killRate.ballistic).toBeGreaterThan(0);
    expect(coverageAt(s, 'EUR', p.x, p.y).ballistic).toBe(0);
    expect(coverageAt(s, 'EUR', p.x, p.y).rocket).toBeGreaterThan(0);
  });

  it('prices reach: long-range systems cost more than their compressed real price alone', () => {
    const sling = EQUIPMENT_MAP.get('davids-sling')!;
    const base = Math.round(TACTICAL_CONFIG.creditsScale * sling.unitCostUsdM ** TACTICAL_CONFIG.costExponent);
    expect(equipmentCost(sling)).toBeGreaterThan(base * 1.8);
    expect(equipmentCost(sling)).toBeGreaterThan(equipmentCost(EQUIPMENT_MAP.get('iris-t-slm')!) * 1.8);
  });

  it('adds terrain to saves made before it existed, without moving sites', () => {
    const s = fresh(8);
    const sites = s.tactical!.sites.map((x) => [x.x, x.y]);
    delete s.tactical!.terrain;
    const t = ensureTactical(s);
    expect(Object.keys(t.terrain!)).toHaveLength(7);
    expect(t.sites.map((x) => [x.x, x.y])).toEqual(sites);
  });
});

describe('tactical layer: in-phase orders', () => {
  const ready = () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 6 }));
    const p = landNear(s, 'EUR');
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...p });
    return { s, d: s.tactical!.deployments[0] };
  };

  it('emergency redeploy takes the system out of action until it arrives', () => {
    const { s, d } = ready();
    const q = landNear(s, 'EUR', 100, 300);
    expect(execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'EUR', ...q }).ok).toBe(false); // briefing: use Move
    execute(s, { type: 'beginPhase' });
    const credits = s.credits;
    expect(execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'EUR', ...q }).ok).toBe(true);
    expect(s.credits).toBe(credits - TACTICAL_CONFIG.emergencyRedeploy.cost);
    const a = s.assets.find((x) => x.id === d.assetId)!;
    expect(a.status).toBe('transit');
    expect(regionProtection(s, 'EUR').level).toBe('exposed'); // can't fire while moving
    expect(execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'EUR', ...q }).ok).toBe(false); // already moving
    execute(s, { type: 'advance', hours: TACTICAL_CONFIG.emergencyRedeploy.sameRegionHours });
    expect(d.transit).toBeUndefined();
    expect([d.x, d.y]).toEqual([q.x, q.y]);
    expect(a.status).not.toBe('transit');
  });

  it('redeploys to another region over the domain transit time, onto valid ground', () => {
    const { s, d } = ready();
    execute(s, { type: 'beginPhase' });
    const sea = s.tactical!.terrain!.IPA.coast === 'east' ? { x: 590, y: 200 } : { x: 10, y: 200 };
    expect(execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'IPA', ...sea }).ok).toBe(false); // NASAMS can't go to sea
    const land = landNear(s, 'IPA', 60, 200);
    expect(execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'IPA', ...land }).ok).toBe(true);
    const hours = redeployHours(EQUIPMENT_MAP.get('nasams')!, 'EUR', 'IPA');
    expect(hours).toBe(TACTICAL_CONFIG.emergencyRedeploy.otherRegionHours.ground);
    execute(s, { type: 'advance', hours: hours - 1 });
    expect(d.region).toBe('EUR');
    execute(s, { type: 'advance', hours: 1 });
    expect(d.region).toBe('IPA');
    expect(s.assets.find((x) => x.id === d.assetId)!.region).toBe('IPA');
  });

  it('raises a time-limited alert that costs credits and wears equipment', () => {
    const { s, d } = ready();
    expect(execute(s, { type: 'raiseAlert', region: 'EUR' }).ok).toBe(false); // briefing
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'raiseAlert', region: 'NAM' }).ok).toBe(false); // nothing deployed there
    const cost = alertCost(s, 'EUR');
    const credits = s.credits;
    expect(execute(s, { type: 'raiseAlert', region: 'EUR' }).ok).toBe(true);
    expect(s.credits).toBe(credits - cost);
    expect(alertActive(s, 'EUR')).toBe(true);
    expect(execute(s, { type: 'raiseAlert', region: 'EUR' }).ok).toBe(false); // already in force
    const a = s.assets.find((x) => x.id === d.assetId)!;
    const before = a.condition;
    execute(s, { type: 'advance', hours: TACTICAL_CONFIG.alert.hours });
    expect(alertActive(s, 'EUR')).toBe(false);
    expect(before - a.condition).toBeGreaterThan(TACTICAL_CONFIG.alert.wearPerHour * (TACTICAL_CONFIG.alert.hours - 1));
  });

  it('an alert improves results against the same wave', () => {
    // Same seed, same deployments: one run raises an alert just before every wave, the other doesn't.
    const play = (alert: boolean) => {
      const s = createInitialState(defaultSettings('campaign', { seed: 12 }));
      for (const r of s.tactical!.forecast) {
        const ss = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        execute(s, { type: 'deploy', equipmentId: 'stinger', region: r, x: ss[0].x, y: ss[0].y });
        execute(s, { type: 'deploy', equipmentId: 'avenger', region: r, x: ss[1].x, y: ss[1].y });
      }
      execute(s, { type: 'beginPhase' });
      let g = 0;
      while (s.status === 'running' && g++ < 100) {
        if (alert) for (const w of s.tactical!.waves) if (!w.resolved && w.atHour === s.hour + 1) execute(s, { type: 'raiseAlert', region: w.region });
        execute(s, { type: 'advance', hours: 1 });
      }
      return s.tactical!.stats;
    };
    const plain = play(false);
    const alerted = play(true);
    expect(alerted.tracks).toBe(plain.tracks);
    expect(alerted.stopped).toBeGreaterThanOrEqual(plain.stopped);
  });
});
