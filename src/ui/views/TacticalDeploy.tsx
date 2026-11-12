// Tactical layer deployment step (campaign briefing): theater map, equipment catalog and site coverage.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  EQUIPMENT, EQUIPMENT_MAP, LAYER_LABELS, REGION_IDS, TACTICAL_CONFIG, TERRAIN_PROFILES, THREAT_CLASSES, THREAT_LABELS,
  canEngage, canEngageClass, coverageAt, detectionRange, equipmentCost, isEffector, isUnlimited, lowHorizonKm, masked,
  placementError, type DefenseLayer,
  type Deployment, type EquipmentSpec, type RegionId, type SimState, type Site, type SiteType, type TheaterTerrain, type ThreatClass,
} from '../../engine';
import { dispatch, store } from '../../store/simStore';
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

const effectorsCovering = (s: SimState, region: RegionId, x: number, y: number) =>
  (s.tactical?.deployments ?? []).filter((d) => {
    if (d.region !== region) return false;
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return isEffector(spec) && Math.hypot(d.x - x, d.y - y) <= spec.rangeKm;
  });

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

/** Where a deployment's marker is at continuous time t: gliding toward its new spot during a same-region redeploy. */
function deploymentPosAt(d: Deployment, t: number, hour: number): [number, number] {
  const tr = d.transit;
  if (!tr || tr.region !== d.region || !tr.hours) return [d.x, d.y];
  const remaining = Math.max(0, tr.remaining - (t - hour));
  const k = Math.min(1, Math.max(0, 1 - remaining / tr.hours));
  return [d.x + (tr.x - d.x) * k, d.y + (tr.y - d.y) * k];
}

/** "Type 45 destroyer (Sea Viper)" → "Type 45 destroyer", for map labels. */
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

const integrityColor = (v: number) => (v > 60 ? '#dbe7f6' : v > 25 ? '#f5b13d' : '#f2545b');

/** Small SVG icon per site type, drawn around (0,0). */
export function SiteIcon({ type, color }: { type: SiteType; color: string }) {
  const stroke = { stroke: '#040912', strokeWidth: 1.5, paintOrder: 'stroke' as const };
  switch (type) {
    case 'city': return <g><circle r={9} fill={color} opacity={0.18} /><circle r={5} fill={color} {...stroke} /></g>;
    case 'port': return <g fill="none" stroke={color} strokeWidth={2}><circle cy={-5} r={2.5} /><path d="M0,-2.5 V7 M-6,2 Q0,9 6,2 M-3.5,0 H3.5" /></g>;
    case 'power': return <path d="M2,-8 L-5,1 L0,1 L-2,8 L5,-1 L0,-1 Z" fill={color} {...stroke} />;
    case 'comms': return <g><path d="M0,-7 L6,0 L0,7 L-6,0 Z" fill={color} {...stroke} /><circle r={1.6} fill="#040912" /></g>;
    case 'command': return <path d="M0,-8 L2.2,-2.5 L8,-2.5 L3.4,1 L5,7 L0,3.6 L-5,7 L-3.4,1 L-8,-2.5 L-2.2,-2.5 Z" fill={color} {...stroke} />;
  }
}

/** Sea, coastline and mountain massifs. */
function Terrain({ terrain }: { terrain: TheaterTerrain | undefined }) {
  if (!terrain) return null;
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id="massif-hatch" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1={0} y1={0} x2={0} y2={6} stroke="#8a7350" strokeWidth={1.2} strokeOpacity={0.5} />
        </pattern>
        <radialGradient id="massif-fill"><stop offset="0%" stopColor="#5b4a33" stopOpacity={0.55} /><stop offset="100%" stopColor="#3a3022" stopOpacity={0.25} /></radialGradient>
      </defs>
      <polygon points={terrain.sea.map((p) => p.join(',')).join(' ')} fill="#0b2a47" fillOpacity={0.75} />
      <polyline points={terrain.coastline.map((p) => p.join(',')).join(' ')} fill="none" stroke="#3d7fb0" strokeWidth={1.5} strokeOpacity={0.7} />
      {terrain.massifs.map((m, i) => (
        <g key={i}>
          <circle cx={m.x} cy={m.y} r={m.r} fill="url(#massif-fill)" />
          <circle cx={m.x} cy={m.y} r={m.r} fill="url(#massif-hatch)" stroke="#8a7350" strokeOpacity={0.6} />
          <circle cx={m.x} cy={m.y} r={m.r * 0.55} fill="none" stroke="#8a7350" strokeOpacity={0.35} />
          <path d={`M${m.x - 7},${m.y + 4} L${m.x},${m.y - 7} L${m.x + 7},${m.y + 4} Z`} fill="#a88c60" opacity={0.8} />
        </g>
      ))}
    </g>
  );
}

const KEY_STEP = 10;

/**
 * The theater map. With `onPoint` it is a placement surface (mouse, or keyboard: focus the map, move the cursor with
 * the arrow keys — Shift for bigger steps — and press Enter); without it, a read-only display.
 */
export function TheaterMap({ s, region, ghost = null, selectedId, onPoint, onPick, highlight, children }: {
  s: SimState;
  region: RegionId;
  ghost?: EquipmentSpec | null;
  selectedId: string | null;
  highlight?: { x: number; y: number; label: string } | null; // e.g. the guide pointing at a site
  onPoint?: (x: number, y: number) => void;
  onPick: (d: Deployment) => void;
  children?: ReactNode; // overlay drawn on top, in km coordinates
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  // Systems redeploying inside this region glide to their new spot: a light per-frame loop rewrites their transform.
  const movers = useRef(new Map<string, { el: SVGGElement; d: Deployment }>());
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const t = store.simTime();
      const h = store.state?.hour ?? 0;
      for (const { el, d } of movers.current.values()) {
        const [x, y] = deploymentPosAt(d, t, h);
        el.setAttribute('transform', `translate(${x},${y})`);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  const [keyCursor, setKeyCursor] = useState(false);
  const t = s.tactical!;
  const terrain = t.terrain?.[region];
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

  // Coverage shading per 20 km cell: faint where only high threats are covered, stronger where low-flying threats
  // are covered too. Uses the engine's rules, so it's memoized on what it depends on.
  const depKey = deps.map((d) => `${d.id}:${d.x}:${d.y}:${d.stock}`).join('|') + s.assets.filter((a) => a.role === 'defense').map((a) => a.status).join('');
  const cells = useMemo(() => {
    const out: { x: number; y: number; low: boolean }[] = [];
    if (!deps.length) return out;
    for (let x = 0; x < W; x += 20) for (let y = 0; y < H; y += 20) {
      const c: [number, number] = [x + 10, y + 10];
      const reach = effectorsCovering(s, region, c[0], c[1]).filter((d) => canEngage(s, d));
      if (!reach.length) continue;
      // Low-level cover: inside a system's radar horizon with a clear line of sight (matches the engine's rules).
      const low = reach.some((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        if (!canEngageClass(spec, 'cruise') && !canEngageClass(spec, 'slowDrone')) return false;
        return Math.hypot(d.x - c[0], d.y - c[1]) <= Math.min(spec.rangeKm, lowHorizonKm(terrain, [d.x, d.y])) && !masked(terrain, [d.x, d.y], c);
      });
      out.push({ x, y, low });
    }
    return out;
  }, [depKey, region]);

  const ghostAt = hover;
  const ghostError = ghost && ghostAt ? placementError(s, ghost, region, Math.round(ghostAt[0]), Math.round(ghostAt[1])) : null;
  const horizon = (d: { x: number; y: number }) => lowHorizonKm(terrain, [d.x, d.y]);

  const arrow = (axis: string) => {
    const at = { north: [W / 2, 18, 180], south: [W / 2, H - 18, 0], west: [18, H / 2, 90], east: [W - 18, H / 2, 270] }[axis]!;
    return (
      <g key={axis} transform={`translate(${at[0]},${at[1]}) rotate(${at[2]})`}>
        <path d="M0,-14 L10,4 L3,4 L3,14 L-3,14 L-3,4 L-10,4 Z" fill="#f2545b" opacity={0.9} className="blink" />
      </g>
    );
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className={`block h-auto w-full select-none rounded border border-ops-line bg-[#06111f] outline-none focus-visible:ring-2 focus-visible:ring-ops-cyan ${onPoint ? 'cursor-crosshair' : ''}`}
      role={onPoint ? 'application' : 'img'}
      tabIndex={onPoint ? 0 : undefined}
      aria-label={`Theater map of ${s.regions[region].name}.${onPoint ? ' Arrow keys move the placement cursor, Shift for larger steps, Enter places or moves.' : ''}`}
      onMouseMove={(e) => { setKeyCursor(false); setHover(toKm(e)); }}
      onMouseLeave={() => { if (!keyCursor) setHover(null); }}
      onFocus={() => { if (onPoint && !hover) { setKeyCursor(true); setHover([W / 2, H / 2]); } }}
      onBlur={() => { if (keyCursor) setHover(null); }}
      onKeyDown={(e) => {
        if (!onPoint) return;
        const step = e.shiftKey ? 50 : KEY_STEP;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) {
          e.preventDefault();
          setKeyCursor(true);
          setHover((h) => { const c = h ?? [W / 2, H / 2]; return [Math.max(0, Math.min(W, c[0] + d[0])), Math.max(0, Math.min(H, c[1] + d[1]))]; });
        } else if ((e.key === 'Enter' || e.key === ' ') && hover) {
          e.preventDefault();
          onPoint(Math.round(hover[0]), Math.round(hover[1]));
        }
      }}
      onClick={(e) => {
        const p = onPoint && toKm(e);
        if (p) onPoint(Math.round(p[0]), Math.round(p[1]));
      }}
    >
      <Terrain terrain={terrain} />
      {Array.from({ length: W / 50 + 1 }, (_, i) => <line key={`v${i}`} x1={i * 50} x2={i * 50} y1={0} y2={H} stroke="#1b2c47" strokeWidth={0.5} strokeOpacity={0.6} />)}
      {Array.from({ length: H / 50 + 1 }, (_, i) => <line key={`h${i}`} y1={i * 50} y2={i * 50} x1={0} x2={W} stroke="#1b2c47" strokeWidth={0.5} strokeOpacity={0.6} />)}
      {cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={20} height={20} fill="#38d6f5" opacity={c.low ? 0.2 : 0.07} pointerEvents="none" />)}
      {axes.map(arrow)}

      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const col = LAYER_COLOR[spec.layer];
        const sensorR = spec.layer === 'detection' ? spec.rangeKm : spec.radar?.rangeKm ?? 0;
        const sel = d.id === selectedId;
        const lowR = spec.domain === 'air' ? 0 : horizon(d);
        return (
          <g key={`r${d.id}`} pointerEvents="none">
            {sensorR > 0 && <circle cx={d.x} cy={d.y} r={Math.min(sensorR, 1200)} fill="none" stroke={col} strokeOpacity={0.3} strokeDasharray="4 5" />}
            {isEffector(spec) && <circle cx={d.x} cy={d.y} r={Math.min(spec.rangeKm, 1200)} fill={col} fillOpacity={0.03} stroke={col} strokeOpacity={sel ? 1 : 0.65} strokeWidth={sel ? 2 : 1} />}
            {isEffector(spec) && lowR > 0 && spec.rangeKm > lowR && (
              <circle cx={d.x} cy={d.y} r={lowR} fill="none" stroke={col} strokeOpacity={sel ? 0.9 : 0.45} strokeDasharray="1 3" strokeWidth={1.5} />
            )}
          </g>
        );
      })}

      {highlight && (
        <g pointerEvents="none" transform={`translate(${highlight.x},${highlight.y})`}>
          <circle r={18} fill="none" stroke="#f5b13d" strokeWidth={2} className="pulse-ring" />
          <circle r={16} fill="none" stroke="#f5b13d" strokeWidth={1.5} strokeDasharray="3 3" />
          <text y={-24} textAnchor="middle" fontSize={11} fill="#f5b13d" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{highlight.label}</text>
        </g>
      )}
      {sites.map((site) => (
        <g key={site.id} transform={`translate(${site.x},${site.y})`} pointerEvents="none">
          <SiteIcon type={site.type} color={integrityColor(site.integrity)} />
          <text textAnchor={site.x < 70 ? 'start' : site.x > W - 70 ? 'end' : 'middle'} x={site.x < 70 ? -8 : site.x > W - 70 ? 8 : 0} y={22} fontSize={12.5} fill="#9fb4cf" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{site.name}</text>
        </g>
      ))}

      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const sel = d.id === selectedId;
        const asset = s.assets.find((a) => a.id === d.assetId);
        const down = asset && (asset.status === 'transit' || asset.status === 'maintenance' || asset.status === 'offline');
        const [px, py] = deploymentPosAt(d, store.simTime(), s.hour);
        const gliding = !!d.transit && d.transit.region === d.region;
        return (
          <g key={d.id} transform={`translate(${px},${py})`} className="cursor-pointer outline-none" tabIndex={0} role="button"
            ref={(el) => { if (el && gliding) movers.current.set(d.id, { el, d }); else movers.current.delete(d.id); }}
            aria-label={`${asset?.name ?? spec.name}${down ? `, ${asset!.status}` : ''}. Press Enter to select.`}
            onClick={(e) => { e.stopPropagation(); onPick(d); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPick(d); } }}>
            {sel && <circle r={14} fill="none" stroke="#fff" strokeOpacity={0.7} className="pulse-ring" />}
            <rect x={-8} y={-8} width={16} height={16} fill={LAYER_COLOR[spec.layer]} fillOpacity={down ? 0.35 : 1} stroke={sel ? '#fff' : '#060b14'} strokeWidth={sel ? 2 : 1.5} transform="rotate(45)" />
            <text y={-13} textAnchor={d.x < 70 ? 'start' : d.x > W - 70 ? 'end' : 'middle'} x={d.x < 70 ? -8 : d.x > W - 70 ? 8 : 0} fontSize={11.5} fill="#fff" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{shortName(spec.name)}</text>
          </g>
        );
      })}

      {ghost && ghostAt && (
        <g pointerEvents="none" opacity={0.8}>
          {isEffector(ghost) && <circle cx={ghostAt[0]} cy={ghostAt[1]} r={Math.min(ghost.rangeKm, 1200)} fill="none" stroke={ghostError ? '#f2545b' : LAYER_COLOR[ghost.layer]} strokeDasharray="6 4" />}
          {isEffector(ghost) && ghost.domain !== 'air' && ghost.rangeKm > horizon({ x: ghostAt[0], y: ghostAt[1] }) && (
            <circle cx={ghostAt[0]} cy={ghostAt[1]} r={horizon({ x: ghostAt[0], y: ghostAt[1] })} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeOpacity={0.6} strokeDasharray="1 3" strokeWidth={1.5} />
          )}
          {detectionRange(ghost, 'cruise') > 0 && <circle cx={ghostAt[0]} cy={ghostAt[1]} r={Math.min(detectionRange(ghost, 'cruise'), 1200)} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeOpacity={0.35} strokeDasharray="2 6" />}
          <rect x={ghostAt[0] - 7} y={ghostAt[1] - 7} width={14} height={14} fill={ghostError ? '#f2545b' : LAYER_COLOR[ghost.layer]} transform={`rotate(45 ${ghostAt[0]} ${ghostAt[1]})`} />
          {ghostError && <text x={ghostAt[0]} y={ghostAt[1] + 24} textAnchor="middle" fontSize={11} fill="#f2545b" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{ghostError}</text>}
        </g>
      )}
      {keyCursor && hover && !ghost && onPoint && (
        <g pointerEvents="none" stroke="#38d6f5" strokeWidth={1.5}><path d={`M${hover[0] - 10},${hover[1]} H${hover[0] + 10} M${hover[0]},${hover[1] - 10} V${hover[1] + 10}`} /></g>
      )}
      {children}
      <text x={6} y={H - 6} fontSize={10} fill="#5d7391" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{W} × {H} km · grid 50 km</text>
    </svg>
  );
}

/** Map legend: what the rings and shading mean. */
export function MapLegend({ region }: { region: RegionId }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ops-dim">
      <span className="italic">{TERRAIN_PROFILES[region].character}</span>
      <span className="flex items-center gap-1"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#38d6f5" /></svg>engagement range</span>
      <span className="flex items-center gap-1"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#38d6f5" strokeDasharray="1 3" strokeWidth="1.5" /></svg>reach vs low-flying threats</span>
      <span className="flex items-center gap-1"><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#a78bfa" strokeDasharray="4 5" /></svg>radar</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#8a7350]/60" />high ground: blocks low line of sight, doubles radar horizon</span>
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
  const showGuide = s.phaseIndex === 0 && !hideGuide;
  const guideTarget = showGuide && !guideSteps(s, region).find((x) => x.id === 'cover')!.done
    ? t.sites.filter((x) => x.region === region).sort((a, b) => b.importance - a.importance)[0] : undefined;

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
    <div className="space-y-3">
      <div className="rounded border border-ops-red/40 bg-ops-red/5 p-2 text-[11px]">
        <span className="label mr-2 text-ops-red">Threat forecast</span>
        Attacks are expected in{' '}
        {t.forecast.map((r, i) => <span key={r} className="text-white">{i ? ' and ' : ''}{s.regions[r].name}</span>)}.
        {' '}Each forecast region will be hit at least once; red arrows show the expected approach. Later, larger phases may also strike elsewhere.
      </div>

      {showGuide && <DeployGuide s={s} region={region} onPick={(id) => { setEquipment(id); setSelectedDep(null); setMoving(false); }} onHide={() => { setHideGuide(true); setGuideHidden(true); }} />}
      {!showGuide && s.phaseIndex === 0 && (
        <button className="text-[10px] text-ops-dim underline hover:text-white" onClick={() => { setHideGuide(false); setGuideHidden(false); }}>Show the first deployment guide</button>
      )}

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
