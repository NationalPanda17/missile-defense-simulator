// Live threats on the theater map: launch point, icons moving along their paths, interceptions and impacts.
// Re-renders every animation frame on its own, so the rest of the map doesn't.
import { TACTICAL_CONFIG, pointAlong, trackPath, type RegionId, type SimState, type ThreatClass, type ThreatWave } from '../../../engine';
import { useSimTime } from '../../../store/simStore';
import { LINGER, trackPhase, waveVisible } from '../../threatTimeline';

const { width: W, height: H } = TACTICAL_CONFIG.theaterKm;

export const THREAT_COLOR: Record<ThreatClass, string> = {
  slowDrone: '#f5b13d', fastDrone: '#fb923c', cruise: '#f2545b', rocket: '#e879f9', ballistic: '#ff4d6d',
};

/** A threat glyph pointing along +x (rotate to heading). */
export function ThreatGlyph({ cls, color, decoy }: { cls: ThreatClass; color: string; decoy?: boolean }) {
  const op = decoy ? 0.45 : 1;
  switch (cls) {
    case 'slowDrone': return <path d="M5,0 L-4,-4 L-2,0 L-4,4 Z" fill={color} opacity={op} stroke="#06111f" strokeWidth={0.8} />;
    case 'fastDrone': return <path d="M6,0 L-4,-3.5 L-2,0 L-4,3.5 Z M-1,-5 L1,-5 L0,-1 Z M-1,5 L1,5 L0,1 Z" fill={color} opacity={op} stroke="#06111f" strokeWidth={0.8} />;
    case 'cruise': return <g opacity={op}><rect x={-6} y={-1.4} width={11} height={2.8} rx={1.4} fill={color} stroke="#06111f" strokeWidth={0.7} /><path d="M-1,-1.4 L-3,-4 M-1,1.4 L-3,4" stroke={color} strokeWidth={1.2} /></g>;
    case 'rocket': return <g opacity={op}><path d="M6,0 L-5,-1.6 L-5,1.6 Z" fill={color} stroke="#06111f" strokeWidth={0.6} /><path d="M-5,0 L-9,0" stroke="#fde68a" strokeWidth={1.5} /></g>;
    case 'ballistic': return <g opacity={op}><circle r={3.2} fill={color} stroke="#fff" strokeWidth={0.8} /><circle r={6} fill="none" stroke={color} strokeOpacity={0.6} /></g>;
  }
}

/** How far along a bent path (0-1) its turn point is. */
function pointFraction(path: [number, number][]): number {
  if (path.length < 3) return 1;
  const a = Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]);
  const b = Math.hypot(path[2][0] - path[1][0], path[2][1] - path[1][1]);
  return a / (a + b || 1);
}

const EDGE_LAUNCH: Record<ThreatWave['axis'], [number, number]> = { north: [W / 2, 6], south: [W / 2, H - 6], west: [6, H / 2], east: [W - 6, H / 2] };

export function LiveThreats({ s, region, only, at }: { s: SimState; region: RegionId; only?: string | null; at?: number }) {
  const live = useSimTime();
  const t = at ?? live; // `at` replays a past moment (after-action review)
  const tac = s.tactical;
  if (!tac) return null;
  const sites = new Map(tac.sites.map((x) => [x.id, x]));
  const waves = tac.waves.filter((w) => w.region === region && (only ? w.id === only : waveVisible(w, t)));
  return (
    <g pointerEvents="none">
      {waves.map((w) => {
        const launched = t >= (w.launchAt ?? w.atHour);
        const inFlight = t < w.atHour;
        const [lx, ly] = EDGE_LAUNCH[w.axis];
        return (
          <g key={w.id}>
            {launched && inFlight && (
              <g transform={`translate(${lx},${ly})`}>
                <circle r={9} fill="none" stroke="#f2545b" strokeWidth={1.5} className="pulse-ring" />
                <circle r={4} fill="#f2545b" />
              </g>
            )}
            {w.tracks.map((tr) => {
              const site = sites.get(tr.siteId);
              if (!site) return null;
              const ph = trackPhase(w, tr, t);
              const path = trackPath(tr, [site.x, site.y]);
              const at = (f: number): [number, number] => pointAlong(path, f).p;
              const col = tr.decoy ? '#7d93b1' : THREAT_COLOR[tr.cls];
              if (ph.kind === 'flight') {
                const here = pointAlong(path, Math.min(1, ph.f));
                const [x, y] = here.p;
                // Trail: a few points back along the path, so it bends round the turn.
                const trail = [0.18, 0.12, 0.06, 0].map((b) => at(Math.max(0, ph.f - b)).join(',')).join(' ');
                const ahead = [here.p, ...(tr.via && ph.f < pointFraction(path) ? [tr.via] : []), [site.x, site.y] as [number, number]].map((p) => p.join(',')).join(' ');
                return (
                  <g key={tr.id}>
                    <polyline points={trail} fill="none" stroke={col} strokeOpacity={0.45} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points={ahead} fill="none" stroke={col} strokeOpacity={0.12} strokeDasharray="2 4" />
                    <g transform={`translate(${x},${y}) rotate(${here.heading})`}><ThreatGlyph cls={tr.cls} color={col} decoy={tr.decoy} /></g>
                  </g>
                );
              }
              if (ph.kind === 'intercepted') {
                const [x, y] = at(ph.f);
                const k = ph.age / LINGER.intercepted;
                return (
                  <g key={tr.id} transform={`translate(${x},${y})`} opacity={1 - k}>
                    <circle r={4 + k * 10} fill="none" stroke={tr.decoy ? '#7d93b1' : '#34d399'} strokeWidth={1.6} />
                    <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke={tr.decoy ? '#7d93b1' : '#34d399'} strokeWidth={2} />
                  </g>
                );
              }
              if (ph.kind === 'impact') {
                const k = ph.age / LINGER.impact;
                return (
                  <g key={tr.id} transform={`translate(${site.x},${site.y})`} opacity={1 - k * 0.85}>
                    <circle r={7 + Math.min(1, ph.age) * 9} fill="#f2545b" fillOpacity={0.25 * (1 - k)} stroke="#f2545b" strokeWidth={1.4} />
                    <path d="M0,-6 L1.6,-1.6 L6,0 L1.6,1.6 L0,6 L-1.6,1.6 L-6,0 L-1.6,-1.6 Z" fill="#fde68a" opacity={Math.max(0, 1 - ph.age)} />
                  </g>
                );
              }
              return null;
            })}
          </g>
        );
      })}
    </g>
  );
}
