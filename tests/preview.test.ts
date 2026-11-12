import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, execute, isSea, lessonSettings, onMassif, previewDefense } from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x: number, y: number) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 300; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}

describe('briefing what-if preview', () => {
  it('estimates the forecast waves against the layout, improves as defenses are added, and changes nothing', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    const empty = previewDefense(s, 'EUR')!;
    expect(empty.waves).toBe(1);
    expect(empty.threats).toBe(10);
    expect(empty.stopRate).toBe(0);
    expect(empty.mix).toEqual({ slowDrone: 6, fastDrone: 2, cruise: 2 });
    const before = JSON.stringify(s);
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR').slice(0, 2)) {
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    const some = previewDefense(s, 'EUR')!;
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) {
      execute(s, { type: 'deploy', equipmentId: 'skynex', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    const more = previewDefense(s, 'EUR')!;
    expect(some.stopRate).toBeGreaterThan(0);
    expect(more.stopRate).toBeGreaterThan(some.stopRate);
    expect(more.prevented).toBeGreaterThan(some.prevented);
    // The preview is a pure read: the same calls leave the state exactly as they found it.
    const snap = JSON.stringify(s);
    previewDefense(s, 'EUR');
    expect(JSON.stringify(s)).toBe(snap);
    expect(snap).not.toBe(before); // (sanity: the deploys did change it)
  });

  it('is close to what actually happens', () => {
    let predicted = 0;
    let actual = 0;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const s = createInitialState(lessonSettings('tactical1', defaultSettings('training', { seed })));
      for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR').slice(0, 3)) {
        execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
      }
      predicted += previewDefense(s, 'EUR')!.stopRate;
      execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 12 });
      actual += s.tactical!.stats.stopped / s.tactical!.stats.tracks;
    }
    expect(Math.abs(predicted - actual) / 6).toBeLessThan(0.15);
  });

  it('leaves out regions with no forecast wave (no peeking at surprises)', () => {
    const s = createInitialState(lessonSettings('tactical2', defaultSettings('training')));
    expect(previewDefense(s, 'AFR')).toBeNull(); // the surprise wave
    expect(previewDefense(s, 'EUR')!.waves).toBe(2);
  });
});
