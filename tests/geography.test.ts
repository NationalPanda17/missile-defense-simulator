import { describe, expect, it } from 'vitest';
import { REGION_IDS } from '../src/engine';
import { REGION_SHAPES } from '../src/ui/map/geography';

/** Even-odd point-in-polygon over all rings of a region. */
function inRegion(rings: [number, number][][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

describe('world map region outlines', () => {
  it('never overlap: no point on the globe lies inside two regions', () => {
    const doubled: string[] = [];
    for (let lat = -84.5; lat < 85; lat += 1) {
      for (let lon = -179.5; lon < 180; lon += 1) {
        const hits = REGION_IDS.filter((r) => inRegion(REGION_SHAPES[r], lon, lat));
        if (hits.length > 1) doubled.push(`${lon},${lat}: ${hits.join('+')}`);
      }
    }
    expect(doubled.slice(0, 5)).toEqual([]);
  });

  it('have no edges that jump across the map (date-line artefacts)', () => {
    for (const r of REGION_IDS) {
      for (const ring of REGION_SHAPES[r]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          // Antarctica's southern edge along the bottom of the map is the only allowed long edge.
          if (Math.abs(a[0] - b[0]) > 60) expect(r === 'POL' && a[1] < -84).toBe(true);
        }
      }
    }
  });

  it('put each region centre on its own region', () => {
    const centres: Record<string, [number, number]> = { NAM: [-100, 45], SAM: [-60, -15], EUR: [15, 52], AFR: [20, 5], MDE: [48, 28], IPA: [108, 24], POL: [-40, 75] };
    for (const r of REGION_IDS) expect(inRegion(REGION_SHAPES[r], centres[r][0], centres[r][1]), r).toBe(true);
  });
});
