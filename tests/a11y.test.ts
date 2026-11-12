import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, execute, lessonSettings } from '../src/engine';
import { announceMemo, describeChanges } from '../src/ui/a11y/announce';

describe('screen-reader announcements', () => {
  it('say nothing on first look, then announce the phase, reports, a launch and its result', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    s.campaignId = 'a';
    expect(describeChanges(null, s).out).toEqual({ polite: [], assertive: [] });
    let memo = announceMemo(s);
    execute(s, { type: 'beginPhase' });
    let r = describeChanges(memo, s);
    expect(r.out.polite.join(' ')).toMatch(/Phase 1, Theater Defense, has begun/);
    memo = r.memo;
    const w = s.tactical!.waves[0];
    execute(s, { type: 'advance', hours: Math.ceil(w.launchAt!) });
    r = describeChanges(memo, s);
    expect(r.out.assertive.join(' ')).toMatch(/Threat wave launched toward Europe/);
    memo = r.memo;
    execute(s, { type: 'advance', hours: Math.ceil(w.atHour - s.hour) + 1 });
    r = describeChanges(memo, s);
    expect(r.out.polite.join(' ')).toMatch(/Wave over Europe ended: \d+ of \d+ threats stopped/);
    // Nothing new: silence.
    expect(describeChanges(r.memo, s).out).toEqual({ polite: [], assertive: [] });
  });

  it('reads new reports, urgent ones assertively', () => {
    const s = createInitialState(lessonSettings('information', defaultSettings('training')));
    s.campaignId = 'b';
    execute(s, { type: 'beginPhase' });
    const memo = announceMemo(s);
    execute(s, { type: 'advance', hours: 3 });
    const r = describeChanges(memo, s);
    expect([...r.out.polite, ...r.out.assertive].join(' ')).toMatch(/New report: .+ confidence \d+ percent/);
  });
});
