// What happened to every threat in a wave, and why: shared by the after-action review and Mission Replay.
import { EQUIPMENT_MAP, THREAT_LABELS, type SimState, type ThreatWave } from '../../engine';

export function WaveBreakdown({ s, wave }: { s: SimState; wave: ThreatWave }) {
  const t = s.tactical!;
  const sites = new Map(t.sites.map((x) => [x.id, x]));
  const deps = new Map(t.deployments.map((d) => [d.id, d]));
  const sys = (id: string) => EQUIPMENT_MAP.get(deps.get(id)?.equipmentId ?? '')?.name ?? 'a system since withdrawn';
  const real = wave.tracks.filter((x) => !x.decoy);
  const decoys = wave.tracks.filter((x) => x.decoy);
  if (!wave.resolved) return <p className="text-[11px] text-ops-dim">Not launched yet.</p>;
  if (real.length && real.every((x) => x.fired === undefined && x.leak === undefined)) {
    return <p className="text-[11px] text-ops-dim">Details were not recorded for this wave (it was played before breakdowns existed).</p>;
  }

  // Systems in the region that never fired at this wave, with their most common reason.
  const idle = new Map<string, Map<string, number>>();
  const firedAny = new Set(wave.tracks.flatMap((x) => (x.fired ?? []).map((f) => f.dep)));
  for (const tr of wave.tracks) {
    for (const w of tr.why ?? []) {
      if (firedAny.has(w.dep)) continue;
      const m = idle.get(w.dep) ?? new Map<string, number>();
      m.set(w.reason, (m.get(w.reason) ?? 0) + 1);
      idle.set(w.dep, m);
    }
  }
  return (
    <div className="space-y-2 text-[11px]">
      <div className="overflow-x-auto">
        <table className="table-ops w-full">
          <thead><tr><th>Threat</th><th>Target</th><th>Seen</th><th>Engaged by</th><th>Result</th></tr></thead>
          <tbody>
            {real.map((tr) => (
              <tr key={tr.id}>
                <td className="whitespace-nowrap text-white">{THREAT_LABELS[tr.cls]}{tr.via ? ' ↪' : ''}</td>
                <td className="whitespace-nowrap">{sites.get(tr.siteId)?.name ?? '—'}</td>
                <td className={tr.detected ? 'text-ops-green' : 'text-ops-amber'}>{tr.detected === undefined ? '—' : tr.detected ? 'yes' : 'no'}</td>
                <td>{tr.fired?.length ? tr.fired.map((f) => `${sys(f.dep)} ×${f.shots}`).join(', ') : <span className="text-ops-dim">nobody</span>}</td>
                <td className={tr.outcome === 'stopped' ? 'text-ops-green' : 'text-ops-red'}>
                  {tr.outcome === 'stopped' ? `stopped by ${sys(tr.stoppedBy ?? '')}` : <>got through{tr.damage ? ` (−${tr.damage})` : ''}{tr.leak && <div className="text-[10px] leading-snug text-ops-dim">{tr.leak}</div>}</>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {decoys.length > 0 && (
        <p className="text-ops-dim">
          {decoys.length} decoy{decoys.length === 1 ? '' : 's'} came with it; {decoys.filter((x) => x.shots > 0).length} drew fire
          ({decoys.reduce((a, x) => a + x.shots, 0)} rounds).
        </p>
      )}
      {idle.size > 0 && (
        <div>
          <div className="label mb-0.5">Systems that did not fire</div>
          <ul className="space-y-0.5 text-ops-dim">
            {[...idle].map(([dep, reasons]) => {
              const top = [...reasons].sort((a, b) => b[1] - a[1])[0][0];
              return <li key={dep}><span className="text-white">{sys(dep)}</span>: {top}.</li>;
            })}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-ops-dim">↪ changed direction mid-flight. “Seen” means a sensor (or airborne radar) tracked it; unseen threats are engaged late and less accurately.</p>
    </div>
  );
}
