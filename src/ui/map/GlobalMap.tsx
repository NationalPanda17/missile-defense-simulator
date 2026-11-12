// Interactive SVG operational map: zoom/pan, region selection, layered domain assets, network links and event markers.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactNode } from 'react';
import { REGION_IDS, isActive, isKnown, confidenceLabel, type Asset, type GameEvent, type RegionId, type SimState } from '../../engine';
import { DOMAIN_COLOR, DOMAIN_LABEL, SEV_TONE, TONE_HEX, tone } from '../components/ui';
import { useUI, type Layers, type OverlayMetric } from '../uiState';
import { CONTEXT_LAND, MAP_H, MAP_W, REGION_SHAPES, project, regionBounds, ringPath } from './geography';

interface View { x: number; y: number; w: number }
const FULL: View = { x: 0, y: 0, w: MAP_W };
const ASPECT = MAP_H / MAP_W;

const LINKS: [RegionId, RegionId][] = [
  ['NAM', 'EUR'], ['NAM', 'SAM'], ['NAM', 'POL'], ['EUR', 'AFR'], ['EUR', 'MDE'], ['EUR', 'POL'],
  ['AFR', 'MDE'], ['AFR', 'SAM'], ['MDE', 'IPA'], ['IPA', 'POL'], ['EUR', 'IPA'],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

export function statusColor(a: Asset, hour: number) {
  if (a.status === 'maintenance') return '#5d7391';
  if (a.status === 'transit') return '#a78bfa';
  if (a.restoredAt !== undefined && hour - a.restoredAt < 12) return '#e0f7ff';
  if (a.status === 'offline') return TONE_HEX.red;
  if (a.status === 'degraded') return TONE_HEX.amber;
  return TONE_HEX.green;
}

function satPosition(a: Asset, idx: number, hour: number): [number, number] {
  if (a.role === 'comms') return [a.pos[0], 0]; // geostationary-style relay
  const inc = a.name.startsWith('AURORA') ? 78 : 52;
  const lon = ((((a.pos[0] + hour * 15 + idx * 47) % 360) + 540) % 360) - 180;
  const lat = inc * Math.sin(((lon - a.pos[0]) * Math.PI) / 180 + idx);
  return [lon, lat];
}

function trackPath(a: Asset, idx: number) {
  const inc = a.name.startsWith('AURORA') ? 78 : 52;
  let d = '';
  for (let lon = -180; lon <= 180; lon += 6) {
    const lat = inc * Math.sin(((lon - a.pos[0]) * Math.PI) / 180 + idx);
    const [x, y] = project(lon, lat);
    d += `${lon === -180 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

export function eventPoint(s: SimState, e: GameEvent): [number, number] {
  const a = e.assetId ? s.assets.find((x) => x.id === e.assetId) : undefined;
  if (a && a.domain !== 'space') return project(a.pos[0] + 2.5, a.pos[1] + 2.5);
  const c = s.regions[e.region].center;
  const h = hash(e.id);
  return project(c[0] + ((h % 13) - 6) * 1.6, c[1] + (((h >> 4) % 9) - 4) * 1.4);
}

export function regionMetric(s: SimState, id: RegionId, m: OverlayMetric) {
  const r = s.regions[id];
  switch (m) {
    case 'readiness': return r.readiness;
    case 'stability': return r.stability;
    case 'comms': return r.comms;
    case 'awareness': return r.awareness;
    case 'infrastructure': return r.infrastructure;
    default: return 0;
  }
}

export default function GlobalMap({ s }: { s: SimState }) {
  const ui = useUI();
  const { layers, overlay } = ui;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(FULL);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const anim = useRef<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  const clampView = (v: View): View => {
    const w = Math.max(120, Math.min(MAP_W, v.w));
    const h = w * ASPECT;
    return { w, x: Math.max(-40, Math.min(MAP_W - w + 40, v.x)), y: Math.max(-30, Math.min(MAP_H - h + 30, v.y)) };
  };

  const animateTo = (target: View) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const dur = 550;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setView(clampView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e }));
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!ui.region) return animateTo(FULL);
    const b = regionBounds(ui.region);
    const w = Math.max(b.w * 1.5, (b.h * 1.5) / ASPECT, 260);
    animateTo({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - (w * ASPECT) / 2, w });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.region]);

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      const v = viewRef.current;
      const f = Math.exp(e.deltaY * 0.0015);
      const w = Math.max(120, Math.min(MAP_W, v.w * f));
      const k = w / v.w;
      setView(clampView({ w, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: RPE<SVGSVGElement>) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMove = (e: RPE<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = view.w / Math.min(rect.width, rect.height / ASPECT);
    const dx = (e.clientX - d.x) * scale;
    const dy = (e.clientY - d.y) * scale;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) {
      if (!d.moved) svgRef.current?.setPointerCapture(e.pointerId);
      d.moved = true;
    }
    if (d.moved) setView(clampView({ w: view.w, x: d.vx - dx, y: d.vy - dy }));
  };
  const onUp = () => {
    setTimeout(() => (drag.current = null), 0);
  };
  const clickGuard = (fn: () => void) => () => {
    if (drag.current?.moved) return;
    fn();
  };

  const zoomBy = (f: number) => {
    const v = viewRef.current;
    const w = Math.max(120, Math.min(MAP_W, v.w * f));
    const cx = v.x + v.w / 2, cy = v.y + (v.w * ASPECT) / 2;
    animateTo({ w, x: cx - w / 2, y: cy - (w * ASPECT) / 2 });
  };

  const k = view.w / MAP_W; // icon scale factor
  const hour = s.hour;
  const showTip = (e: React.MouseEvent, content: ReactNode) => {
    const host = svgRef.current!.parentElement!.getBoundingClientRect();
    setHover({ x: e.clientX - host.left, y: e.clientY - host.top, content });
  };

  const domainVisible = (a: Asset) => layers[a.domain as keyof Layers] && (a.domain !== 'ground' || a.role === 'sensor' || layers.infrastructure);
  const groundHubs = useMemo(() => {
    const m = new Map<RegionId, Asset>();
    for (const a of s.assets) if (a.domain === 'ground' && a.role === 'comms') m.set(a.region, a);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.assets.length]);

  const activeEvents = s.events.filter((e) => isActive(e) && isKnown(s, e));
  const globalEvents = activeEvents.filter((e) => e.global);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-ops-line bg-[#040912]">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.w * ASPECT}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { setHover(null); onUp(); }}
        role="img"
        aria-label="Global operations map"
      >
        <defs>
          <radialGradient id="sweepGrad" cx="0" cy="0" r="1">
            <stop offset="0" stopColor="#38d6f5" stopOpacity="0.35" />
            <stop offset="1" stopColor="#38d6f5" stopOpacity="0" />
          </radialGradient>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#f2545b" strokeOpacity="0.35" strokeWidth="2" />
          </pattern>
          <filter id="glow"><feGaussianBlur stdDeviation="1.5" /></filter>
        </defs>

        <rect x={-200} y={-200} width={MAP_W + 400} height={MAP_H + 400} fill="#040912" onClick={clickGuard(() => ui.setRegion(null))} />
        {/* graticule */}
        <g stroke="#11223a" strokeWidth={0.5 * k + 0.2} pointerEvents="none">
          {Array.from({ length: 13 }, (_, i) => -180 + i * 30).map((lon) => {
            const [x] = project(lon, 0);
            return <line key={`lo${lon}`} x1={x} x2={x} y1={0} y2={MAP_H} />;
          })}
          {[-60, -30, 0, 30, 60].map((lat) => {
            const [, y] = project(0, lat);
            return <line key={`la${lat}`} x1={0} x2={MAP_W} y1={y} y2={y} strokeDasharray={lat === 0 ? undefined : '2 3'} />;
          })}
        </g>

        {CONTEXT_LAND.map((r, i) => <path key={i} d={ringPath(r)} fill="#0b1626" stroke="#16263f" strokeWidth={0.5} pointerEvents="none" />)}

        {/* regions */}
        {REGION_IDS.map((id) => {
          const val = regionMetric(s, id, overlay);
          const col = overlay === 'none' ? '#1b2c47' : TONE_HEX[tone(val)];
          const sel = ui.region === id;
          const r = s.regions[id];
          return (
            <g key={id} className="cursor-pointer" onClick={clickGuard(() => ui.setRegion(sel ? null : id))}
              onMouseMove={(e) => showTip(e, (
                <div><div className="font-sans text-sm font-semibold text-white">{r.name}</div>
                  <div className="grid grid-cols-2 gap-x-3 text-[10px]">
                    <span>Readiness</span><span className="text-right">{r.readiness.toFixed(0)}</span>
                    <span>Stability</span><span className="text-right">{r.stability.toFixed(0)}</span>
                    <span>Awareness</span><span className="text-right">{r.awareness.toFixed(0)}</span>
                    <span>Comms</span><span className="text-right">{r.comms.toFixed(0)}</span>
                    <span>Infrastructure</span><span className="text-right">{r.infrastructure.toFixed(0)}</span>
                  </div><div className="mt-1 text-[10px] text-ops-dim">Click to open regional command</div></div>
              ))}
              onMouseLeave={() => setHover(null)}>
              {REGION_SHAPES[id].map((ring, i) => (
                <path key={i} d={ringPath(ring)} fill={col} fillOpacity={overlay === 'none' ? 0.5 : sel ? 0.32 : 0.16}
                  stroke={sel ? '#38d6f5' : col} strokeOpacity={sel ? 1 : 0.55} strokeWidth={(sel ? 1.6 : 0.7) * Math.max(k, 0.35)}
                  className="transition-[fill-opacity] duration-300 hover:fill-opacity-30" />
              ))}
              {r.stability < 40 && REGION_SHAPES[id].map((ring, i) => <path key={`h${i}`} d={ringPath(ring)} fill="url(#hatch)" pointerEvents="none" />)}
            </g>
          );
        })}

        {/* sensor coverage */}
        {layers.sensors && s.assets.filter((a) => a.role === 'sensor' && a.domain !== 'space' && domainVisible(a) && a.status !== 'transit').map((a) => {
          const [x, y] = project(a.pos[0], a.pos[1]);
          const av = a.status === 'maintenance' || a.status === 'offline' ? 0 : a.condition / 100;
          const rad = (a.domain === 'air' ? 34 : a.domain === 'sea' ? 30 : 26) * (0.4 + 0.6 * av);
          return <circle key={`cov${a.id}`} cx={x} cy={y} r={rad} fill={DOMAIN_COLOR[a.domain]} fillOpacity={0.05 + 0.05 * av} stroke={DOMAIN_COLOR[a.domain]} strokeOpacity={0.35} strokeWidth={0.5 * k + 0.15} strokeDasharray="3 3" pointerEvents="none" />;
        })}

        {/* comms network */}
        {layers.comms && (
          <g pointerEvents="none">
            {LINKS.map(([a, b]) => {
              const ha = groundHubs.get(a), hb = groundHubs.get(b);
              if (!ha || !hb) return null;
              const [x1, y1] = project(ha.pos[0], ha.pos[1]);
              const [x2, y2] = project(hb.pos[0], hb.pos[1]);
              const q = Math.min(s.regions[a].comms, s.regions[b].comms, ha.condition, hb.condition);
              const col = TONE_HEX[tone(q)];
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.18;
              const down = q < 35;
              return <path key={`${a}${b}`} d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={col} strokeOpacity={down ? 0.5 : 0.75} strokeWidth={0.9 * k + 0.25} strokeDasharray={down ? '2 4' : '6 6'} className={down ? '' : q > 70 ? 'flow' : 'flow-slow'} />;
            })}
            {s.assets.filter((a) => a.domain === 'ground' && a.role === 'command').map((c) => {
              const h = groundHubs.get(c.region);
              if (!h) return null;
              const [x1, y1] = project(h.pos[0], h.pos[1]);
              const [x2, y2] = project(c.pos[0], c.pos[1]);
              return <line key={`cl${c.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={TONE_HEX[tone(Math.min(c.condition, h.condition))]} strokeOpacity={0.6} strokeWidth={0.6 * k + 0.2} strokeDasharray="3 3" className="flow-slow" />;
            })}
            {layers.space && s.assets.filter((a) => a.domain === 'space' && a.role === 'comms').map((sat) => {
              const [sx, sy] = project(sat.pos[0], 0);
              return sat.coverage.map((rid) => {
                const h = groundHubs.get(rid);
                if (!h) return null;
                const [x, y] = project(h.pos[0], h.pos[1]);
                const q = sat.status === 'offline' || sat.status === 'maintenance' ? 0 : sat.condition;
                return <line key={`sl${sat.id}${rid}`} x1={sx} y1={sy} x2={x} y2={y} stroke="#a78bfa" strokeOpacity={q < 35 ? 0.15 : 0.35} strokeWidth={0.5 * k + 0.15} strokeDasharray="1 4" className="flow-slow" />;
              });
            })}
          </g>
        )}

        {/* orbital tracks */}
        {layers.space && s.assets.filter((a) => a.domain === 'space' && a.role === 'sensor').map((a, i) => (
          <path key={`trk${a.id}`} d={trackPath(a, i)} fill="none" stroke="#a78bfa" strokeOpacity={0.18} strokeWidth={0.6 * k + 0.15} strokeDasharray="4 6" pointerEvents="none" />
        ))}

        {/* radar sweep on selected region */}
        {ui.region && (() => {
          const [cx, cy] = project(...s.regions[ui.region].center);
          const R = 60;
          return (
            <g pointerEvents="none">
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="#38d6f5" strokeOpacity={0.25} strokeWidth={0.5} />
              <circle cx={cx} cy={cy} r={R * 0.5} fill="none" stroke="#38d6f5" strokeOpacity={0.15} strokeWidth={0.4} />
              <g className="radar-sweep" style={{ transformOrigin: `${cx}px ${cy}px` }}>
                <path d={`M${cx},${cy} L${cx + R},${cy} A${R},${R} 0 0,0 ${cx + R * Math.cos(-0.6)},${cy + R * Math.sin(-0.6)} Z`} fill="url(#sweepGrad)" />
              </g>
            </g>
          );
        })()}

        {/* assets */}
        {s.assets.filter(domainVisible).map((a) => {
          const spaceIdx = s.assets.filter((x) => x.domain === 'space').indexOf(a);
          const [lon, lat] = a.domain === 'space' ? satPosition(a, spaceIdx, hour) : a.pos;
          const [x, y] = project(lon, lat);
          const sc = Math.max(0.35, Math.min(1, k * 1.15));
          const fill = statusColor(a, hour);
          const stroke = DOMAIN_COLOR[a.domain];
          const sel = ui.assetId === a.id;
          let shape: ReactNode;
          if (a.domain === 'space') shape = <g><rect x={-2.2} y={-2.2} width={4.4} height={4.4} fill={fill} stroke={stroke} strokeWidth={0.8} /><line x1={-6} x2={6} y1={0} y2={0} stroke={stroke} strokeWidth={1.2} /></g>;
          else if (a.domain === 'air') shape = <path d="M0,-4.5 L4,3.5 L0,1.5 L-4,3.5 Z" fill={fill} stroke={stroke} strokeWidth={0.8} />;
          else if (a.domain === 'sea') shape = <path d="M-4.5,-1 L4.5,-1 L3,2.5 L-3,2.5 Z" fill={fill} stroke={stroke} strokeWidth={0.8} />;
          else if (a.role === 'sensor') shape = <rect x={-3} y={-3} width={6} height={6} fill={fill} stroke={stroke} strokeWidth={0.8} />;
          else if (a.role === 'comms') shape = <path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill={fill} stroke={stroke} strokeWidth={0.8} />;
          else shape = <g><circle r={4} fill="#040912" stroke={stroke} strokeWidth={0.8} /><path d="M0,-2.6 L2.4,1.8 L-2.4,1.8 Z" fill={fill} /></g>;
          return (
            <g key={a.id} transform={`translate(${x},${y}) scale(${sc})`} className="cursor-pointer"
              onClick={clickGuard(() => ui.openAsset(a.id))}
              onMouseMove={(e) => showTip(e, (
                <div><div className="font-semibold text-white">{a.name}</div><div className="text-[10px] text-ops-dim">{a.className} · {DOMAIN_LABEL[a.domain]}</div>
                  <div className="mt-1 text-[10px]">Status <b style={{ color: fill }}>{a.status.toUpperCase()}</b> · Condition {a.condition.toFixed(0)}%</div>
                  <div className="text-[10px]">Service {a.hoursToService < 0 ? <span className="text-ops-red">OVERDUE {-a.hoursToService}h</span> : `due in ${a.hoursToService}h`}</div></div>
              ))}
              onMouseLeave={() => setHover(null)}>
              {sel && <circle r={8} fill="none" stroke="#fff" strokeWidth={0.8} />}
              {a.status === 'offline' && <circle r={6} fill="none" stroke={TONE_HEX.red} strokeWidth={0.8} className="blink" />}
              {shape}
              {layers.labels && k < 0.5 && <text x={6} y={-4} fontSize={5} fill="#9fb4cf">{a.name}</text>}
            </g>
          );
        })}

        {/* history layer */}
        {layers.history && s.events.filter((e) => !isActive(e) && e.resolvedAt !== undefined).slice(-80).map((e) => {
          const [x, y] = eventPoint(s, e);
          const col = e.status === 'resolved' ? TONE_HEX.green : e.status === 'escalated' ? TONE_HEX.red : '#5d7391';
          const sc = Math.max(0.4, k);
          return (
            <g key={`h${e.id}`} transform={`translate(${x},${y}) scale(${sc})`} opacity={0.75} className="cursor-pointer" onClick={clickGuard(() => ui.openEvent(e.id))}>
              {e.status === 'escalated' ? <path d="M-3,-3 L3,3 M3,-3 L-3,3" stroke={col} strokeWidth={1.4} /> : <circle r={2.4} fill="none" stroke={col} strokeWidth={1} />}
            </g>
          );
        })}

        {/* events */}
        {layers.events && activeEvents.filter((e) => !e.global).map((e) => {
          const [x, y] = eventPoint(s, e);
          const col = TONE_HEX[SEV_TONE[e.severity]];
          const uncertain = e.confidence < 60;
          const sc = Math.max(0.45, Math.min(1.1, k * 1.3));
          const conf = confidenceLabel(e.confidence);
          return (
            <g key={e.id} transform={`translate(${x},${y}) scale(${sc})`} className="cursor-pointer"
              onClick={clickGuard(() => ui.openEvent(e.id))}
              onMouseMove={(ev) => showTip(ev, (
                <div><div className="font-semibold text-white">{e.id} · {e.title}</div>
                  <div className="text-[10px]">Severity {e.reportedSeverity[0] === e.reportedSeverity[1] ? e.severity : `${e.reportedSeverity[0]}–${e.reportedSeverity[1]} (conflicting)`} · Confidence {Math.round(e.confidence)}% {conf.label}</div>
                  <div className="text-[10px] text-ops-dim">Status {e.status.toUpperCase()} · window closes T+{e.deadline}h</div></div>
              ))}
              onMouseLeave={() => setHover(null)}>
              {e.severity >= 3 && <circle r={7} fill="none" stroke={col} strokeWidth={1.2} className="pulse-ring" />}
              <circle r={5.5} fill={col} fillOpacity={uncertain ? 0.15 : 0.35} stroke={col} strokeWidth={1.2} strokeDasharray={uncertain ? '2 1.5' : undefined} />
              {e.status === 'responding' && <circle r={8} fill="none" stroke="#38d6f5" strokeWidth={1} strokeDasharray={`${(e.progress / 100) * 50} 50`} transform="rotate(-90)" />}
              {e.status === 'confirming' && <circle r={8} fill="none" stroke="#a78bfa" strokeWidth={1} strokeDasharray="1.5 2" className="radar-sweep" />}
              <text y={2.4} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#fff">{uncertain ? '?' : '!'}</text>
            </g>
          );
        })}

        {/* region labels */}
        {layers.labels && REGION_IDS.map((id) => {
          const r = s.regions[id];
          const [x, y] = project(r.center[0], r.center[1] - (id === 'POL' ? 0 : 6));
          const val = regionMetric(s, id, overlay);
          const fs = Math.max(4.5, 9 * Math.min(1, k * 1.2));
          return (
            <g key={`lbl${id}`} pointerEvents="none" transform={`translate(${x},${y})`}>
              <text textAnchor="middle" fontSize={fs} fontFamily="Rajdhani" fontWeight={700} fill="#c9d8ec" letterSpacing={1.5} style={{ paintOrder: 'stroke' }} stroke="#040912" strokeWidth={2}>{r.short}</text>
              {overlay !== 'none' && <text y={fs * 1.05} textAnchor="middle" fontSize={fs * 0.8} fill={TONE_HEX[tone(val)]} style={{ paintOrder: 'stroke' }} stroke="#040912" strokeWidth={2}>{Math.round(val)}</text>}
            </g>
          );
        })}
      </svg>

      {/* Global event banner */}
      {layers.events && globalEvents.length > 0 && (
        <div className="absolute left-1/2 top-2 flex -translate-x-1/2 flex-col gap-1">
          {globalEvents.map((e) => (
            <button key={e.id} onClick={() => ui.openEvent(e.id)} className="chip blink border-ops-red/60 bg-ops-red/15 px-3 py-1 text-[11px] text-ops-red">
              ◉ GLOBAL · {e.title} · {e.status.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* hover tooltip */}
      {hover && (
        <div className="pointer-events-none absolute z-20 max-w-[260px] rounded border border-ops-cyan/30 bg-ops-bg/95 px-2.5 py-1.5 text-[11px] shadow-xl" style={{ left: hover.x + 14, top: hover.y + 10 }}>{hover.content}</div>
      )}

      {/* zoom controls */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button className="btn h-7 w-7 p-0" onClick={() => zoomBy(0.7)} aria-label="Zoom in" title="Zoom in">＋</button>
        <button className="btn h-7 w-7 p-0" onClick={() => zoomBy(1.4)} aria-label="Zoom out" title="Zoom out">－</button>
        <button className="btn h-7 w-7 p-0" onClick={() => { ui.setRegion(null); animateTo(FULL); }} aria-label="Reset view" title="Global view">⌂</button>
      </div>

      {/* legend + layers */}
      <LegendPanel open={legendOpen} setOpen={setLegendOpen} />
      <div className="pointer-events-none absolute bottom-2 right-2 text-[10px] text-ops-dim">ZOOM {(MAP_W / view.w).toFixed(1)}x · SCROLL TO ZOOM · DRAG TO PAN</div>
    </div>
  );
}

function LegendPanel({ open, setOpen }: { open: boolean; setOpen: (b: boolean) => void }) {
  const { layers, toggleLayer, overlay, setOverlay } = useUI();
  const LAYER_LIST: [keyof Layers, string, string][] = [
    ['space', 'Space', DOMAIN_COLOR.space], ['air', 'Air', DOMAIN_COLOR.air], ['sea', 'Maritime', DOMAIN_COLOR.sea],
    ['ground', 'Ground sensors', DOMAIN_COLOR.ground], ['infrastructure', 'Infrastructure', '#34d399'], ['comms', 'Comms network', '#38d6f5'],
    ['sensors', 'Sensor coverage', '#38d6f5'], ['events', 'Intel events', '#f2545b'], ['history', 'Event history', '#5d7391'], ['labels', 'Labels', '#c9d8ec'],
  ];
  return (
    <div className="absolute bottom-2 left-2 max-h-[calc(100%-1rem)] w-56 overflow-y-auto rounded border border-ops-line bg-ops-bg/90 text-[11px] backdrop-blur">
      <button className="flex w-full items-center justify-between px-2 py-1.5 font-sans text-[12px] font-semibold uppercase tracking-widest text-ops-cyan" onClick={() => setOpen(!open)} aria-expanded={open}>
        Layers & Legend <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-ops-line p-2">
          <div>
            <div className="label mb-1">Region overlay</div>
            <select className="input w-full py-0.5" value={overlay} onChange={(e) => setOverlay(e.target.value as OverlayMetric)}>
              <option value="readiness">Readiness</option><option value="stability">Stability</option><option value="comms">Communications</option>
              <option value="awareness">Awareness</option><option value="infrastructure">Infrastructure</option><option value="none">None</option>
            </select>
          </div>
          <div className="grid grid-cols-1 gap-0.5">
            {LAYER_LIST.map(([k, label, col]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 hover:text-white">
                <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} className="accent-cyan-400" />
                <span className="h-2 w-2 rounded-sm" style={{ background: col }} />{label}
              </label>
            ))}
          </div>
          <div className="border-t border-ops-line pt-2">
            <div className="label mb-1">Asset condition</div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              {[['#34d399', 'Healthy'], ['#f5b13d', 'Degraded'], ['#f2545b', 'Offline / critical'], ['#e0f7ff', 'Restored (<12h)'], ['#5d7391', 'Maintenance'], ['#a78bfa', 'In transit']].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
              ))}
            </div>
            <div className="label mb-1 mt-2">Symbols</div>
            <div className="grid grid-cols-2 gap-1 text-[10px] text-ops-dim">
              <span>▲ Aircraft</span><span>⏢ Vessel</span><span>■ Sensor station</span><span>◆ Relay hub</span><span>◬ Command center</span><span>⊟ Satellite</span>
              <span className="text-ops-red">● Active event</span><span className="text-ops-amber">◌ Uncertain report</span>
              <span className="text-ops-red">◎ Critical (pulsing)</span><span>▨ Unstable region</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
