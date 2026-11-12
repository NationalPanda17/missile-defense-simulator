// Tactical layer deployment step (campaign briefing): theater map, equipment catalog and site coverage.
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  EQUIPMENT, EQUIPMENT_MAP, LAYER_LABELS, REGION_IDS, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, detectionRange,
  equipmentCost, isEffector, isUnlimited, type DefenseLayer, type Deployment, type EquipmentSpec, type RegionId, type SimState,
  type Site, type SiteType, type ThreatClass,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { Chip, TONE_HEX } from '../components/ui';

const { width: W, height: H } = TACTICAL_CONFIG.theaterKm;

export const LAYER_COLOR: Record<DefenseLayer, string> = {
  detection: '#a78bfa',
  pointDefense: '#34d399',
  directedEnergy: '#f5b13d',
  shortMedium: '#38d6f5',
  long: '#3b82f6',
  upper: '#f2545b',
};
export const CLASS_SHORT: Record<ThreatClass, string> = { slowDrone: 'SD', fastDrone: 'FD', cruise: 'CM', rocket: 'RK', ballistic: 'BM' };
export const SITE_GLYPH: Record<SiteType, string> = { city: '●', port: '⚓', power: '⚡', comms: '◆', command: '★' };

const effectorsCovering = (s: SimState, region: RegionId, x: number, y: number) =>
  (s.tactical?.deployments ?? []).filter((d) => {
    if (d.region !== region) return false;
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return isEffector(spec) && Math.hypot(d.x - x, d.y - y) <= spec.rangeKm;
  });

/** Best single-shot kill rate against each threat class at a point, from systems in range. */
function bestKill(s: SimState, region: RegionId, x: number, y: number): Record<ThreatClass, number> {
  const out = { slowDrone: 0, fastDrone: 0, cruise: 0, rocket: 0, ballistic: 0 };
  for (const d of effectorsCovering(s, region, x, y)) {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    for (const c of THREAT_CLASSES) out[c] = Math.max(out[c], spec.killRate[c]);
  }
  return out;
}

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

/** The theater map. With `onPoint` it is a placement surface; without it, a read-only display. */
export function TheaterMap({ s, region, ghost = null, selectedId, onPoint, onPick, children }: {
  s: SimState;
  region: RegionId;
  ghost?: EquipmentSpec | null;
  selectedId: string | null;
  onPoint?: (x: number, y: number) => void;
  onPick: (d: Deployment) => void;
  children?: ReactNode; // overlay drawn on top, in km coordinates
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const t = s.tactical!;
  const sites = t.sites.filter((x) => x.region === region);
  const deps = t.deployments.filter((d) => d.region === region);
  const axes = [...new Set(t.waves.filter((w) => w.phaseIndex === s.phaseIndex && w.forecast && w.region === region).map((w) => w.axis))];

  const toKm = (e: MouseEvent): [number, number] | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.max(0, Math.min(W, p.x)), Math.max(0, Math.min(H, p.y))];
  };

  // Coverage shading: how many effectors reach each 20 km cell. Recomputed each render because the engine
  // mutates the deployment list in place.
  const cells: { x: number; y: number; n: number }[] = [];
  for (let x = 0; x < W; x += 20) for (let y = 0; y < H; y += 20) {
    const n = effectorsCovering(s, region, x + 10, y + 10).length;
    if (n) cells.push({ x, y, n });
  }

  const arrow = (axis: string) => {
    const at = { north: [W / 2, 18, 180], south: [W / 2, H - 18, 0], west: [18, H / 2, 90], east: [W - 18, H / 2, 270] }[axis]!;
    return (
      <g key={axis} transform={`translate(${at[0]},${at[1]}) rotate(${at[2]})`}>
        <path d="M0,-14 L10,4 L3,4 L3,14 L-3,14 L-3,4 L-10,4 Z" fill="#f2545b" opacity={0.85} className="blink" />
      </g>
    );
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className={`block h-auto w-full select-none rounded border border-ops-line bg-[#040912] ${onPoint ? 'cursor-crosshair' : ''}`}
      role="img"
      aria-label={`Theater map of ${s.regions[region].name}`}
      onMouseMove={(e) => setHover(toKm(e))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        const p = onPoint && toKm(e);
        if (p) onPoint(Math.round(p[0]), Math.round(p[1]));
      }}
    >
      {Array.from({ length: W / 50 + 1 }, (_, i) => <line key={`v${i}`} x1={i * 50} x2={i * 50} y1={0} y2={H} stroke="#1b2c47" strokeWidth={0.5} />)}
      {Array.from({ length: H / 50 + 1 }, (_, i) => <line key={`h${i}`} y1={i * 50} y2={i * 50} x1={0} x2={W} stroke="#1b2c47" strokeWidth={0.5} />)}
      {cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={20} height={20} fill="#38d6f5" opacity={Math.min(0.32, 0.09 * c.n)} pointerEvents="none" />)}
      {axes.map(arrow)}

      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const col = LAYER_COLOR[spec.layer];
        const sensorR = spec.layer === 'detection' ? spec.rangeKm : spec.radar?.rangeKm ?? 0;
        return (
          <g key={`r${d.id}`} pointerEvents="none">
            {sensorR > 0 && <circle cx={d.x} cy={d.y} r={Math.min(sensorR, 1200)} fill="none" stroke={col} strokeOpacity={0.35} strokeDasharray="4 5" />}
            {isEffector(spec) && <circle cx={d.x} cy={d.y} r={Math.min(spec.rangeKm, 1200)} fill={col} fillOpacity={0.04} stroke={col} strokeOpacity={d.id === selectedId ? 1 : 0.7} strokeWidth={d.id === selectedId ? 2 : 1} />}
          </g>
        );
      })}

      {sites.map((site) => (
        <g key={site.id} transform={`translate(${site.x},${site.y})`} pointerEvents="none">
          <text textAnchor="middle" dy={6} fontSize={20} fill={site.integrity > 60 ? '#c9d8ec' : site.integrity > 25 ? '#f5b13d' : '#f2545b'}>{SITE_GLYPH[site.type]}</text>
          <text textAnchor="middle" y={24} fontSize={13} fill="#7d93b1">{site.name}</text>
        </g>
      ))}

      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const sel = d.id === selectedId;
        return (
          <g key={d.id} transform={`translate(${d.x},${d.y})`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); onPick(d); }}>
            <rect x={-8} y={-8} width={16} height={16} fill={LAYER_COLOR[spec.layer]} stroke={sel ? '#fff' : '#060b14'} strokeWidth={sel ? 2 : 1} transform="rotate(45)" />
            <text y={-12} textAnchor="middle" fontSize={12} fill="#fff">{spec.name}</text>
          </g>
        );
      })}

      {ghost && hover && (
        <g pointerEvents="none" opacity={0.7}>
          {isEffector(ghost) && <circle cx={hover[0]} cy={hover[1]} r={Math.min(ghost.rangeKm, 1200)} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeDasharray="6 4" />}
          {detectionRange(ghost, 'cruise') > 0 && <circle cx={hover[0]} cy={hover[1]} r={Math.min(detectionRange(ghost, 'cruise'), 1200)} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeOpacity={0.4} strokeDasharray="2 6" />}
          <rect x={hover[0] - 6} y={hover[1] - 6} width={12} height={12} fill={LAYER_COLOR[ghost.layer]} transform={`rotate(45 ${hover[0]} ${hover[1]})`} />
        </g>
      )}
      {children}
      <text x={6} y={H - 6} fontSize={10} fill="#5d7391">{W} × {H} km · grid 50 km</text>
    </svg>
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
          <button key={l} className={`btn px-1.5 py-0.5 text-[10px] ${layer === l ? 'btn-active' : ''}`} onClick={() => setLayer(l)}>
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
                <div className="truncate text-[10px] text-ops-dim">
                  {e.origin} · {isEffector(e) ? `range ${e.rangeKm} km · alt ${e.altitudeKm} km` : `detects to ${e.rangeKm} km`}
                  {e.radar ? ` · ${e.radar.band}-band` : ''}
                  {isEffector(e) ? ` · ${isUnlimited(e) ? 'unlimited' : `${e.magazine} rds`}` : ''}
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
          <div className="truncate text-white">{SITE_GLYPH[site.type]} {site.name}</div>
          <div className="text-[10px] text-ops-dim">{n ? `${n} system${n > 1 ? 's' : ''} in range` : 'Unprotected'} · integrity {Math.round(site.integrity)}%</div>
        </div>
        <KillBars k={bestKill(s, region, site.x, site.y)} />
      </li>
    );
  };
  return <ul className="space-y-1.5">{sites.map(row)}</ul>;
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

  const onPoint = (x: number, y: number) => {
    if (moving && dep) {
      if (dispatch({ type: 'relocate', deploymentId: dep.id, x, y }).ok) setMoving(false);
      return;
    }
    if (spec && dispatch({ type: 'deploy', equipmentId: spec.id, region, x, y }).ok) setEquipment(null);
  };

  const hint = moving ? `Click the map to move ${depSpec?.name}. Relocating costs ${TACTICAL_CONFIG.relocateCost} credits.`
    : spec ? `Click the map to place ${spec.name} (${equipmentCost(spec)} credits).`
    : 'Pick equipment from the catalog, then click the map to place it. Click a placed system to move or withdraw it.';

  return (
    <div className="space-y-3">
      <div className="rounded border border-ops-red/40 bg-ops-red/5 p-2 text-[11px]">
        <span className="label mr-2 text-ops-red">Threat forecast</span>
        Attacks are expected in{' '}
        {t.forecast.map((r, i) => <span key={r} className="text-white">{i ? ' and ' : ''}{s.regions[r].name}</span>)}.
        {' '}Each forecast region will be hit at least once; red arrows show the expected approach. Later, larger phases may also strike elsewhere.
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Region">
        {REGION_IDS.map((r) => (
          <button key={r} role="tab" aria-selected={r === region} className={`btn ${r === region ? 'btn-active' : ''}`} onClick={() => { setRegion(r); setSelectedDep(null); setMoving(false); }}>
            {s.regions[r].short}
            {t.forecast.includes(r) && <span className="text-ops-red">●</span>}
            {count(r) > 0 && <span className="text-ops-dim">{count(r)}</span>}
          </button>
        ))}
      </div>

      {/* Phones: map, catalog, then coverage. Wider screens: map and coverage on the left, catalog on the right. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-2 md:col-start-1 md:row-start-1">
          <TheaterMap s={s} region={region} ghost={moving && depSpec ? depSpec : spec} selectedId={dep?.id ?? null} onPoint={onPoint}
            onPick={(d) => { setSelectedDep(d.id === selectedDep ? null : d.id); setEquipment(null); setMoving(false); }} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-ops-dim">{hint}</span>
            <span className="tabular-nums text-white">Credits <span className="text-ops-green">{Math.round(s.credits)}</span></span>
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
