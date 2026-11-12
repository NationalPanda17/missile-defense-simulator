import { describe, expect, it } from 'vitest';
import {
  createInitialState, defaultSettings, execute, computeScore, isActive, TEMPLATE_MAP, exportJSON, importJSON,
  EQUIPMENT, THREAT_CLASSES, LAYER_LABELS, equipmentCost, equipmentUpkeep, isEffector, stateShapeError,
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

describe('tactical layer: equipment catalog', () => {
  it('has unique ids and complete, sane figures', () => {
    expect(new Set(EQUIPMENT.map((e) => e.id)).size).toBe(EQUIPMENT.length);
    expect(EQUIPMENT.length).toBeGreaterThanOrEqual(30);
    for (const e of EQUIPMENT) {
      expect(e.name, e.id).toBeTruthy();
      expect(e.description, e.id).toBeTruthy();
      expect(LAYER_LABELS[e.layer], e.id).toBeTruthy();
      expect(e.rangeKm, e.id).toBeGreaterThan(0);
      expect(e.altitudeKm, e.id).toBeGreaterThan(0);
      expect(e.unitCostUsdM, e.id).toBeGreaterThan(0);
      expect(e.reactionSec, e.id).toBeGreaterThan(0);
      for (const t of THREAT_CLASSES) {
        expect(e.killRate[t], `${e.id} ${t}`).toBeGreaterThanOrEqual(0);
        expect(e.killRate[t], `${e.id} ${t}`).toBeLessThanOrEqual(1);
      }
      if (e.radar) expect(e.radar.rangeKm, e.id).toBeGreaterThan(0);
    }
  });

  it('sensors engage nothing and effectors carry a magazine', () => {
    for (const e of EQUIPMENT) {
      if (e.layer === 'detection') expect(isEffector(e), e.id).toBe(false);
      else {
        expect(isEffector(e), e.id).toBe(true);
        expect(e.magazine, e.id).toBeGreaterThan(0);
      }
    }
  });

  it('every threat class can be engaged by something', () => {
    for (const t of THREAT_CLASSES) expect(EQUIPMENT.some((e) => e.killRate[t] > 0), t).toBe(true);
  });

  it('named products list their official references', () => {
    // The ZU-23-2 is widely built with no single official source, so its figures are game values.
    for (const e of EQUIPMENT.filter((e) => !e.generic && e.id !== 'zu-23-2')) expect(e.sources.length, e.id).toBeGreaterThan(0);
  });

  it('compresses real costs into an affordable credit range', () => {
    const costs = EQUIPMENT.map(equipmentCost);
    expect(Math.min(...costs)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...costs)).toBeLessThan(400);
    for (const e of EQUIPMENT) expect(equipmentUpkeep(e), e.id).toBeGreaterThan(0);
  });
});

describe('tactical layer: state and saves', () => {
  it('new games start with an empty tactical state', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    expect(s.tactical).toEqual({ deployments: [] });
  });

  it('loads a save made before the tactical layer', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    delete s.tactical;
    const t = importJSON(exportJSON(s))!;
    expect(t).not.toBeNull();
    expect(t.tactical).toEqual({ deployments: [] });
  });

  it('rejects malformed tactical state', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 3 }));
    const dep = { id: 'd1', equipmentId: 'iris-t-slm', region: 'EUR' as const, x: 100, y: 100, stock: 24, deployedAt: 0 };
    s.tactical = { deployments: [dep] };
    expect(stateShapeError(s)).toBeNull();
    s.tactical = { deployments: [{ ...dep, equipmentId: 'not-real' }] };
    expect(stateShapeError(s)).toMatch(/unknown equipment/);
    s.tactical = { deployments: [{ ...dep, x: 9999 }] };
    expect(stateShapeError(s)).toMatch(/outside the theater/);
  });
});
