// Tactical Theater: watch threat waves play out, track magazines and resupply during a phase.
import { useEffect, useRef, useState } from 'react';
import { WaveActions } from '../PausePrompt';
import { useUI } from '../uiState';
import {
  EQUIPMENT_MAP, LAYER_LABELS, REGION_IDS, TACTICAL_CONFIG, alertActive, alertCost, alertHoursLeft, incomingWaves, isEffector,
  isUnlimited, redeployCost, redeployHours,
  regionProtection, resupplyCost, type Deployment, type ProtectionLevel, type RegionId, type SimState, type ThreatWave, type Track,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { Bar, Chip, Panel, Stat, TONE_TEXT } from '../components/ui';
import { CLASS_SHORT, LAYER_COLOR, MapLegend, TheaterMap } from './TacticalDeploy';

export const PROTECTION_TONE: Record<ProtectionLevel, 'green' | 'amber' | 'red'> = { protected: 'green', thin: 'amber', exposed: 'red' };
const REPLAY_MS = 5000;

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Where along its path (0-1) a track ends: where it was stopped, or 1 at its target. */
function endFraction(s: SimState, tr: Track, target: [number, number]): number {
  if (!tr.stoppedBy) return 1;
  const d = s.tactical!.deployments.find((x) => x.id === tr.stoppedBy);
  const spec = d && EQUIPMENT_MAP.get(d.equipmentId);
  if (!d || !spec) return 0.8;
  // First point where the path enters the stopping system's range, nudged inward a little.
  const [ax, ay] = tr.from;
  const dx = target[0] - ax;
  const dy = target[1] - ay;
  const fx = ax - d.x;
  const fy = ay - d.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - spec.rangeKm * spec.rangeKm;
  const disc = B * B - 4 * A * C;
  if (A === 0 || disc < 0) return 0.8;
  const t1 = Math.max(0, (-B - Math.sqrt(disc)) / (2 * A));
  return Math.min(0.97, t1 + 0.12 * (1 - t1));
}

/** Animated replay of one wave: tracks fly in, then burst green where stopped or red where they hit. */
function WaveReplay({ s, wave }: { s: SimState; wave: ThreatWave }) {
  const [p, setP] = useState(reducedMotion() ? 1 : 0);
  useEffect(() => {
    if (reducedMotion()) { setP(1); return; }
    setP(0);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const v = Math.min(1, (now - start) / REPLAY_MS);
      setP(v);
      if (v < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [wave.id]);

  const sites = new Map(s.tactical!.sites.map((x) => [x.id, x]));
  return (
    <g pointerEvents="none">
      {wave.tracks.map((tr, i) => {
        const site = sites.get(tr.siteId);
        if (!site) return null;
        const target: [number, number] = [site.x, site.y];
        const end = endFraction(s, tr, target);
        const delay = (i / Math.max(1, wave.tracks.length)) * 0.35; // stagger launches
        const local = Math.max(0, Math.min(1, (p - delay) / (1 - delay - 0.1)));
        const f = local * end;
        const x = tr.from[0] + (target[0] - tr.from[0]) * f;
        const y = tr.from[1] + (target[1] - tr.from[1]) * f;
        const done = local >= 1;
        const hit = tr.outcome === 'leaked';
        const col = tr.decoy ? '#7088a8' : hit ? '#f2545b' : '#f5b13d';
        return (
          <g key={tr.id}>
            <line x1={tr.from[0]} y1={tr.from[1]} x2={x} y2={y} stroke={col} strokeOpacity={0.35} strokeDasharray={tr.decoy ? '2 4' : undefined} />
            {!done && <circle cx={x} cy={y} r={3.5} fill={col} />}
            {done && (tr.outcome === 'stopped' || tr.outcome === 'decoyStopped') && (
              <g transform={`translate(${x},${y})`}><circle r={7} fill="none" stroke="#34d399" strokeWidth={2} /><path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke="#34d399" strokeWidth={2} /></g>
            )}
            {done && hit && <circle cx={x} cy={y} r={10} fill="#f2545b" fillOpacity={0.35} stroke="#f2545b" />}
          </g>
        );
      })}
    </g>
  );
}

function DeploymentRow({ s, d, moving, onRedeploy }: { s: SimState; d: Deployment; moving: boolean; onRedeploy: () => void }) {
  const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
  const asset = s.assets.find((a) => a.id === d.assetId);
  const cost = resupplyCost(d);
  const unlimited = isUnlimited(spec);
  return (
    <li className={`rounded border p-2 ${moving ? 'border-ops-cyan bg-ops-cyan/5' : 'border-ops-line'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-sans text-[13px] font-semibold text-white">
          <span className="mr-1 inline-block h-2 w-2 rotate-45" style={{ background: LAYER_COLOR[spec.layer] }} />{asset?.name ?? spec.name}
        </span>
        <span className="shrink-0 text-[10px] uppercase text-ops-dim">{asset?.status ?? '—'}</span>
      </div>
      <div className="mt-1 grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-ops-dim">
        <span>Condition</span><Bar value={asset?.condition ?? 0} showValue />
        {isEffector(spec) && !unlimited && (<><span>Rounds</span><Bar value={d.stock} max={spec.magazine} showValue /></>)}
      </div>
      {isEffector(spec) && !unlimited && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
          <span className="text-ops-dim">{d.reloadRemaining !== undefined ? `Resupplying, ${d.reloadRemaining}h left` : `${d.stock}/${spec.magazine} rounds`}</span>
          <button data-coach="resupply" className="btn px-2 py-0.5" disabled={d.reloadRemaining !== undefined || d.stock >= spec.magazine || s.credits < cost}
            onClick={() => dispatch({ type: 'resupply', deploymentId: d.id })}>
            Resupply{cost ? ` (${cost} cr)` : ''}
          </button>
        </div>
      )}
      {!isEffector(spec) && <div className="mt-1 text-[10px] text-ops-dim">{LAYER_LABELS[spec.layer]} · detects to {spec.rangeKm} km</div>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]">
        <span className={d.transit ? 'text-ops-amber' : 'text-ops-dim'}>
          {d.transit ? `En route to ${s.regions[d.transit.region].short}, ${d.transit.remaining}h` : 'In position'}
        </span>
        <button data-coach="emergency" className={`btn px-2 py-0.5 ${moving ? 'btn-active' : ''}`} disabled={!!d.transit || s.status !== 'running' || asset?.status === 'maintenance'}
          title="Move during the phase: out of action while it travels" onClick={onRedeploy}>
          {moving ? 'Choose position…' : 'Redeploy'}
        </button>
      </div>
    </li>
  );
}

export function TheaterView({ s }: { s: SimState }) {
  const ui = useUI();
  const t = s.tactical;
  const inbound = incomingWaves(s);
  const lastResolved = t ? [...t.waves].filter((w) => w.resolved).sort((a, b) => b.atHour - a.atHour)[0] : undefined;
  const [region, setRegion] = useState<RegionId>(inbound[0]?.wave.region ?? lastResolved?.region ?? t?.forecast[0] ?? 'NAM');
  // Another screen (the adjutant) can ask for a region.
  useEffect(() => {
    if (ui.theaterFocus) {
      setRegion(ui.theaterFocus);
      ui.setTheaterFocus(null);
    }
  }, [ui.theaterFocus]);
  const [replayId, setReplayId] = useState<string | null>(lastResolved?.id ?? null); // wave shown in the summary
  const [playing, setPlaying] = useState<string | null>(null); // wave being replayed on demand
  const [selected, setSelected] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const movingDep = t?.deployments.find((d) => d.id === moving) ?? null;
  const movingSpec = movingDep ? EQUIPMENT_MAP.get(movingDep.equipmentId)! : null;
  useEffect(() => {
    if (!moving) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoving(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [moving]);

  // Jump to each new wave as it lands, and replay it.
  const seen = useRef(lastResolved?.id);
  useEffect(() => {
    if (lastResolved && lastResolved.id !== seen.current) {
      seen.current = lastResolved.id;
      // A new wave has launched: follow it live (no replay needed).
      setRegion(lastResolved.region);
      setReplayId(lastResolved.id);
      setPlaying(null);
    }
  }, [lastResolved?.id]);

  if (!t?.enabled) {
    return <Panel title="Tactical Theater"><p className="text-ops-dim">The tactical layer is not active in this scenario. It runs in campaigns.</p></Panel>;
  }

  const prot = regionProtection(s, region);
  const regionWaves = t.waves.filter((w) => w.region === region && w.resolved).sort((a, b) => b.atHour - a.atHour);
  const replay = t.waves.find((w) => w.id === replayId && w.region === region) ?? null;
  const deps = t.deployments.filter((d) => d.region === region);
  const st = t.stats;
  const real = replay?.tracks.filter((x) => !x.decoy) ?? [];

  return (
    <div className="space-y-2">
      {/* Always the same height, so the controls below don't jump when a warning appears or clears. */}
      <div className="flex min-h-[30px] flex-wrap items-center gap-1.5" role="status" aria-live="polite">
        {inbound.length === 0 && <span className="text-[11px] text-ops-dim">No waves inbound.</span>}
        {inbound.length > 0 && (<>
          {inbound.map(({ wave, eta, launched, launchIn }) => (
            <button key={wave.id} className="chip blink border-ops-red/60 bg-ops-red/15 px-3 py-1 text-[11px] text-ops-red" onClick={() => setRegion(wave.region)}>
              {launched
                ? `⚠ In flight: ${s.regions[wave.region].name} from the ${wave.axis}, impact ${eta <= 0 ? 'now' : `~${eta}h`}`
                : `⚠ Launch expected: ${s.regions[wave.region].name} from the ${wave.axis}, ${launchIn <= 0 ? 'now' : `~${launchIn}h`}`}
            </button>
          ))}
        </>)}
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Region">
        {REGION_IDS.map((r) => {
          const lvl = regionProtection(s, r).level;
          return (
            <button key={r} role="tab" aria-selected={r === region} className={`btn ${r === region ? 'btn-active' : ''}`} onClick={() => { setRegion(r); setSelected(null); }}>
              <span className={TONE_TEXT[PROTECTION_TONE[lvl]]} aria-label={lvl}>◆</span>{s.regions[r].short}
            </button>
          );
        })}
      </div>

      {/* The map gets the full width; side panels sit beside it only on very wide screens. */}
      <div className="grid gap-2 2xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Panel title={`Theater · ${s.regions[region].name}`} right={<Chip t={PROTECTION_TONE[prot.level]}>{prot.level} · {Math.round(prot.coverage * 100)}% covered</Chip>}>
          {inbound.some((x) => x.wave.region === region) && (
            <div className="mb-2 rounded border border-ops-red/40 bg-ops-red/5 p-2 text-[11px]">
              <div className="label text-ops-red">Wave inbound · what you can do now</div>
              <WaveActions s={s} region={region} compact />
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            {alertActive(s, region) ? (
              <Chip t="amber">⚠ Alert in force · {alertHoursLeft(s, region)}h left</Chip>
            ) : (
              <button data-coach="alert" className="btn" disabled={s.status !== 'running' || !deps.length || s.credits < alertCost(s, region)}
                title={`Better detection and ${Math.round((1 - TACTICAL_CONFIG.alert.reactionMult) * 100)}% faster reactions for ${TACTICAL_CONFIG.alert.hours}h; equipment wears faster`}
                onClick={() => dispatch({ type: 'raiseAlert', region })}>
                Raise alert ({alertCost(s, region)} cr, {TACTICAL_CONFIG.alert.hours}h)
              </button>
            )}
            {movingSpec && movingDep && (
              <span className="text-ops-cyan">
                Click the map (any region tab) to redeploy {s.assets.find((a) => a.id === movingDep.assetId)?.name}:{' '}
                {redeployCost(movingDep.region, region)} cr, out of action {redeployHours(movingSpec, movingDep.region, region)}h.{' '}
                <button className="underline" onClick={() => setMoving(null)}>Cancel</button>
              </span>
            )}
          </div>
          <TheaterMap s={s} region={region} selectedId={selected ?? moving} ghost={movingSpec}
            onPoint={movingDep ? (x, y) => { if (dispatch({ type: 'emergencyRedeploy', deploymentId: movingDep.id, region, x, y }).ok) setMoving(null); } : undefined}
            onPick={(d) => setSelected(d.id === selected ? null : d.id)}>
            {playing && replay && replay.id === playing && <WaveReplay key={`${replay.id}-${playing}`} s={s} wave={replay} />}
          </TheaterMap>
          <div className="mt-1.5"><MapLegend region={region} /></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            {replay && replay.applied === false ? (
              <>
                <span className="text-white">{replay.id}, from the {replay.axis}</span>
                <span className="blink text-ops-red">in flight · impact {replay.atHour - s.hour <= 0 ? 'now' : `in ~${replay.atHour - s.hour}h`}</span>
                <span className="text-ops-dim">{threatMix(real)}</span>
              </>
            ) : replay ? (
              <>
                <span className="text-white">{replay.id}, T+{replay.atHour}h, from the {replay.axis}</span>
                <span className="text-ops-green">{real.filter((x) => x.outcome === 'stopped').length} stopped</span>
                <span className="text-ops-red">{real.filter((x) => x.outcome === 'leaked').length} got through</span>
                {replay.tracks.some((x) => x.decoy) && <span className="text-ops-dim">{replay.tracks.filter((x) => x.decoy).length} false tracks</span>}
                <span className="text-ops-dim">{threatMix(real)}</span>
                <button className="btn px-2 py-0.5" onClick={() => { setPlaying(null); requestAnimationFrame(() => setPlaying(replay.id)); }}>Replay</button>
              </>
            ) : (
              <span className="text-ops-dim">No waves have reached {s.regions[region].name} yet this campaign.</span>
            )}
          </div>
          {regionWaves.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {regionWaves.map((w) => {
                const r = w.tracks.filter((x) => !x.decoy);
                const leaked = r.filter((x) => x.outcome === 'leaked').length;
                if (w.applied === false) return <span key={w.id} className="chip border-ops-red/50 text-ops-red">T+{w.atHour}h in flight</span>;
                return (
                  <button key={w.id} className={`btn px-2 py-0.5 ${w.id === replayId ? 'btn-active' : ''}`} onClick={() => { setReplayId(w.id); setPlaying(null); }}>
                    T+{w.atHour}h <span className={leaked ? 'text-ops-red' : 'text-ops-green'}>{r.length - leaked}/{r.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="grid content-start gap-2 md:grid-cols-2 2xl:grid-cols-1">
          <Panel title="Campaign totals">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Threats" value={st.tracks} />
              <Stat label="Stopped" value={st.tracks ? `${Math.round((st.stopped / st.tracks) * 100)}%` : '—'} t={st.tracks ? (st.stopped / st.tracks >= 0.7 ? 'green' : st.stopped / st.tracks >= 0.4 ? 'amber' : 'red') : undefined} />
              <Stat label="Got through" value={st.leaked} t={st.leaked ? 'red' : undefined} />
              <Stat label="Shots" value={st.shots} />
              <Stat label="Decoys hit" value={st.decoysEngaged} sub="wasted shots" />
              <Stat label="Site damage" value={st.siteDamage} />
            </div>
          </Panel>
          <Panel title="Deployed here" right={<span>{deps.length}</span>}>
            {deps.length ? (
              <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">{deps.map((d) => <DeploymentRow key={d.id} s={s} d={d} moving={moving === d.id} onRedeploy={() => setMoving(moving === d.id ? null : d.id)} />)}</ul>
            ) : (
              <p className="text-[11px] text-ops-dim">Nothing deployed in {s.regions[region].name}. Equipment is placed during campaign briefings.</p>
            )}
            <p className="mt-2 text-[10px] text-ops-dim">
              Systems wear down like other equipment: send them for maintenance from Ground, Air or Maritime Command.
              Resupply needs logistics capacity of {TACTICAL_CONFIG.minLogisticsForResupply}+ (now {Math.round(s.logistics)}).
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Threat mix of a wave, e.g. "4 SD · 2 CM · 1 BM". */
function threatMix(tracks: Track[]): string {
  const n = new Map<Track['cls'], number>();
  for (const tr of tracks) n.set(tr.cls, (n.get(tr.cls) ?? 0) + 1);
  return [...n].map(([c, k]) => `${k} ${CLASS_SHORT[c]}`).join(' · ');
}
