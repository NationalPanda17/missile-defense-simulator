// Builds the world map's region outlines from Natural Earth country borders (public domain, via the world-atlas
// package), so regions are accurate and neighbouring regions share exactly the same border line (no overlaps).
//
//   npx tsx scripts/build-geography.ts
//
// Writes src/ui/map/regions.generated.ts. Countries are assigned to the game's seven regions below; simplification
// runs on the shared topology, so both sides of a border are simplified identically.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { merge } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import type { GeometryCollection, Topology } from 'topojson-specification';

const require = createRequire(import.meta.url);
const world = require('world-atlas/countries-110m.json') as Topology<{ countries: GeometryCollection<{ name: string }> }>;

type RegionId = 'NAM' | 'SAM' | 'EUR' | 'AFR' | 'MDE' | 'IPA' | 'POL';

const REGION_OF: Record<Exclude<RegionId, 'IPA'>, string[]> = {
  NAM: ['Canada', 'United States of America', 'Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama',
    'Cuba', 'Jamaica', 'Haiti', 'Dominican Rep.', 'Bahamas', 'Puerto Rico'],
  SAM: ['Colombia', 'Venezuela', 'Guyana', 'Suriname', 'Ecuador', 'Peru', 'Brazil', 'Bolivia', 'Paraguay', 'Chile', 'Argentina', 'Uruguay',
    'Falkland Is.', 'Trinidad and Tobago'],
  EUR: ['Russia', 'Belarus', 'Ukraine', 'Moldova', 'Iceland', 'Ireland', 'United Kingdom', 'Norway', 'Sweden', 'Finland', 'Denmark', 'Estonia',
    'Latvia', 'Lithuania', 'Poland', 'Germany', 'Netherlands', 'Belgium', 'Luxembourg', 'France', 'Spain', 'Portugal', 'Switzerland', 'Austria',
    'Italy', 'Slovenia', 'Croatia', 'Bosnia and Herz.', 'Serbia', 'Montenegro', 'Kosovo', 'Albania', 'Macedonia', 'Greece', 'Bulgaria',
    'Romania', 'Hungary', 'Slovakia', 'Czechia'],
  MDE: ['Turkey', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Iraq', 'Iran', 'Saudi Arabia', 'Yemen', 'Oman', 'United Arab Emirates',
    'Qatar', 'Kuwait', 'Cyprus', 'N. Cyprus', 'Georgia', 'Armenia', 'Azerbaijan', 'Afghanistan', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan',
    'Kyrgyzstan', 'Tajikistan', 'Egypt'],
  AFR: ['Algeria', 'Angola', 'Benin', 'Botswana', 'Burkina Faso', 'Burundi', 'Cameroon', 'Central African Rep.', 'Chad', 'Congo', "Côte d'Ivoire",
    'Dem. Rep. Congo', 'Djibouti', 'Eq. Guinea', 'Eritrea', 'Ethiopia', 'Gabon', 'Gambia', 'Ghana', 'Guinea', 'Guinea-Bissau', 'Kenya', 'Lesotho',
    'Liberia', 'Libya', 'Madagascar', 'Malawi', 'Mali', 'Mauritania', 'Morocco', 'Mozambique', 'Namibia', 'Niger', 'Nigeria', 'Rwanda', 'S. Sudan',
    'Senegal', 'Sierra Leone', 'Somalia', 'Somaliland', 'South Africa', 'Sudan', 'Tanzania', 'Togo', 'Tunisia', 'Uganda', 'W. Sahara', 'Zambia',
    'Zimbabwe', 'eSwatini'],
  POL: ['Greenland', 'Antarctica', 'Fr. S. Antarctic Lands'],
};

const regionOf = (name: string): RegionId => {
  for (const [r, names] of Object.entries(REGION_OF)) if (names.includes(name)) return r as RegionId;
  return 'IPA'; // South, East and Southeast Asia and Oceania
};

// Simplify the shared arcs once (so both sides of every border stay identical), then dissolve countries by region.
// Casts: the topojson typings disagree on property types; the data shape is known.
const topo = simplify(presimplify(world as never) as never, 0.08) as unknown as typeof world;
const geoms = topo.objects.countries.geometries;
const round = (v: number) => Math.round(v * 10) / 10;

/** Clip a ring to the half-plane x <= edge (keep = 'le') or x >= edge ('ge') — Sutherland–Hodgman. */
function clipX(ring: number[][], edge: number, keep: 'le' | 'ge'): number[][] {
  const inside = (p: number[]) => (keep === 'le' ? p[0] <= edge : p[0] >= edge);
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (edge - a[0]) / (b[0] - a[0]);
      out.push([edge, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/**
 * Rings that cross the ±180° meridian (Russia's far east, Fiji) come with edges that jump across the whole map,
 * which would draw lines across the world. Unwrap the longitudes, then cut the ring at the meridian into one piece
 * on each side. A ring that wraps all the way round the globe (Antarctica) is left alone: its long edge is its
 * southern boundary along the bottom of the map.
 */
function splitAntimeridian(ring: number[][]): number[][][] {
  if (!ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180)) return [ring];
  const un: number[][] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    let x = ring[i][0];
    const prev = un[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    un.push([x, ring[i][1]]);
  }
  const drift = un[un.length - 1][0] - un[0][0];
  if (Math.abs(drift) > 180) return [ring]; // wraps the globe
  const max = Math.max(...un.map((p) => p[0]));
  const min = Math.min(...un.map((p) => p[0]));
  const pieces: number[][][] = [];
  if (max > 180) {
    pieces.push(clipX(un, 180, 'le'));
    pieces.push(clipX(un, 180, 'ge').map(([x, y]) => [x - 360, y]));
  } else if (min < -180) {
    pieces.push(clipX(un, -180, 'ge'));
    pieces.push(clipX(un, -180, 'le').map(([x, y]) => [x + 360, y]));
  } else pieces.push(un);
  return pieces.filter((p) => p.length >= 3);
}

/** Signed area (deg²) of a ring, to drop specks. */
const area = (ring: number[][]) => Math.abs(ring.reduce((a, p, i) => { const q = ring[(i + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

const out: Record<string, number[][][]> = {};
for (const r of ['NAM', 'SAM', 'EUR', 'AFR', 'MDE', 'IPA', 'POL'] as RegionId[]) {
  const mp = merge(topo as never, geoms.filter((g) => regionOf((g.properties as { name: string }).name) === r) as never);
  const rings: number[][][] = [];
  for (const poly of mp.coordinates) {
    for (const piece of splitAntimeridian(poly[0].slice(0, -1))) { // drop the closing point; ringPath closes it
      const outer = piece.map(([x, y]) => [round(x), round(Math.max(-85, Math.min(85, y)))]);
      const dedup = outer.filter((p, i) => i === 0 || p[0] !== outer[i - 1][0] || p[1] !== outer[i - 1][1]);
      if (dedup.length >= 3 && area(dedup) >= 0.6) rings.push(dedup);
    }
  }
  out[r] = rings;
  console.log(r, `${rings.length} rings, ${rings.reduce((a, x) => a + x.length, 0)} points`);
}

const body = `// GENERATED by scripts/build-geography.ts from Natural Earth (public domain) via world-atlas. Do not edit by hand.
// Region outlines in lon/lat. Neighbouring regions share identical border points.
import type { RegionId } from '../../engine';

export const REGION_RINGS: Record<RegionId, [number, number][][]> = ${JSON.stringify(out)};
`;
writeFileSync(new URL('../src/ui/map/regions.generated.ts', import.meta.url), body);
console.log('wrote src/ui/map/regions.generated.ts', `${(body.length / 1024).toFixed(0)} KB`);
