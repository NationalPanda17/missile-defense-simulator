// Fourth playtest: Crisis pacing and adjutant, the campaign's opening wave, locked response odds, resupply prices.
import { describe, expect, it } from 'vitest';
import {
  TACTICAL_CONFIG, TACTICAL_PRESETS, TEMPLATE_MAP, advise, applyPacing, createInitialState, defaultAutoPause, defaultSettings,
  execute, isActive, resupplyCost, withLevel, EQUIPMENT_MAP, type SimState,
} from '../src/engine';

describe('Crisis Mode pauses before escalations', () => {
  it('defaults to escalation pauses where there are no waves', () => {
    for (const lv of [undefined, 'officer', 'commander'] as const) expect(defaultAutoPause(lv, false).deadline).toBe(true);
    expect(defaultAutoPause('commander', true).deadline).toBe(false); // the campaign keeps its Commander default
  });

  it('reads a saved "waves only" as "urgent only" without waves, but respects "never"', () => {
    expect(applyPacing({ launch: true, deadline: false, report: false }, false)).toEqual({ launch: true, deadline: true, report: false });
    expect(applyPacing({ launch: true, deadline: false, report: false }, true).deadline).toBe(false);
    expect(applyPacing({ launch: false, deadline: false, report: false }, false).deadline).toBe(false);
  });

  it('has the adjutant flag a level objective below target straight away', () => {
    const s = createInitialState(defaultSettings('crisis', { seed: 3 }));
    execute(s, { type: 'beginPhase' });
    for (const r of Object.values(s.regions)) r.comms = 10;
    s.metrics.network = 30;
    const net = s.phases[0].objectives.find((o) => o.metric === 'network')!;
    s.metrics.network = net.target - 10;
    expect(advise(s).some((a) => a.id.startsWith(`objective:0:${net.id}`))).toBe(true);
  });
});

describe('the campaign opening builds up', () => {
  it('keeps the first wave small and after T+12h, even at Commander with Coastal Saturation', () => {
    const preset = TACTICAL_PRESETS.find((p) => p.id === 'coastal-saturation')!;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = createInitialState(withLevel(defaultSettings('campaign', { seed, tactical: preset.settings }), 'commander'));
      const waves = s.tactical!.waves.filter((w) => w.phaseIndex === 0).sort((a, b) => a.atHour - b.atHour);
      const first = waves[0];
      expect(first.atHour, `seed ${seed}`).toBeGreaterThanOrEqual(12);
      expect(first.tracks.length, `seed ${seed}`).toBeLessThanOrEqual(TACTICAL_CONFIG.waves[0].tracks[1]);
      expect(Math.max(...waves.map((w) => w.tracks.length))).toBeGreaterThan(first.tracks.length); // the rest stay big
    }
  });

  it('every scenario preset has a description for the picker', () => {
    for (const p of TACTICAL_PRESETS) expect(p.description.length, p.id).toBeGreaterThan(20);
  });
});

describe('response odds and resupply', () => {
  it('locks the success chance when a response is ordered', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 8 }));
    execute(s, { type: 'beginPhase' });
    let e: SimState['events'][number] | undefined;
    for (let i = 0; i < 100 && !e; i++) {
      execute(s, { type: 'advance', hours: 1 });
      e = s.events.find((x) => isActive(x) && x.status === 'reported' && x.reportedAt <= s.hour);
    }
    const resp = TEMPLATE_MAP.get(e!.templateId)!.responses.find((r) => !r.passive)!;
    s.credits = 5000;
    expect(execute(s, { type: 'respond', eventId: e!.id, responseId: resp.id }).ok).toBe(true);
    const locked = e!.responseChance!;
    expect(locked).toBeGreaterThan(0);
    for (const r of Object.values(s.regions)) r.comms = 0; // conditions change; the locked chance does not
    execute(s, { type: 'advance', hours: 1 });
    expect(e!.responseChance).toBe(locked);
  });

  it('makes resupply a real cost', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 2 }));
    const r = s.tactical!.forecast[0];
    const site = s.tactical!.sites.find((x) => x.region === r)!;
    expect(execute(s, { type: 'deploy', equipmentId: 'iris-t-slm', region: r, x: site.x, y: site.y }).ok).toBe(true);
    const d = s.tactical!.deployments[0];
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    expect(resupplyCost(d, 1)).toBeGreaterThanOrEqual(TACTICAL_CONFIG.resupplyMinCost);
    expect(resupplyCost(d, spec.magazine)).toBeGreaterThanOrEqual(Math.ceil(36 * 0.8) - 1);
    expect(resupplyCost(d, 0)).toBe(0);
  });
});
