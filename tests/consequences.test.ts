import { describe, expect, it } from 'vitest';
import { advise, createInitialState, defaultSettings, execute, scheduleWaves, siteDamageShare } from '../src/engine';

describe('campaign consequences carry over', () => {
  it('damaged sites keep pulling a region’s stability down', () => {
    const run = (damage: boolean) => {
      const s = createInitialState(defaultSettings('campaign', { seed: 30 }));
      if (damage) for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) site.integrity = 40;
      execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 24 });
      return s;
    };
    const hurt = run(true);
    const fine = run(false);
    expect(siteDamageShare(hurt, 'EUR')).toBeCloseTo(0.6, 5);
    expect(hurt.regions.EUR.stability).toBeLessThan(fine.regions.EUR.stability - 3);
  });

  it('makes a badly hit region a likelier forecast target', () => {
    let hit = 0;
    let base = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = createInitialState(defaultSettings('campaign', { seed }));
      if (a.tactical!.forecast.includes('AFR')) base++;
      const b = createInitialState(defaultSettings('campaign', { seed }));
      for (const site of b.tactical!.sites.filter((x) => x.region === 'AFR')) site.integrity = 20;
      // Re-run the briefing forecast with the damage in place.
      b.status = 'briefing';
      b.tactical!.waves = [];
      scheduleWaves(b);
      if (b.tactical!.forecast.includes('AFR')) hit++;
    }
    expect(hit).toBeGreaterThan(base);
  });

  it('can be repaired with Rebuild Damaged Sites, and the adjutant suggests it', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 30 }));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'MDE')) site.integrity = 50;
    execute(s, { type: 'beginPhase' });
    expect(advise(s).some((a) => a.id.startsWith('rebuild:MDE'))).toBe(true);
    s.credits = 5000;
    expect(execute(s, { type: 'invest', investmentId: 'rebuild', region: 'MDE' }).ok).toBe(true);
    expect(advise(s).some((a) => a.id.startsWith('rebuild:MDE'))).toBe(false); // already under way
    execute(s, { type: 'advance', hours: 19 });
    for (const site of s.tactical!.sites.filter((x) => x.region === 'MDE')) expect(site.integrity).toBe(85);
  });
});
