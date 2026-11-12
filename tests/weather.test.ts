import { describe, expect, it } from 'vitest';
import { WEATHER, createInitialState, defaultSettings, execute, isNight, isStorm, localHour, stormWindows } from '../src/engine';

describe('weather and daylight', () => {
  const s = createInitialState(defaultSettings('campaign', { seed: 42 }));

  it('uses local time from each theater’s longitude (the scenario starts at 06:00 UTC)', () => {
    expect(localHour(s, 'EUR', 0)).toBeCloseTo(7); // 06:00 UTC + 1h
    expect(localHour(s, 'NAM', 0)).toBeCloseTo((6 - 100 / 15 + 24) % 24);
    expect(isNight(s, 'EUR', 0)).toBe(false);
    expect(isNight(s, 'EUR', 16)).toBe(true); // 23:00 local
  });

  it('is the same every time for a seed, with storms in a plausible share of the time', () => {
    const again = createInitialState(defaultSettings('campaign', { seed: 42 }));
    let stormy = 0;
    for (let h = 0; h < 2400; h++) {
      expect(isStorm(s, 'IPA', h)).toBe(isStorm(again, 'IPA', h));
      if (isStorm(s, 'IPA', h)) stormy++;
    }
    expect(stormy / 2400).toBeGreaterThan(WEATHER.stormChance.IPA * 0.5);
    expect(stormy / 2400).toBeLessThan(WEATHER.stormChance.IPA * 1.6);
    for (const [a, b] of stormWindows(s, 'IPA', 0, 240)) for (let h = a; h < b; h++) expect(isStorm(s, 'IPA', h)).toBe(true);
  });

  it('times some campaign raids for the dark, and records each wave’s conditions', () => {
    let night = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const c = createInitialState(defaultSettings('campaign', { seed }));
      for (let i = 0; i < 2000 && c.status !== 'complete'; i++) {
        if (c.status === 'briefing') execute(c, { type: 'beginPhase' });
        execute(c, { type: 'advance', hours: 1 });
      }
      for (const w of c.tactical!.waves) {
        expect(w.conditions).toBeDefined();
        total++;
        if (isNight(c, w.region, w.launchAt ?? w.atHour)) night++;
      }
    }
    expect(night / total).toBeGreaterThan(0.4); // well above the share of the day that is night (9h of 24)
  });
});
