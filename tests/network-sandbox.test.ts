import { describe, expect, it } from 'vitest';
import { NETWORK_CATEGORIES, createInitialState, defaultSettings, execute, networkPracticeSettings } from '../src/engine';

describe('network and infrastructure practice (sandbox)', () => {
  it('has no attacks, even if threat waves are asked for', () => {
    const s = createInitialState({ ...networkPracticeSettings(7), waves: true });
    expect(s.tactical?.enabled ?? false).toBe(false);
    expect(s.tactical?.waves.length ?? 0).toBe(0);
  });

  it('only produces network, satellite, power, sensor, supply and weather reports, starting with scripted faults', () => {
    for (const seed of [3, 8, 21]) {
      const s = createInitialState(networkPracticeSettings(seed));
      execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 96 });
      expect(s.events.length).toBeGreaterThan(5);
      for (const e of s.events) expect(NETWORK_CATEGORIES).toContain(e.category);
      const ids = s.events.map((e) => e.templateId);
      for (const t of ['relay_degradation', 'power_fault', 'sat_power', 'cable_fault']) expect(ids).toContain(t);
      // Never the categories it leaves out.
      expect(s.events.some((e) => ['instability', 'aircraft', 'maritime', 'personnel', 'information'].includes(e.category))).toBe(false);
    }
  });

  it('sets network goals scaled to its length', () => {
    const s = createInitialState({ ...networkPracticeSettings(4), durationHours: 144 });
    const p = s.phases[0];
    expect(p.objectives.map((o) => o.metric)).toEqual(['networkAvg', 'infrastructure', 'maintenanceDone', 'escalationsMax']);
    expect(p.objectives.find((o) => o.metric === 'maintenanceDone')!.target).toBe(12);
  });

  it('leaves the ordinary sandbox as it was', () => {
    const s = createInitialState(defaultSettings('sandbox', { seed: 4 }));
    expect(s.phases[0].categories.length).toBeGreaterThan(NETWORK_CATEGORIES.length);
    expect(s.phases[0].categories).toContain('instability');
  });
});
