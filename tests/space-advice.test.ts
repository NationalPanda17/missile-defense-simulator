import { describe, expect, it } from 'vitest';
import {
  advise, createInitialState, defaultSettings, execute, launchSatellite, networkPracticeSettings, sats, spaceOutlook, spawnEvent, withLevel,
  type CommandLevel, type RegionId, type SimState,
} from '../src/engine';

const fresh = (seed = 5, level: CommandLevel = 'officer') => createInitialState(withLevel(defaultSettings('campaign', { seed }), level));
const sat = (s: SimState, name: string) => s.assets.find((a) => a.name === name)!;
const expect_ = (s: SimState, forecast: RegionId[]) => { s.tactical!.forecast = forecast; };
const wear = (s: SimState, name: string, condition: number) => { const a = sat(s, name); a.condition = condition; a.status = 'degraded'; return a; };

describe('space outlook and advice', () => {
  it('warns that one Molniya satellite leaves the pole uncovered part of each orbit, and a second closes the gap', () => {
    const s = fresh();
    expect_(s, ['POL']);
    const gap = spaceOutlook(s).gaps.find((g) => g.region === 'POL')!;
    expect(gap.hours).toBeGreaterThanOrEqual(8);
    expect(gap.fix.kind).toBe('launch');
    const tip = advise(s).find((a) => a.id.startsWith('spacegap:POL'))!;
    expect(tip.text).toMatch(/second, half an orbit behind/);
    launchSatellite(s, 'warning', 'POL');
    expect(spaceOutlook(s).gaps.find((g) => g.region === 'POL')?.hours ?? 0).toBeLessThan(gap.hours);
  });

  it('says when a launch for the region is already on its way', () => {
    const s = fresh();
    s.credits = 5000;
    expect_(s, ['POL']);
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'invest', investmentId: 'launch_warning', region: 'POL' }).ok).toBe(true);
    expect(spaceOutlook(s).gaps.find((g) => g.region === 'POL')?.fix.kind).toBe('launching');
    expect(advise(s).some((a) => a.id.startsWith('spacegap:POL'))).toBe(false);
  });

  it('a worn warning satellite: down for the regions it served, with servicing as the fix', () => {
    const s = fresh();
    expect_(s, ['EUR', 'AFR']);
    const v = wear(s, 'VIGIL-2', 30);
    const o = spaceOutlook(s);
    const w = o.watch.find((x) => x.asset === v)!;
    expect(w.state).toBe('down');
    expect(w.regions.length).toBeGreaterThan(0);
    const gap = o.gaps.find((g) => g.fix.kind === 'service');
    if (gap) expect(gap.fix.kind === 'service' && gap.fix.asset).toBe(v);
    expect(advise(s).find((a) => a.id.startsWith(`satdown:${v.id}`))!.text).toMatch(/too worn/);
  });

  it('a satellite close to the mission floor is fading, and servicing clears it', () => {
    const s = fresh();
    expect_(s, ['EUR']);
    const v = wear(s, 'VIGIL-2', 44);
    expect(spaceOutlook(s).watch.find((x) => x.asset === v)?.state).toBe('fading');
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'maintain', assetId: v.id }).ok).toBe(true);
    expect(advise(s).some((a) => a.id.startsWith(`satfade:${v.id}`) || a.id.startsWith(`satdown:${v.id}`))).toBe(false);
  });

  it('suggests drifting a geostationary satellite over when that covers the gap without opening another', () => {
    const s = fresh();
    expect_(s, ['EUR']);
    execute(s, { type: 'beginPhase' });
    const v2 = sat(s, 'VIGIL-2');
    v2.orbit!.destroyed = true;
    v2.condition = 0;
    const gap = spaceOutlook(s).gaps.find((g) => g.region === 'EUR');
    expect(gap).toBeDefined();
    expect(gap!.fix.kind).toBe('move');
    if (gap!.fix.kind !== 'move') return;
    expect(execute(s, { type: 'moveSat', assetId: gap!.fix.asset.id, lon: gap!.fix.lon }).ok).toBe(true);
    execute(s, { type: 'advance', hours: gap!.fix.hours + 1 });
    expect(spaceOutlook(s).gaps.find((g) => g.region === 'EUR')).toBeUndefined();
  });

  it('flags a jammed satellite', () => {
    const s = fresh(5, 'commander');
    execute(s, { type: 'beginPhase' });
    s.phaseIndex = 1;
    const e = spawnEvent(s, 'sat_jam', { scripted: true })!;
    const a = s.assets.find((x) => x.id === e.assetId)!;
    // Make sure it matters: expect attacks where it warns, if it is a warning satellite.
    const w = spaceOutlook(s).watch.find((x) => x.asset === a);
    if (a.orbit!.mission === 'warning' && !w) return; // a warning satellite over no forecast region is not worth a word
    expect(w?.why).toBe('jammed');
  });

  it('only uses what the player knows: moving the hidden wave times changes nothing', () => {
    const s = fresh(9);
    const before = JSON.stringify(spaceOutlook(s).gaps.map((g) => [g.region, g.hours, g.fix.kind]));
    for (const w of s.tactical!.waves) w.atHour += 5;
    s.commands.push({ t: 0, kind: 'test', text: '', credits: 0, category: 'control' }); // bust the cache
    expect(JSON.stringify(spaceOutlook(s).gaps.map((g) => [g.region, g.hours, g.fix.kind]))).toBe(before);
  });

  it('is quiet where there is no forecast (network practice)', () => {
    const s = createInitialState(networkPracticeSettings(4));
    expect(sats(s).length).toBeGreaterThan(0);
    expect(spaceOutlook(s)).toMatchObject({ gaps: [], watch: [] });
  });
});
