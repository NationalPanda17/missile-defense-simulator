// Map symbols for the theater: a framed icon per kind of system, and site markers with an integrity ring.
import type { DefenseLayer, EquipmentSpec, SiteType } from '../../../engine';

export const LAYER_COLOR: Record<DefenseLayer, string> = {
  detection: '#a78bfa',
  pointDefense: '#34d399',
  directedEnergy: '#f5b13d',
  shortMedium: '#38d6f5',
  long: '#3b82f6',
  upper: '#f2545b',
};

export type IconKind = 'radar' | 'aew' | 'gun' | 'manpads' | 'interceptor' | 'ew' | 'laser' | 'launcher' | 'ship' | 'listener';

/** Which symbol a system uses, from what it does. */
export function iconKind(spec: EquipmentSpec): IconKind {
  if (spec.domain === 'sea') return 'ship';
  if (spec.domain === 'air') return 'aew';
  if (spec.id === 'acoustic-net' || spec.id === 'passive-rf') return 'listener';
  if (spec.layer === 'detection') return 'radar';
  if (spec.layer === 'directedEnergy') return 'laser';
  if (spec.id === 'ew-jammer' || spec.id === 'hpm') return 'ew';
  if (spec.id === 'coyote') return 'interceptor';
  if (spec.id === 'stinger' || spec.id === 'avenger') return 'manpads';
  if (['zu-23-2', 'gepard', 'skynex'].includes(spec.id)) return 'gun';
  return 'launcher';
}

/** Missiles drawn on a launcher: more for higher tiers. */
const launcherTubes = (layer: DefenseLayer) => (layer === 'upper' ? 4 : layer === 'long' ? 3 : 2);

/** The glyph inside the frame, drawn in a 22×22 box centred on (0,0). */
function Glyph({ kind, layer, color }: { kind: IconKind; layer: DefenseLayer; color: string }) {
  const line = { fill: 'none', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'radar':
      return <g {...line}><path d="M-6,5 L6,5 M0,5 L0,0" /><path d="M-6.5,-2.5 Q0,-10 6.5,-2.5 Z" fill={color} fillOpacity={0.25} /><path d="M0,-2.5 L3,-6" /></g>;
    case 'aew':
      return <g {...line}><path d="M0,-7 L0,7 M-7,1 L0,-1 L7,1 M-3,6 L0,5 L3,6" /><ellipse cx={0} cy={-1} rx={4.5} ry={1.6} fill={color} fillOpacity={0.35} /></g>;
    case 'gun':
      return <g {...line}><rect x={-5} y={0} width={10} height={5} rx={1} fill={color} fillOpacity={0.25} /><path d="M-1.5,0 L4,-7 M1.5,0 L7,-6" /></g>;
    case 'manpads':
      return <g {...line}><path d="M-6,5 L6,-5" strokeWidth={2.6} /><path d="M4,-7 L8,-7 L8,-3" /><circle cx={-4} cy={-3} r={1.6} fill={color} /></g>;
    case 'interceptor':
      return <g {...line}><path d="M0,-7 L5,5 L0,2.5 L-5,5 Z" fill={color} fillOpacity={0.3} /><path d="M-7,-1 L7,-1" strokeWidth={1.2} /></g>;
    case 'ew':
      return <g {...line}><circle cx={-4} cy={2} r={1.6} fill={color} /><path d="M-1,-1 Q2,2 -1,5 M1.5,-4 Q6,2 1.5,8" transform="translate(0,-2)" /></g>;
    case 'laser':
      return <g {...line}><rect x={-6} y={1} width={6} height={5} rx={1} fill={color} fillOpacity={0.3} /><path d="M0,2 L7,-6" strokeDasharray="2 1.5" strokeWidth={2} /></g>;
    case 'ship':
      return <g {...line}><path d="M-7,2 L7,2 L5,6 L-5,6 Z" fill={color} fillOpacity={0.3} /><path d="M-3,2 L-3,-1 L3,-1 L3,2 M0,-1 L0,-6 M-2,-4.5 L2,-4.5" /></g>;
    case 'listener':
      return <g {...line}><circle cx={0} cy={0} r={1.8} fill={color} /><path d="M-4,-4 A5.6,5.6 0 0 0 -4,4 M4,-4 A5.6,5.6 0 0 1 4,4 M-6.5,-6.5 A9,9 0 0 0 -6.5,6.5 M6.5,-6.5 A9,9 0 0 1 6.5,6.5" strokeWidth={1.2} /></g>;
    case 'launcher': {
      const n = launcherTubes(layer);
      return (
        <g {...line}>
          <path d="M-7,5 L7,5" />
          {Array.from({ length: n }, (_, i) => {
            const x = -5 + (i * 10) / Math.max(1, n - 1) * (n > 1 ? 1 : 0);
            return <path key={i} d={`M${x - 2},4 L${x + 2},-5`} strokeWidth={1.8} />;
          })}
          {layer === 'upper' && <circle cx={0} cy={-7} r={1.2} fill={color} />}
        </g>
      );
    }
  }
}

/**
 * A placed system: rounded frame in its layer colour, a glyph for what it does, a rounds bar along the bottom and a
 * status light. `stock` is 0-1 (undefined for sensors and unlimited systems).
 */
export function SystemIcon({ spec, stock, status, selected, dim }: {
  spec: EquipmentSpec;
  stock?: number;
  status: 'ok' | 'degraded' | 'down';
  selected?: boolean;
  dim?: boolean;
}) {
  const col = LAYER_COLOR[spec.layer];
  const kind = iconKind(spec);
  const light = status === 'ok' ? '#34d399' : status === 'degraded' ? '#f5b13d' : '#f2545b';
  return (
    <g opacity={dim ? 0.45 : 1}>
      <rect x={-11} y={-11} width={22} height={22} rx={kind === 'ship' || kind === 'aew' ? 11 : 4} fill="#07121f" stroke={selected ? '#ffffff' : col} strokeWidth={selected ? 2.2 : 1.6} />
      <Glyph kind={kind} layer={spec.layer} color={col} />
      {stock !== undefined && (
        <g>
          <rect x={-8} y={8.2} width={16} height={1.8} rx={0.9} fill="#1b2c47" />
          <rect x={-8} y={8.2} width={16 * Math.max(0, Math.min(1, stock))} height={1.8} rx={0.9} fill={stock > 0.5 ? '#34d399' : stock > 0.2 ? '#f5b13d' : '#f2545b'} />
        </g>
      )}
      <circle cx={8.5} cy={-8.5} r={2.6} fill={light} stroke="#07121f" strokeWidth={1} />
    </g>
  );
}

/** Small SVG icon per site type, drawn around (0,0). */
export function SiteIcon({ type, color }: { type: SiteType; color: string }) {
  const stroke = { stroke: '#040912', strokeWidth: 1.5, paintOrder: 'stroke' as const };
  switch (type) {
    case 'city': return <g><rect x={-6} y={-2} width={4} height={7} fill={color} {...stroke} /><rect x={-1.5} y={-6} width={4} height={11} fill={color} {...stroke} /><rect x={3} y={0} width={3.5} height={5} fill={color} {...stroke} /></g>;
    case 'port': return <g fill="none" stroke={color} strokeWidth={2}><circle cy={-5} r={2.5} /><path d="M0,-2.5 V7 M-6,2 Q0,9 6,2 M-3.5,0 H3.5" /></g>;
    case 'power': return <path d="M2,-8 L-5,1 L0,1 L-2,8 L5,-1 L0,-1 Z" fill={color} {...stroke} />;
    case 'comms': return <g><path d="M0,7 L-4,7 L0,-4 L4,7 Z" fill="none" stroke={color} strokeWidth={1.6} /><path d="M-4,-6 Q0,-9 4,-6 M-6,-8 Q0,-12 6,-8" fill="none" stroke={color} strokeWidth={1.2} /></g>;
    case 'command': return <path d="M0,-8 L2.2,-2.5 L8,-2.5 L3.4,1 L5,7 L0,3.6 L-5,7 L-3.4,1 L-8,-2.5 L-2.2,-2.5 Z" fill={color} {...stroke} />;
  }
}

/** A site: icon on a dark disc with an integrity ring that empties as the site is damaged. */
export function SiteMarker({ type, integrity, important }: { type: SiteType; integrity: number; important: boolean }) {
  const col = integrity > 60 ? '#dbe7f6' : integrity > 25 ? '#f5b13d' : '#f2545b';
  const r = important ? 12 : 10.5;
  const c = 2 * Math.PI * r;
  return (
    <g>
      <circle r={r} fill="#07121f" fillOpacity={0.85} stroke="#2a3d5c" strokeWidth={1} />
      <circle r={r} fill="none" stroke={col} strokeWidth={2} strokeDasharray={`${(c * Math.max(0, integrity)) / 100} ${c}`} transform="rotate(-90)" strokeLinecap="round" />
      <SiteIcon type={type} color={col} />
    </g>
  );
}
