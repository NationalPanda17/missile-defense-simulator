import { describe, expect, it } from 'vitest';
import { advise, adjutantApplies, createInitialState, defaultSettings, execute, isSea, lessonSettings, onMassif, EQUIPMENT_MAP } from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x = 300, y = 200) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 400; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}

describe('adjutant', () => {
  it('flags forecast regions with no defenses, and stops once they are armed', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 21 }));
    const forecast = s.tactical!.forecast;
    expect(forecast.length).toBeGreaterThan(0);
    const undefended = advise(s).filter((a) => a.id.startsWith('undefended:'));
    expect(undefended.map((a) => a.level)).toEqual(forecast.map(() => 'urgent'));
    expect(undefended[0].text).toContain(s.regions[forecast[0]].name);
    expect(undefended[0].action?.deploy).toBe(true);
    for (const r of forecast) execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
    expect(advise(s).filter((a) => a.id.startsWith('undefended:'))).toEqual([]);
  });

  it('warns about low magazines where a wave is expected', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 21 }));
    const r = s.tactical!.forecast[0];
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
    const d = s.tactical!.deployments[0];
    d.stock = 2;
    const a = advise(s).find((x) => x.id.startsWith('ammo:'))!;
    expect(a.text).toBe(`${s.regions[r].name}’s ${EQUIPMENT_MAP.get('nasams')!.name} is down to 2 rounds and a wave is expected. Resupply it.`);
    d.stock = 18;
    expect(advise(s).some((x) => x.id.startsWith('ammo:'))).toBe(false);
  });

  it('counts overdue assets and points at the right domain', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 21 }));
    for (const a of s.assets.filter((x) => x.domain === 'air').slice(0, 3)) a.hoursToService = -5;
    const a = advise(s).find((x) => x.id.startsWith('overdue:'))!;
    expect(a.text).toMatch(/^3 assets are overdue for service/);
    expect(a.level).toBe('warn');
    expect(a.action?.view).toBe('air');
  });

  it('flags reports about to escalate with nothing ordered', () => {
    const s = createInitialState(lessonSettings('events', defaultSettings('training')));
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 2 });
    const e = s.events.find((x) => x.status === 'reported')!;
    e.deadline = s.hour + 3;
    expect(advise(s).find((x) => x.id === `deadline:${e.id}`)?.text).toMatch(/escalates in 3h and nothing has been ordered/);
  });

  it('never gives away a surprise wave before its warning', () => {
    const s = createInitialState(lessonSettings('tactical2', defaultSettings('training')));
    for (const r of ['EUR', 'MDE'] as RegionId[]) execute(s, { type: 'deploy', equipmentId: 'nasams', region: r, ...landNear(s, r) });
    execute(s, { type: 'beginPhase' });
    expect(advise(s).some((a) => a.text.includes('Africa'))).toBe(false);
    // Once the Africa wave is inside its warning window, the adjutant says so.
    const w = s.tactical!.waves.find((x) => x.region === 'AFR')!;
    execute(s, { type: 'advance', hours: Math.floor(w.launchAt! - 2) });
    expect(advise(s).some((a) => a.id.startsWith('undefended:AFR') && /outside the forecast/.test(a.text))).toBe(true);
  });

  it('is off in training lessons (the coach teaches instead)', () => {
    expect(adjutantApplies(createInitialState(lessonSettings('basics', defaultSettings('training'))))).toBe(false);
    expect(adjutantApplies(createInitialState(defaultSettings('campaign')))).toBe(true);
  });
});
