// A running count while waves fly over a region: in flight, stopped, got through. Updates every frame on its own.
import { type RegionId, type SimState } from '../../../engine';
import { useSimTime } from '../../../store/simStore';
import { trackPhase, waveVisible } from '../../threatTimeline';

export function LiveTally({ s, region }: { s: SimState; region: RegionId }) {
  const t = useSimTime();
  const waves = (s.tactical?.waves ?? []).filter((w) => w.region === region && waveVisible(w, t));
  if (!waves.length) return null;
  let flying = 0, stopped = 0, through = 0;
  for (const w of waves) for (const tr of w.tracks) {
    if (tr.decoy) continue;
    const ph = trackPhase(w, tr, t);
    if (ph.kind === 'flight') flying++;
    else if (ph.kind === 'intercepted' || (ph.kind === 'gone' && (tr.outcome === 'stopped'))) stopped++;
    else if (ph.kind === 'impact' || (ph.kind === 'gone' && tr.outcome === 'leaked')) through++;
  }
  return (
    <span className="flex items-center gap-2 rounded border border-ops-line bg-black/30 px-2 py-0.5 font-sans text-[14px] font-semibold tabular-nums" role="status" aria-live="off" aria-label={`${flying} in flight, ${stopped} stopped, ${through} got through`}>
      <span className="text-ops-amber">▸ {flying} <span className="text-[10px] font-normal uppercase tracking-wider">in flight</span></span>
      <span className="text-ops-green">✓ {stopped} <span className="text-[10px] font-normal uppercase tracking-wider">stopped</span></span>
      <span className="text-ops-red">✕ {through} <span className="text-[10px] font-normal uppercase tracking-wider">through</span></span>
    </span>
  );
}
