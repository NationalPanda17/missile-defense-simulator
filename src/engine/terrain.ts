// Theater terrain: each region gets a coastline (sea area), mountain massifs and clustered cities, so placement is a
// different puzzle in every region. Terrain is generated from the tactical RNG, so a seed always gives the same maps.
//
// Effects (see resolveTrack in tactical.ts):
// - Low-flying threats (drones, cruise missiles) are only visible to a surface radar inside its radar horizon, and a
//   massif between the radar and the threat hides it. A system on a massif sees further.
// - Airborne early-warning aircraft are not horizon-limited and can cue surface systems beyond their own horizon.
// - Ships must be placed at sea; everything else on land.
import { TACTICAL_CONFIG } from './config';
import { rand } from './rng';
import type { RegionId, TheaterTerrain } from './types';

type Rng = { rng: number };
type Pt = [number, number];
type Side = 'north' | 'south' | 'east' | 'west';

interface TerrainProfile {
  coast: Side; // the side the sea is on
  depth: number; // share of the theater that is sea, measured from that side
  massifs: number;
  band: { axis: 'x' | 'y'; at: number }; // massifs line up along this band (share of width or height)
  clusters: number; // city clusters
  character: string; // one-line description for the UI
}

/** Each region plays differently. Positions are shares of the theater so profiles survive a size change. */
export const TERRAIN_PROFILES: Record<RegionId, TerrainProfile> = {
  NAM: { coast: 'west', depth: 0.16, massifs: 3, band: { axis: 'x', at: 0.36 }, clusters: 2, character: 'Western coast backed by a mountain spine; two metro areas inland.' },
  SAM: { coast: 'east', depth: 0.2, massifs: 4, band: { axis: 'x', at: 0.2 }, clusters: 1, character: 'High ridge along the west, one dense coastal metro in the east.' },
  EUR: { coast: 'north', depth: 0.22, massifs: 2, band: { axis: 'y', at: 0.78 }, clusters: 3, character: 'Northern coastline, southern highlands, many close-set cities.' },
  AFR: { coast: 'west', depth: 0.14, massifs: 2, band: { axis: 'y', at: 0.45 }, clusters: 1, character: 'Open plains and long distances; sites are spread thin.' },
  MDE: { coast: 'south', depth: 0.2, massifs: 4, band: { axis: 'y', at: 0.35 }, clusters: 2, character: 'Southern gulf coast with a mountain wall to the north.' },
  IPA: { coast: 'east', depth: 0.42, massifs: 2, band: { axis: 'x', at: 0.3 }, clusters: 2, character: 'Mostly ocean: a narrow coastal strip with volcanic peaks.' },
  POL: { coast: 'north', depth: 0.45, massifs: 1, band: { axis: 'y', at: 0.8 }, clusters: 1, character: 'Ice-bound sea to the north and a few remote outposts.' },
};

const W = () => TACTICAL_CONFIG.theaterKm.width;
const H = () => TACTICAL_CONFIG.theaterKm.height;

/** Generate a region's terrain. */
export function generateTerrain(r: Rng, region: RegionId): TheaterTerrain {
  const p = TERRAIN_PROFILES[region];
  const w = W();
  const h = H();
  const vertical = p.coast === 'west' || p.coast === 'east';
  const span = vertical ? h : w; // the coast runs along this axis
  const across = vertical ? w : h;
  const phase = rand(r) * Math.PI * 2;
  const amp = across * (0.03 + rand(r) * 0.04);
  const coastline: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const along = (i / 24) * span;
    const wobble = amp * Math.sin(phase + (along / span) * Math.PI * 3) + amp * 0.4 * Math.sin(phase * 2 + (along / span) * Math.PI * 7);
    const off = Math.max(8, p.depth * across + wobble);
    const at = p.coast === 'west' || p.coast === 'north' ? off : across - off;
    coastline.push(vertical ? [Math.round(at), Math.round(along)] : [Math.round(along), Math.round(at)]);
  }
  const corners: Record<Side, Pt[]> = {
    west: [[0, h], [0, 0]],
    east: [[w, h], [w, 0]],
    north: [[w, 0], [0, 0]],
    south: [[w, h], [0, h]],
  };
  // Sea polygon: the coastline, then back along the theater edge.
  const sea: Pt[] = [...coastline, ...corners[p.coast]];

  const t: TheaterTerrain = { coast: p.coast, coastline, sea, massifs: [] };
  for (let i = 0, tries = 0; i < p.massifs && tries < 200; tries++) {
    const radius = Math.round(22 + rand(r) * 22);
    const centre = p.band.at * (p.band.axis === 'x' ? w : h) + (rand(r) - 0.5) * 120;
    const along = 40 + rand(r) * ((p.band.axis === 'x' ? h : w) - 80);
    const m: Pt = p.band.axis === 'x' ? [Math.round(centre), Math.round(along)] : [Math.round(along), Math.round(centre)];
    if (!insideTheaterPt(m) || isSea(t, m) || t.massifs.some((o) => Math.hypot(o.x - m[0], o.y - m[1]) < o.r + radius + 15)) continue;
    t.massifs.push({ x: m[0], y: m[1], r: radius });
    i++;
  }
  return t;
}

const insideTheaterPt = ([x, y]: Pt) => x >= 0 && x <= W() && y >= 0 && y <= H();

/** Is the point at sea? (Ray casting against the sea polygon.) */
export function isSea(t: TheaterTerrain | undefined, [x, y]: Pt): boolean {
  if (!t) return false;
  let inside = false;
  const poly = t.sea;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (km) from a point to the coastline. */
export function coastDistance(t: TheaterTerrain, [x, y]: Pt): number {
  let best = Infinity;
  for (let i = 1; i < t.coastline.length; i++) {
    const [ax, ay] = t.coastline[i - 1];
    const [bx, by] = t.coastline[i];
    const dx = bx - ax;
    const dy = by - ay;
    const k = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + k * dx), y - (ay + k * dy)));
  }
  return best;
}

export function onMassif(t: TheaterTerrain | undefined, [x, y]: Pt): boolean {
  return !!t?.massifs.some((m) => Math.hypot(m.x - x, m.y - y) <= m.r);
}

/** True if the straight line a→b passes over a massif that neither end sits on (low-altitude line of sight). */
export function masked(t: TheaterTerrain | undefined, a: Pt, b: Pt): boolean {
  if (!t) return false;
  for (const m of t.massifs) {
    if (Math.hypot(m.x - a[0], m.y - a[1]) <= m.r || Math.hypot(m.x - b[0], m.y - b[1]) <= m.r) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const k = Math.max(0, Math.min(1, ((m.x - a[0]) * dx + (m.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(m.x - (a[0] + k * dx), m.y - (a[1] + k * dy)) < m.r * 0.8) return true;
  }
  return false;
}

/** Radar horizon (km) against low-flying threats for a surface system at this point. */
export function lowHorizonKm(t: TheaterTerrain | undefined, at: Pt): number {
  return TACTICAL_CONFIG.lowAltitude.horizonKm * (onMassif(t, at) ? TACTICAL_CONFIG.lowAltitude.massifHorizonMult : 1);
}

/** A random land point (or null), at least `margin` km from the edges, off massifs and `inland` km from the coast. */
export function randomLand(r: Rng, t: TheaterTerrain, margin: number, inland: number, near?: { at: Pt; within: number }): Pt | null {
  for (let i = 0; i < 80; i++) {
    let p: Pt;
    if (near) {
      const ang = rand(r) * Math.PI * 2;
      const d = rand(r) * near.within;
      p = [Math.round(near.at[0] + Math.cos(ang) * d), Math.round(near.at[1] + Math.sin(ang) * d)];
    } else {
      p = [Math.round(margin + rand(r) * (W() - 2 * margin)), Math.round(margin + rand(r) * (H() - 2 * margin))];
    }
    if (p[0] < margin || p[0] > W() - margin || p[1] < margin || p[1] > H() - margin) continue;
    if (isSea(t, p) || onMassif(t, p) || coastDistance(t, p) < inland) continue;
    return p;
  }
  return null;
}

/** A land point close to the coast, for ports. */
export function randomCoastal(r: Rng, t: TheaterTerrain, margin: number): Pt | null {
  for (let i = 0; i < 120; i++) {
    const c = t.coastline[1 + Math.floor(rand(r) * (t.coastline.length - 2))];
    const p: Pt = [Math.round(c[0] + (rand(r) - 0.5) * 30), Math.round(c[1] + (rand(r) - 0.5) * 30)];
    if (p[0] < margin || p[0] > W() - margin || p[1] < margin || p[1] > H() - margin) continue;
    if (!isSea(t, p) && !onMassif(t, p) && coastDistance(t, p) <= 14) return p;
  }
  return null;
}
