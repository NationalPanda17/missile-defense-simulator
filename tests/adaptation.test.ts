import { describe, expect, it } from 'vitest';
import { ADAPTATION, createInitialState, defaultSettings, enemyPlan, execute, scheduleWaves, withLevel } from '../src/engine';
import type { CommandLevel, SimState, ThreatClass, ThreatWave } from '../src/engine';

const fresh = (seed: number, level: CommandLevel = 'commander') => createInitialState(withLevel(defaultSettings('campaign', { seed }), level));

/** A phase-one wave into `region` whose tracks of each class got through or were stopped as given. */
function pastWave(s: SimState, region: ThreatWave['region'], outcomes: [ThreatClass, 'leaked' | 'stopped', number][], axis: ThreatWave['axis'] = 'north'): ThreatWave {
  const t = s.tactical!;
  const site = t.sites.find((x) => x.region === region)!;
  const tracks = outcomes.flatMap(([cls, outcome, n]) => Array.from({ length: n }, (_, i) => ({
    id: `T-${cls}-${outcome}-${i}-${t.nextId++}`, cls, siteId: site.id, from: [0, 0] as [number, number], decoy: false, shots: 1, outcome,
  })));
  return { id: `W-${t.nextId++}`, region, phaseIndex: 0, atHour: 10, axis, forecast: true, tracks, resolved: true };
}

/** Move the state to phase two's briefing with only the given phase-one history. */
function atPhaseTwo(s: SimState, waves: ThreatWave[]) {
  s.tactical!.waves = waves;
  s.tactical!.enemy = undefined;
  s.phaseIndex = 1;
  s.status = 'briefing';
}

describe('Commander: the enemy adapts', () => {
  it('only on Commander, and only after the first phase', () => {
    const officer = fresh(5, 'officer');
    atPhaseTwo(officer, [pastWave(officer, 'EUR', [['cruise', 'leaked', 5]])]);
    expect(enemyPlan(officer)).toBeUndefined();
    const cmd = fresh(5);
    expect(enemyPlan(cmd)).toBeUndefined(); // phase one: nothing learned yet
  });

  it('sends more of what got through and less of what was stopped, within limits', () => {
    const s = fresh(7);
    atPhaseTwo(s, [pastWave(s, 'EUR', [['cruise', 'leaked', 6], ['slowDrone', 'stopped', 6], ['rocket', 'stopped', 3], ['rocket', 'leaked', 3]])]);
    const p = enemyPlan(s)!;
    expect(p.mix.cruise).toBeGreaterThan(1.2);
    expect(p.mix.slowDrone).toBeLessThan(0.8);
    for (const m of Object.values(p.mix)) {
      expect(m).toBeLessThanOrEqual(1 + ADAPTATION.mixShift + 1e-9);
      expect(m).toBeGreaterThanOrEqual(1 - ADAPTATION.mixShift - 1e-9);
    }
    expect(p.learned.join(' ')).toMatch(/Cruise missiles got through/);
  });

  it('presses undefended regions, reuses the approach that worked, and is the same every time', () => {
    const s = fresh(11);
    atPhaseTwo(s, [pastWave(s, 'AFR', [['fastDrone', 'leaked', 5]], 'west')]);
    const p = enemyPlan(s)!;
    expect(p.target.AFR ?? 0).toBeGreaterThan(0);
    expect(p.axis.AFR).toBe('west');
    const again = fresh(11);
    atPhaseTwo(again, [pastWave(again, 'AFR', [['fastDrone', 'leaked', 5]], 'west')]);
    expect(enemyPlan(again)).toEqual(p);
  });

  it('brings more decoys when the defense wasted rounds on them', () => {
    const s = fresh(13);
    const w = pastWave(s, 'EUR', [['cruise', 'stopped', 4]]);
    w.tracks.push({ id: 'D1', cls: 'cruise', siteId: w.tracks[0].siteId, from: [0, 0], decoy: true, shots: 3 });
    atPhaseTwo(s, [w]);
    expect(enemyPlan(s)!.decoys).toBe(ADAPTATION.decoyBoost);
  });

  it('shifts the scheduled waves: more of the favoured threat on average', () => {
    let favoured = 0;
    let neutral = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const adapt of [true, false]) {
        const s = fresh(seed);
        atPhaseTwo(s, [pastWave(s, 'EUR', adapt ? [['ballistic', 'leaked', 6], ['slowDrone', 'stopped', 6]] : [['ballistic', 'stopped', 6], ['slowDrone', 'stopped', 6]])]);
        scheduleWaves(s);
        const n = s.tactical!.waves.filter((w) => w.phaseIndex === 1).flatMap((w) => w.tracks).filter((x) => x.cls === 'ballistic').length;
        if (adapt) favoured += n; else neutral += n;
      }
    }
    expect(favoured).toBeGreaterThan(neutral);
  });

  it('intel is right most of the time and wrong some of the time', () => {
    let wrong = 0;
    const n = 80;
    for (let seed = 1; seed <= n; seed++) {
      const s = fresh(seed);
      atPhaseTwo(s, [pastWave(s, 'EUR', [['cruise', 'leaked', 5]])]);
      const { intel } = enemyPlan(s)!;
      if (!intel.accurate) wrong++;
      expect(!!intel.actual).toBe(!intel.accurate); // a wrong call always comes with what was really true
    }
    expect(wrong / n).toBeGreaterThan(0.15);
    expect(wrong / n).toBeLessThan(0.45);
  });

  it('plays a full Commander campaign with a plan for every later phase', () => {
    const s = fresh(21);
    let g = 0;
    while (s.status !== 'complete' && g++ < 2000) {
      if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 1 });
    }
    expect(s.status).toBe('complete');
    expect(s.tactical!.enemy?.map((p) => p.phaseIndex)).toEqual(s.phases.slice(1).map((_, i) => i + 1));
  });
});
