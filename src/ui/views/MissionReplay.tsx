// After-action mission replay: scrub through the run on a region's theater map, with every wave and decision marked.
import { useEffect, useMemo, useState } from 'react';
import { REGION_IDS, type CommandEntry, type RegionId, type SimState, type ThreatWave } from '../../engine';
import { Panel } from '../components/ui';
import { trackPhase } from '../threatTimeline';
import { TheaterMap } from './theater/TheaterMap';
import { WaveBreakdown } from './WaveBreakdown';

const CAT_COLOR: Record<CommandEntry['category'], string> = {
  response: '#38d6f5', maintenance: '#34d399', investment: '#a78bfa', redeploy: '#f5b13d', confirmation: '#7dd3fc', control: '#7088a8',
};
const CAT_LABEL: Record<CommandEntry['category'], string> = {
  response: 'Response / alert', maintenance: 'Maintenance / resupply', investment: 'Investment / deployment', redeploy: 'Redeploy / move', confirmation: 'Confirmation', control: 'Control',
};
const SPEEDS = [1, 4, 12] as const; // sim hours per second of playback

const launchOf = (w: ThreatWave) => w.launchAt ?? w.atHour;

/** What happened to a wave by time t, in a few words. */
function waveStatus(w: ThreatWave, t: number): string {
  if (t < launchOf(w)) return `launches in ${(launchOf(w) - t).toFixed(1)}h`;
  const real = w.tracks.filter((x) => !x.decoy);
  let flying = 0;
  let stopped = 0;
  let hit = 0;
  for (const tr of real) {
    const ph = trackPhase(w, tr, t);
    if (ph.kind === 'flight') flying++;
    else if (ph.kind === 'intercepted' || (ph.kind === 'gone' && tr.outcome === 'stopped')) stopped++;
    else if (ph.kind === 'impact' || (ph.kind === 'gone' && tr.outcome === 'leaked')) hit++;
  }
  return `${flying} in flight · ${stopped} stopped · ${hit} hit`;
}

export function MissionReplay({ s }: { s: SimState }) {
  const tac = s.tactical!;
  const waves = tac.waves.filter((w) => w.resolved);
  const regions = REGION_IDS.filter((r) => waves.some((w) => w.region === r));
  const [region, setRegion] = useState<RegionId>(regions[0]);
  const regionWaves = useMemo(() => waves.filter((w) => w.region === region).sort((a, b) => launchOf(a) - launchOf(b)), [waves, region]);
  const end = Math.max(1, s.hour);
  const [t, setT] = useState(() => Math.max(0, launchOf(regionWaves[0] ?? waves[0]) - 0.5));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const decisions = s.commands.filter((c) => c.category !== 'control');

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setT((x) => {
      const n = x + speed * 0.05;
      if (n >= end) { setPlaying(false); return end; }
      return n;
    }), 50);
    return () => window.clearInterval(id);
  }, [playing, speed, end]);

  const jump = (dir: 1 | -1) => {
    const list = regionWaves.map((w) => launchOf(w) - 0.5);
    const target = dir > 0 ? list.find((x) => x > t + 0.01) : [...list].reverse().find((x) => x < t - 0.01);
    if (target !== undefined) setT(Math.max(0, target));
  };
  const selectRegion = (r: RegionId) => {
    setRegion(r);
    const first = waves.filter((w) => w.region === r).sort((a, b) => launchOf(a) - launchOf(b))[0];
    if (first) setT(Math.max(0, launchOf(first) - 0.5));
  };

  // Timeline geometry: 1000 units wide.
  const X = (h: number) => (h / end) * 1000;
  const recent = decisions.filter((c) => c.t <= t && c.t > t - 6).slice(-4).reverse();
  const live = regionWaves.filter((w) => t >= launchOf(w) - 2 && t <= w.atHour + 3);
  // The wave to explain: the one in the air, or else the most recent one before this moment.
  const focusWave = live[0] ?? [...regionWaves].reverse().find((w) => launchOf(w) <= t) ?? null;

  if (!regions.length) return null;
  return (
    <Panel className="xl:col-span-3" title="Mission Replay">
      <div className="space-y-2">
        <p className="text-[11px] text-ops-dim">
          Scrub through the run. The map shows each wave in flight and every interception and hit, with the systems that were deployed by
          then. Marks under the timeline are your decisions; click one to jump to it. Sites show their condition at the end of the run.
        </p>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Replay region">
          {regions.map((r) => (
            <button key={r} role="tab" aria-selected={r === region} className={`btn ${r === region ? 'btn-active' : ''}`} onClick={() => selectRegion(r)}>
              {s.regions[r].short} <span className="text-ops-dim">{waves.filter((w) => w.region === r).length}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0">
            <TheaterMap s={s} region={region} selectedId={null} onPick={() => {}} replayAt={t} />
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="label">At T+{t.toFixed(1)}h</div>
            {live.length ? live.map((w) => (
              <div key={w.id} className="rounded border border-ops-red/40 p-2">
                <div className="text-white">{w.id} · from the {w.axis}{w.forecast ? '' : ' · surprise'}</div>
                <div className="text-ops-dim">{waveStatus(w, t)}</div>
              </div>
            )) : <div className="text-ops-dim">No wave over {s.regions[region].name} right now.</div>}
            <div className="label pt-1">Your recent decisions</div>
            {recent.length ? (
              <ul className="space-y-1">
                {recent.map((c, i) => (
                  <li key={i} className="flex gap-2"><span className="shrink-0 tabular-nums text-ops-dim">T+{c.t}h</span><span style={{ color: CAT_COLOR[c.category] }}>■</span><span className="min-w-0">{c.text}</span></li>
                ))}
              </ul>
            ) : <div className="text-ops-dim">None in the 6 hours before this moment.</div>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary w-20" onClick={() => { if (t >= end) setT(0); setPlaying(!playing); }}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button className="btn" onClick={() => jump(-1)} title="Previous wave in this region">◂ Wave</button>
          <button className="btn" onClick={() => jump(1)} title="Next wave in this region">Wave ▸</button>
          <span className="flex gap-1" role="group" aria-label="Playback speed">
            {SPEEDS.map((v) => <button key={v} className={`btn px-2 ${speed === v ? 'btn-active' : ''}`} onClick={() => setSpeed(v)}>{v}h/s</button>)}
          </span>
          <span className="ml-auto tabular-nums text-ops-dim">T+{t.toFixed(1)}h / {end}h</span>
        </div>
        <input type="range" className="w-full accent-[#38d6f5]" min={0} max={end} step={0.05} value={t} aria-label="Replay time (hours)"
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
        <svg viewBox="0 0 1000 46" preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label="Timeline of waves and decisions">
          <line x1={0} y1={14} x2={1000} y2={14} stroke="#1b2c47" strokeWidth={10} />
          {waves.map((w) => (
            <rect key={w.id} x={X(launchOf(w))} y={w.region === region ? 9 : 12} width={Math.max(3, X(w.atHour) - X(launchOf(w)))} height={w.region === region ? 10 : 4}
              fill={w.region === region ? '#f2545b' : '#7088a8'} opacity={w.region === region ? 0.9 : 0.5} className="cursor-pointer" onClick={() => setT(launchOf(w))}>
              <title>{`${w.id} · ${s.regions[w.region].name} · launch T+${launchOf(w)}h, impact T+${w.atHour}h`}</title>
            </rect>
          ))}
          {decisions.map((c, i) => (
            <rect key={i} x={X(c.t) - 1.5} y={26} width={3} height={14} fill={CAT_COLOR[c.category]} className="cursor-pointer" onClick={() => setT(c.t)}>
              <title>{`T+${c.t}h · ${c.text}`}</title>
            </rect>
          ))}
          <line x1={X(t)} y1={0} x2={X(t)} y2={46} stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {focusWave && (
          <details className="rounded border border-ops-line px-2 py-1" open>
            <summary className="cursor-pointer text-[11px]"><span className="label">Breakdown</span> <span className="text-white">wave at T+{focusWave.atHour}h, {s.regions[focusWave.region].name}</span></summary>
            <div className="pt-1"><WaveBreakdown s={s} wave={focusWave} /></div>
          </details>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ops-dim">
          <span><span className="text-ops-red">■</span> waves in {s.regions[region].name}</span>
          <span><span style={{ color: '#7088a8' }}>■</span> waves elsewhere</span>
          {(Object.keys(CAT_LABEL) as CommandEntry['category'][]).filter((k) => k !== 'control' && decisions.some((c) => c.category === k)).map((k) => (
            <span key={k}><span style={{ color: CAT_COLOR[k] }}>■</span> {CAT_LABEL[k]}</span>
          ))}
        </div>
      </div>
    </Panel>
  );
}
