import { describe, expect, it } from 'vitest';
import { createInitialState, defaultSettings, REGION_IDS } from '../src/engine';
import { fanOut, layoutLabels, overlaps, type Box, type LabelRequest } from '../src/ui/views/theater/labels';

const W = 600;
const H = 400;
const box = (x: number, y: number, r: number): Box => ({ x: x - r, y: y - r, w: r * 2, h: r * 2 });

/** Small deterministic RNG for repeatable scenes. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertClean(placed: ReturnType<typeof layoutLabels>, obstacles: Box[]) {
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i].box;
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(W);
    expect(a.y + a.h).toBeLessThanOrEqual(H);
    for (const o of obstacles) expect(overlaps(a, o, 0), `${placed[i].text} over an icon`).toBe(false);
    for (let j = i + 1; j < placed.length; j++) expect(overlaps(a, placed[j].box, 0), `${placed[i].text} / ${placed[j].text}`).toBe(false);
  }
}

describe('theater map labels', () => {
  it('never overlaps another label, an icon or the edge, in crowded random scenes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const n = 6 + Math.floor(r() * 18);
      const pts = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: 20 + r() * (W - 40), y: 20 + r() * (H - 40) }));
      const obstacles = pts.map((p) => box(p.x, p.y, 12));
      const reqs: LabelRequest[] = pts.map((p, i) => ({
        id: p.id, text: ['Velmar Command Post', 'Kartova', 'Savston Power Station', 'NASAMS', 'IRIS-T SLM', '1,840 m'][i % 6],
        x: p.x, y: p.y, fontSize: 11, priority: r() * 100, iconRadius: 12,
      }));
      assertClean(layoutLabels(reqs, obstacles, { w: W, h: H }), obstacles);
    }
  });

  it('places the higher-priority label when two compete for the same space', () => {
    const reqs: LabelRequest[] = [
      { id: 'low', text: 'Low priority name', x: 300, y: 200, fontSize: 11, priority: 1, iconRadius: 10 },
      { id: 'high', text: 'High priority name', x: 302, y: 201, fontSize: 11, priority: 9, iconRadius: 10 },
    ];
    const placed = layoutLabels(reqs, [], { w: W, h: H });
    expect(placed[0].id).toBe('high');
    expect(placed.map((p) => p.id)).toContain('high');
  });

  it('labels nearly every site in real theaters, with no overlaps', () => {
    let total = 0;
    let labelled = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = createInitialState(defaultSettings('campaign', { seed }));
      for (const region of REGION_IDS) {
        const sites = s.tactical!.sites.filter((x) => x.region === region);
        const massifs = s.tactical!.terrain![region].massifs;
        const obstacles = [...sites.map((x) => box(x.x, x.y, 13)), ...massifs.map((m) => box(m.x, m.y, 7))];
        const reqs: LabelRequest[] = [
          ...sites.map((x) => ({ id: x.id, text: x.name, x: x.x, y: x.y, fontSize: 12, priority: 100 + x.importance, iconRadius: 12 })),
          ...massifs.map((m, i) => ({ id: `peak${i}`, text: '1,840 m', x: m.x, y: m.y, fontSize: 9, priority: 5, iconRadius: 7 })),
        ];
        const placed = layoutLabels(reqs, obstacles, { w: W, h: H });
        assertClean(placed, obstacles);
        total += sites.length;
        labelled += placed.filter((p) => !p.id.startsWith('peak')).length;
      }
    }
    expect(labelled / total).toBeGreaterThan(0.95);
  });

  it('fans out stacked markers so they no longer overlap', () => {
    const pts = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 101, y: 100 }, { id: 'c', x: 100, y: 102 }, { id: 'd', x: 400, y: 300 }];
    const out = fanOut(pts, 24, 27);
    expect(out.get('d')).toEqual({ x: 400, y: 300, moved: false });
    const moved = ['a', 'b', 'c'].map((id) => out.get(id)!);
    expect(moved.every((p) => p.moved)).toBe(true);
    for (let i = 0; i < moved.length; i++) for (let j = i + 1; j < moved.length; j++) {
      expect(Math.hypot(moved[i].x - moved[j].x, moved[i].y - moved[j].y)).toBeGreaterThanOrEqual(23.9);
    }
    // ...and clear of the middle, where a site marker may sit.
    for (const p of moved) expect(Math.hypot(p.x - 100.33, p.y - 100.67)).toBeGreaterThanOrEqual(26.9);
  });
});
