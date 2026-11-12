import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, execute, isSea, leakText, lessonSettings, onMassif, previewDefense } from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x: number, y: number) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 300; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}
const run = (s: SimState, h = 12) => { execute(s, { type: 'beginPhase' }); execute(s, { type: 'advance', hours: h }); return s.tactical!.waves[0]; };

describe('why threats got through', () => {
  it('says when nothing was deployed', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    const w = run(s);
    for (const tr of w.tracks.filter((x) => !x.decoy)) expect(leakText(tr, s.tactical!.deployments)).toBe('Nothing deployed in the region could engage it.');
  });

  it('names systems that could not reach the threat, and why', () => {
    // High arc drill: ballistic missiles and rockets; a gun system can reach neither the altitude nor most rockets.
    const s = createInitialState(lessonSettings('drill-higharc', defaultSettings('training')));
    const site = s.tactical!.sites.find((x) => x.region === 'MDE')!;
    execute(s, { type: 'deploy', equipmentId: 'skynex', region: 'MDE', ...landNear(s, 'MDE', site.x, site.y) });
    const w = run(s);
    const ballistic = w.tracks.filter((x) => x.cls === 'ballistic' && x.outcome === 'leaked');
    expect(ballistic.length).toBeGreaterThan(0);
    for (const tr of ballistic) expect(leakText(tr, s.tactical!.deployments)).toMatch(/Nothing engaged it: Skynex — cannot reach a ballistic missile’s altitude/);
  });

  it('records who engaged each threat and how many rounds, matching the totals', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR').slice(0, 3)) {
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    const w = run(s);
    for (const tr of w.tracks) {
      expect((tr.fired ?? []).reduce((a, f) => a + f.shots, 0)).toBe(tr.shots);
      if (tr.outcome === 'stopped') expect(tr.fired!.some((f) => f.dep === tr.stoppedBy)).toBe(true);
      if (tr.outcome === 'leaked') expect(leakText(tr, s.tactical!.deployments)).toBeTruthy();
      expect(tr.leak).toBeUndefined(); // saves keep codes, not sentences
      expect(typeof tr.detected).toBe('boolean');
    }
    expect(s.log.some((l) => /stopped, \d+ got through\. Mostly: /.test(l.text)) || w.tracks.every((x) => x.decoy || x.outcome === 'stopped')).toBe(true);
  });

  it('gives the forecast a likely range around its estimate', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR').slice(0, 2)) {
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    const p = previewDefense(s, 'EUR')!;
    expect(p.range[0]).toBeLessThanOrEqual(p.prevented);
    expect(p.range[1]).toBeGreaterThanOrEqual(p.prevented);
    expect(p.range[1]).toBeGreaterThan(p.range[0]);
  });
});

describe('older saves', () => {
  it('still explain leaks stored as sentences and reasons stored as words', () => {
    const tr = { id: 'T', cls: 'cruise' as const, siteId: 'S', from: [0, 0] as [number, number], decoy: false, shots: 0, outcome: 'leaked' as const,
      leak: 'Written out.', why: [{ dep: 'D1', reason: 'out of range' }] };
    expect(leakText(tr, [])).toBe('Written out.');
  });
});
