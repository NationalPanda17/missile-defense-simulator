import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, execute, lessonSettings, isActive, isSea, onMassif } from '../src/engine';
import type { RegionId, SimState } from '../src/engine';
import { detectCues, memoOf, tensionOf, trackCues } from '../src/ui/audio/cues';

function landNear(s: SimState, region: RegionId, x: number, y: number) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 300; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}

describe('sound cues', () => {
  it('makes no sound on the first look or for a different scenario', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    s.campaignId = 'a';
    expect(detectCues(null, s).cues).toEqual([]);
    const other = createInitialState(defaultSettings('campaign', { seed: 4 }));
    other.campaignId = 'b';
    expect(detectCues(memoOf(s), other).cues).toEqual([]);
  });

  it('cues phase start, the player’s orders and new reports', () => {
    const s = createInitialState(lessonSettings('information', defaultSettings('training')));
    s.campaignId = 'x';
    let memo = memoOf(s);
    execute(s, { type: 'beginPhase' });
    let r = detectCues(memo, s);
    expect(r.cues).toEqual(['phaseStart']);
    memo = r.memo;
    execute(s, { type: 'advance', hours: 2 });
    r = detectCues(memo, s);
    expect(r.cues).toContain('report');
    memo = r.memo;
    const e = s.events.find((x) => isActive(x) && x.status === 'reported')!;
    execute(s, { type: 'confirm', eventId: e.id });
    r = detectCues(memo, s);
    expect(r.cues).toEqual(['confirm']);
    // Nothing new, no sound.
    expect(detectCues(r.memo, s).cues).toEqual([]);
  });

  it('cues a launch, then each interception and hit when it happens on the map', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    s.campaignId = 'y';
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR').slice(0, 3)) {
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    execute(s, { type: 'beginPhase' });
    let memo = memoOf(s);
    const w = s.tactical!.waves[0];
    execute(s, { type: 'advance', hours: Math.ceil(w.launchAt!) });
    const r = detectCues(memo, s);
    expect(r.cues).toContain('launch');
    memo = r.memo;
    const cues = trackCues(s, w.launchAt! - 0.001, w.atHour + 0.001);
    const stopped = w.tracks.filter((x) => x.outcome === 'stopped' || x.outcome === 'decoyStopped').length;
    const hits = w.tracks.filter((x) => x.outcome === 'leaked').length;
    expect(cues.filter((c) => c === 'intercept')).toHaveLength(stopped);
    expect(cues.filter((c) => c === 'impact')).toHaveLength(hits);
    expect(stopped).toBeGreaterThan(0);
    // Split into two windows, nothing is counted twice or lost.
    const mid = (w.launchAt! + w.atHour) / 2;
    expect(trackCues(s, w.launchAt! - 0.001, mid).length + trackCues(s, mid, w.atHour + 0.001).length).toBe(cues.length);
    // Tension rises while threats are in flight.
    expect(tensionOf(s, mid)).toBeGreaterThan(tensionOf(s, w.atHour + 5));
  });
});
