// Tactical layer deployment step (campaign briefing): theater map, equipment catalog and site coverage.
import { useEffect, useMemo, useState } from 'react';
import {
  EQUIPMENT, EQUIPMENT_MAP, LAYER_LABELS, REGION_IDS, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, coverageAt,
  equipmentCost, isEffector, isUnlimited, previewDefense, stockpileRules, stormWindows, type DefenseLayer, type RegionId, type SimState, type Site, type ThreatClass,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { Chip, TONE_HEX } from '../components/ui';
import { SiteIcon } from './theater/icons';
import { LAYER_COLOR, MapLegend, TheaterMap, effectorsCovering } from './theater/TheaterMap';

export { LAYER_COLOR, MapLegend, TheaterMap } from './theater/TheaterMap';

export const CLASS_SHORT: Record<ThreatClass, string> = { slowDrone: 'SD', fastDrone: 'FD', cruise: 'CM', rocket: 'RK', ballistic: 'BM' };

/** Best single-shot kill rate per threat class for a threat aimed at this point (engine rules: altitude, horizon, terrain). */
const bestKill = (s: SimState, region: RegionId, x: number, y: number) => coverageAt(s, region, x, y);

export function KillBars({ k }: { k: Record<ThreatClass, number> }) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {THREAT_CLASSES.map((c) => (
        <div key={c} title={`${THREAT_LABELS[c]}: ${Math.round(k[c] * 100)}%`}>
          <div className="h-1.5 overflow-hidden rounded-sm bg-ops-line/70">
            <div className="h-full" style={{ width: `${k[c] * 100}%`, background: k[c] >= 0.7 ? TONE_HEX.green : k[c] >= 0.4 ? TONE_HEX.amber : TONE_HEX.red }} />
          </div>
          <div className="mt-0.5 text-center text-[8px] text-ops-dim">{CLASS_SHORT[c]}</div>
        </div>
      ))}
    </div>
  );
}

const DOMAIN_WORD = { ground: 'ground-based', air: 'airborne', sea: 'ship (place at sea)', space: 'space' } as const;

function StatChip({ label, value, tone = 'dim' }: { label: string; value: string; tone?: 'dim' | 'green' | 'amber' }) {
  const c = tone === 'green' ? 'border-ops-green/40 text-ops-green' : tone === 'amber' ? 'border-ops-amber/40 text-ops-amber' : 'border-ops-line text-ops-text';
  return <span className={`rounded-sm border px-1 py-px ${c}`}><span className="text-ops-dim">{label} </span>{value}</span>;
}

function Catalog({ s, selected, onSelect }: { s: SimState; selected: string | null; onSelect: (id: string | null) => void }) {
  const [layer, setLayer] = useState<DefenseLayer | 'all'>('all');
  const layers = Object.keys(LAYER_LABELS) as DefenseLayer[];
  const list = EQUIPMENT.filter((e) => layer === 'all' || e.layer === layer);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <button className={`btn px-1.5 py-0.5 text-[10px] ${layer === 'all' ? 'btn-active' : ''}`} onClick={() => setLayer('all')}>All</button>
        {layers.map((l) => (
          <button key={l} data-coach={`layer-${l}`} className={`btn px-1.5 py-0.5 text-[10px] ${layer === l ? 'btn-active' : ''}`} onClick={() => setLayer(l)}>
            <span className="inline-block h-2 w-2 rotate-45" style={{ background: LAYER_COLOR[l] }} />{LAYER_LABELS[l]}
          </button>
        ))}
      </div>
      <ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1 md:max-h-[30rem]">
        {list.map((e) => {
          const cost = equipmentCost(e);
          const sel = e.id === selected;
          const short = s.credits < cost;
          return (
            <li key={e.id}>
              <button
                className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${sel ? 'border-ops-cyan bg-ops-cyan/10' : 'border-ops-line hover:border-ops-cyan/50'}`}
                onClick={() => onSelect(sel ? null : e.id)}
                aria-pressed={sel}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-sans text-[13px] font-semibold text-white">
                    <span className="mr-1 inline-block h-2 w-2 rotate-45" style={{ background: LAYER_COLOR[e.layer] }} />{e.name}
                  </span>
                  <span className={`shrink-0 tabular-nums ${short ? 'text-ops-red' : 'text-ops-green'}`}>{cost} cr</span>
                </div>
                <div className="truncate text-[10px] text-ops-dim">{e.origin} · {DOMAIN_WORD[e.domain]}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-[9.5px]">
                  <StatChip label={isEffector(e) ? 'Range' : 'Detects'} value={`${e.rangeKm} km`} />
                  {isEffector(e) && <StatChip label="Ceiling" value={`${e.altitudeKm} km`} />}
                  {isEffector(e) && <StatChip label="Rounds" value={isUnlimited(e) ? '∞' : String(e.magazine)} />}
                  {e.radar && <StatChip label="Radar" value={`${e.radar.band}-band`} />}
                  {e.domain === 'air' && <StatChip label="Sees" value="past horizon" tone="green" />}
                  {e.domain !== 'air' && isEffector(e) && e.rangeKm > TACTICAL_CONFIG.lowAltitude.horizonKm && (
                    <StatChip label="Low-level" value={`≤${TACTICAL_CONFIG.lowAltitude.horizonKm} km`} tone="amber" />
                  )}
                </div>
                {sel && <p className="mt-1 text-[11px] leading-snug text-ops-text">{e.description}</p>}
                {isEffector(e) && <div className="mt-1"><KillBars k={e.killRate} /></div>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SiteCoverage({ s, region }: { s: SimState; region: RegionId }) {
  const sites = s.tactical!.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance);
  const row = (site: Site) => {
    const n = effectorsCovering(s, region, site.x, site.y).length;
    return (
      <li key={site.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-white"><svg width="16" height="16" viewBox="-9 -9 18 18" aria-hidden className="shrink-0"><SiteIcon type={site.type} color={site.integrity > 60 ? '#dbe7f6' : site.integrity > 25 ? '#f5b13d' : '#f2545b'} /></svg>{site.name}</div>
          <div className="text-[10px] text-ops-dim">{n ? `${n} system${n > 1 ? 's' : ''} in range` : 'Unprotected'} · integrity {Math.round(site.integrity)}%</div>
        </div>
        <KillBars k={bestKill(s, region, site.x, site.y)} />
      </li>
    );
  };
  return <ul className="space-y-1.5">{sites.map(row)}</ul>;
}

const GUIDE_KEY = 'mds.deployGuide.hidden';
const guideHidden = () => { try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; } };
const setGuideHidden = (v: boolean) => { try { if (v) localStorage.setItem(GUIDE_KEY, '1'); else localStorage.removeItem(GUIDE_KEY); } catch { /* ignore */ } };

interface GuideStep { id: string; text: string; done: boolean; pick?: string; pickLabel?: string }

/** Steps of the first-deployment guide, ticked off from the actual state. */
export function guideSteps(s: SimState, region: RegionId): GuideStep[] {
  const t = s.tactical!;
  const here = t.deployments.filter((d) => d.region === region);
  const specOf = (id: string) => EQUIPMENT_MAP.get(id)!;
  const top = t.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance)[0];
  const coversTop = here.some((d) => {
    const sp = specOf(d.equipmentId);
    return (sp.layer === 'shortMedium' || sp.layer === 'long') && top && Math.hypot(d.x - top.x, d.y - top.y) <= Math.min(sp.rangeKm, 60);
  });
  const axis = t.waves.find((w) => w.phaseIndex === s.phaseIndex && w.region === region && w.forecast)?.axis;
  return [
    { id: 'region', done: t.forecast.includes(region), text: `Open a forecast region (red dot).${axis ? ` Threats here are expected from the ${axis}.` : ''}` },
    { id: 'cover', done: coversTop, pick: 'iris-t-slm', pickLabel: 'Pick IRIS-T SLM', text: `Put a medium-range system on or near ${top?.name ?? 'the most important city'} (highlighted). Low-flying threats are only engaged within about ${TACTICAL_CONFIG.lowAltitude.horizonKm} km, so keep it close.` },
    { id: 'close', done: here.some((d) => ['pointDefense', 'directedEnergy'].includes(specOf(d.equipmentId).layer)), pick: 'skynex', pickLabel: 'Pick Skynex', text: 'Add close-in defense against drone swarms at a key site.' },
    { id: 'sense', done: here.some((d) => specOf(d.equipmentId).layer === 'detection'), pick: 'acoustic-net', pickLabel: 'Pick acoustic sensors', text: 'Add a sensor toward the threat. Cheap acoustic and RF sensors catch low drones that radars miss; airborne radar (E-7) sees past the horizon.' },
    { id: 'all', done: t.forecast.every((r) => t.deployments.some((d) => d.region === r && isEffector(specOf(d.equipmentId)))), text: 'Do the same in the other forecast region, then begin the phase. During the phase, use the Tactical Theater (X) to resupply, raise alerts and redeploy.' },
  ];
}

function DeployGuide({ s, region, onPick, onHide }: { s: SimState; region: RegionId; onPick: (id: string) => void; onHide: () => void }) {
  const steps = guideSteps(s, region);
  const next = steps.find((x) => !x.done);
  return (
    <div className="rounded border border-ops-amber/40 bg-ops-amber/5 p-2.5 text-[11px]" role="region" aria-label="First deployment guide">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label text-ops-amber">First deployment guide · {s.regions[region].name}</span>
        <button className="text-[10px] text-ops-dim underline hover:text-white" onClick={onHide}>Hide guide</button>
      </div>
      <ol className="space-y-1">
        {steps.map((st, i) => (
          <li key={st.id} className={`flex items-start gap-2 ${st === next ? 'text-white' : st.done ? 'text-ops-dim line-through decoration-ops-dim/50' : 'text-ops-dim'}`}>
            <span className={`mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${st.done ? 'border-ops-green bg-ops-green/20 text-ops-green' : st === next ? 'border-ops-amber text-ops-amber' : 'border-ops-line'}`}>{st.done ? '✓' : i + 1}</span>
            <span className="flex-1">{st.text}</span>
            {st === next && st.pick && <button className="btn shrink-0 px-2 py-0.5" onClick={() => onPick(st.pick!)}>{st.pickLabel}</button>}
          </li>
        ))}
      </ol>
      {!next && <div className="mt-1.5 text-ops-green">All set. Begin the phase when you're ready.</div>}
    </div>
  );
}

/** What each threat class needs, in a sentence, for the forecast check. */
const CLASS_ADVICE: Record<ThreatClass, string> = {
  slowDrone: 'slow drones: cheap to stop with guns, Coyote or jamming; low, so radars must be close or on high ground',
  fastDrone: 'fast drones: counter-drone guns and short-range missiles; low-flying',
  cruise: 'cruise missiles: fly very low; short/medium-range missiles (NASAMS, IRIS-T) with a radar nearby or airborne early warning',
  rocket: 'rockets: fast and short-lived; Iron Dome-class systems near the sites they target',
  ballistic: 'ballistic missiles: only upper-tier or long-range systems reach them (Patriot PAC-3, THAAD, Arrow, SM-3/SM-6)',
};

/** The phase's storms and nights in a region, in one line. */
function weatherOutlook(s: SimState, region: RegionId): string {
  const phase = s.phases[s.phaseIndex];
  const from = s.status === 'running' ? s.phaseStartHour : s.hour;
  const storms = stormWindows(s, region, from, from + phase.hours);
  const st = storms.length
    ? `storms T+${storms.slice(0, 3).map(([a, b]) => `${a}–${b}h`).join(', ')}${storms.length > 3 ? '…' : ''} (sensors at 60% range)`
    : 'no storms expected';
  return `Weather: ${st}. Nights run 20:00–05:00 local; some raids are timed for the dark, when Stinger, Avenger and ZU-23-2 are less accurate.`;
}

/** Forecast check: the expected threats in this region and how the current layout would do against them. */
function ForecastCheck({ s, region }: { s: SimState; region: RegionId }) {
  const t = s.tactical!;
  const key = t.deployments.filter((d) => d.region === region).map((d) => `${d.id}:${d.x}:${d.y}:${d.stock}`).join('|');
  // Recomputed only when this region's layout (or the phase) changes.
  const p = useMemo(() => previewDefense(s, region), [key, region, s.phaseIndex, s.hour]);
  if (!p) {
    return t.forecast.includes(region) ? null : (
      <p className="text-[11px] text-ops-dim">{s.regions[region].name} is not in this phase’s forecast. Surprise attacks are possible in later phases.</p>
    );
  }
  const pct = Math.round(p.prevented * 100);
  const tone = pct >= 70 ? 'text-ops-green' : pct >= 40 ? 'text-ops-amber' : 'text-ops-red';
  const classes = (Object.entries(p.mix) as [ThreatClass, number][]).sort((a, b) => b[1] - a[1]);
  return (
    <details className="rounded border border-ops-line px-2 py-1 text-[11px]" aria-live="polite">
      <summary className="cursor-pointer list-none">
        <span className="label mr-2">Forecast check · {s.regions[region].name}</span>
        Simulated outcome with this layout: <b className={tone}>about {pct}% of the expected damage prevented</b>{' '}
        <span className="text-ops-dim">(likely {Math.round(p.range[0] * 100)}–{Math.round(p.range[1] * 100)}%; {Math.round(p.stopRate * 100)}% of ~{p.threats} threats stopped) · what works ▾</span>
      </summary>
      <ul className="mt-1 space-y-0.5 text-ops-dim">
        {classes.map(([c, n]) => <li key={c}>▸ ~{n} × {CLASS_ADVICE[c]}</li>)}
        <li>▸ {weatherOutlook(s, region)}</li>
      </ul>
      <div className="mt-1 text-[10px] text-ops-dim">
        An estimate from replaying the forecast waves against your layout many times. Luck matters: the real result can land anywhere in the likely range, and sometimes outside it. Surprise attacks are not included.
        Site coverage (on the map) is different: it only measures which sites sit inside some system’s reach.
      </div>
    </details>
  );
}

export function DeployPanel({ s }: { s: SimState }) {
  const t = s.tactical!;
  const [region, setRegion] = useState<RegionId>(t.forecast[0] ?? 'NAM');
  const [equipment, setEquipment] = useState<string | null>(null);
  const [selectedDep, setSelectedDep] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const spec = equipment ? EQUIPMENT_MAP.get(equipment)! : null;
  const dep = t.deployments.find((d) => d.id === selectedDep && d.region === region) ?? null;
  const depSpec = dep ? EQUIPMENT_MAP.get(dep.equipmentId)! : null;
  const depAsset = dep ? s.assets.find((a) => a.id === dep.assetId) : undefined;
  const count = (r: RegionId) => t.deployments.filter((d) => d.region === r).length;
  const [hideGuide, setHideGuide] = useState(guideHidden);
  const spentNow = s.commands.filter((c) => c.t === s.hour && (c.kind === 'deploy' || c.kind === 'relocate')).reduce((a, c) => a + c.credits, 0);
  const showGuide = s.phaseIndex === 0 && !hideGuide && s.settings.mode === 'campaign'; // training lessons have their own coach
  const guideTarget = showGuide && !guideSteps(s, region).find((x) => x.id === 'cover')!.done
    ? t.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance)[0] : undefined;

  useEffect(() => {
    if (!equipment && !moving) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setEquipment(null); setMoving(false); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [equipment, moving]);

  const onPoint = (x: number, y: number) => {
    if (moving && dep) {
      if (dispatch({ type: 'relocate', deploymentId: dep.id, x, y }).ok) setMoving(false);
      return;
    }
    if (spec && dispatch({ type: 'deploy', equipmentId: spec.id, region, x, y }).ok) setEquipment(null);
  };

  const hint = moving ? `Click the map to move ${depSpec?.name}. Relocating costs ${TACTICAL_CONFIG.relocateCost} credits.`
    : spec ? `Click the map to place ${spec.name} (${equipmentCost(spec)} credits).`
    : 'Pick equipment from the catalog, then click the map to place it (or Tab to the map, move with the arrow keys and press Enter). Click or Tab to a placed system to move or withdraw it.';

  return (
    // Short screens: region tabs, the forecast check and the map come first; the forecast note and guide follow.
    <div className="flex flex-col gap-3">
      <div className="order-4 rounded border border-ops-red/40 bg-ops-red/5 p-2 text-[11px]">
        <span className="label mr-2 text-ops-red">Threat forecast</span>
        Attacks are expected in{' '}
        {t.forecast.map((r, i) => <span key={r} className="text-white">{i ? ' and ' : ''}{s.regions[r].name}</span>)}.
        {' '}Each forecast region will be hit at least once; red arrows show the expected approach. Later, larger phases may also strike elsewhere.
        {stockpileRules(s) && (
          <div className="mt-1 text-ops-amber">
            Interceptor stockpiles are on: each unit you field adds {stockpileRules(s)!.initial === 1 ? 'one magazine' : 'half a magazine'} to its type’s national reserve. Resupply draws from it, and it is restocked at each phase start.
          </div>
        )}
      </div>

      <div className="order-2"><ForecastCheck s={s} region={region} /></div>

      {showGuide && <div className="order-5"><DeployGuide s={s} region={region} onPick={(id) => { setEquipment(id); setSelectedDep(null); setMoving(false); }} onHide={() => { setHideGuide(true); setGuideHidden(true); }} /></div>}
      {!showGuide && s.phaseIndex === 0 && (
        <button className="order-5 self-start text-[10px] text-ops-dim underline hover:text-white" onClick={() => { setHideGuide(false); setGuideHidden(false); }}>Show the first deployment guide</button>
      )}

      <div className="order-1 flex flex-wrap gap-1" role="tablist" aria-label="Region">
        {REGION_IDS.map((r) => (
          <button key={r} data-coach={`region-${r}`} role="tab" aria-selected={r === region} className={`btn ${r === region ? 'btn-active' : ''}`} onClick={() => { setRegion(r); setSelectedDep(null); setMoving(false); }}>
            {s.regions[r].short}
            {t.forecast.includes(r) && <span className="text-ops-red">●</span>}
            {count(r) > 0 && <span className="text-ops-dim">{count(r)}</span>}
          </button>
        ))}
      </div>

      {/* Phones: map, catalog, then coverage. Wider screens: map and coverage on the left, catalog on the right. */}
      <div className="order-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_19rem]">
        {/* The map stays put while the catalog scrolls, so a click after picking a system lands where it looks. */}
        <div className="min-w-0 space-y-2 md:sticky md:top-0 md:col-start-1 md:row-start-1 md:self-start" data-coach="deploy-map">
          {/* Always the same height, so picking a system never moves the map under the pointer. */}
          <div className={`flex min-h-[30px] items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${spec || (moving && depSpec) ? 'border-ops-cyan/60 bg-ops-cyan/10' : 'border-ops-line'}`} role="status">
            <span className={spec || (moving && depSpec) ? 'text-white' : 'text-ops-dim'}>
              {moving && depSpec ? <>Moving <b>{depSpec.name}</b>: click its new spot on the map. Esc cancels.</>
                : spec ? <>Placing <b>{spec.name}</b> ({equipmentCost(spec)} cr): click a spot{spec.domain === 'sea' ? ' at sea' : spec.domain === 'air' ? '' : ' on land'}. The outline follows your pointer. Esc cancels.</>
                : 'Pick a system from the catalog, then click the map to place it.'}
            </span>
            {(spec || moving) && <button className="btn px-2 py-0" onClick={() => { setEquipment(null); setMoving(false); }}>Cancel</button>}
          </div>
          <TheaterMap s={s} region={region} ghost={moving && depSpec ? depSpec : spec} selectedId={dep?.id ?? null} onPoint={onPoint}
            highlight={guideTarget ? { x: guideTarget.x, y: guideTarget.y, label: 'Start here' } : null}
            onPick={(d) => { setSelectedDep(d.id === selectedDep ? null : d.id); setEquipment(null); setMoving(false); }} />
          <MapLegend region={region} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-ops-dim">{hint}</span>
            <span className="tabular-nums text-white">
              Credits <span className="text-ops-green">{Math.round(s.credits)}</span>
              {spentNow > 0 && <span className="ml-2 text-ops-dim">spent this briefing {spentNow}</span>}
            </span>
          </div>
          {dep && depSpec && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-ops-cyan/40 p-2">
              <div className="min-w-0">
                <div className="font-sans text-[14px] font-semibold text-white">{depAsset?.name ?? depSpec.name}</div>
                <div className="text-[10px] text-ops-dim">
                  {LAYER_LABELS[depSpec.layer]} · at {dep.x}, {dep.y} km · condition {Math.round(depAsset?.condition ?? 0)}%
                  {isEffector(depSpec) ? ` · ${isUnlimited(depSpec) ? 'unlimited' : `${dep.stock}/${depSpec.magazine} rds`}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                <button className={`btn ${moving ? 'btn-active' : ''}`} onClick={() => { setMoving(!moving); setEquipment(null); }}>Move</button>
                <button className="btn btn-danger" onClick={() => { dispatch({ type: 'withdraw', deploymentId: dep.id }); setSelectedDep(null); setMoving(false); }}>
                  Withdraw (+{Math.floor(equipmentCost(depSpec) * TACTICAL_CONFIG.withdrawRefund)} cr)
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="label mb-1 flex items-center justify-between">
            <span>Equipment</span>
            <span className="flex gap-1">{THREAT_CLASSES.map((c) => <Chip key={c} title={THREAT_LABELS[c]}>{CLASS_SHORT[c]}</Chip>)}</span>
          </div>
          <Catalog s={s} selected={equipment} onSelect={(id) => { setEquipment(id); setSelectedDep(null); setMoving(false); }} />
        </div>
        <div className="min-w-0 md:col-start-1 md:row-start-2">
          <div className="label mb-1 flex items-center justify-between">
            <span>Site coverage · {s.regions[region].name}</span>
            <span className="normal-case tracking-normal">best kill rate per threat</span>
          </div>
          <SiteCoverage s={s} region={region} />
        </div>
      </div>
    </div>
  );
}
