import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MAP, TACTICAL_CONFIG, THREAT_CLASSES, createInitialState, defaultSettings, enemyPlan, execute, placementError, threatWorth, trackStory, withLevel,
  type EnemyStyle, type RegionId, type SimState, type ThreatWave,
} from '../src/engine';
import { THREAT_VARIANTS, VARIANT_MAP, baseVariant, introducedVariants, traitsOf, variantFrom, variantOf, variantsOf } from '../src/engine/threats';

function spot(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 0; r <= 300; r += 4) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
const KIT = ['iris-t-slm', 'skynex', 'iris-t-slm', 'skynex', 'sentinel', 'patriot-pac3'];
function play(seed: number, opts: { enemy?: EnemyStyle; level?: 'recruit' | 'officer' | 'commander'; idle?: boolean } = {}) {
  const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed, enemy: opts.enemy }, opts.level ?? 'officer'));
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 3000) {
    if (s.status === 'briefing') {
      if (!opts.idle) for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        const sites = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        KIT.forEach((id, i) => execute(s, { type: 'deploy', equipmentId: id, region: r, ...spot(s, id, r, sites[i % 3].x, sites[i % 3].y) }));
      }
      execute(s, { type: 'beginPhase' });
    }
    for (const d of s.tactical!.deployments) if (d.stock < EQUIPMENT_MAP.get(d.equipmentId)!.magazine / 2) execute(s, { type: 'resupply', deploymentId: d.id });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}
const realTracks = (s: SimState) => s.tactical!.waves.flatMap((w) => w.tracks.map((tr) => ({ w, tr }))).filter((x) => !x.tr.decoy);

describe('threat types', () => {
  it('give every class exactly one standard type, with unique ids and real designations', () => {
    expect(new Set(THREAT_VARIANTS.map((v) => v.id)).size).toBe(THREAT_VARIANTS.length);
    for (const c of THREAT_CLASSES) {
      expect(variantsOf(c).filter((v) => v.from === 0)).toHaveLength(1);
      expect(Object.keys(baseVariant(c).traits)).toHaveLength(0); // the standard type is the class as it always was
    }
    for (const v of THREAT_VARIANTS) {
      expect(v.designation.length).toBeGreaterThan(1);
      expect(v.text.length).toBeGreaterThan(10);
      expect(v.counter.length).toBeGreaterThan(10);
    }
  });

  it('treat threats with no type (older saves, lessons, raids) as the standard one', () => {
    expect(traitsOf({ cls: 'cruise' })).toEqual({});
    expect(variantOf({ cls: 'ballistic' }).id).toBe('scud-b');
    expect(variantOf({ cls: 'ballistic', variant: 'nonsense' }).id).toBe('scud-b');
    expect(threatWorth({ cls: 'cruise' })).toBe(TACTICAL_CONFIG.threatDamage.cruise);
  });

  it('start with standard types only and bring in the others by phase (a phase later on Recruit)', () => {
    for (const level of ['officer', 'recruit'] as const) {
      const games = [4, 8].map((seed) => play(seed, { level }));
      const all = games.flatMap(realTracks);
      for (const { w, tr } of all) {
        const v = variantOf(tr);
        expect(tr.variant, 'every new threat records its type').toBeDefined();
        expect(v.from).toBeLessThanOrEqual(w.phaseIndex);
      }
      // One new type per later phase (a phase later on Recruit), never more.
      for (const s of games) {
        const intro = introducedVariants(s);
        expect(intro.map((x) => x.phase)).toEqual(level === 'recruit' ? [2, 3] : [1, 2, 3]);
        for (const { w, tr } of realTracks(s)) expect(variantFrom(s, variantOf(tr))).toBeLessThanOrEqual(w.phaseIndex);
      }
      expect(all.filter((x) => x.w.phaseIndex === 0).every((x) => variantOf(x.tr).from === 0)).toBe(true);
      expect(all.some((x) => variantOf(x.tr).from > 0)).toBe(true);
    }
  });

  it('play out their traits: groups, decoys, radar hunting, landing wide and extra damage', () => {
    // Each campaign meets only three of the extra types, so play enough to meet them all.
    const games: SimState[] = [];
    const met = () => new Set(games.flatMap((g) => introducedVariants(g).map((x) => x.id)));
    for (let seed = 1; seed <= 60 && !['lancet', 'harop', 'iskander', 'grad'].every((id) => met().has(id)) || games.length < 6; seed++) {
      games.push(play(seed, { enemy: (['swarm', 'hunter', 'planner'] as EnemyStyle[])[seed % 3] }));
    }
    const all = games.flatMap(realTracks);
    // Small drones come in threes from one entry point.
    const lancets = all.filter((x) => x.tr.variant === 'lancet');
    expect(lancets.length).toBeGreaterThan(0);
    const byWave = new Map<ThreatWave, number>();
    for (const x of lancets) byWave.set(x.w, (byWave.get(x.w) ?? 0) + 1);
    expect([...byWave.values()].every((n) => n % 3 === 0)).toBe(true);
    // Radar-hunting drones go for a radar whenever one is emitting.
    const harops = all.filter((x) => x.tr.variant === 'harop');
    expect(harops.length).toBeGreaterThan(0);
    expect(harops.filter((x) => x.tr.depTarget).length / harops.length).toBeGreaterThan(0.8);
    // Iskander-M brings its own ballistic decoys.
    const iskanderWaves = games.flatMap((s) => s.tactical!.waves).filter((w) => w.resolved && w.tracks.some((tr) => !tr.decoy && tr.variant === 'iskander'));
    expect(iskanderWaves.length).toBeGreaterThan(0);
    for (const w of iskanderWaves) {
      const n = w.tracks.filter((tr) => !tr.decoy && tr.variant === 'iskander').length;
      expect(w.tracks.filter((tr) => tr.decoy && tr.variant === 'iskander' && tr.cls === 'ballistic').length).toBe(n * traitsOf({ cls: 'ballistic', variant: 'iskander' }).decoys!);
    }
    // Unguided rockets that get through sometimes land wide and do nothing; guided ones hit harder.
    // (Undefended campaigns, so plenty of them get through.)
    const gradGames: SimState[] = [];
    for (let seed = 1; seed <= 80 && gradGames.length < 4; seed++) {
      const probe = createInitialState(withLevel({ ...defaultSettings('campaign'), seed }, 'officer'));
      if (introducedVariants(probe).some((x) => x.id === 'grad')) gradGames.push(play(seed, { idle: true }));
    }
    const grads = gradGames.flatMap(realTracks).filter((x) => x.tr.variant === 'grad' && x.tr.outcome === 'leaked' && !x.tr.depTarget);
    expect(grads.some((x) => x.tr.wide && x.tr.damage === 0)).toBe(true);
    expect(grads.some((x) => !x.tr.wide)).toBe(true);
    expect(threatWorth({ cls: 'rocket', variant: 'tornado-s' })).toBeGreaterThan(threatWorth({ cls: 'rocket', variant: 'grad' }));
  });

  it('a stealthy cruise missile is seen less often than the standard one against the same defenses', () => {
    const all = [1, 3, 5, 7, 9, 12].flatMap((seed) => realTracks(play(seed, { enemy: 'fox' })));
    const rate = (id: string) => {
      const xs = all.filter((x) => x.tr.variant === id && x.tr.detected !== undefined && !x.tr.depTarget);
      return xs.filter((x) => x.tr.detected).length / xs.length;
    };
    expect(all.filter((x) => x.tr.variant === 'kh-101').length).toBeGreaterThan(5);
    expect(rate('kh-101')).toBeLessThan(rate('kalibr'));
  });

  it('commanders favour their own types', () => {
    const share = (enemy: EnemyStyle, id: string) => {
      const all = [2, 6, 11].flatMap((seed) => realTracks(play(seed, { enemy })));
      const cls = VARIANT_MAP.get(id)!.cls;
      const ofClass = all.filter((x) => x.tr.cls === cls && x.w.phaseIndex >= 1);
      return ofClass.filter((x) => x.tr.variant === id).length / Math.max(1, ofClass.length);
    };
    expect(share('swarm', 'lancet')).toBeGreaterThan(share('planner', 'lancet'));
    expect(share('fox', 'kh-101')).toBeGreaterThan(share('planner', 'kh-101'));
  });

  it('on Commander, switches to a harder type of a class the defense stopped well', () => {
    const s = createInitialState(withLevel(defaultSettings('campaign', { seed: 7 }), 'commander'));
    const t = s.tactical!;
    const site = t.sites.find((x) => x.region === 'EUR')!;
    const mk = (cls: 'cruise' | 'rocket', outcome: 'leaked' | 'stopped', n: number) => Array.from({ length: n }, (_, i) => ({
      id: `T-${cls}-${i}-${t.nextId++}`, cls, siteId: site.id, from: [0, 0] as [number, number], decoy: false, shots: 1, outcome,
    }));
    t.waves = [{ id: 'W-1', region: 'EUR', phaseIndex: 0, atHour: 10, axis: 'north', forecast: true, resolved: true, tracks: [...mk('cruise', 'stopped', 8), ...mk('rocket', 'leaked', 8)] }];
    t.enemy = undefined;
    s.phaseIndex = 1;
    s.status = 'briefing';
    const plan = enemyPlan(s)!;
    expect(plan.variants?.['kh-101']).toBeGreaterThan(1);
    expect(plan.learned.join(' ')).toMatch(/Kh-101/);
    expect(plan.intel.text).toMatch(/Kh-101/);
  });

  it('name the type in the threat story', () => {
    const s = play(6, { enemy: 'fox' });
    const x = realTracks(s).find((y) => y.tr.variant === 'kh-101' && y.w.resolved)!;
    expect(trackStory(s, x.w, x.tr)).toMatch(/Low-observable cruise missile \(Kh-101\)/);
  });
});
