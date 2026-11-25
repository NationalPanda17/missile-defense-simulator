// The battle-first layout, the start screen, quieter pauses, the footer message slot and the combat effects.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import {
  QUICK_BATTLE_ID, createInitialState, defaultSettings, execute, lessonSettings, networkPracticeSettings, pauseMemo, pauseReasons, spawnEvent, wantsPause,
  defaultAutoPause, type SimState,
} from '../src/engine';
import { store } from '../src/store/simStore';
import { UIProvider } from '../src/ui/uiState';
import { StartScreen } from '../src/ui/Modals';
import { NAV, navGroups, opensOverBattle } from '../src/ui/Shell';
import { ToastLine } from '../src/ui/components/ui';
import { LiveThreats } from '../src/ui/views/theater/LiveThreats';
import { trackEnd } from '../src/ui/threatTimeline';

const html = (el: ReactElement) => renderToString(<UIProvider>{el}</UIProvider>);

describe('battle-first layout', () => {
  it('groups the screens as Battle, Network, Staff and Review, battle first', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    const g = navGroups(s);
    expect(g.map((x) => x.name)).toEqual(['Battle', 'Network', 'Staff', 'Review']);
    expect(g[0].items.map((n) => n.id)).toEqual(['theater', 'global']);
    expect(g.flatMap((x) => x.items).length).toBe(NAV.length);
    // No threat waves: no theater.
    const n = createInitialState(networkPracticeSettings(3));
    expect(navGroups(n)[0].items.map((x) => x.id)).toEqual(['global']);
  });

  it('network and staff screens open over the battle; planning screens and wave-free scenarios do not', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    for (const v of ['space', 'air', 'sea', 'ground', 'comms', 'infra', 'intel', 'logistics'] as const) expect(opensOverBattle(s, v)).toBe(true);
    for (const v of ['theater', 'global', 'campaign', 'editor', 'aar'] as const) expect(opensOverBattle(s, v)).toBe(false);
    expect(opensOverBattle(createInitialState(networkPracticeSettings(3)), 'space')).toBe(false);
  });
});

describe('start screen', () => {
  it('leads with three choices and folds the rest under More modes', () => {
    const out = html(<StartScreen onSandbox={() => {}} />);
    for (const t of ['Quick Battle', 'Campaign', 'More modes', 'Endless Defense', 'Raid Designer', 'Network practice']) expect(out).toContain(t);
    expect(out.indexOf('Quick Battle')).toBeLessThan(out.indexOf('More modes'));
    expect(out.indexOf('Begin campaign')).toBeLessThan(out.indexOf('More modes'));
  });
});

describe('fewer interruptions', () => {
  it('routine reports wait in the inbox; the most severe ones still pause', () => {
    const p = defaultAutoPause('recruit');
    expect(wantsPause(p, { kind: 'report', text: '' })).toBe(false);
    expect(wantsPause(p, { kind: 'report', text: '', severe: true })).toBe(true);
    expect(wantsPause(p, { kind: 'launch', text: '' })).toBe(true);
    expect(wantsPause(defaultAutoPause('commander'), { kind: 'report', text: '', severe: true })).toBe(false);
  });

  it('marks a new top-severity report as severe', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    execute(s, { type: 'beginPhase' });
    const memo = pauseMemo(s);
    const e = spawnEvent(s, 'relay_degradation', { scripted: true })!;
    e.severity = 3;
    e.reportedAt = s.hour;
    const r = pauseReasons(memo, s).reasons.find((x) => x.eventId === e.id);
    expect(r?.severe).toBe(true);
  });
});

describe('messages inside a window', () => {
  it('the footer slot shows the latest message', () => {
    store.toasts = [{ id: 1, tone: 'err', text: 'Too close to another system.' } as (typeof store.toasts)[number]];
    expect(html(<ToastLine />)).toContain('Too close to another system.');
    store.toasts = [];
    expect(html(<ToastLine />)).toContain('hidden');
  });
});

describe('combat feel', () => {
  it('draws the interceptor on its way just before a threat is stopped', () => {
    const s: SimState = createInitialState(lessonSettings(QUICK_BATTLE_ID, { ...defaultSettings('training'), seed: 5 }));
    const t = s.tactical!;
    // Defend the region, then run until a wave has been decided with a stopped track.
    const r = t.forecast[0];
    const site = t.sites.find((x) => x.region === r)!;
    for (const id of ['iris-t-slm', 'skynex', 'coyote', 'sentinel']) execute(s, { type: 'deploy', equipmentId: id, region: r, x: site.x, y: site.y });
    execute(s, { type: 'beginPhase' });
    let w, tr;
    for (let g = 0; g < 80 && !tr; g++) {
      execute(s, { type: 'advance', hours: 1 });
      w = t.waves.find((x) => x.resolved && x.tracks.some((k) => k.outcome === 'stopped' && k.stoppedBy));
      tr = w?.tracks.find((k) => k.outcome === 'stopped' && k.stoppedBy && !k.decoy);
    }
    expect(tr).toBeDefined();
    const { launch, flight, end } = trackEnd(w!, tr!);
    const at = launch + flight * (end - 0.05); // inside the interceptor's flight
    store.state = s;
    const out = renderToString(<svg><LiveThreats s={s} region={w!.region} only={w!.id} at={at} /></svg>);
    expect(out).toContain('data-interceptor');
    store.state = null;
  });
});
