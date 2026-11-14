// Tactical layer deployment step (campaign briefing): theater map, equipment catalog and site coverage.
import { useEffect, useMemo, useState } from 'react';
import {
  EQUIPMENT, EQUIPMENT_MAP, LAYER_LABELS, PASSIVE_SENSOR, RADAR_BANDS, RADAR_BAND_IDS, REGION_IDS, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, coverageAt,
  DOCTRINES, ENEMY_STYLES, resupplyCost, channelsOf, loadoutOf, proposeDefense, killRateOf, roundCostOf, JAMMING, suggestFixes, unitName, veteranOf, equipmentCost, isEffector, isUnlimited, jammedBand, previewDefense, forecastTargets, stockpileRules, stormWindows, type Deployment, type FireDoctrine, type RadarBand, type DefenseLayer, type RegionId, type SimState, type Site, type ThreatClass,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { TONE_HEX } from '../components/ui';
import { useUI } from '../uiState';
import { Meter } from '../Guide';
import { SiteIcon } from './theater/icons';
import { LAYER_COLOR, MapLegend, TheaterMap, effectorsCovering } from './theater/TheaterMap';

export { LAYER_COLOR, MapLegend, TheaterMap } from './theater/TheaterMap';

export const CLASS_SHORT: Record<ThreatClass, string> = { slowDrone: 'SD', fastDrone: 'FD', cruise: 'CM', rocket: 'RK', ballistic: 'BM', hypersonic: 'HG' };

/** Best single-shot kill rate per threat class for a threat aimed at this point (engine rules: altitude, horizon, terrain). */
const bestKill = (s: SimState, region: RegionId, x: number, y: number) => coverageAt(s, region, x, y);

export function KillBars({ k }: { k: Record<ThreatClass, number> }) {
  return (
    <div className="grid grid-cols-6 gap-1">
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

/** A shooter's standing fire orders: one choice the player makes for the fight, changeable at any time. */
export function DoctrinePicker({ d }: { d: Deployment }) {
  const cur: FireDoctrine = d.doctrine ?? 'free';
  return (
    <label className="flex flex-wrap items-center gap-1.5 text-[10px] text-ops-dim" title={DOCTRINES[cur].text}>
      <span>Fire orders</span>
      <select className="input py-0.5 text-[11px]" value={cur} aria-label="Fire orders"
        onChange={(e) => dispatch({ type: 'setDoctrine', deploymentId: d.id, doctrine: e.target.value as FireDoctrine })}>
        {(Object.keys(DOCTRINES) as FireDoctrine[]).map((k) => <option key={k} value={k}>{DOCTRINES[k].label}</option>)}
      </select>
      <span className="basis-full leading-snug">{DOCTRINES[cur].text}</span>
    </label>
  );
}

/**
 * Everything a unit can be told: fire orders, a silent radar, shoot and scoot, patrol, and which interceptors to
 * load. Shown wherever a unit is selected, in a briefing or during a phase.
 */
export function UnitOrders({ s, d }: { s: SimState; d: Deployment }) {
  const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
  const toggle = (label: string, on: boolean, title: string, set: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-ops-dim" title={title}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{label}
    </label>
  );
  const load = loadoutOf(spec, d.loadout);
  return (
    <div className="space-y-1.5">
      {isEffector(spec) && <DoctrinePicker d={d} />}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {spec.radar && toggle('Radar silent', !!d.emcon, 'Switch the radar off: it sees nothing, and missiles that hunt radars cannot find it. A shooter can still fire on another sensor’s track.',
          (v) => dispatch({ type: 'setEmcon', deploymentId: d.id, on: v }))}
        {isEffector(spec) && spec.domain === 'ground' && toggle('Shoot and scoot', !!d.scoot, `After firing in a wave it moves a few km and is out of action for ${TACTICAL_CONFIG.scoot.hours} hours: missiles aimed at where it stood miss.`,
          (v) => dispatch({ type: 'setScoot', deploymentId: d.id, on: v }))}
        {spec.domain === 'sea' && toggle('Patrol', !!d.patrol, `Steam up to ${TACTICAL_CONFIG.patrol.km} km toward each wave before it arrives, staying at sea. The ship wears faster.`,
          (v) => dispatch({ type: 'setPatrol', deploymentId: d.id, on: v }))}
      </div>
      {spec.loadouts && (
        <label className="flex flex-wrap items-center gap-1.5 text-[10px] text-ops-dim">
          <span>Interceptors</span>
          <select className="input py-0.5 text-[11px]" value={d.loadout ?? 'standard'} disabled={s.status !== 'briefing'} aria-label="Interceptor load"
            title={s.status !== 'briefing' ? 'Launchers are reloaded with a different mix only in a briefing' : undefined}
            onChange={(e) => dispatch({ type: 'setLoadout', deploymentId: d.id, loadout: e.target.value })}>
            <option value="standard">Standard mix</option>
            {spec.loadouts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <span className="basis-full leading-snug">
            {load ? load.text : 'The system’s usual load.'} {Math.round(roundCostOf(s, d, spec) * 10) / 10} cr a round
            {(['cruise', 'ballistic'] as ThreatClass[]).filter((c) => spec.killRate[c] > 0).map((c) => `, ${THREAT_LABELS[c].toLowerCase()} ${Math.round(killRateOf(d, spec, c) * 100)}%`).join('')}.
            {s.status !== 'briefing' && ' Can be changed in the next briefing.'}
          </span>
        </label>
      )}
    </div>
  );
}

/** Side view: how high each deployed system reaches against how high each forecast threat flies. */
function AltitudeStrip({ s, region }: { s: SimState; region: RegionId }) {
  const t = s.tactical!;
  const deps = t.deployments.filter((d) => d.region === region && isEffector(EQUIPMENT_MAP.get(d.equipmentId)!));
  const classes = [...new Set(t.waves.filter((w) => w.region === region && w.phaseIndex === s.phaseIndex && !w.resolved).flatMap((w) => w.tracks.map((x) => x.cls)))];
  if (!deps.length || !classes.length) return null;
  // Log scale from 50 m to 200 km, so drones and space both fit.
  const H = 86;
  const y = (km: number) => H - 4 - ((Math.log10(Math.max(0.05, Math.min(200, km))) - Math.log10(0.05)) / (Math.log10(200) - Math.log10(0.05))) * (H - 18);
  const kinds = [...new Map(deps.map((d) => [d.equipmentId, EQUIPMENT_MAP.get(d.equipmentId)!])).values()].sort((a, b) => a.altitudeKm - b.altitudeKm).slice(0, 9);
  const W = 560;
  const col = (W - 150) / Math.max(1, kinds.length);
  const alts = classes.map((c) => ({ c, km: TACTICAL_CONFIG.threatAltitudeKm[c] })).sort((a, b) => a.km - b.km);
  return (
    <details className="rounded border border-ops-line px-2 py-1 text-[11px]">
      <summary className="cursor-pointer text-ops-dim hover:text-white">
        <span className="label mr-2">Altitude</span>
        {alts.filter((a) => !deps.some((d) => { const sp = EQUIPMENT_MAP.get(d.equipmentId)!; return sp.altitudeKm >= a.km && sp.killRate[a.c] > 0; })).length
          ? <span className="text-ops-amber">Nothing here reaches: {alts.filter((a) => !deps.some((d) => { const sp = EQUIPMENT_MAP.get(d.equipmentId)!; return sp.altitudeKm >= a.km && sp.killRate[a.c] > 0; })).map((a) => `${THREAT_LABELS[a.c].toLowerCase()}s (${a.km} km)`).join(', ')}. </span>
          : <span className="text-ops-green">Something here can reach every kind of threat forecast. </span>}
        Side view ▸
      </summary>
      <svg viewBox={`0 0 ${W} ${H + 14}`} className="mt-1 block h-auto w-full max-w-2xl" role="img" aria-label="Side view of system ceilings against threat altitudes">
        {alts.map((a) => (
          <g key={a.c}>
            <line x1={0} x2={W - 150} y1={y(a.km)} y2={y(a.km)} stroke="#f2545b" strokeOpacity={0.7} strokeDasharray="4 3" />
            <text x={W - 146} y={y(a.km) + 3} fontSize={9} fill="#f2545b">{THREAT_LABELS[a.c]} · {a.km} km</text>
          </g>
        ))}
        {kinds.map((sp, i) => (
          <g key={sp.id}>
            <rect x={i * col + col * 0.25} width={col * 0.5} y={y(sp.altitudeKm)} height={H - 4 - y(sp.altitudeKm)} fill={LAYER_COLOR[sp.layer]} fillOpacity={0.55} stroke={LAYER_COLOR[sp.layer]} />
            <text x={i * col + col / 2} y={y(sp.altitudeKm) - 2} textAnchor="middle" fontSize={8.5} fill="#dbe7f6">{sp.altitudeKm} km</text>
            <text x={i * col + col / 2} y={H + 8} textAnchor="middle" fontSize={8} fill="#7d93b1">{sp.name.replace(/\s*\(.*\)$/, '').slice(0, 13)}</text>
          </g>
        ))}
        <line x1={0} x2={W - 150} y1={H - 4} y2={H - 4} stroke="#7d93b1" />
      </svg>
      <p className="text-[10px] text-ops-dim">Bars are how high each system you have here can hit; red lines are how high each forecast threat flies. A bar must reach a line for that system to engage it.</p>
    </details>
  );
}

/** What a system's radar band means for it: range kept in storms, decoys recognised, quality of the track it shares. */
function BandLine({ band }: { band: RadarBand | null }) {
  const r = band ? RADAR_BANDS[band] : PASSIVE_SENSOR;
  return (
    <div className="mt-1 rounded-sm border border-ops-line/70 px-1.5 py-1 text-[10px] leading-relaxed text-ops-dim">
      <span className="text-white">{band ? `${band}-band radar (${RADAR_BANDS[band].nick})` : 'Passive sensor (listens, no radar)'}</span>
      <span className="grid grid-cols-[auto_1fr] gap-x-2">
        <span>Range kept in a storm</span><Meter value={r.storm} />
        <span>Recognises decoys</span><Meter value={r.sharp} />
        <span>Track for other shooters</span><Meter value={r.cue} />
      </span>
    </div>
  );
}

/**
 * The radar bands deployed in a region and what they add up to: whether a storm would blind them, and whether anything
 * here is sharp enough to pick out decoys.
 */
function RadarPicture({ s, region }: { s: SimState; region: RegionId }) {
  const ui = useUI();
  const specs = s.tactical!.deployments.filter((d) => d.region === region).map((d) => EQUIPMENT_MAP.get(d.equipmentId)!);
  const bands = RADAR_BAND_IDS.filter((b) => specs.some((sp) => sp.radar?.band === b));
  const passive = specs.some((sp) => !sp.radar && sp.layer === 'detection');
  const phase = s.phases[s.phaseIndex];
  const from = s.status === 'running' ? s.phaseStartHour : s.hour;
  const storms = stormWindows(s, region, from, from + phase.hours).length > 0;
  const guide = <button className="ml-1 text-ops-cyan underline" onClick={() => ui.setHelp('bands')}>What are radar bands?</button>;
  const jam = jammedBand(s);
  if (!bands.length) {
    return (
      <div className="rounded border border-ops-line px-2 py-1 text-[11px] text-ops-dim">
        <span className="label mr-2">Radar picture</span>
        {specs.length ? (passive ? 'Passive sensors only: they hear drones, nothing else. ' : 'No radar here: shooters will react late and hit less than half as often. ') : 'No radars placed here yet. '}
        {guide}
      </div>
    );
  }
  const bestStorm = Math.max(...bands.map((b) => RADAR_BANDS[b].storm));
  const bestSharp = Math.max(...bands.map((b) => RADAR_BANDS[b].sharp));
  const notes: { tone: string; text: string }[] = [];
  if (bestStorm < 0.7) notes.push({ tone: storms ? 'text-ops-amber' : 'text-ops-dim', text: `${storms ? '⚠ Storms are forecast and e' : 'E'}very radar here is short-wave: in a storm the best keeps ${Math.round(bestStorm * 100)}% of its range. A long-wave radar (L or UHF) sees through weather.` });
  if (bestSharp < 0.5) notes.push({ tone: 'text-ops-amber', text: `Nothing here is sharp enough to pick out decoys (best ${Math.round(bestSharp * 100)}%): expect rounds wasted on fakes. An X-band radar such as Sentinel recognises ${Math.round(RADAR_BANDS.X.sharp * 100)}%.` });
  if (jam) {
    const hit = specs.filter((sp) => sp.radar?.band === jam).length;
    const radars = specs.filter((sp) => sp.radar).length;
    notes.unshift({ tone: hit ? 'text-ops-red' : 'text-ops-green', text: hit
      ? `⚠ The enemy is jamming ${jam}-band this phase: ${hit} of your ${radars} radar${radars === 1 ? '' : 's'} here will see ${Math.round(JAMMING.range * 100)}% as far and recognise ${Math.round(JAMMING.sharp * 100)}% as many decoys. Add a radar on another band.`
      : `The enemy is jamming ${jam}-band this phase; none of your radars here use it.` });
  }
  if (!notes.length) notes.push({ tone: 'text-ops-green', text: 'A good mix: weather-proof warning and a sharp picture.' });
  return (
    <div className="rounded border border-ops-line px-2 py-1 text-[11px]">
      <span className="label mr-2">Radar picture</span>
      {bands.map((b) => (
        <span key={b} className="mr-1 rounded-sm border border-ops-line px-1 text-white" title={RADAR_BANDS[b].summary}>{b}<span className="text-ops-dim"> ×{specs.filter((sp) => sp.radar?.band === b).length}</span></span>
      ))}
      <span className="text-ops-dim">storm range {Math.round(bestStorm * 100)}% · decoys recognised {Math.round(bestSharp * 100)}%</span>
      {guide}
      {notes.map((n) => <div key={n.text} className={n.tone}>{n.text}</div>)}
    </div>
  );
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
      <ul data-catalog className="max-h-[22rem] space-y-1 overflow-y-auto pr-1 md:max-h-[max(16rem,calc(100dvh-22rem-var(--coach-h,0px)))]">
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
                  {e.lure ? <StatChip label="Lure" value="draws missiles that hunt radars" tone="green" /> : <StatChip label={isEffector(e) ? 'Range' : 'Detects'} value={`${e.rangeKm} km`} />}
                  {isEffector(e) && <StatChip label="Handles" value={Number.isFinite(channelsOf(e)) ? `${channelsOf(e) * TACTICAL_CONFIG.saturationPasses} a wave` : 'any number'} />}
                  {e.loadouts && <StatChip label="Loads" value={`${e.loadouts.length + 1}`} />}
                  {isEffector(e) && <StatChip label="Ceiling" value={`${e.altitudeKm} km`} />}
                  {isEffector(e) && <StatChip label="Rounds" value={isUnlimited(e) ? '∞' : String(e.magazine)} />}
                  {e.radar && <StatChip label={jammedBand(s) === e.radar.band ? 'Radar (jammed)' : 'Radar'} tone={jammedBand(s) === e.radar.band ? 'amber' : 'dim'} value={`${e.radar.band}-band${isEffector(e) ? ` · sees ${e.radar.rangeKm} km` : ''}`} />}
                  {isEffector(e) && e.roundCr !== undefined && <StatChip label="Per round" value={`${e.roundCr} cr`} />}
                  {!e.radar && isEffector(e) && <StatChip label="No radar" value="needs a sensor nearby" tone="amber" />}
                  {!e.radar && !isEffector(e) && !e.lure && <StatChip label="Passive" value="drones only" />}
                  {e.domain === 'air' && <StatChip label="Sees" value="past horizon" tone="green" />}
                  {e.domain !== 'air' && isEffector(e) && e.rangeKm > TACTICAL_CONFIG.lowAltitude.horizonKm && (
                    <StatChip label="Low-level" value={`≤${TACTICAL_CONFIG.lowAltitude.horizonKm} km`} tone="amber" />
                  )}
                </div>
                {sel && <p className="mt-1 text-[11px] leading-snug text-ops-text">{e.description}</p>}
                {sel && (e.radar || !isEffector(e)) && !e.lure && <BandLine band={e.radar?.band ?? null} />}
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

/**
 * Where the guide sends the player first: the site the forecast waves aim the most damage at (falling back to the
 * most important site when nothing is forecast here). The most valuable site is often not the one attacked.
 */
export function guideSites(s: SimState, region: RegionId): Site[] {
  const targets = forecastTargets(s, region).map((x) => x.site);
  const rest = s.tactical!.sites.filter((x) => x.region === region && !targets.includes(x)).sort((a, b) => b.importance - a.importance);
  return [...targets, ...rest];
}

/** Steps of the first-deployment guide, ticked off from the actual state. */
export function guideSteps(s: SimState, region: RegionId): GuideStep[] {
  const t = s.tactical!;
  const here = t.deployments.filter((d) => d.region === region);
  const specOf = (id: string) => EQUIPMENT_MAP.get(id)!;
  const [top, second] = guideSites(s, region);
  const coversTop = here.some((d) => {
    const sp = specOf(d.equipmentId);
    return (sp.layer === 'shortMedium' || sp.layer === 'long') && top && Math.hypot(d.x - top.x, d.y - top.y) <= Math.min(sp.rangeKm, 60);
  });
  const axis = t.waves.find((w) => w.phaseIndex === s.phaseIndex && w.region === region && w.forecast)?.axis;
  return [
    { id: 'region', done: t.forecast.includes(region), text: `Open a forecast region (red dot).${axis ? ` Threats here are expected from the ${axis}.` : ''}` },
    { id: 'cover', done: coversTop, pick: 'iris-t-slm', pickLabel: 'Pick IRIS-T SLM', text: `Put a medium-range system on or near ${top?.name ?? 'the most important city'} (highlighted): the forecast waves aim the most damage at it. Low-flying threats are only engaged within about ${TACTICAL_CONFIG.lowAltitude.horizonKm} km, so keep it close.` },
    { id: 'close', done: here.some((d) => ['pointDefense', 'directedEnergy'].includes(specOf(d.equipmentId).layer)), pick: 'skynex', pickLabel: 'Pick Skynex', text: `Add close-in defense against drone swarms at ${second && second !== top ? `${second.name}, the next site the waves aim at` : 'a targeted site'}. Gun systems only reach a few km, so place them on the site itself.` },
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
  slowDrone: 'slow drones: cheap to stop with guns, Coyote or jamming; low, so radars must be close or on high ground. Expect decoys among them: a sharp (X or Ku-band) radar picks those out',
  fastDrone: 'fast drones: counter-drone guns and short-range missiles; low-flying',
  cruise: 'cruise missiles: fly very low; short/medium-range missiles (NASAMS, IRIS-T) with a radar nearby or airborne early warning',
  rocket: 'rockets: fast and short-lived; Iron Dome-class systems near the sites they target',
  ballistic: 'ballistic missiles: only upper-tier or long-range systems reach them (Patriot PAC-3, THAAD, Arrow, SM-3/SM-6)',
  hypersonic: 'hypersonic gliders: very fast and they swerve; only THAAD, Aegis SM-6, Patriot PAC-3, SAMP/T and Arrow 2 have a chance, so stack two',
};

/** The phase's storms and nights in a region, in one line. */
function weatherOutlook(s: SimState, region: RegionId): string {
  const phase = s.phases[s.phaseIndex];
  const from = s.status === 'running' ? s.phaseStartHour : s.hour;
  const storms = stormWindows(s, region, from, from + phase.hours);
  const st = storms.length
    ? `storms T+${storms.slice(0, 3).map(([a, b]) => `${a}–${b}h`).join(', ')}${storms.length > 3 ? '…' : ''} (radars lose range by band: X-band keeps ${Math.round(RADAR_BANDS.X.storm * 100)}%, S-band ${Math.round(RADAR_BANDS.S.storm * 100)}%, L-band ${Math.round(RADAR_BANDS.L.storm * 100)}%)`
    : 'no storms expected';
  return `Weather: ${st}. Nights run 20:00–05:00 local; some raids are timed for the dark, when Stinger, Avenger and ZU-23-2 are less accurate.`;
}

/** A letter for a share stopped: A (85%+) down to F (under 40%). */
const gradeOf = (x: number) => (x >= 0.85 ? 'A' : x >= 0.7 ? 'B' : x >= 0.55 ? 'C' : x >= 0.4 ? 'D' : 'F');
const GRADE_TONE: Record<string, string> = { A: 'border-ops-green/50 text-ops-green', B: 'border-ops-green/40 text-ops-green', C: 'border-ops-amber/50 text-ops-amber', D: 'border-ops-amber/50 text-ops-amber', F: 'border-ops-red/50 text-ops-red' };

/** Forecast check: the expected threats in this region and how the current layout would do against them. */
function ForecastCheck({ s, region }: { s: SimState; region: RegionId }) {
  const t = s.tactical!;
  const key = t.deployments.filter((d) => d.region === region).map((d) => `${d.id}:${d.x}:${d.y}:${d.stock}:${d.doctrine ?? ''}`).join('|');
  // Recomputed only when this region's layout (or the phase) changes.
  const p = useMemo(() => previewDefense(s, region), [key, region, s.phaseIndex, s.hour]);
  const targets = useMemo(() => forecastTargets(s, region), [key, region, s.phaseIndex, s.hour]);
  const exposed = targets.filter((x) => x.uncovered >= x.threat / 2);
  if (!p) {
    return t.forecast.includes(region) ? null : (
      <p className="text-[11px] text-ops-dim">{s.regions[region].name} is not in this phase’s forecast. Surprise attacks are possible in later phases.</p>
    );
  }
  const pct = Math.round(p.prevented * 100);
  const tone = pct >= 70 ? 'text-ops-green' : pct >= 40 ? 'text-ops-amber' : 'text-ops-red';
  const classes = (Object.entries(p.mix) as [ThreatClass, number][]).sort((a, b) => b[1] - a[1]);
  return (
    // The details open as a drop-down over the map instead of pushing it down, so a click aimed at the map lands
    // where it looks.
    <details className="relative rounded border border-ops-line px-2 py-1 text-[11px]" aria-live="polite">
      <summary className="cursor-pointer list-none">
        <span className="label mr-2">Forecast check · {s.regions[region].name}</span>
        Simulated outcome with this layout: <b className={tone}>about {pct}% of the expected damage prevented</b>{' '}
        <span className="text-ops-dim">(likely {Math.round(p.range[0] * 100)}–{Math.round(p.range[1] * 100)}%; {Math.round(p.stopRate * 100)}% of ~{p.threats} threats stopped) · what works ▾</span>
        <span className="mt-1 flex flex-wrap items-center gap-1" aria-label="Grade against each kind of threat">
          <span className="text-ops-dim">Against each threat:</span>
          {classes.map(([c, n]) => {
            const g = gradeOf(p.byClass[c] ?? 0);
            return <span key={c} className={`rounded-sm border px-1 ${GRADE_TONE[g]}`} title={`${THREAT_LABELS[c]}: about ${Math.round((p.byClass[c] ?? 0) * 100)}% of ~${n} stopped`}>{THREAT_LABELS[c]}s <b>{g}</b></span>;
          })}
        </span>
        {exposed.length > 0 && (
          <span className="mt-0.5 block text-ops-amber">
            ⚠ Targeted sites outside your coverage: {exposed.slice(0, 4).map((x) => x.site.name).join(', ')}{exposed.length > 4 ? ` +${exposed.length - 4} more` : ''}
          </span>
        )}
      </summary>
      <div className="absolute inset-x-0 top-full z-20 mt-1 rounded border border-ops-line bg-ops-panel p-2 shadow-2xl">
      <ul className="space-y-0.5 text-ops-dim">
        {targets.length > 0 && <li>▸ Likely targets, most threatened first: {targets.slice(0, 5).map((x) => x.site.name).join(', ')}</li>}
        {classes.map(([c, n]) => <li key={c}>▸ ~{n} × {CLASS_ADVICE[c]}</li>)}
        <li>▸ {weatherOutlook(s, region)}</li>
        {s.settings.mode === 'campaign' && s.phaseIndex > 0 && <li>▸ Some missiles will go for your radars instead of a site. Keep close-in defense beside them.</li>}
      </ul>
      <div className="mt-1 text-[10px] text-ops-dim">
        An estimate from replaying the forecast waves against your layout many times. Luck matters: the real result can land anywhere in the likely range, and sometimes outside it. Surprise attacks are not included.
        Site coverage (on the map) is different: it only measures which sites sit inside some system’s reach.
      </div>
      </div>
    </details>
  );
}

/** Bring the deploy map back on screen, for buttons further down the page that start a placement. */
const showMap = () => window.requestAnimationFrame(() => document.querySelector('[data-coach="deploy-map"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

export function DeployPanel({ s }: { s: SimState }) {
  const t = s.tactical!;
  const ui = useUI();
  // Open on the region last worked on (in this briefing or the last), else the first forecast region.
  const [region, setRegionState] = useState<RegionId>(ui.deployRegion ?? t.forecast[0] ?? 'NAM');
  const setRegion = (r: RegionId) => { setRegionState(r); ui.setDeployRegion(r); };
  // The newest placement of this briefing that can still be taken back for a full refund.
  const undoable = [...t.deployments].reverse().find((d) => {
    const sp = EQUIPMENT_MAP.get(d.equipmentId)!;
    return s.status === 'briefing' && d.deployedAt === s.hour && !d.kills && (isUnlimited(sp) || d.stock >= sp.magazine);
  });
  const [equipment, setEquipment] = useState<string | null>(null);
  const [selectedDep, setSelectedDep] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [pane, setPane] = useState<'map' | 'systems'>('map'); // phones only
  const spec = equipment ? EQUIPMENT_MAP.get(equipment)! : null;
  const dep = t.deployments.find((d) => d.id === selectedDep && d.region === region) ?? null;
  const depSpec = dep ? EQUIPMENT_MAP.get(dep.equipmentId)! : null;
  const depAsset = dep ? s.assets.find((a) => a.id === dep.assetId) : undefined;
  const count = (r: RegionId) => t.deployments.filter((d) => d.region === r).length;
  const [hideGuide, setHideGuide] = useState(guideHidden);
  const spentNow = s.commands.filter((c) => c.t === s.hour && (c.kind === 'deploy' || c.kind === 'relocate')).reduce((a, c) => a + c.credits, 0);
  const showGuide = s.phaseIndex === 0 && !hideGuide && s.settings.mode === 'campaign'; // training lessons have their own coach
  // The adjutant's proposed defense for a region, worked out when asked for.
  const [planFor, setPlanFor] = useState<RegionId | null>(null);
  const budget = Math.max(0, Math.floor(s.credits * 0.75));
  const plan = useMemo(() => (planFor === region ? proposeDefense(s, region, budget) : null), [planFor, region, t.deployments.length, s.phaseIndex]);
  // Keyboard: [ and ] change region, U undoes, M moves and Delete takes back the selected system.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelectorAll('.modal-overlay').length > 1) return; // the guide is open on top
      const i = REGION_IDS.indexOf(region);
      if (e.key === '[' || e.key === ']') { setRegion(REGION_IDS[(i + (e.key === ']' ? 1 : REGION_IDS.length - 1)) % REGION_IDS.length]); setSelectedDep(null); setMoving(false); }
      else if (e.key.toLowerCase() === 'u' && undoable) { dispatch({ type: 'withdraw', deploymentId: undoable.id }); setSelectedDep(null); }
      else if (e.key.toLowerCase() === 'm' && dep) { setMoving(!moving); setEquipment(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && dep) { e.preventDefault(); dispatch({ type: 'withdraw', deploymentId: dep.id }); setSelectedDep(null); setMoving(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  // Picking a system with the keyboard hands the arrow keys straight to the map.
  useEffect(() => {
    if (!equipment && !moving) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && el.tagName === 'BUTTON' && el.closest('[data-catalog]')) (document.querySelector('[data-coach="deploy-map"] svg.theater-map') as SVGSVGElement | null)?.focus();
  }, [equipment, moving]);
  // What the last phase's review said would have helped most here: shown as a ghost on the map until it is placed.
  const fix = useMemo(() => (s.phaseIndex > 0 && s.status === 'briefing' ? suggestFixes(s, 7).find((f) => f.region === region) : undefined), [s.phaseIndex, s.status, region, s.campaignId]);
  const fixSpec = fix ? EQUIPMENT_MAP.get(fix.equipmentId)! : null;
  const fixDone = !!fix && t.deployments.some((d) => d.region === region && d.equipmentId === fix.equipmentId && d.deployedAt === s.hour && Math.hypot(d.x - fix.x, d.y - fix.y) < 30);
  const guideTarget = showGuide && !guideSteps(s, region).find((x) => x.id === 'cover')!.done
    ? guideSites(s, region)[0] : undefined;

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
    : 'Pick equipment from the catalog, then click the map to place it. Keyboard: Enter on a system, arrow keys to move the cursor (Shift for bigger steps), Enter to place; [ and ] change region, U undoes, Tab reaches placed systems, M moves and Delete takes back the selected one.';

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

      <div className="order-2 space-y-1">
        <ForecastCheck s={s} region={region} />
        <RadarPicture s={s} region={region} />
        <AltitudeStrip s={s} region={region} />
        {t.forecast.includes(region) && (
          <div className="rounded border border-ops-line px-2 py-1 text-[11px]">
            <span className="label mr-2">Adjutant’s proposal</span>
            {!plan && <><span className="text-ops-dim">Not sure where to start? </span><button className="btn px-2 py-0.5" onClick={() => setPlanFor(region)}>Propose a defense for {s.regions[region].name}</button></>}
            {plan && plan.length === 0 && <span className="text-ops-dim">Nothing more to add within about {budget} credits. <button className="underline" onClick={() => setPlanFor(null)}>Close</button></span>}
            {plan && plan.length > 0 && (
              <>
                <span className="text-white">{plan.length} systems for {plan.reduce((a, p) => a + p.cost, 0)} credits</span>
                <span className="text-ops-dim"> (keeping about a quarter of your credits for the phase).</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ops-dim">
                  {plan.map((p, i) => <li key={i}><span className="text-white">{EQUIPMENT_MAP.get(p.equipmentId)!.name}</span> ({p.cost} cr): {p.why}</li>)}
                </ul>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button className="btn btn-primary px-2 py-0.5" onClick={() => { for (const p of plan) dispatch({ type: 'deploy', equipmentId: p.equipmentId, region, x: p.x, y: p.y }); setPlanFor(null); }}>Place them all</button>
                  <button className="btn px-2 py-0.5" onClick={() => setPlanFor(null)}>No thanks</button>
                  <span className="text-[10px] text-ops-dim">Anything placed can be moved, or taken back for a full refund, until the phase begins.</span>
                </div>
              </>
            )}
          </div>
        )}
        {fix && fixSpec && !fixDone && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-ops-amber/40 bg-ops-amber/5 px-2 py-1 text-[11px]">
            <span><span className="label mr-2 text-ops-amber">From the last review</span>{fix.text} <span className="text-ops-dim">The amber ring on the map marks the spot.</span></span>
            <button className="btn shrink-0 px-2 py-0.5" onClick={() => { setEquipment(fix.equipmentId); setSelectedDep(null); setMoving(false); setPane('map'); showMap(); }}>Pick {fixSpec.name}</button>
          </div>
        )}
        {s.settings.mode === 'campaign' && s.settings.enemy && s.settings.enemy !== 'planner' && (
          <div className="rounded border border-ops-line px-2 py-1 text-[11px] text-ops-dim">
            <span className="label mr-2">Opponent</span><span className="text-white">{ENEMY_STYLES[s.settings.enemy].name}, {ENEMY_STYLES[s.settings.enemy].title}.</span> {ENEMY_STYLES[s.settings.enemy].text} <span className="text-ops-text">Answer: {ENEMY_STYLES[s.settings.enemy].counter}</span>
          </div>
        )}
      </div>

      {showGuide && <div className="order-5"><DeployGuide s={s} region={region} onPick={(id) => { setEquipment(id); setSelectedDep(null); setMoving(false); setPane('map'); showMap(); }} onHide={() => { setHideGuide(true); setGuideHidden(true); }} /></div>}
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

      {/* Phones: one pane at a time (Map or Systems); picking a system jumps back to the map. */}
      <div className="order-3 flex gap-1 md:hidden" role="tablist" aria-label="Deploy view">
        <button role="tab" aria-selected={pane === 'map'} className={`btn flex-1 ${pane === 'map' ? 'btn-active' : ''}`} onClick={() => setPane('map')}>Map{spec ? ` · placing ${spec.name}` : ''}</button>
        <button role="tab" aria-selected={pane === 'systems'} className={`btn flex-1 ${pane === 'systems' ? 'btn-active' : ''}`} onClick={() => setPane('systems')}>Systems</button>
      </div>
      {/* Wider screens: map and coverage on the left, catalog on the right. */}
      <div className="order-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_19rem]">
        {/* The map stays put while the catalog scrolls in its own box, so a click after picking a system lands where it
            looks. (A pinned map column would cover the site list beneath it.) The catalog's box fits the screen. */}
        <div className={`min-w-0 space-y-2 md:col-start-1 md:row-start-1 md:block ${pane === 'map' ? '' : 'hidden'}`} data-coach="deploy-map">
          {/* Always the same height, so picking a system never moves the map under the pointer. */}
          <div className={`flex min-h-[30px] items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] ${spec || (moving && depSpec) ? 'border-ops-cyan/60 bg-ops-cyan/10' : 'border-ops-line'}`} role="status">
            <span className={spec || (moving && depSpec) ? 'text-white' : 'text-ops-dim'}>
              {moving && depSpec ? <>Moving <b>{depSpec.name}</b>: click its new spot on the map. Esc cancels.</>
                : spec ? <>Placing <b>{spec.name}</b> ({equipmentCost(spec)} cr): click a spot{spec.domain === 'sea' ? ' at sea' : spec.domain === 'air' ? '' : ' on land'}. The outline follows your pointer. Esc cancels.</>
                : <><span className="md:hidden">Open Systems, pick one, then tap the map to place it.</span><span className="hidden md:inline">Pick a system from the catalog, then click the map to place it.</span></>}
            </span>
            {undoable && !spec && !moving && (
              <button className="btn shrink-0 px-2 py-0" title="Take back the last system placed in this briefing: every credit is returned"
                onClick={() => { if (undoable.region !== region) setRegion(undoable.region); dispatch({ type: 'withdraw', deploymentId: undoable.id }); setSelectedDep(null); setMoving(false); }}>
                ↶ Undo {EQUIPMENT_MAP.get(undoable.equipmentId)!.name}
              </button>
            )}
            {(spec || moving) && <button className="btn px-2 py-0" onClick={() => { setEquipment(null); setMoving(false); }}>Cancel</button>}
          </div>
          {/* Phones: the map is drawn at full size and scrolls sideways, so taps land precisely. */}
          <div className="-mx-1 overflow-x-auto px-1 md:mx-0 md:overflow-visible md:px-0">
            <div className="min-w-[560px] md:min-w-0">
              <TheaterMap s={s} region={region} ghost={moving && depSpec ? depSpec : spec} selectedId={dep?.id ?? null} onPoint={onPoint}
                fitClass="md:max-h-[max(15rem,calc(100dvh-24rem-var(--coach-h,0px)))]"
                highlight={guideTarget ? { x: guideTarget.x, y: guideTarget.y, label: 'Start here' } : fix && fixSpec && !fixDone ? { x: fix.x, y: fix.y, label: `Suggested: ${fixSpec.name}` } : null}
                onPick={(d) => { setSelectedDep(d.id === selectedDep ? null : d.id); setEquipment(null); setMoving(false); }} />
            </div>
          </div>
          <p className="text-[10px] text-ops-dim md:hidden">Swipe the map sideways to see the whole theater.</p>
          <MapLegend region={region} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-ops-dim">{hint}</span>
            <span className="rounded border border-ops-green/50 bg-ops-green/10 px-2 py-0.5 tabular-nums text-white">
              Credits <span className="font-sans text-[15px] font-bold text-ops-green">{Math.round(s.credits).toLocaleString('en-US')}</span>
              {spentNow > 0 && <span className="ml-2 text-ops-dim">spent this briefing {spentNow}</span>}
            </span>
          </div>
          {dep && depSpec && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-ops-cyan/40 p-2">
              <div className="min-w-0">
                <div className="font-sans text-[14px] font-semibold text-white">{unitName(s, dep)}{veteranOf(dep) ? <span className="ml-1.5 rounded-sm border border-ops-amber/50 px-1 text-[10px] text-ops-amber">★ {veteranOf(dep)!.label}</span> : null}</div>
                <div className="text-[10px] text-ops-dim">
                  {LAYER_LABELS[depSpec.layer]} · at {dep.x}, {dep.y} km · condition {Math.round(depAsset?.condition ?? 0)}%
                  {isEffector(depSpec) ? ` · ${isUnlimited(depSpec) ? 'unlimited' : `${dep.stock}/${depSpec.magazine} rds`} · ${dep.kills ?? 0} stopped` : ''}
                </div>
              </div>
              <div className="order-last basis-full"><UnitOrders s={s} d={dep} /></div>
              <div className="flex gap-1">
                <button className={`btn ${moving ? 'btn-active' : ''}`} onClick={() => { setMoving(!moving); setEquipment(null); }}>Move</button>
                <button className="btn btn-danger" onClick={() => { dispatch({ type: 'withdraw', deploymentId: dep.id }); setSelectedDep(null); setMoving(false); }}
                  title={dep.deployedAt === s.hour && s.status === 'briefing' ? 'Placed in this briefing: taking it back returns every credit' : 'Half its price comes back, less the cost of any rounds it has fired'}>
                  {dep.deployedAt === s.hour && s.status === 'briefing' && !dep.kills && (isUnlimited(depSpec) || dep.stock >= depSpec.magazine)
                    ? `Take back (+${equipmentCost(depSpec)} cr)` : `Withdraw (+${Math.max(0, Math.floor(equipmentCost(depSpec) * TACTICAL_CONFIG.withdrawRefund) - resupplyCost(dep))} cr)`}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className={`min-w-0 md:col-start-2 md:row-span-2 md:row-start-1 md:block ${pane === 'systems' ? '' : 'hidden'}`}>
          <div className="label mb-1 flex items-center justify-between">
            <span>Equipment</span>
            <span className="normal-case tracking-normal text-ops-dim">bars: chance one shot stops each threat</span>
          </div>
          <p className="mb-1 text-[10px] leading-snug text-ops-dim">{THREAT_CLASSES.map((c) => `${CLASS_SHORT[c]} ${THREAT_LABELS[c].toLowerCase()}`).join(' · ')}</p>
          <Catalog s={s} selected={equipment} onSelect={(id) => { setEquipment(id); setSelectedDep(null); setMoving(false); if (id) setPane('map'); }} />
        </div>
        <div className={`min-w-0 md:col-start-1 md:row-start-2 md:block ${pane === 'map' ? '' : 'hidden'}`}>
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
