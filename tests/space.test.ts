import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MAP, createInitialState, defaultSettings, execute, inViewAt, inViewDuring, missionUp, placementError, sats, spawnEvent, tickSpace, withLevel,
  type CommandLevel, type RegionId, type SimState,
} from '../src/engine';

const fresh = (seed = 5, level: CommandLevel = 'officer') => createInitialState(withLevel(defaultSettings('campaign', { seed }), level));
const sat = (s: SimState, name: string) => s.assets.find((a) => a.name === name)!;

function spot(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 0; r <= 300; r += 4) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
const KIT = ['patriot-pac3', 'thaad', 'iris-t-slm', 'skynex', 'sentinel'];
function play(seed: number, opts: { level?: CommandLevel; blind?: boolean } = {}) {
  const s = fresh(seed, opts.level ?? 'officer');
  const blind = () => { if (opts.blind) for (const a of sats(s)) if (a.orbit!.mission === 'warning' || a.orbit!.mission === 'tracking') { a.orbit!.destroyed = true; a.condition = 0; } };
  blind();
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 3000) {
    if (s.status === 'briefing') {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        const sites = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        KIT.forEach((id, i) => { try { execute(s, { type: 'deploy', equipmentId: id, region: r, ...spot(s, id, r, sites[i % 3].x, sites[i % 3].y) }); } catch { /* no room */ } });
      }
      execute(s, { type: 'beginPhase' });
    }
    blind();
    for (const d of s.tactical!.deployments) if (d.stock < EQUIPMENT_MAP.get(d.equipmentId)!.magazine / 2) execute(s, { type: 'resupply', deploymentId: d.id });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

describe('orbits', () => {
  it('a geostationary satellite sees about a third of the world from one place, but not the far north', () => {
    const s = fresh();
    const v1 = sat(s, 'VIGIL-1');
    expect(v1.orbit!.regime).toBe('GEO');
    const seen = inViewAt(s, v1.orbit!, 0);
    expect(seen).toContain('NAM');
    expect(seen).toContain('SAM');
    expect(seen).not.toContain('POL');
    expect(seen).not.toContain('IPA');
    expect(inViewAt(s, v1.orbit!, 13)).toEqual(seen); // it does not move
    for (const a of sats(s).filter((x) => x.orbit!.regime === 'GEO')) expect(inViewAt(s, a.orbit!, 0)).not.toContain('POL');
  });

  it('the Molniya satellite covers the polar region for most, not all, of each day', () => {
    const s = fresh();
    const o = sat(s, 'AURORA-P').orbit!;
    expect(o.regime).toBe('HEO');
    const hours = Array.from({ length: 48 }, (_, h) => inViewAt(s, o, h).includes('POL')).filter(Boolean).length;
    expect(hours).toBeGreaterThanOrEqual(26);
    expect(hours).toBeLessThanOrEqual(40);
  });

  it('a low imaging satellite passes over regions a few times a day, briefly', () => {
    const s = fresh();
    const o = sat(s, 'ARGUS-1').orbit!;
    expect(o.regime).toBe('SSO');
    const passes = Object.fromEntries((['EUR', 'AFR', 'NAM', 'IPA'] as RegionId[]).map((r) => [r, Array.from({ length: 24 }, (_, h) => inViewDuring(s, o, h).includes(r)).filter(Boolean).length]));
    for (const n of Object.values(passes)) expect(n).toBeLessThanOrEqual(8);
    expect(Object.values(passes).filter((n) => n > 0).length).toBeGreaterThanOrEqual(3);
    // It moves: where it is changes hour to hour.
    tickSpace(s);
    const p0 = [...sat(s, 'ARGUS-1').pos];
    s.hour += 1;
    tickSpace(s);
    expect(sat(s, 'ARGUS-1').pos).not.toEqual(p0);
  });

  it('older saves (satellites with no orbit) keep their fixed coverage', () => {
    const s = fresh();
    const v = sat(s, 'VIGIL-2');
    delete v.orbit;
    v.coverage = ['EUR', 'AFR', 'MDE'];
    tickSpace(s);
    expect(v.coverage).toEqual(['EUR', 'AFR', 'MDE']);
  });
});

describe('space in the fight', () => {
  it('missile warning and the tracking layer help stop ballistic missiles and gliders, and the debrief records it', () => {
    let withSpace = 0, withSpaceN = 0, blind = 0, blindN = 0, warned = 0;
    for (const seed of [3, 7, 11, 19]) {
      const a = play(seed);
      const b = play(seed, { blind: true });
      for (const w of a.tactical!.waves) {
        if (w.space?.warned) warned++;
        for (const tr of w.tracks) if (!tr.decoy && (tr.cls === 'ballistic' || tr.cls === 'hypersonic') && tr.outcome) { withSpaceN++; if (tr.outcome === 'stopped') withSpace++; }
      }
      for (const w of b.tactical!.waves) {
        expect(w.space?.warned).toBeUndefined();
        for (const tr of w.tracks) if (!tr.decoy && (tr.cls === 'ballistic' || tr.cls === 'hypersonic') && tr.outcome) { blindN++; if (tr.outcome === 'stopped') blind++; }
      }
    }
    expect(warned).toBeGreaterThan(0);
    expect(withSpaceN).toBeGreaterThan(10);
    expect(withSpace / withSpaceN).toBeGreaterThan(blind / blindN);
  });
});

describe('space operations', () => {
  it('moves a geostationary satellite: costs propellant, off station while drifting, then covers the new region', () => {
    const s = fresh();
    execute(s, { type: 'beginPhase' });
    const v = sat(s, 'VIGIL-1');
    const fuel = v.orbit!.fuel;
    expect(inViewAt(s, v.orbit!, s.hour)).not.toContain('EUR');
    const r = execute(s, { type: 'moveSat', assetId: v.id, lon: 15 });
    expect(r.ok).toBe(true);
    expect(v.orbit!.fuel).toBeLessThan(fuel);
    expect(missionUp(s, v)).toBe(false);
    expect(execute(s, { type: 'moveSat', assetId: v.id, lon: 60 }).ok).toBe(false); // already drifting
    const hours = v.orbit!.drift!.hours;
    execute(s, { type: 'advance', hours: 1 });
    expect(v.coverage).toEqual([]);
    execute(s, { type: 'advance', hours: hours + 1 });
    expect(v.orbit!.drift).toBeUndefined();
    expect(v.orbit!.lon).toBe(15);
    expect(v.coverage).toContain('EUR');
    // Not without propellant.
    v.orbit!.fuel = 1;
    expect(execute(s, { type: 'moveSat', assetId: v.id, lon: -100 }).ok).toBe(false);
  });

  it('a debris dodge burns propellant, and cannot be ordered with an empty tank', () => {
    const s = fresh();
    execute(s, { type: 'beginPhase' });
    const e = spawnEvent(s, 'debris', { scripted: true })!;
    const a = s.assets.find((x) => x.id === e.assetId)!;
    expect(a.orbit).toBeDefined();
    a.orbit!.fuel = 3;
    expect(execute(s, { type: 'respond', eventId: e.id, responseId: 'maneuver' }).ok).toBe(false);
    a.orbit!.fuel = 50;
    expect(execute(s, { type: 'respond', eventId: e.id, responseId: 'maneuver' }).ok).toBe(true);
    expect(a.orbit!.fuel).toBe(42);
  });

  it('launches a missile-warning satellite over the chosen region (an elliptical orbit for the Polar region)', () => {
    const s = fresh();
    s.credits = 5000;
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'invest', investmentId: 'launch_warning', region: 'POL' }).ok).toBe(true);
    expect(execute(s, { type: 'invest', investmentId: 'launch_imaging' }).ok).toBe(true);
    execute(s, { type: 'advance', hours: 32 });
    const polar = sats(s).filter((a) => a.orbit!.regime === 'HEO' && a.orbit!.mission === 'warning');
    expect(polar.length).toBe(2);
    expect(sats(s).filter((a) => a.orbit!.mission === 'imaging').length).toBe(3);
    // Two Molniya satellites half an orbit apart cover the pole far more of the day than one.
    const both = Array.from({ length: 24 }, (_, h) => polar.some((a) => inViewAt(s, a.orbit!, s.hour + h).includes('POL'))).filter(Boolean).length;
    expect(both).toBeGreaterThanOrEqual(21);
  });

  it('a jammed satellite cannot fly its mission until the jamming is dealt with', () => {
    const s = fresh(5, 'commander');
    execute(s, { type: 'beginPhase' });
    s.phaseIndex = 1;
    const e = spawnEvent(s, 'sat_jam', { scripted: true })!;
    const a = s.assets.find((x) => x.id === e.assetId)!;
    expect(missionUp(s, a)).toBe(false);
    e.status = 'resolved';
    expect(missionUp(s, a)).toBe(true);
  });
});

describe('attacks on satellites', () => {
  it('never happen on Recruit', () => {
    for (const seed of [2, 4, 6]) {
      const s = play(seed, { level: 'recruit' });
      expect(s.space?.strikes?.some((x) => x.target) ?? false).toBe(false);
      expect(s.events.some((e) => e.templateId === 'sat_jam' || e.templateId === 'sat_inspector')).toBe(false);
    }
  });

  it('on Commander, strike low satellites, leave debris, and are the same for the same seed', () => {
    const runs = [2, 4, 6, 8].map((seed) => play(seed, { level: 'commander' }));
    const hits = runs.flatMap((s) => (s.space?.strikes ?? []).filter((x) => x.target).map((x) => ({ s, x })));
    expect(hits.length).toBeGreaterThan(0);
    for (const { s, x } of hits) {
      const target = s.assets.find((a) => a.id === x.target)!;
      expect(['LEO', 'SSO']).toContain(target.orbit!.regime);
      expect(x.phase).toBeGreaterThanOrEqual(1);
    }
    expect(runs.some((s) => (s.space?.debrisUntil ?? -1) > 0)).toBe(true);
    const again = play(2, { level: 'commander' });
    expect(again.space?.strikes).toEqual(runs[0].space?.strikes);
    // At most two a campaign.
    for (const s of runs) expect((s.space?.strikes ?? []).filter((x) => x.target).length).toBeLessThanOrEqual(2);
  });
});
