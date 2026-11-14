import { describe, expect, it } from 'vitest';
import {
  ENDLESS_ID, EQUIPMENT, EQUIPMENT_MAP, RAID_ID, STORIES, TACTICAL_CONFIG, channelsOf, createInitialState, defaultSettings, endlessWave, engageRange, equipmentCost,
  escalationOf, execute, isSea, killRateOf, lessonSettings, placementError, practiceShot, previewDefense, proposeDefense, reinforceOptions, resupplyCost, roundCostOf,
  stockpileOf, waveChatter, wavesSurvived, withLevel, type EnemyStyle, type RegionId, type SimState,
} from '../src/engine';

function spot(s: SimState, id: string, region: RegionId, x: number, y: number, min = 0) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = min; r <= 300; r += 3) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
const campaign = (seed: number, extra: Partial<Parameters<typeof withLevel>[0]> = {}, level: 'recruit' | 'officer' | 'commander' = 'officer') =>
  createInitialState(withLevel({ ...defaultSettings('campaign'), seed, ...extra }, level));
const KIT = ['iris-t-slm', 'skynex', 'iris-t-slm', 'skynex', 'sentinel', 'patriot-pac3'];
function play(seed: number, opts: { enemy?: EnemyStyle; kit?: string[]; story?: string; each?: (s: SimState) => void } = {}) {
  const s = campaign(seed, { enemy: opts.enemy, story: opts.story });
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 3000) {
    if (s.status === 'briefing') {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        const sites = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        (opts.kit ?? KIT).forEach((id, i) => execute(s, { type: 'deploy', equipmentId: id, region: r, ...spot(s, id, r, sites[i % 3].x, sites[i % 3].y, 4) }));
      }
      opts.each?.(s);
      execute(s, { type: 'beginPhase' });
    }
    for (const d of s.tactical!.deployments) if (d.stock < EQUIPMENT_MAP.get(d.equipmentId)!.magazine / 2) execute(s, { type: 'resupply', deploymentId: d.id });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}
const tracks = (s: SimState) => s.tactical!.waves.flatMap((w) => w.tracks);

describe('terrain', () => {
  it('gives every theater a valley from a landward edge, used by low fliers after the opening phase', () => {
    const s = campaign(4);
    for (const [region, terrain] of Object.entries(s.tactical!.terrain!)) {
      expect(terrain.valleys!.length, region).toBeGreaterThanOrEqual(1);
      for (const v of terrain.valleys!) expect(v.side).not.toBe(terrain.coast);
      expect(terrain.cities!.length).toBe(3);
    }
    const all = [3, 5, 9, 14].flatMap((k) => play(k).tactical!.waves);
    const inValley = all.flatMap((w) => w.tracks.filter((x) => x.valley).map((x) => ({ w, x })));
    expect(inValley.length).toBeGreaterThan(0);
    for (const { w, x } of inValley) {
      expect(w.phaseIndex).toBeGreaterThan(0);
      expect(['slowDrone', 'fastDrone', 'cruise']).toContain(x.cls);
    }
  });
  it('shortens the reach of guns placed among a city’s buildings', () => {
    const s = campaign(4);
    const city = s.tactical!.sites.find((x) => x.region === 'EUR' && x.type === 'city')!;
    const terrain = s.tactical!.terrain!.EUR;
    const skynex = EQUIPMENT_MAP.get('skynex')!;
    expect(engageRange(terrain, { x: city.x, y: city.y }, skynex)).toBeCloseTo(skynex.rangeKm * TACTICAL_CONFIG.urban.reach, 6);
    expect(engageRange(terrain, { x: city.x + 6, y: city.y }, skynex)).toBe(skynex.rangeKm);
    expect(engageRange(terrain, { x: city.x, y: city.y }, EQUIPMENT_MAP.get('nasams')!)).toBe(EQUIPMENT_MAP.get('nasams')!.rangeKm);
  });
  it('lets a patrolling ship steam toward a wave, staying at sea', () => {
    const run = (patrol: boolean) => {
      const s = createInitialState(lessonSettings('drill-higharc', defaultSettings('training')));
      const t = s.tactical!;
      let p: { x: number; y: number } | null = null;
      for (let x = 10; x < 600 && !p; x += 10) for (let y = 10; y < 400 && !p; y += 10) if (isSea(t.terrain!.MDE, [x, y]) && !placementError(s, EQUIPMENT_MAP.get('type-45')!, 'MDE', x, y)) p = { x, y };
      execute(s, { type: 'deploy', equipmentId: 'type-45', region: 'MDE', ...p! });
      const d = t.deployments[0];
      if (patrol) expect(execute(s, { type: 'setPatrol', deploymentId: d.id, on: true }).ok).toBe(true);
      const start = [d.x, d.y];
      execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 10 });
      return { moved: Math.hypot(d.x - start[0], d.y - start[1]), sea: isSea(t.terrain!.MDE, [d.x, d.y]) };
    };
    expect(run(false).moved).toBe(0);
    const on = run(true);
    expect(on.moved).toBeGreaterThan(0);
    expect(on.moved).toBeLessThanOrEqual(TACTICAL_CONFIG.patrol.km + 1);
    expect(on.sea).toBe(true);
  });
});

describe('saturation and hand-offs', () => {
  it('limits how many threats one system handles in a wave, and says so', () => {
    for (const e of EQUIPMENT) if (e.killRate.slowDrone > 0 || e.killRate.ballistic > 0) expect(channelsOf(e), e.id).toBeGreaterThan(0);
    expect(channelsOf(EQUIPMENT_MAP.get('ew-jammer')!)).toBe(Infinity);
    // Thirty rockets against one long-range battery that reaches the whole theater.
    const raid = { region: 'EUR' as RegionId, waves: [{ atHour: 8, axis: 'north' as const, tracks: { rocket: 30 } }] };
    const s = createInitialState({ ...lessonSettings(RAID_ID, defaultSettings('training')), raid });
    const site = s.tactical!.sites.filter((x) => x.region === 'EUR').sort((a, b) => b.importance - a.importance)[0];
    execute(s, { type: 'deploy', equipmentId: 'davids-sling', region: 'EUR', ...spot(s, 'davids-sling', 'EUR', 300, 200) });
    expect(site).toBeTruthy();
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 9 });
    const w = s.tactical!.waves.find((x) => x.resolved)!;
    const engaged = w.tracks.filter((x) => (x.fired ?? []).length > 0).length;
    expect(engaged).toBe(channelsOf(EQUIPMENT_MAP.get('davids-sling')!) * TACTICAL_CONFIG.saturationPasses);
    expect(w.tracks.some((x) => (x.why ?? []).some((y) => Array.isArray(y) && y[1] === 'sat'))).toBe(true);
  });
  it('marks threats a later layer stopped after an earlier one missed', () => {
    const handoffs = [3, 5, 9].flatMap((k) => tracks(play(k))).filter((x) => x.handoff);
    expect(handoffs.length).toBeGreaterThan(0);
    for (const x of handoffs) { expect(x.outcome === 'stopped' || x.outcome === 'decoyStopped').toBe(true); expect((x.fired ?? []).length).toBeGreaterThanOrEqual(2); }
  });
});

describe('protecting radars', () => {
  const hunted = (prepare: (s: SimState) => void) => {
    let hits = 0;
    let lure = 0;
    for (const seed of [9, 14, 21]) {
      const s = play(seed, { enemy: 'hunter', each: prepare });
      for (const tr of tracks(s).filter((x) => x.depTarget)) {
        const d = s.tactical!.deployments.find((x) => x.id === tr.depTarget);
        if (d && EQUIPMENT_MAP.get(d.equipmentId)!.lure) lure++;
        else hits++;
      }
    }
    return { hits, lure };
  };
  it('lets a silent radar escape the hunt, at the price of seeing nothing', () => {
    const loud = hunted(() => {});
    const silent = hunted((s) => { for (const d of s.tactical!.deployments) if (EQUIPMENT_MAP.get(d.equipmentId)!.radar) execute(s, { type: 'setEmcon', deploymentId: d.id, on: true }); });
    expect(loud.hits).toBeGreaterThan(0);
    expect(silent.hits).toBe(0);
    const s = campaign(4);
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'stinger', region: 'EUR', ...spot(s, 'stinger', 'EUR', site.x, site.y) });
    expect(execute(s, { type: 'setEmcon', deploymentId: s.tactical!.deployments[0].id, on: true }).ok).toBe(false);
  });
  it('draws most of the hunters onto decoy emitters', () => {
    const withLures = hunted((s) => {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r && d.equipmentId === 'decoy-emitter')) continue;
        const site = s.tactical!.sites.find((x) => x.region === r)!;
        execute(s, { type: 'deploy', equipmentId: 'decoy-emitter', region: r, ...spot(s, 'decoy-emitter', r, site.x, site.y, 10) });
      }
    });
    expect(withLures.lure).toBeGreaterThan(withLures.hits);
  });
  it('moves a system with shoot-and-scoot orders after it fires', () => {
    const s = createInitialState(lessonSettings('drill-swarm', defaultSettings('training')));
    const site = s.tactical!.sites.filter((x) => x.region === 'EUR').sort((a, b) => b.importance - a.importance)[0];
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spot(s, 'nasams', 'EUR', site.x, site.y) });
    const d = s.tactical!.deployments[0];
    expect(execute(s, { type: 'setScoot', deploymentId: d.id, on: true }).ok).toBe(true);
    const start = [d.x, d.y];
    execute(s, { type: 'beginPhase' });
    while (!s.tactical!.waves.some((w) => w.resolved) && s.hour < 12) execute(s, { type: 'advance', hours: 1 });
    expect(d.transit).toBeTruthy();
    execute(s, { type: 'advance', hours: TACTICAL_CONFIG.scoot.hours + 1 });
    const moved = Math.hypot(d.x - start[0], d.y - start[1]);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(TACTICAL_CONFIG.scoot.km + 30);
  });
});

describe('interceptor loads', () => {
  it('exist only where an official source names more than one interceptor, and trade price against effect', () => {
    const withLoads = EQUIPMENT.filter((e) => e.loadouts?.length);
    expect(withLoads.map((e) => e.id).sort()).toEqual(['aegis-sm6', 'barak-mx', 'nasams', 'patriot-pac3', 'type-45']);
    for (const e of withLoads) expect(e.sources.length, e.id).toBeGreaterThan(0);
    const s = campaign(4);
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'patriot-pac3', region: 'EUR', ...spot(s, 'patriot-pac3', 'EUR', site.x, site.y) });
    const d = s.tactical!.deployments[0];
    const spec = EQUIPMENT_MAP.get('patriot-pac3')!;
    const std = { cost: roundCostOf(s, d, spec), kill: killRateOf(d, spec, 'ballistic') };
    expect(execute(s, { type: 'setLoadout', deploymentId: d.id, loadout: 'gem' }).ok).toBe(true);
    expect(roundCostOf(s, d, spec)).toBeLessThan(std.cost);
    expect(killRateOf(d, spec, 'ballistic')).toBeLessThan(std.kill);
    execute(s, { type: 'setLoadout', deploymentId: d.id, loadout: 'mse' });
    expect(roundCostOf(s, d, spec)).toBeGreaterThan(std.cost);
    expect(killRateOf(d, spec, 'ballistic')).toBeGreaterThan(std.kill);
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'setLoadout', deploymentId: d.id, loadout: 'standard' }).ok).toBe(false); // only in a briefing
  });
});

describe('the enemy', () => {
  it('sends two-sided and timed raids in later phases, never the first', () => {
    const waves = [3, 5, 9, 14, 21, 30].flatMap((k) => play(k).tactical!.waves);
    expect(waves.some((w) => w.axis2)).toBe(true);
    expect(waves.some((w) => w.follow)).toBe(true);
    for (const w of waves.filter((x) => x.axis2 || x.follow)) expect(w.phaseIndex).toBeGreaterThan(0);
    for (const w of waves.filter((x) => x.follow)) expect(w.tracks.every((x) => x.decoy || (x.cls !== 'slowDrone' && x.cls !== 'fastDrone'))).toBe(true);
  });
  it('escalates against a defense that holds and eases off one that fails', () => {
    const s = campaign(4);
    expect(escalationOf(s).level).toBe('steady');
    const fake = (stopped: number, leaked: number) => {
      const x = campaign(4);
      x.phaseIndex = 1;
      x.tactical!.waves = [{ id: 'W', region: 'EUR', phaseIndex: 0, atHour: 10, axis: 'north', forecast: true, resolved: true, applied: true,
        tracks: Array.from({ length: stopped + leaked }, (_, i) => ({ id: `T${i}`, cls: 'slowDrone' as const, siteId: x.tactical!.sites[0].id, from: [0, 0] as [number, number], decoy: false, shots: 1, outcome: i < stopped ? 'stopped' as const : 'leaked' as const })) }];
      return escalationOf(x);
    };
    expect(fake(18, 2).level).toBe('heavy');
    expect(fake(18, 2).mix.ballistic).toBeGreaterThan(1);
    expect(fake(4, 16).level).toBe('light');
    expect(fake(12, 8).level).toBe('steady');
  });
});

describe('between fights', () => {
  it('repairs only the sites crews are sent to, in the order given', () => {
    const s = campaign(4);
    const [a, b] = s.tactical!.sites.filter((x) => x.region === 'EUR');
    a.integrity = 60;
    b.integrity = 60;
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 6 });
    expect(a.integrity).toBe(60);
    execute(s, { type: 'repairFirst', siteId: a.id });
    execute(s, { type: 'repairFirst', siteId: b.id }); // b now first
    execute(s, { type: 'advance', hours: 6 });
    expect(b.integrity).toBeGreaterThan(60);
    expect(a.integrity).toBe(60);
  });
  it('grows stockpiles and cuts round prices as the defense industry expands, three levels at most', () => {
    const s = campaign(4, { startCredits: 5000 });
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spot(s, 'nasams', 'EUR', site.x, site.y) });
    const d = s.tactical!.deployments[0];
    const spec = EQUIPMENT_MAP.get('nasams')!;
    const before = { stock: stockpileOf(s, 'nasams'), price: roundCostOf(s, d, spec) };
    s.industry = 2;
    expect(roundCostOf(s, d, spec)).toBeCloseTo(before.price * 0.8, 6);
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spot(s, 'nasams', 'EUR', site.x + 10, site.y) });
    expect(stockpileOf(s, 'nasams') - before.stock).toBeGreaterThan(before.stock);
    s.industry = 3;
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'invest', investmentId: 'industry' }).ok).toBe(false);
  });
  it('lets one region be reinforced before each later phase', () => {
    const s = campaign(4);
    expect(reinforceOptions(s)).toEqual([]);
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: s.phases[0].hours });
    const options = reinforceOptions(s);
    expect(options.length).toBe(3);
    const site = s.tactical!.sites.find((x) => x.region === options[0])!;
    site.integrity = 50;
    expect(execute(s, { type: 'reinforce', region: options[0] }).ok).toBe(true);
    expect(site.integrity).toBe(50 + TACTICAL_CONFIG.reinforce.integrity);
    expect(execute(s, { type: 'reinforce', region: options[1] }).ok).toBe(false); // one per phase
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: options[0], ...spot(s, 'nasams', options[0], site.x, site.y) });
    const d = s.tactical!.deployments[s.tactical!.deployments.length - 1];
    d.stock = 0;
    expect(resupplyCost(d, 10, s)).toBe(0);
  });
});

describe('modes', () => {
  it('Endless Defense sends a bigger wave each time, unlocks heavier threats, and ends when the region falls', () => {
    const size = (i: number) => Object.values(endlessWave(7, i).tracks).reduce((a, b) => a + (b ?? 0), 0);
    expect(size(10)).toBeGreaterThan(size(0));
    expect(endlessWave(7, 0).tracks.ballistic).toBeUndefined();
    expect(Array.from({ length: 30 }, (_, i) => endlessWave(7, i)).some((w) => w.tracks.hypersonic)).toBe(true);
    const s = createInitialState(lessonSettings(ENDLESS_ID, { ...defaultSettings('training'), seed: 7 }));
    expect(s.phases.length).toBe(40);
    let guard = 0;
    while (s.status !== 'complete' && guard++ < 600) {
      if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 1 });
    }
    expect(s.status).toBe('complete');
    expect(s.phaseIndex).toBeLessThan(39); // undefended, it falls long before the end
    expect(wavesSurvived(s)).toBeGreaterThanOrEqual(0);
    expect(wavesSurvived(s)).toBeLessThan(15);
  });
  it('written campaigns rename the chapters and fight where the story is set', () => {
    for (const [id, story] of Object.entries(STORIES)) {
      expect(story.chapters.length).toBe(4);
      const s = campaign(5, { story: id, enemy: story.enemy });
      expect(s.phases.map((p) => p.name)).toEqual(story.chapters.map((c) => c.name));
      expect(s.tactical!.forecast.every((r) => story.regions.includes(r))).toBe(true);
    }
  });
  it('plays a raid a player wrote, and the advisor can defend it', () => {
    const raid = { region: 'AFR' as RegionId, waves: [{ atHour: 8, axis: 'north' as const, tracks: { slowDrone: 8, cruise: 3 } }, { atHour: 16, axis: 'east' as const, tracks: { ballistic: 2, rocket: 4 } }] };
    const s = createInitialState({ ...lessonSettings(RAID_ID, defaultSettings('training')), raid });
    expect(s.tactical!.forecast).toEqual(['AFR']);
    expect(s.tactical!.waves.length).toBe(2);
    const plan = proposeDefense(s, 'AFR', s.credits - 200);
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(plan.reduce((a, p) => a + p.cost, 0)).toBeLessThanOrEqual(s.credits - 200);
    expect(plan.some((p) => p.equipmentId === 'patriot-pac3')).toBe(true); // ballistic missiles are forecast
    const before = previewDefense(s, 'AFR')!.prevented;
    for (const p of plan) expect(execute(s, { type: 'deploy', equipmentId: p.equipmentId, region: 'AFR', x: p.x, y: p.y }).ok, p.equipmentId).toBe(true);
    for (const p of plan) expect(p.cost).toBe(equipmentCost(EQUIPMENT_MAP.get(p.equipmentId)!));
    expect(previewDefense(s, 'AFR')!.prevented).toBeGreaterThan(before + 0.4);
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 40 });
    expect(s.status).toBe('complete');
    const w = s.tactical!.waves[0];
    const lines = waveChatter(s, w);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((l, i) => i === 0 || l.at >= lines[i - 1].at)).toBe(true);
  });
});

describe('practice range', () => {
  it('explains a single engagement with its dice', () => {
    const hit = practiceShot({ equipmentId: 'nasams', cls: 'cruise', offsetKm: 10, seed: 1 });
    expect(hit.lines.some((l) => /Shot 1: needs \d+ or less/.test(l.text))).toBe(true);
    expect(hit.lines[hit.lines.length - 1].text).toMatch(/^Result:/);
    const high = practiceShot({ equipmentId: 'skynex', cls: 'ballistic', offsetKm: 1, seed: 1 });
    expect(high.stopped).toBe(false);
    expect(high.lines.some((l) => /Ceiling/.test(l.text))).toBe(true);
    const far = practiceShot({ equipmentId: 'davids-sling', cls: 'cruise', offsetKm: 60, seed: 1 });
    expect(far.lines.some((l) => /radar horizon/.test(l.text))).toBe(true);
    const blind = practiceShot({ equipmentId: 'stinger', cls: 'slowDrone', offsetKm: 2, seed: 3 });
    expect(blind.lines.some((l) => /Not seen/.test(l.text))).toBe(true);
    const cued = practiceShot({ equipmentId: 'stinger', cls: 'slowDrone', offsetKm: 2, sensorId: 'sentinel', seed: 3 });
    expect(cued.lines.some((l) => /Seen: tracked by X-band/.test(l.text))).toBe(true);
    const many = Array.from({ length: 40 }, (_, k) => practiceShot({ equipmentId: 'nasams', cls: 'cruise', offsetKm: 10, seed: k + 1 }).stopped);
    expect(many.filter(Boolean).length).toBeGreaterThan(20);
    expect(many.filter(Boolean).length).toBeLessThan(40);
  });
});
