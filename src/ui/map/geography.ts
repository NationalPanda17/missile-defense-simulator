// World map geometry: region outlines (lon/lat), projection and helpers.
import type { RegionId } from '../../engine';
import { REGION_RINGS } from './regions.generated';

type Ring = [number, number][];

/** Region outlines from Natural Earth country borders (see scripts/build-geography.ts). Shared borders are identical. */
export const REGION_SHAPES: Record<RegionId, Ring[]> = REGION_RINGS;

export const MAP_W = 1000;
export const MAP_H = 472;

export function project(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * MAP_W, ((85 - lat) / 170) * MAP_H];
}

export function ringPath(ring: Ring) {
  return ring.map(([lo, la], i) => {
    const [x, y] = project(lo, la);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('') + 'Z';
}

export function regionBounds(id: RegionId): { x: number; y: number; w: number; h: number } {
  // Use the primary (first) ring for framing, except polar which frames the Arctic.
  const ring = REGION_SHAPES[id][0];
  const pts = ring.map(([lo, la]) => project(lo, la));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Background land masses not part of a primary region (context only). */
/** Every country now belongs to a region, so there is no separate context land. */
export const CONTEXT_LAND: Ring[] = [];
