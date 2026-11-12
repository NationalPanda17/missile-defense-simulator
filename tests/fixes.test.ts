import { describe, expect, it } from 'vitest';
import { EQUIPMENT_MAP, canEngageClass, createInitialState, defaultSettings, execute, isSea, lessonSettings, onMassif, suggestFixes } from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x: number, y: number) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 300; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}

describe('debrief: what would have helped', () => {
  it('suggests a system that can engage what got through, placed by the site hit hardest, with a real gain', () => {
    // High arc drill with only a gun system: ballistic missiles and rockets get through.
    const s = createInitialState(lessonSettings('drill-higharc', defaultSettings('training')));
    const site = s.tactical!.sites.find((x) => x.region === 'MDE')!;
    execute(s, { type: 'deploy', equipmentId: 'skynex', region: 'MDE', ...landNear(s, 'MDE', site.x, site.y) });
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 40 });
    const before = JSON.stringify(s);
    const fixes = suggestFixes(s);
    expect(JSON.stringify(s)).toBe(before); // pure
    expect(fixes.length).toBe(1);
    const f = fixes[0];
    expect(f.region).toBe('MDE');
    expect(f.stoppedMore).toBeGreaterThanOrEqual(1);
    expect(canEngageClass(EQUIPMENT_MAP.get(f.equipmentId)!, f.mainClass)).toBe(true);
    expect(f.text).toMatch(/threats got through in Middle East, mostly .*would have stopped about \d+ more/);
  });

  it('stays quiet when almost nothing got through', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    for (const site of s.tactical!.sites.filter((x) => x.region === 'EUR')) {
      execute(s, { type: 'deploy', equipmentId: 'skynex', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
      execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', site.x, site.y) });
    }
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 12 });
    const leaked = s.tactical!.waves[0].tracks.filter((x) => !x.decoy && x.outcome === 'leaked').length;
    if (leaked < 2) expect(suggestFixes(s)).toEqual([]);
  });
});
