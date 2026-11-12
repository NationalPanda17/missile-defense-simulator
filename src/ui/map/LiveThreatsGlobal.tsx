// Live threat waves on the world map: a launch point beyond the target region, icons flying in, then interception or
// impact markers. Re-renders every animation frame on its own, so the rest of the map doesn't.
import type { SimState, ThreatWave } from '../../engine';
import { useSimTime } from '../../store/simStore';
import { LINGER, trackPhase, waveVisible } from '../threatTimeline';
import { THREAT_COLOR, ThreatGlyph } from '../views/theater/LiveThreats';
import { project } from './geography';

/** Launch point (lon/lat offset) beyond the region, in the direction the wave comes from. */
const OFFSET: Record<ThreatWave['axis'], [number, number]> = { north: [0, 20], south: [0, -20], west: [-28, 0], east: [28, 0] };

export function LiveThreatsGlobal({ s, k }: { s: SimState; k: number }) {
  const t = useSimTime();
  const tac = s.tactical;
  if (!tac?.enabled) return null;
  const sc = Math.max(0.35, Math.min(1, k * 1.15));
  return (
    <g pointerEvents="none">
      {tac.waves.filter((w) => waveVisible(w, t)).map((w) => {
        const c = s.regions[w.region].center;
        const o = OFFSET[w.axis];
        const [lx, ly] = project(Math.max(-178, Math.min(178, c[0] + o[0])), Math.max(-80, Math.min(80, c[1] + o[1])));
        const [cx, cy] = project(c[0], c[1]);
        const dx = cx - lx;
        const dy = cy - ly;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len; // perpendicular, to fan the tracks out side by side
        const ny = dx / len;
        const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
        const real = w.tracks.filter((x) => !x.decoy);
        const leaked = real.filter((x) => x.outcome === 'leaked').length;
        const inFlight = t < w.atHour;
        return (
          <g key={w.id}>
            {inFlight && (
              <g transform={`translate(${lx},${ly}) scale(${sc})`}>
                <circle r={8} fill="none" stroke="#f2545b" strokeWidth={1.2} className="pulse-ring" />
                <circle r={3} fill="#f2545b" />
                <title>{`${w.id}: launch toward ${s.regions[w.region].name}`}</title>
              </g>
            )}
            {inFlight && <line x1={lx} y1={ly} x2={cx} y2={cy} stroke="#f2545b" strokeOpacity={0.25} strokeWidth={0.8 * sc} strokeDasharray="3 4" />}
            {w.tracks.map((tr, i) => {
              const ph = trackPhase(w, tr, t);
              const lane = ((i % 7) - 3) * 2.2; // spread tracks across a corridor
              const at = (f: number): [number, number] => [lx + dx * f + nx * lane * (1 - f * 0.7), ly + dy * f + ny * lane * (1 - f * 0.7)];
              const col = tr.decoy ? '#7d93b1' : THREAT_COLOR[tr.cls];
              if (ph.kind === 'flight') {
                const [x, y] = at(Math.min(1, ph.f));
                return <g key={tr.id} transform={`translate(${x},${y}) rotate(${heading}) scale(${sc * 0.85})`}><ThreatGlyph cls={tr.cls} color={col} decoy={tr.decoy} /></g>;
              }
              if (ph.kind === 'intercepted') {
                const [x, y] = at(ph.f);
                const q = ph.age / LINGER.intercepted;
                return <circle key={tr.id} cx={x} cy={y} r={(2 + q * 5) * sc} fill="none" stroke="#34d399" strokeWidth={1 * sc} opacity={1 - q} />;
              }
              return null;
            })}
            {!inFlight && t < w.atHour + LINGER.impact && (
              <g transform={`translate(${cx},${cy}) scale(${sc})`} opacity={1 - (t - w.atHour) / LINGER.impact}>
                {leaked > 0 ? (
                  <>
                    <circle r={6 + Math.min(1, t - w.atHour) * 8} fill="#f2545b" fillOpacity={0.2} stroke="#f2545b" strokeWidth={1.2} />
                    <path d="M0,-5 L1.4,-1.4 L5,0 L1.4,1.4 L0,5 L-1.4,1.4 L-5,0 L-1.4,-1.4 Z" fill="#fde68a" />
                  </>
                ) : (
                  <circle r={9} fill="none" stroke="#34d399" strokeWidth={1.6} />
                )}
                <title>{`${w.id}: ${real.length - leaked}/${real.length} stopped`}</title>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
