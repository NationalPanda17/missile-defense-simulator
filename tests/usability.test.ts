import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MAP, confidenceLabel, createInitialState, defaultSettings, equipmentCost, execute, lessonSettings, placementError, spawnEvent, urgentList,
  type RegionId, type SimState,
} from '../src/engine';

function spot(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 0; r <= 300; r += 4) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}

describe('undoing a placement', () => {
  it('returns every credit in the briefing it was made in, and only half afterwards', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    const before = { credits: s.credits, personnel: s.personnel };
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spot(s, 'nasams', 'EUR', site.x, site.y) });
    expect(s.credits).toBeLessThan(before.credits);
    expect(execute(s, { type: 'withdraw', deploymentId: s.tactical!.deployments[0].id }).ok).toBe(true);
    expect(s.credits).toBe(before.credits);
    expect(s.personnel).toBe(before.personnel);
    expect(s.tactical!.deployments.length).toBe(0);
    // Once the phase is running it is a withdrawal: half back.
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...spot(s, 'nasams', 'EUR', site.x, site.y) });
    const paid = s.credits;
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'withdraw', deploymentId: s.tactical!.deployments[0].id });
    expect(s.credits - paid).toBe(Math.floor(equipmentCost(EQUIPMENT_MAP.get('nasams')!) * 0.5));
  });
});

describe('automatic resupply', () => {
  const run = (auto: boolean) => {
    const s = createInitialState(lessonSettings('drill-swarm', defaultSettings('training')));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) {
      execute(s, { type: 'deploy', equipmentId: 'coyote', region: 'EUR', ...spot(s, 'coyote', 'EUR', site.x, site.y) });
    }
    if (auto) expect(execute(s, { type: 'setAutoResupply', region: 'EUR', on: true }).ok).toBe(true);
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 32 });
    return s;
  };
  it('reorders rounds by itself in the regions where it is on, and keeps a reserve', () => {
    const off = run(false);
    const on = run(true);
    expect(off.commands.some((c) => c.kind === 'resupply')).toBe(false);
    expect(on.commands.filter((c) => c.kind === 'resupply').length).toBeGreaterThan(0);
    expect(on.tactical!.stats.stopped).toBeGreaterThan(off.tactical!.stats.stopped);
    expect(on.credits).toBeGreaterThanOrEqual(0);
    expect(execute(on, { type: 'setAutoResupply', region: 'EUR', on: false }).ok).toBe(false); // scenario is over
    expect(on.tactical!.autoResupply).toEqual(['EUR']);
  });
});

describe('what needs the player', () => {
  it('is empty in a briefing, and lists a report about to escalate once running', () => {
    const s = createInitialState(defaultSettings('campaign', { seed: 4 }));
    expect(urgentList(s)).toEqual([]);
    execute(s, { type: 'beginPhase' });
    const e = spawnEvent(s, 'sensor_drift', { region: 'EUR', scripted: true })!;
    e.deadline = s.hour + 3;
    const list = urgentList(s);
    expect(list.some((u) => u.kind === 'report' && u.eventId === e.id)).toBe(true);
    execute(s, { type: 'dismiss', eventId: e.id });
    expect(urgentList(s).some((u) => u.eventId === e.id)).toBe(false);
  });
});

describe('confidence labels', () => {
  it('call a high number VERY LIKELY and keep CONFIRMED for a confirmation that came back', () => {
    expect(confidenceLabel(95).label).toBe('VERY LIKELY');
    expect(confidenceLabel(60, true).label).toBe('CONFIRMED');
    expect(confidenceLabel(20).label).toBe('UNVERIFIED');
    const s = createInitialState(defaultSettings('training', { seed: 7 }));
    execute(s, { type: 'beginPhase' });
    const e = spawnEvent(s, 'sensor_drift', { region: 'EUR', scripted: true })!;
    execute(s, { type: 'confirm', eventId: e.id });
    execute(s, { type: 'advance', hours: 12 });
    expect(e.confirmed).toBe(true);
  });
});
