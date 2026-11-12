import { describe, expect, it } from 'vitest';
import { EQUIPMENT_MAP, STOCKPILES, createInitialState, defaultSettings, execute, isSea, onMassif, resupplyRounds, stockpileOf, withLevel } from '../src/engine';
import type { CommandLevel, RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x = 300, y = 200) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 400; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}
const campaign = (level: CommandLevel) => createInitialState(withLevel(defaultSettings('campaign', { seed: 21 }), level));
const nasams = EQUIPMENT_MAP.get('nasams')!;

describe('interceptor stockpiles', () => {
  it('apply only to the campaign on Officer and Commander', () => {
    for (const lvl of ['recruit', 'officer', 'commander'] as CommandLevel[]) {
      const s = campaign(lvl);
      const r = s.tactical!.forecast[0];
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
      const want = STOCKPILES[lvl] ? Math.floor(nasams.magazine * STOCKPILES[lvl]!.initial) : Infinity;
      expect(stockpileOf(s, 'nasams'), lvl).toBe(want);
    }
    expect(stockpileOf(createInitialState(defaultSettings('sandbox')), 'nasams')).toBe(Infinity);
    expect(stockpileOf(createInitialState(defaultSettings('training')), 'nasams')).toBe(Infinity);
  });

  it('resupply draws from the stockpile, can be partial, and stops when it is empty', () => {
    const s = campaign('commander'); // reserve: half a magazine per unit
    const r = s.tactical!.forecast[0];
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
    execute(s, { type: 'beginPhase' });
    const d = s.tactical!.deployments[0];
    const reserve = stockpileOf(s, 'nasams');
    d.stock = 0; // fired everything
    expect(resupplyRounds(s, d)).toBe(reserve);
    expect(execute(s, { type: 'resupply', deploymentId: d.id }).ok).toBe(true);
    expect(stockpileOf(s, 'nasams')).toBe(0);
    execute(s, { type: 'advance', hours: nasams.reloadHours + 1 });
    expect(d.stock).toBe(reserve); // partial: only what the stockpile had
    d.stock = 0;
    const r2 = execute(s, { type: 'resupply', deploymentId: d.id });
    expect(r2.ok).toBe(false);
    expect(r2.message).toMatch(/stockpile .* is empty/);
  });

  it('is restocked at each later phase start, up to its cap', () => {
    const s = campaign('officer');
    const r = s.tactical!.forecast[0];
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
    s.tactical!.stockpile!.nasams = 0;
    let guard = 0;
    execute(s, { type: 'beginPhase' });
    while (s.status === 'running' && guard++ < 500) execute(s, { type: 'advance', hours: 1 });
    execute(s, { type: 'beginPhase' }); // phase 2
    expect(stockpileOf(s, 'nasams')).toBe(nasams.magazine * STOCKPILES.officer!.restock);
    s.tactical!.stockpile!.nasams = 999;
    while (s.status === 'running' && guard++ < 1000) execute(s, { type: 'advance', hours: 1 });
    execute(s, { type: 'beginPhase' }); // phase 3
    expect(stockpileOf(s, 'nasams')).toBe(nasams.magazine * STOCKPILES.officer!.cap);
  });
});
