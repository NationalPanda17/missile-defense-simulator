import { describe, expect, it } from 'vitest';
import {
  createInitialState, defaultSettings, execute, computeScore, isActive, TEMPLATE_MAP, exportJSON, importJSON,
} from '../src/engine';
import type { SimState } from '../src/engine';

function runCampaign(policy: (s: SimState) => void, seed = 7) {
  const s = createInitialState(defaultSettings('campaign', { seed }));
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 2000) {
    if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
    policy(s);
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

const passive = () => {};
const active = (s: SimState) => {
  for (const e of s.events.filter((e) => isActive(e) && e.reportedAt <= s.hour)) {
    if (e.status !== 'reported') continue;
    if (e.confidence < 55) { execute(s, { type: 'confirm', eventId: e.id }); continue; }
    const t = TEMPLATE_MAP.get(e.templateId)!;
    const r = t.responses.filter((r) => !r.passive).sort((a, b) => a.credits - b.credits)[0];
    if (r) execute(s, { type: 'respond', eventId: e.id, responseId: r.id });
  }
  for (const a of s.assets) if (a.hoursToService < 0 || a.condition < 60) execute(s, { type: 'maintain', assetId: a.id });
  if (s.credits > 900) execute(s, { type: 'invest', investmentId: 'resilience' });
};

describe('simulation engine', () => {
  it('runs a full campaign deterministically', () => {
    const a = runCampaign(passive, 11);
    const b = runCampaign(passive, 11);
    expect(a.status).toBe('complete');
    expect(a.hour).toBe(240);
    expect(a.metrics.globalReadiness).toBeCloseTo(b.metrics.globalReadiness, 6);
    expect(a.events.length).toBeGreaterThan(10);
  });

  it('an active commander outscores a passive one', () => {
    const scores = [3, 5, 9].map((seed) => {
      const p = computeScore(runCampaign(passive, seed));
      const act = runCampaign(active, seed);
      const q = computeScore(act);
      console.log(`seed ${seed}: passive ${p.total.toFixed(1)} (${p.grade}) active ${q.total.toFixed(1)} (${q.grade}) events ${act.events.length} esc ${act.counters.escalations} credits ${Math.round(act.credits)} ready ${act.metrics.globalReadiness.toFixed(0)}`);
      console.log('  passive', JSON.stringify(Object.fromEntries(Object.entries(p.components).map(([k, v]) => [k, Math.round(v)]))));
      console.log('  active ', JSON.stringify(Object.fromEntries(Object.entries(q.components).map(([k, v]) => [k, Math.round(v)]))));
      return [p.total, q.total];
    });
    for (const [p, q] of scores) expect(q).toBeGreaterThan(p);
  });

  it('rejects unaffordable commands and logs spending', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 1 }));
    execute(s, { type: 'beginPhase' });
    s.credits = 10;
    expect(execute(s, { type: 'invest', investmentId: 'modernize' }).ok).toBe(false);
    s.credits = 1000;
    expect(execute(s, { type: 'maintain', assetId: s.assets[0].id }).ok).toBe(true);
    expect(s.commands.at(-1)?.credits).toBeGreaterThan(0);
    expect(s.crewsBusy).toBe(1);
  });

  it('round-trips through JSON save', () => {
    const s = runCampaign(active, 2);
    const t = importJSON(exportJSON(s))!;
    expect(t.hour).toBe(s.hour);
    expect(t.events.length).toBe(s.events.length);
  });
});
