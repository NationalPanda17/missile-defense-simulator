// Reusable presentational primitives.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Asset, Domain, Severity } from '../../engine';

/** Meters move over one simulated hour at the current speed (--tick, set by the store), so values flow rather than jump. */
export const GLIDE = { transitionDuration: 'var(--tick, 400ms)', transitionTimingFunction: 'linear' } as const;

export const tone = (v: number) => (v >= 75 ? 'green' : v >= 55 ? 'cyan' : v >= 35 ? 'amber' : 'red');
export const TONE_HEX = { green: '#34d399', cyan: '#38d6f5', amber: '#f5b13d', red: '#f2545b', dim: '#7088a8', violet: '#a78bfa', blue: '#3b82f6' };
export const TONE_TEXT = { green: 'text-ops-green', cyan: 'text-ops-cyan', amber: 'text-ops-amber', red: 'text-ops-red', dim: 'text-ops-dim' };
export const TONE_CHIP = {
  green: 'border-ops-green/50 text-ops-green bg-ops-green/10',
  cyan: 'border-ops-cyan/50 text-ops-cyan bg-ops-cyan/10',
  amber: 'border-ops-amber/50 text-ops-amber bg-ops-amber/10',
  red: 'border-ops-red/50 text-ops-red bg-ops-red/10',
  dim: 'border-ops-line text-ops-dim bg-transparent',
};
export const SEV_TONE: Record<Severity, keyof typeof TONE_CHIP> = { 1: 'cyan', 2: 'amber', 3: 'red', 4: 'red' };
export const DOMAIN_COLOR: Record<Domain, string> = { space: '#a78bfa', air: '#38d6f5', sea: '#3b82f6', ground: '#34d399' };
export const DOMAIN_LABEL: Record<Domain, string> = { space: 'Space', air: 'Air', sea: 'Maritime', ground: 'Ground' };

export function Panel({ title, right, children, className = '', bodyClass = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel flex min-h-0 flex-col ${className}`}>
      {title && (
        <header className="panel-title">
          <span className="truncate">{title}</span>
          {right && <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] normal-case tracking-normal text-ops-dim">{right}</span>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass || 'p-3'}`}>{children}</div>
    </section>
  );
}

export function Bar({ value, max = 100, color, height = 6, showValue = false }: { value: number; max?: number; color?: string; height?: number; showValue?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const c = color ?? TONE_HEX[tone(pct)];
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-full overflow-hidden rounded-sm bg-ops-line/60" style={{ height }}>
        <div className="absolute inset-y-0 left-0 rounded-sm transition-[width]" style={{ width: `${pct}%`, background: c, boxShadow: `0 0 8px ${c}55`, ...GLIDE }} />
      </div>
      {showValue && <span className="w-8 shrink-0 text-right tabular-nums" style={{ color: c }}>{Math.round(value)}</span>}
    </div>
  );
}

export function Stat({ label, value, unit, t, sub, full }: { label: string; value: ReactNode; unit?: string; t?: keyof typeof TONE_TEXT; sub?: ReactNode; full?: string }) {
  return (
    <div className="min-w-0" title={full}>
      <div className="label truncate">{label}</div>
      {full && <span className="sr-only">{full}</span>}
      <div className={`font-sans text-xl font-semibold tabular-nums leading-tight ${t ? TONE_TEXT[t] : 'text-white'}`}>
        {value}
        {unit && <span className="ml-0.5 text-xs text-ops-dim">{unit}</span>}
      </div>
      {sub && <div className="truncate text-[10px] text-ops-dim">{sub}</div>}
    </div>
  );
}

export function Chip({ t = 'dim', children, title }: { t?: keyof typeof TONE_CHIP; children: ReactNode; title?: string }) {
  return <span title={title} className={`chip ${TONE_CHIP[t]}`}>{children}</span>;
}

export function Gauge({ value, label, size = 96 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 8;
  const c = Math.PI * r * 1.5;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const col = TONE_HEX[tone(value)];
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.82} viewBox={`0 0 ${size} ${size * 0.82}`} role="img" aria-label={`${label} ${Math.round(value)}%`}>
        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1b2c47" strokeWidth={7} strokeDasharray={`${c} ${Math.PI * 2 * r}`} strokeLinecap="round" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={7} strokeDasharray={`${c * pct} ${Math.PI * 2 * r}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray var(--tick, 400ms) linear', filter: `drop-shadow(0 0 4px ${col}88)` }} />
        </g>
        <text x="50%" y={size / 2 + 4} textAnchor="middle" fill="#fff" fontSize={size / 4.2} fontFamily="Rajdhani" fontWeight={700}>{Math.round(value)}</text>
      </svg>
      <div className="label -mt-1">{label}</div>
    </div>
  );
}

export interface Series { name: string; color: string; data: number[] }

export function LineChart({ series, height = 140, xLabels, yMax = 100, startHour = 0 }: { series: Series[]; height?: number; xLabels?: (i: number) => string; yMax?: number; startHour?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(120, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const n = Math.max(...series.map((s) => s.data.length), 2);
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (i / (n - 1)) * iw;
  const y = (v: number) => pad.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;
  const label = xLabels ?? ((i: number) => `T+${startHour + i}h`);
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={height} onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left - pad.l) / iw) * (n - 1));
        setHover(i >= 0 && i < n ? i : null);
      }}>
        {[0, 25, 50, 75, 100].map((g) => {
          const v = (g / 100) * yMax;
          return (
            <g key={g}>
              <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="#1b2c47" strokeDasharray="2 4" />
              <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#7088a8">{Math.round(v)}</text>
            </g>
          );
        })}
        {[...new Set([0, Math.floor((n - 1) / 2), n - 1])].map((i) => (
          <text key={i} x={x(i)} y={height - 4} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={9} fill="#7088a8">{label(i)}</text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} style={{ filter: `drop-shadow(0 0 3px ${s.color}66)` }} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#38d6f5" strokeOpacity={0.5} />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-1 z-10 rounded border border-ops-line bg-ops-bg/95 px-2 py-1 text-[10px] shadow-lg" style={{ left: Math.min(x(hover) + 8, w - 130) }}>
          <div className="text-ops-dim">{label(hover)}</div>
          {series.map((s) => (
            <div key={s.name} className="flex justify-between gap-3"><span style={{ color: s.color }}>{s.name}</span><span className="tabular-nums">{s.data[hover]?.toFixed(1) ?? '—'}</span></div>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-[10px] text-ops-dim"><span className="h-[2px] w-3" style={{ background: s.color }} />{s.name}</span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ data, color = '#38d6f5', w = 80, h = 22 }: { data: number[]; color?: string; w?: number; h?: number }) {
  if (data.length < 2) return <svg width={w} height={h} />;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (Math.max(0, Math.min(100, v)) / 100) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide = false, tall = false, footer }: { title: ReactNode; onClose?: () => void; children: ReactNode; wide?: boolean; tall?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  // Portalled to <body>: a `fixed` element inside a panel with backdrop-filter would be positioned relative to
  // that panel instead of the viewport.
  return createPortal(
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-[2px] sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`panel fadein flex max-h-full w-full flex-col ${wide ? 'max-w-5xl' : 'max-w-2xl'} ${tall ? 'h-full' : ''} border-ops-cyan/30 bg-ops-panel`} role="dialog" aria-modal="true">
        <header className="panel-title">
          <span className="truncate">{title}</span>
          {onClose && <button className="btn px-2" onClick={onClose} aria-label="Close">✕</button>}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-ops-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`btn whitespace-nowrap ${value === t.id ? 'btn-active' : ''}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export const fmtHour = (h: number) => `T+${h}h`;
export function simClock(start: number, hour: number) {
  const d = new Date(start + Math.floor(hour * 60) * 60_000); // fractional hours give minutes
  const m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return {
    date: `${String(d.getUTCDate()).padStart(2, '0')} ${m} ${d.getUTCFullYear()}`,
    time: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`,
  };
}

/** Map/list colour for an asset's status. */
export function statusColor(a: Asset, hour: number) {
  if (a.status === 'maintenance') return '#7088a8';
  if (a.status === 'transit') return '#a78bfa';
  if (a.restoredAt !== undefined && hour - a.restoredAt < 12) return '#e0f7ff';
  if (a.status === 'offline') return TONE_HEX.red;
  if (a.status === 'degraded') return TONE_HEX.amber;
  return TONE_HEX.green;
}

/**
 * A delete button that asks first: the first click turns it into "Delete?", a second click within a few seconds
 * deletes. Moving away or waiting six seconds cancels.
 */
export function ConfirmDelete({ onConfirm, label, text = '✕', confirmText = 'Delete?', className = '' }: { onConfirm: () => void; label: string; text?: string; confirmText?: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 6000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`btn ${armed ? 'btn-danger' : ''} ${className}`} aria-label={armed ? `Confirm: ${label}` : label} title={label}
      onClick={(e) => { e.stopPropagation(); if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      onBlur={() => setArmed(false)}>
      {armed ? confirmText : text}
    </button>
  );
}

/** How each live objective state is drawn. "On track" is not "met": levels are measured, and paid, at phase end. */
export const OBJECTIVE_LOOK = {
  done: { icon: '✔', cls: 'text-ops-green', bar: '#34d399', title: 'Done: counts toward the phase result.' },
  'on-track': { icon: '◐', cls: 'text-ops-cyan', bar: '#38d6f5', title: 'On track: meets the target now, but it is measured when the phase ends.' },
  behind: { icon: '○', cls: 'text-white', bar: '#f5b13d', title: 'Not there yet.' },
  missed: { icon: '✘', cls: 'text-ops-red', bar: '#f87171', title: 'Missed: this one can no longer be met this phase.' },
} as const;
