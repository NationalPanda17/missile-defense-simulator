import { describe, expect, it } from 'vitest';
import { createInitialState, defaultAutoPause, defaultSettings, execute, lessonSettings, pauseMemo, pauseReasons } from '../src/engine';
import type { PauseMemo, PauseReason, SimState } from '../src/engine';

/** Advance hour by hour like the store does, collecting every reason it would have paused for. */
function watch(s: SimState, hours: number) {
  // Like the store: watching starts in the briefing, so a wave already due when the phase begins still counts.
  let memo: PauseMemo = pauseMemo(s);
  if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
  const all: { hour: number; reasons: PauseReason[] }[] = [];
  for (let i = 0; i < hours && s.status === 'running'; i++) {
    execute(s, { type: 'advance', hours: 1 });
    const r = pauseReasons(memo, s);
    memo = r.memo;
    if (r.reasons.length) all.push({ hour: s.hour, reasons: r.reasons });
  }
  return all;
}

describe('auto-pause', () => {
  it('stops once for each launch warning, before the launch, with the region', () => {
    const s = createInitialState(lessonSettings('tactical2', defaultSettings('training')));
    const hits = watch(s, 40).flatMap((h) => h.reasons.filter((r) => r.kind === 'launch').map((r) => ({ ...r, hour: h.hour })));
    const waves = s.tactical!.waves;
    expect(hits.map((h) => h.waveId).sort()).toEqual(waves.map((w) => w.id).sort()); // every wave, once
    for (const h of hits) {
      const w = waves.find((x) => x.id === h.waveId)!;
      expect(h.hour).toBeLessThanOrEqual(w.launchAt!); // warned before (or at) launch, never after impact
      expect(h.text).toContain(s.regions[w.region].name);
    }
    expect(hits.find((h) => h.region === 'AFR')!.text).toMatch(/outside the forecast/);
  });

  it('stops for new reports and for reports about to escalate with nothing ordered', () => {
    const s = createInitialState(lessonSettings('events', defaultSettings('training')));
    const kinds = watch(s, 60).flatMap((h) => h.reasons.map((r) => r.kind));
    expect(kinds).toContain('report');
    expect(kinds).toContain('deadline');
  });

  it('says nothing about a report once it has been handled', () => {
    const s = createInitialState(lessonSettings('events', defaultSettings('training')));
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 2 });
    for (const e of s.events) execute(s, { type: 'dismiss', eventId: e.id });
    expect(watch(s, 60).flatMap((h) => h.reasons).filter((r) => r.kind === 'deadline' && s.events.some((e) => e.id === r.eventId && e.status === 'dismissed'))).toEqual([]);
  });

  it('defaults by difficulty, and is silent when nothing changes', () => {
    expect(defaultAutoPause('recruit')).toEqual({ launch: true, deadline: true, report: true });
    expect(defaultAutoPause('officer')).toEqual({ launch: true, deadline: true, report: false });
    expect(defaultAutoPause(undefined)).toEqual(defaultAutoPause('officer'));
    expect(defaultAutoPause('commander')).toEqual({ launch: false, deadline: false, report: false });
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    expect(pauseReasons(pauseMemo(s), s).reasons).toEqual([]);
  });
});
