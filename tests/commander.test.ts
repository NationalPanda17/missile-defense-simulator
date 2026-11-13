// Commander playtest: Phase 4 measures improvement, briefings aim players at the sites actually attacked, and
// Commander's budget and deadlines stay tighter than Officer's for the whole campaign.
import { describe, expect, it } from 'vitest';
import {
  COMMAND_LEVELS, createInitialState, defaultSettings, execute, forecastTargets, objectiveProgress, objectiveValue, withLevel,
  type CommandLevel, type SimState,
} from '../src/engine';

const campaign = (level: CommandLevel, seed = 31) => createInitialState(withLevel(defaultSettings('campaign', { seed }), level));
function toPhase(s: SimState, index: number) {
  for (let g = 0; g < 2000 && !(s.phaseIndex === index && s.status === 'briefing'); g++) {
    if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

describe('Phase 4 measures recovery from where the phase began', () => {
  it('targets gains, scaled by difficulty, that start unmet', () => {
    for (const [lv, ready, infra, cred] of [['recruit', 2, 1, 200], ['officer', 4, 3, 300], ['commander', 5, 4, 300]] as const) {
      const s = toPhase(campaign(lv), 3);
      const o = Object.fromEntries(s.phases[3].objectives.map((x) => [x.id, x]));
      expect([o.p4_ready.metric, o.p4_ready.target, o.p4_infra.metric, o.p4_infra.target, o.p4_cred.target])
        .toEqual(['readinessGain', ready, 'infrastructureGain', infra, cred]);
      execute(s, { type: 'beginPhase' });
      expect(objectiveValue(s, 'readinessGain')).toBeCloseTo(0, 6);
      expect(objectiveValue(s, 'infrastructureGain')).toBeCloseTo(0, 6);
      expect(objectiveProgress(s, o.p4_ready)).toBe('behind');
      expect(objectiveProgress(s, o.p4_infra)).toBe('behind');
    }
  });

  it('counts improvement, not the absolute level', () => {
    const s = toPhase(campaign('officer'), 3);
    execute(s, { type: 'beginPhase' });
    const start = s.phaseStart!.infrastructure;
    for (const r of Object.values(s.regions)) r.infrastructure += 5;
    execute(s, { type: 'advance', hours: 1 });
    expect(objectiveValue(s, 'infrastructureGain')).toBeCloseTo(s.metrics.infrastructure - start, 6);
    expect(objectiveValue(s, 'infrastructureGain')).toBeGreaterThan(3);
  });
});

describe('forecast targets', () => {
  it('lists the sites the forecast waves aim at, most threatened first, and what nothing covers', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = campaign('commander', seed);
      const r = s.tactical!.forecast[0];
      const targets = forecastTargets(s, r);
      expect(targets.length).toBeGreaterThan(0);
      for (let i = 1; i < targets.length; i++) expect(targets[i - 1].threat).toBeGreaterThanOrEqual(targets[i].threat);
      for (const x of targets) expect(x.uncovered).toBeCloseTo(x.threat, 9); // nothing deployed yet
      const top = targets[0].site;
      expect(execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: r, x: top.x, y: top.y }).ok).toBe(true);
      expect(forecastTargets(s, r).find((x) => x.site.id === top.id)!.uncovered).toBeLessThan(targets[0].threat);
    }
  });
});

describe('Commander stays harder after the opening budget', () => {
  it('earns less per hour and gives less time per report than Officer', () => {
    expect(COMMAND_LEVELS.commander.incomeMult).toBeLessThan(1);
    expect(COMMAND_LEVELS.commander.deadlineMult).toBeLessThan(1);
    expect(COMMAND_LEVELS.recruit.deadlineMult).toBeGreaterThan(1);
    const gain = (lv: CommandLevel) => {
      const s = campaign(lv, 5);
      s.credits = 500; // below the reserve threshold, so nothing is reclaimed and only income differs
      const c0 = s.credits;
      execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 24 });
      return s.credits - c0;
    };
    expect(gain('commander')).toBeLessThan(gain('officer') * 0.95);
    expect(campaign('commander').phases[0].special[0]).toMatch(/less time before reports escalate, 10% less income/);
  });
});
