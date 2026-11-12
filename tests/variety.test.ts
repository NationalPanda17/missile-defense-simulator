import { describe, expect, it } from 'vitest';
import { TEMPLATE_MAP, createInitialState, defaultSettings, execute, pointAlong, trackPath } from '../src/engine';

describe('campaign variety', () => {
  it('has the new event types, each with a real response and valid follow-ons', () => {
    for (const id of ['feed_corruption', 'cable_fault', 'debris', 'heat', 'fuel']) {
      const t = TEMPLATE_MAP.get(id)!;
      expect(t, id).toBeTruthy();
      expect(t.responses.some((r) => !r.passive)).toBe(true);
      for (const sp of t.escalation.spawns) expect(TEMPLATE_MAP.has(sp.templateId), `${id} → ${sp.templateId}`).toBe(true);
    }
  });

  it('later phases include threats that change direction, inside the theater; phase 1 has none', () => {
    let turned = 0;
    let phase1 = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = createInitialState(defaultSettings('campaign', { seed }));
      for (let i = 0; i < 400 && s.status !== 'complete'; i++) {
        if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
        execute(s, { type: 'advance', hours: 1 });
      }
      for (const w of s.tactical!.waves) for (const tr of w.tracks) {
        if (!tr.via) continue;
        if (w.phaseIndex === 0) phase1++;
        turned++;
        expect(tr.via[0]).toBeGreaterThanOrEqual(10);
        expect(tr.via[0]).toBeLessThanOrEqual(590);
        expect(tr.via[1]).toBeGreaterThanOrEqual(10);
        expect(tr.via[1]).toBeLessThanOrEqual(390);
      }
    }
    expect(phase1).toBe(0);
    expect(turned).toBeGreaterThan(5);
  });

  it('places a point along a bent path by distance, with the heading of its leg', () => {
    const path = trackPath({ from: [0, 0], via: [30, 0] }, [30, 40]); // legs of 30 and 40 km
    expect(pointAlong(path, 0).p).toEqual([0, 0]);
    expect(pointAlong(path, 30 / 70).p[0]).toBeCloseTo(30);
    expect(pointAlong(path, 0.2).heading).toBeCloseTo(0);
    const late = pointAlong(path, 50 / 70);
    expect(late.p[0]).toBeCloseTo(30);
    expect(late.p[1]).toBeCloseTo(20);
    expect(late.heading).toBeCloseTo(90);
    expect(pointAlong(path, 1).p).toEqual([30, 40]);
  });
});

import { TACTICAL_PRESETS, challengeOf, challengeSettings, decodeChallenge, encodeChallenge, withLevel } from '../src/engine';

describe('challenge links', () => {
  it('round-trip and rebuild the same starting world, difficulty and scenario', () => {
    const preset = TACTICAL_PRESETS.find((p) => p.id === 'long-night')!;
    const base = defaultSettings('campaign', { seed: 987654 });
    const s = createInitialState(withLevel({ ...base, name: `${base.name} · ${preset.name}`, tactical: preset.settings }, 'commander'));
    const c = challengeOf(s, { total: 71.26, grade: 'B' })!;
    const code = encodeChallenge(c);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe
    const back = decodeChallenge(code)!;
    expect(back).toEqual({ ...c, score: 71.3 });
    const t = createInitialState(challengeSettings(back));
    expect(t.settings.level).toBe('commander');
    expect(t.settings.name).toBe(s.settings.name);
    expect(t.credits).toBe(s.credits);
    expect(t.tactical!.waves).toEqual(s.tactical!.waves);
    expect(t.tactical!.sites).toEqual(s.tactical!.sites);
    expect(t.assets.map((a) => a.condition)).toEqual(s.assets.map((a) => a.condition));
    expect(t.settings.challenge).toEqual({ score: 71.3, grade: 'B' });
  });

  it('rejects tampered or malformed links and clamps settings', () => {
    expect(decodeChallenge('not-base64!!')).toBeNull();
    expect(decodeChallenge(encodeChallenge({ v: 2 } as never))).toBeNull();
    expect(decodeChallenge(encodeChallenge({ v: 1, mode: 'sandbox', seed: 1 } as never))).toBeNull();
    const c = decodeChallenge(encodeChallenge({ v: 1, mode: 'campaign', seed: 5, level: 'god' as never, score: 500, tactical: { waveSize: 99 } as never }))!;
    expect(c.level).toBe('officer');
    expect(c.score).toBeUndefined();
    expect(c.tactical!.waveSize).toBeLessThanOrEqual(2.5);
  });

  it('is not offered for training lessons', () => {
    expect(challengeOf(createInitialState(defaultSettings('training')))).toBeNull();
  });
});
