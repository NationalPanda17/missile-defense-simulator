// Theater topography: land and sea, a shallow coastal band, mountain massifs as contour bands, roads between sites,
// plus map furniture (distance ticks, scale bar, north arrow, region name). Purely visual: the engine's rules use the
// massif circles and sea polygon from engine/terrain.ts, and these shapes stay within those circles.
import type { Site, TheaterTerrain } from '../../../engine';

/** Deterministic pseudo-noise from a number, 0-1. */
const hash01 = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** An irregular closed outline around a massif at `scale` of its radius (never beyond the rules' circle). */
function contour(m: { x: number; y: number; r: number }, scale: number): string {
  const seed = m.x * 7.13 + m.y * 3.71;
  const pts: string[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wobble = 0.82 + 0.12 * Math.sin(3 * a + hash01(seed) * 6) + 0.06 * Math.sin(5 * a + hash01(seed + 1) * 6);
    const r = m.r * scale * Math.min(0.98, wobble);
    pts.push(`${(m.x + Math.cos(a) * r).toFixed(1)},${(m.y + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Fictional peak height (m) for a massif, from its size. */
export const peakHeight = (r: number, x: number) => Math.round((r * 55 + hash01(x) * 400) / 10) * 10;

const BANDS = ['#34482d', '#526037', '#776c42', '#9a8456', '#c9b07c'];

/** Minimum spanning tree over the sites: a plausible road network that links every site without clutter. */
function roads(sites: Site[]): [Site, Site][] {
  if (sites.length < 2) return [];
  const inTree = new Set([sites[0].id]);
  const out: [Site, Site][] = [];
  while (inTree.size < sites.length) {
    let best: [Site, Site] | null = null;
    let bestD = Infinity;
    for (const a of sites) {
      if (!inTree.has(a.id)) continue;
      for (const b of sites) {
        if (inTree.has(b.id)) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < bestD) { bestD = d; best = [a, b]; }
      }
    }
    if (!best) break;
    inTree.add(best[1].id);
    out.push(best);
  }
  return out;
}

export function TerrainLayer({ terrain, sites, w, h }: { terrain: TheaterTerrain | undefined; sites: Site[]; w: number; h: number }) {
  if (!terrain) return null;
  // Sea gets deeper (darker) away from the coast.
  const deep = { north: ['0', '1', '0', '0'], south: ['0', '0', '0', '1'], west: ['1', '0', '0', '0'], east: ['0', '0', '1', '0'] }[terrain.coast];
  const sea = terrain.sea.map((p) => p.join(',')).join(' ');
  const coast = terrain.coastline.map((p) => p.join(',')).join(' ');
  return (
    <g pointerEvents="none">
      <defs>
        <linearGradient id="sea-depth" x1={deep[0]} y1={deep[1]} x2={deep[2]} y2={deep[3]}>
          <stop offset="0%" stopColor="#06182c" />
          <stop offset="100%" stopColor="#0d3256" />
        </linearGradient>
        <radialGradient id="land-tone" cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#14211a" />
          <stop offset="100%" stopColor="#0d1712" />
        </radialGradient>
        <radialGradient id="hill-shade" cx="32%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#fff6dc" stopOpacity={0.35} />
          <stop offset="55%" stopColor="#fff6dc" stopOpacity={0} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.35} />
        </radialGradient>
        <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx={2} dy={3} stdDeviation={3} floodColor="#000" floodOpacity={0.5} /></filter>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill="url(#land-tone)" />
      <polygon points={sea} fill="url(#sea-depth)" />
      {/* shallow water and surf */}
      <polyline points={coast} fill="none" stroke="#2f7fb8" strokeOpacity={0.25} strokeWidth={14} strokeLinejoin="round" />
      <polyline points={coast} fill="none" stroke="#5fb3e6" strokeOpacity={0.35} strokeWidth={5} strokeLinejoin="round" />
      <polyline points={coast} fill="none" stroke="#9fd8ff" strokeOpacity={0.8} strokeWidth={1.3} strokeLinejoin="round" />

      {/* roads */}
      {roads(sites).map(([a, b]) => (
        <g key={`${a.id}-${b.id}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#070d0a" strokeWidth={4} strokeLinecap="round" />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a39d7f" strokeOpacity={0.75} strokeWidth={1.6} strokeLinecap="round" />
        </g>
      ))}

      {/* mountains: hypsometric contour bands and peak (heights are labelled by the collision-free label layout) */}
      {terrain.massifs.map((m, i) => (
        <g key={i} filter="url(#soft-shadow)">
          {[1, 0.8, 0.6, 0.42, 0.25].map((sc, k) => (
            <path key={k} d={contour(m, sc)} fill={BANDS[k]} stroke="#f0dcab" strokeOpacity={0.22 + k * 0.06} strokeWidth={0.8} />
          ))}
          {/* hillshade: light from the north-west, shadow to the south-east */}
          <path d={contour(m, 1)} fill="url(#hill-shade)" />
          <path d={`M${m.x - 6},${m.y + 4} L${m.x},${m.y - 6} L${m.x + 6},${m.y + 4} Z`} fill="#e2d2a8" stroke="#3a3022" strokeWidth={0.8} />
        </g>
      ))}
    </g>
  );
}

/** Grid, edge distance ticks, scale bar, north arrow and the region name. */
export function MapFurniture({ w, h, title }: { w: number; h: number; title: string }) {
  const label = { fontSize: 8.5, fill: '#7d93b1', style: { paintOrder: 'stroke' as const }, stroke: '#06111f', strokeWidth: 2.5 };
  return (
    <g pointerEvents="none">
      {Array.from({ length: w / 50 + 1 }, (_, i) => <line key={`v${i}`} x1={i * 50} x2={i * 50} y1={0} y2={h} stroke="#9fb4cf" strokeOpacity={i % 2 ? 0.05 : 0.09} />)}
      {Array.from({ length: h / 50 + 1 }, (_, i) => <line key={`h${i}`} y1={i * 50} y2={i * 50} x1={0} x2={w} stroke="#9fb4cf" strokeOpacity={i % 2 ? 0.05 : 0.09} />)}
      {Array.from({ length: w / 100 - 1 }, (_, i) => <text key={`tx${i}`} x={(i + 1) * 100} y={10} textAnchor="middle" {...label}>{(i + 1) * 100}</text>)}
      {Array.from({ length: h / 100 - 1 }, (_, i) => <text key={`ty${i}`} x={4} y={(i + 1) * 100 + 3} {...label}>{(i + 1) * 100}</text>)}
      {/* scale bar */}
      <g transform={`translate(${w - 118},${h - 14})`}>
        <rect x={-4} y={-11} width={114} height={18} rx={3} fill="#06111f" fillOpacity={0.7} />
        <rect x={0} y={0} width={50} height={3} fill="#c9d8ec" />
        <rect x={50} y={0} width={50} height={3} fill="#7088a8" />
        <text x={0} y={-3} {...label}>0</text>
        <text x={50} y={-3} textAnchor="middle" {...label}>50</text>
        <text x={100} y={-3} textAnchor="end" {...label}>100 km</text>
      </g>
      {/* north arrow */}
      <g transform={`translate(${w - 18},${30})`}>
        <circle r={11} fill="#06111f" fillOpacity={0.7} stroke="#2a3d5c" />
        <path d="M0,-8 L4,3 L0,0.5 L-4,3 Z" fill="#c9d8ec" />
        <text y={9.5} textAnchor="middle" fontSize={7} fill="#c9d8ec">N</text>
      </g>
      <text x={8} y={h - 8} fontSize={12} fontWeight={700} letterSpacing={2} fill="#c9d8ec" fillOpacity={0.55} style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>
        {title.toUpperCase()} THEATER
      </text>
    </g>
  );
}
