import { describe, expect, it } from 'vitest';
import {
  ENEMY_STYLE_IDS, EQUIPMENT, EQUIPMENT_MAP, INVESTMENTS, MEDALS, QUICK_BATTLE_ID, TACTICAL_CONFIG, THREAT_CLASSES, canEngageClass, createInitialState, defaultSettings,
  earnedMedals, execute, lessonSettings, narrateWave, phaseDispatch, placementError, previewDefense, suggestFixes, trackStory, trackTarget, unitName, veteranOf, withLevel,
  type EnemyStyle, type RegionId, type SimState,
} from '../src/engine';

function spot(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 0; r <= 300; r += 4) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
const KIT = ['iris-t-slm', 'skynex', 'iris-t-slm', 'skynex', 'sentinel', 'patriot-pac3'];
/** Plays a whole campaign with a fixed kit in every forecast region. */
function play(seed: number, opts: { enemy?: EnemyStyle; level?: 'recruit' | 'officer' | 'commander'; kit?: string[]; research?: string } = {}) {
  const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed, enemy: opts.enemy }, opts.level ?? 'officer'));
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 3000) {
    if (s.status === 'briefing') {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        const sites = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        (opts.kit ?? KIT).forEach((id, i) => execute(s, { type: 'deploy', equipmentId: id, region: r, ...spot(s, id, r, sites[i % 3].x, sites[i % 3].y) }));
      }
      if (opts.research && !s.research?.includes(opts.research) && !s.projects.length) execute(s, { type: 'invest', investmentId: opts.research });
      execute(s, { type: 'beginPhase' });
    }
    for (const d of s.tactical!.deployments) if (d.stock < EQUIPMENT_MAP.get(d.equipmentId)!.magazine / 2) execute(s, { type: 'resupply', deploymentId: d.id });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}
const tracks = (s: SimState) => s.tactical!.waves.flatMap((w) => w.tracks);

describe('hypersonic gliders', () => {
  it('are a sixth class that only a few systems can engage, and always turn in flight', () => {
    expect(THREAT_CLASSES).toContain('hypersonic');
    const able = EQUIPMENT.filter((e) => canEngageClass(e, 'hypersonic')).map((e) => e.id);
    expect(able.length).toBeGreaterThanOrEqual(3);
    expect(able.length).toBeLessThanOrEqual(6);
    expect(able).toContain('thaad');
    expect(able).not.toContain('nasams');
    const seen = [3, 5, 9, 14].flatMap((k) => tracks(play(k))).filter((x) => x.cls === 'hypersonic');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => !!x.via || !!x.depTarget)).toBe(true);
  });
});

describe('strikes on the defense', () => {
  it('send some missiles at radars from the second phase, damage the system they hit, and never start in phase 1', () => {
    const s = play(9, { enemy: 'hunter' });
    const hunters = tracks(s).filter((x) => x.depTarget);
    expect(hunters.length).toBeGreaterThan(0);
    for (const tr of hunters) {
      expect(tr.decoy).toBe(false);
      expect(TACTICAL_CONFIG.strikes.classes).toContain(tr.cls);
      expect(trackTarget(s.tactical!, tr)).toEqual(tr.aim);
      if (tr.outcome === 'leaked') expect(tr.damage).toBe(0); // the system takes the hit, not a site
    }
    const planner = play(9);
    expect(planner.tactical!.waves.filter((w) => w.phaseIndex === 0).flatMap((w) => w.tracks).some((x) => x.depTarget)).toBe(false);
  });
});

describe('enemy commanders', () => {
  it('fight differently: the Swarm sends more drones, the Fox more waves, the Hunter more strikes on radars', () => {
    const totals = (enemy: EnemyStyle) => {
      const out = { drones: 0, real: 0, waves: 0, hunts: 0 };
      for (const seed of [3, 5, 9]) {
        const s = play(seed, { enemy });
        const real = tracks(s).filter((x) => !x.decoy);
        out.real += real.length;
        out.drones += real.filter((x) => x.cls === 'slowDrone' || x.cls === 'fastDrone').length;
        out.waves += s.tactical!.waves.length;
        out.hunts += real.filter((x) => x.depTarget).length;
      }
      return out;
    };
    const base = totals('planner');
    const swarm = totals('swarm');
    expect(swarm.drones / swarm.real).toBeGreaterThan(base.drones / base.real);
    expect(swarm.real).toBeGreaterThan(base.real);
    expect(totals('fox').waves).toBeGreaterThan(base.waves);
    expect(totals('hunter').hunts).toBeGreaterThan(base.hunts);
    expect(ENEMY_STYLE_IDS.length).toBe(4);
  });
  it('leaves a campaign with no commander chosen exactly as the Planner plays it', () => {
    const a = play(5);
    const b = play(5, { enemy: 'planner' });
    expect(a.tactical!.stats).toEqual(b.tactical!.stats);
  });
});

describe('research', () => {
  it('can be funded once, completes, and takes effect', () => {
    const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed: 4, startCredits: 5000 }, 'officer'));
    execute(s, { type: 'beginPhase' });
    for (const inv of INVESTMENTS.filter((i) => i.once)) expect(execute(s, { type: 'invest', investmentId: inv.id }).ok, inv.id).toBe(true);
    expect(execute(s, { type: 'invest', investmentId: 'r_network' }).ok).toBe(false); // already under way
    execute(s, { type: 'advance', hours: 45 });
    expect([...(s.research ?? [])].sort()).toEqual(['r_discrim', 'r_ecm', 'r_network', 'r_reload']);
    expect(execute(s, { type: 'invest', investmentId: 'r_network' }).ok).toBe(false); // done
  });
  it('halves resupply time with Rapid Resupply', () => {
    const hours = (research: boolean) => {
      const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed: 4 }, 'recruit'));
      if (research) s.research = ['r_reload'];
      const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
      execute(s, { type: 'deploy', equipmentId: 'patriot-pac3', region: 'EUR', ...spot(s, 'patriot-pac3', 'EUR', site.x, site.y) });
      execute(s, { type: 'beginPhase' });
      const d = s.tactical!.deployments[0];
      d.stock = 0;
      expect(execute(s, { type: 'resupply', deploymentId: d.id }).ok).toBe(true);
      return d.reloadRemaining!;
    };
    expect(hours(true)).toBe(Math.ceil(hours(false) / 2));
  });
});

describe('unit service records', () => {
  it('give every unit a callsign, count the threats it stops and rank it', () => {
    const s = play(5);
    const deps = s.tactical!.deployments;
    expect(deps.every((d) => !!d.callsign)).toBe(true);
    expect(unitName(s, deps[0])).toContain(deps[0].callsign!);
    const stopped = tracks(s).filter((x) => !x.decoy && x.outcome === 'stopped').length;
    expect(deps.reduce((a, d) => a + (d.kills ?? 0), 0)).toBe(stopped);
    expect(veteranOf({ kills: 0 })).toBeNull();
    expect(veteranOf({ kills: TACTICAL_CONFIG.veteran[1].kills })!.label).toBe('Veteran');
    expect(veteranOf({ kills: TACTICAL_CONFIG.veteran[0].kills })!.label).toBe('Elite');
  });
});

describe('telling the story', () => {
  const s = play(9);
  const wave = s.tactical!.waves.filter((w) => w.resolved).sort((a, b) => b.tracks.length - a.tracks.length)[0];
  it('narrates a wave from its opening to its result', () => {
    const lines = narrateWave(s, wave);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0].text).toContain(`from the ${wave.axis}`);
    expect(lines[lines.length - 1].text).toMatch(/stopped/);
    for (const l of lines) expect(l.text).not.toMatch(/undefined|NaN/);
  });
  it('tells every threat\'s story without gaps', () => {
    for (const w of s.tactical!.waves) for (const tr of w.tracks) {
      const text = trackStory(s, w, tr);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/undefined|NaN/);
    }
  });
  it('writes a front page for each finished phase and none for one still to come', () => {
    for (let i = 0; i < s.phases.length; i++) {
      const d = phaseDispatch(s, i)!;
      expect(d.headline.length).toBeGreaterThan(5);
      expect(d.deck).not.toMatch(/undefined|NaN/);
    }
    const fresh = createInitialState(defaultSettings('campaign', { seed: 3 }));
    expect(phaseDispatch(fresh, 0)).toBeNull();
  });
});

describe('planning aids', () => {
  it('grades the layout against each forecast threat class', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    const r = s.tactical!.forecast[0];
    const empty = previewDefense(s, r)!;
    expect(Object.values(empty.byClass).every((x) => x === 0)).toBe(true);
    for (const site of s.tactical!.sites.filter((x) => x.region === r)) execute(s, { type: 'deploy', equipmentId: 'skynex', region: r, ...spot(s, 'skynex', r, site.x, site.y) });
    const guns = previewDefense(s, r)!;
    expect(guns.byClass.slowDrone!).toBeGreaterThan(0.5);
    expect(Object.keys(guns.byClass).sort()).toEqual(Object.keys(guns.mix).sort());
  });
  it('says where a suggested system would stand', () => {
    const s = play(3, { kit: ['zu-23-2'] });
    for (const f of suggestFixes(s)) {
      expect(placementError(s, EQUIPMENT_MAP.get(f.equipmentId)!, f.region, f.x, f.y)).toBeNull();
    }
  });
});

describe('medals', () => {
  it('have unique ids and are earned only by finished games', () => {
    expect(new Set(MEDALS.map((m) => m.id)).size).toBe(MEDALS.length);
    expect(earnedMedals(createInitialState(defaultSettings('campaign', { seed: 3 })))).toEqual([]);
    const done = play(5);
    expect(earnedMedals(done)).toContain('first-watch');
    const quick = createInitialState(lessonSettings(QUICK_BATTLE_ID, { ...defaultSettings('training'), seed: 11 }));
    execute(quick, { type: 'beginPhase' });
    execute(quick, { type: 'advance', hours: 40 });
    expect(earnedMedals(quick)).toContain('first-watch');
    expect(earnedMedals(quick)).not.toContain('quick-three'); // nothing was defended
  });
});
