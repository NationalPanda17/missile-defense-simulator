import { describe, expect, it } from 'vitest';
import { COMMAND_LEVELS, createInitialState, defaultSettings, execute, withLevel } from '../src/engine';
import type { CommandLevel, SimState } from '../src/engine';

const campaign = (level?: CommandLevel, seed = 31) => {
  const base = defaultSettings('campaign', { seed });
  return createInitialState(level ? withLevel(base, level) : base);
};

function play(s: SimState, hours = 240) {
  for (let i = 0; i < 2000 && s.status !== 'complete' && s.hour < hours; i++) {
    if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

const realTracks = (s: SimState) => s.tactical!.waves.reduce((a, w) => a + w.tracks.length, 0);

describe('campaign difficulty levels', () => {
  it('Officer is exactly the campaign as designed', () => {
    const a = play(campaign(undefined, 5));
    const b = play(campaign('officer', 5));
    expect(b.settings.name).toBe(a.settings.name);
    expect(b.phases).toEqual(a.phases);
    expect(b.metrics.globalReadiness).toBe(a.metrics.globalReadiness);
    expect(b.tactical!.waves).toEqual(a.tactical!.waves);
    expect(b.events.length).toBe(a.events.length);
  });

  it('Recruit is easier and Commander harder than Officer', () => {
    const r = campaign('recruit');
    const o = campaign('officer');
    const c = campaign('commander');
    expect(r.credits).toBe(o.credits + COMMAND_LEVELS.recruit.credits);
    expect(c.credits).toBe(o.credits + COMMAND_LEVELS.commander.credits);
    expect(r.settings.name).toContain('Recruit');
    expect(c.settings.name).toContain('Commander');
    for (let i = 0; i < o.phases.length; i++) {
      expect(r.phases[i].falseRate).toBeLessThan(o.phases[i].falseRate);
      expect(c.phases[i].falseRate).toBeGreaterThan(o.phases[i].falseRate);
    }
    // Over several seeds: more events and more incoming threats at Commander than at Recruit.
    let evR = 0; let evC = 0; let trR = 0; let trC = 0;
    for (const seed of [2, 3, 4, 6]) {
      const pr = play(campaign('recruit', seed));
      const pc = play(campaign('commander', seed));
      evR += pr.events.length; evC += pc.events.length;
      trR += realTracks(pr); trC += realTracks(pc);
    }
    expect(evC).toBeGreaterThan(evR);
    expect(trC).toBeGreaterThan(trR);
  });

  it('applies only to the campaign', () => {
    const s = withLevel(defaultSettings('crisis'), 'commander');
    expect(s.level).toBeUndefined();
    expect(s.startCredits).toBe(defaultSettings('crisis').startCredits);
  });
});
