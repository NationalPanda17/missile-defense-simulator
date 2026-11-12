// The theater map: topography, coverage, range rings, sites, systems and labels that never overlap.
// With `onPoint` it is a placement surface (mouse, or keyboard: focus the map, move the cursor with the arrow keys —
// Shift for bigger steps — and press Enter); without it, a read-only display.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  EQUIPMENT_MAP, TACTICAL_CONFIG, TERRAIN_PROFILES, canEngage, canEngageClass, detectionRange, isEffector, isUnlimited,
  lowHorizonKm, masked, placementError, type Deployment, type EquipmentSpec, type RegionId, type SimState,
} from '../../../engine';
import { store } from '../../../store/simStore';
import { LAYER_COLOR, SiteMarker, SystemIcon } from './icons';
import { fanOut, layoutLabels, textWidth, type Box, type LabelRequest } from './labels';
import { LiveThreats } from './LiveThreats';
import { MapFurniture, TerrainLayer, peakHeight } from './terrain';

export { LAYER_COLOR } from './icons';

const { width: W, height: H } = TACTICAL_CONFIG.theaterKm;
const KEY_STEP = 10;
const ICON_R = 11; // half-size of a system icon
const SITE_R = 12;

/** "Type 45 destroyer (Sea Viper)" → "Type 45 destroyer", for map labels. */
export const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');

/** Where a deployment's marker is at continuous time t: gliding toward its new spot during a same-region redeploy. */
export function deploymentPosAt(d: Deployment, t: number, hour: number): [number, number] {
  const tr = d.transit;
  if (!tr || tr.region !== d.region || !tr.hours) return [d.x, d.y];
  const remaining = Math.max(0, tr.remaining - (t - hour));
  const k = Math.min(1, Math.max(0, 1 - remaining / tr.hours));
  return [d.x + (tr.x - d.x) * k, d.y + (tr.y - d.y) * k];
}

export const effectorsCovering = (s: SimState, region: RegionId, x: number, y: number) =>
  (s.tactical?.deployments ?? []).filter((d) => {
    if (d.region !== region) return false;
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return isEffector(spec) && Math.hypot(d.x - x, d.y - y) <= spec.rangeKm;
  });

const box = (x: number, y: number, r: number): Box => ({ x: x - r, y: y - r, w: r * 2, h: r * 2 });

export function TheaterMap({ s, region, ghost = null, selectedId, onPoint, onPick, highlight, children, replayAt }: {
  s: SimState;
  region: RegionId;
  ghost?: EquipmentSpec | null;
  selectedId: string | null;
  onPoint?: (x: number, y: number) => void;
  onPick: (d: Deployment) => void;
  highlight?: { x: number; y: number; label: string } | null; // e.g. the guide pointing at a site
  children?: ReactNode; // overlay drawn on top, in km coordinates
  replayAt?: number; // replay: show threats at this sim hour, and only systems deployed by then
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [keyCursor, setKeyCursor] = useState(false);
  const t = s.tactical!;
  const terrain = t.terrain?.[region];
  const sites = t.sites.filter((x) => x.region === region);
  const deps = t.deployments.filter((d) => d.region === region && (replayAt === undefined || d.deployedAt <= replayAt));
  const axes = [...new Set(t.waves.filter((w) => w.phaseIndex === s.phaseIndex && w.forecast && w.region === region).map((w) => w.axis))];
  const topImportance = Math.max(...sites.map((x) => x.importance));

  // Systems redeploying inside this region glide to their new spot: a light per-frame loop rewrites their transform.
  const movers = useRef(new Map<string, { el: SVGGElement; d: Deployment }>());
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const now = store.simTime();
      const h = store.state?.hour ?? 0;
      for (const { el, d } of movers.current.values()) {
        const [x, y] = deploymentPosAt(d, now, h);
        el.setAttribute('transform', `translate(${x},${y})`);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toKm = (e: MouseEvent): [number, number] | null => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [Math.max(0, Math.min(W, p.x)), Math.max(0, Math.min(H, p.y))];
  };

  // Coverage shading per 20 km cell: faint where only high threats are covered, stronger where low-flying threats
  // are covered too (inside a system's radar horizon with a clear line of sight, as in the engine).
  const depKey = deps.map((d) => `${d.id}:${d.x}:${d.y}:${d.stock}`).join('|') + s.assets.filter((a) => a.role === 'defense').map((a) => a.status).join('');
  const cells = useMemo(() => {
    const out: { x: number; y: number; low: boolean }[] = [];
    if (!deps.length) return out;
    for (let x = 0; x < W; x += 20) for (let y = 0; y < H; y += 20) {
      const c: [number, number] = [x + 10, y + 10];
      const reach = effectorsCovering(s, region, c[0], c[1]).filter((d) => canEngage(s, d));
      if (!reach.length) continue;
      const low = reach.some((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        if (!canEngageClass(spec, 'cruise') && !canEngageClass(spec, 'slowDrone')) return false;
        return Math.hypot(d.x - c[0], d.y - c[1]) <= Math.min(spec.rangeKm, lowHorizonKm(terrain, [d.x, d.y])) && !masked(terrain, [d.x, d.y], c);
      });
      out.push({ x, y, low });
    }
    return out;
  }, [depKey, region]);

  // Markers that would sit on top of each other fan out around their shared spot (with a leader line back).
  const now = store.simTime();
  const display = fanOut(deps.map((d) => { const [x, y] = deploymentPosAt(d, now, s.hour); return { id: d.id, x, y }; }), ICON_R * 2.2, SITE_R + ICON_R + 4);

  // Labels: sites, systems and mountain heights, placed so none overlap each other, an icon or the map furniture.
  const arrowAt = { north: [W / 2, 18], south: [W / 2, H - 18], west: [18, H / 2], east: [W - 18, H / 2] } as const;
  const furniture: Box[] = [
    { x: W - 122, y: H - 27, w: 118, h: 22 }, // scale bar
    { x: W - 30, y: 18, w: 24, h: 24 }, // north arrow
    { x: 4, y: H - 22, w: textWidth(`${s.regions[region].name} theater`, 12) * 1.25, h: 18 }, // region title
    ...Array.from({ length: W / 100 - 1 }, (_, i) => ({ x: (i + 1) * 100 - 10, y: 2, w: 20, h: 10 })),
    ...Array.from({ length: H / 100 - 1 }, (_, i) => ({ x: 2, y: (i + 1) * 100 - 6, w: 20, h: 10 })),
    ...axes.map((a) => box(arrowAt[a][0], arrowAt[a][1], 16)),
  ];
  const obstacles: Box[] = [
    ...furniture,
    ...sites.map((x) => box(x.x, x.y, SITE_R + 1)),
    ...deps.map((d) => { const p = display.get(d.id)!; return box(p.x, p.y, ICON_R + 1); }),
    ...(terrain?.massifs ?? []).map((m) => box(m.x, m.y, 7)),
    ...(highlight ? [box(highlight.x, highlight.y, 18)] : []),
  ];
  const requests: LabelRequest[] = [
    ...sites.map((x) => ({ id: `site:${x.id}`, text: x.name, x: x.x, y: x.y, fontSize: x.importance >= topImportance ? 12 : 11, priority: 100 + x.importance * 10, iconRadius: SITE_R })),
    ...deps.filter((d) => !d.transit).map((d) => {
      const p = display.get(d.id)!;
      return { id: `dep:${d.id}`, text: shortName(EQUIPMENT_MAP.get(d.equipmentId)!.name), x: p.x, y: p.y, fontSize: 10.5, priority: d.id === selectedId ? 1000 : 60, iconRadius: ICON_R };
    }),
    ...(terrain?.massifs ?? []).map((m, i) => ({ id: `peak:${i}`, text: `${peakHeight(m.r, m.x).toLocaleString('en-US')} m`, x: m.x, y: m.y, fontSize: 9, priority: 5, iconRadius: 7 })),
    ...(highlight ? [{ id: 'highlight', text: highlight.label, x: highlight.x, y: highlight.y, fontSize: 11, priority: 2000, iconRadius: 18 }] : []),
  ];
  const labels = layoutLabels(requests, obstacles, { w: W, h: H });

  const ghostAt = hover;
  const ghostError = ghost && ghostAt ? placementError(s, ghost, region, Math.round(ghostAt[0]), Math.round(ghostAt[1])) : null;
  const horizon = (p: { x: number; y: number }) => lowHorizonKm(terrain, [p.x, p.y]);
  const selected = deps.find((d) => d.id === selectedId);

  const arrow = (axis: keyof typeof arrowAt) => {
    const rot = { north: 180, south: 0, west: 90, east: 270 }[axis];
    return (
      <g key={axis} transform={`translate(${arrowAt[axis][0]},${arrowAt[axis][1]}) rotate(${rot})`}>
        <path d="M0,-14 L10,4 L3,4 L3,14 L-3,14 L-3,4 L-10,4 Z" fill="#f2545b" opacity={0.9} className="blink" />
        <title>Threats expected from the {axis}</title>
      </g>
    );
  };

  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      className={`block h-auto w-full select-none rounded border border-ops-line bg-[#0d1712] outline-none focus-visible:ring-2 focus-visible:ring-ops-cyan ${onPoint ? 'cursor-crosshair' : ''}`}
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
      <TerrainLayer terrain={terrain} sites={sites} w={W} h={H} />
      <MapFurniture w={W} h={H} title={s.regions[region].name} />
      {/* coverage glow: 20 km cells, blurred into a smooth field */}
      <defs><filter id="coverage-blur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation={7} /></filter></defs>
      <g filter="url(#coverage-blur)" pointerEvents="none">
        {cells.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x - 1} y={c.y - 1} width={22} height={22} fill="#38d6f5" opacity={c.low ? 0.2 : 0.07} />)}
      </g>
      {axes.map(arrow)}

      {/* range rings (at true positions) */}
      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const col = LAYER_COLOR[spec.layer];
        const sensorR = spec.layer === 'detection' ? spec.rangeKm : spec.radar?.rangeKm ?? 0;
        const sel = d.id === selectedId;
        const lowR = spec.domain === 'air' ? 0 : horizon(d);
        return (
          <g key={`r${d.id}`} pointerEvents="none">
            {sensorR > 0 && <circle cx={d.x} cy={d.y} r={Math.min(sensorR, 1200)} fill="none" stroke={col} strokeOpacity={sel ? 0.55 : 0.28} strokeDasharray="4 5" />}
            {isEffector(spec) && <circle cx={d.x} cy={d.y} r={Math.min(spec.rangeKm, 1200)} fill={col} fillOpacity={sel ? 0.06 : 0.025} stroke={col} strokeOpacity={sel ? 1 : 0.6} strokeWidth={sel ? 2 : 1} />}
            {isEffector(spec) && lowR > 0 && spec.rangeKm > lowR && (
              <circle cx={d.x} cy={d.y} r={lowR} fill="none" stroke={col} strokeOpacity={sel ? 0.9 : 0.45} strokeDasharray="1 3" strokeWidth={1.5} />
            )}
          </g>
        );
      })}

      {/* sites */}
      {sites.map((site) => (
        <g key={site.id} transform={`translate(${site.x},${site.y})`}>
          <SiteMarker type={site.type} integrity={site.integrity} important={site.importance >= topImportance} />
          <title>{`${site.name} · integrity ${Math.round(site.integrity)}%`}</title>
        </g>
      ))}

      {highlight && (
        <g pointerEvents="none" transform={`translate(${highlight.x},${highlight.y})`}>
          <circle r={18} fill="none" stroke="#f5b13d" strokeWidth={2} className="pulse-ring" />
          <circle r={16} fill="none" stroke="#f5b13d" strokeWidth={1.5} strokeDasharray="3 3" />
        </g>
      )}

      {/* systems: fanned out when stacked, with a leader line to their true spot */}
      {deps.map((d) => {
        const p = display.get(d.id)!;
        if (!p.moved) return null;
        return <g key={`lead${d.id}`} pointerEvents="none"><line x1={d.x} y1={d.y} x2={p.x} y2={p.y} stroke="#c9d8ec" strokeOpacity={0.5} strokeWidth={1} /><circle cx={d.x} cy={d.y} r={2.2} fill="#c9d8ec" /></g>;
      })}
      {deps.map((d) => {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        const sel = d.id === selectedId;
        const asset = s.assets.find((a) => a.id === d.assetId);
        const down = !asset || asset.status === 'transit' || asset.status === 'maintenance' || asset.status === 'offline';
        const p = display.get(d.id)!;
        const gliding = !!d.transit && d.transit.region === d.region;
        const stock = isEffector(spec) && !isUnlimited(spec) ? d.stock / spec.magazine : undefined;
        const status = down ? 'down' : asset!.status === 'degraded' ? 'degraded' : 'ok';
        return (
          <g key={d.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer outline-none" tabIndex={0} role="button"
            ref={(el) => { if (el && gliding) movers.current.set(d.id, { el, d }); else movers.current.delete(d.id); }}
            aria-label={`${asset?.name ?? spec.name}${down ? `, ${asset?.status ?? 'unavailable'}` : ''}. Press Enter to select.`}
            onClick={(e) => { e.stopPropagation(); onPick(d); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPick(d); } }}>
            {sel && <circle r={16} fill="none" stroke="#fff" strokeOpacity={0.7} className="pulse-ring" />}
            <SystemIcon spec={spec} stock={stock} status={status} selected={sel} dim={down} />
            <title>{`${asset?.name ?? spec.name} · ${asset?.status ?? ''} · condition ${Math.round(asset?.condition ?? 0)}%${stock !== undefined ? ` · ${d.stock}/${spec.magazine} rounds` : ''}`}</title>
          </g>
        );
      })}

      {/* range label on the selected system's ring */}
      {selected && (() => {
        const spec = EQUIPMENT_MAP.get(selected.equipmentId)!;
        const r = isEffector(spec) ? spec.rangeKm : detectionRange(spec, 'cruise');
        if (!r || r > 700) return null;
        const y = Math.max(12, selected.y - r - 4);
        return <text x={selected.x} y={y} textAnchor="middle" fontSize={9.5} fill="#ffffff" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3} pointerEvents="none">{r} km</text>;
      })()}

      {/* labels (collision-free) */}
      <g pointerEvents="none">
        {labels.map((l) => {
          const isPeak = l.id.startsWith('peak:');
          const isDep = l.id.startsWith('dep:');
          const fill = l.id === 'highlight' ? '#f5b13d' : isPeak ? '#e2d2a8' : isDep ? '#ffffff' : '#c9d8ec';
          return (
            <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={l.fontSize} fontWeight={isDep || l.id === 'highlight' ? 600 : 500}
              fill={fill} fillOpacity={isPeak ? 0.85 : 1} style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{l.text}</text>
          );
        })}
      </g>

      {ghost && ghostAt && (
        <g pointerEvents="none" opacity={0.85}>
          {isEffector(ghost) && <circle cx={ghostAt[0]} cy={ghostAt[1]} r={Math.min(ghost.rangeKm, 1200)} fill="none" stroke={ghostError ? '#f2545b' : LAYER_COLOR[ghost.layer]} strokeDasharray="6 4" />}
          {isEffector(ghost) && ghost.domain !== 'air' && ghost.rangeKm > horizon({ x: ghostAt[0], y: ghostAt[1] }) && (
            <circle cx={ghostAt[0]} cy={ghostAt[1]} r={horizon({ x: ghostAt[0], y: ghostAt[1] })} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeOpacity={0.6} strokeDasharray="1 3" strokeWidth={1.5} />
          )}
          {detectionRange(ghost, 'cruise') > 0 && <circle cx={ghostAt[0]} cy={ghostAt[1]} r={Math.min(detectionRange(ghost, 'cruise'), 1200)} fill="none" stroke={LAYER_COLOR[ghost.layer]} strokeOpacity={0.35} strokeDasharray="2 6" />}
          <g transform={`translate(${ghostAt[0]},${ghostAt[1]})`}>
            <SystemIcon spec={ghost} status={ghostError ? 'down' : 'ok'} />
            {ghostError && <rect x={-11} y={-11} width={22} height={22} rx={4} fill="#f2545b" fillOpacity={0.35} />}
          </g>
          {ghostError && (
            <text x={Math.min(W - 6, Math.max(6, ghostAt[0]))} y={ghostAt[1] + 26} textAnchor={ghostAt[0] < 120 ? 'start' : ghostAt[0] > W - 120 ? 'end' : 'middle'}
              fontSize={11} fontWeight={600} fill="#f2545b" style={{ paintOrder: 'stroke' }} stroke="#06111f" strokeWidth={3}>{ghostError}</text>
          )}
        </g>
      )}
      {keyCursor && hover && !ghost && onPoint && (
        <g pointerEvents="none" stroke="#38d6f5" strokeWidth={1.5}><path d={`M${hover[0] - 10},${hover[1]} H${hover[0] + 10} M${hover[0]},${hover[1] - 10} V${hover[1] + 10}`} /></g>
      )}
      <LiveThreats s={s} region={region} at={replayAt} />
      {children}
    </svg>
  );
}

/** Map legend: what the symbols, rings and shading mean. */
export function MapLegend({ region }: { region: RegionId }) {
  const sw = (color: string, dash?: string, width = 1) => <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeDasharray={dash} strokeWidth={width} /></svg>;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ops-dim">
      <span className="italic">{TERRAIN_PROFILES[region].character}</span>
      <span className="flex items-center gap-1">{sw('#38d6f5')}engagement range</span>
      <span className="flex items-center gap-1">{sw('#38d6f5', '1 3', 1.5)}reach vs low-flying threats</span>
      <span className="flex items-center gap-1">{sw('#a78bfa', '4 5')}radar</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#7a6a45]" />high ground: blocks low line of sight, doubles radar horizon</span>
      <span className="flex items-center gap-1"><span className="inline-block h-1 w-4 rounded bg-ops-green" />rounds left</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-ops-green" />status</span>
      <span className="flex items-center gap-1"><svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden><circle r={5.5} fill="none" stroke="#dbe7f6" strokeWidth={1.6} strokeDasharray="22 40" transform="rotate(-90)" /></svg>site integrity</span>
    </div>
  );
}
