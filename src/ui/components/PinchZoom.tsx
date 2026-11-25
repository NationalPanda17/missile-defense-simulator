// Touch screens: pinch to zoom a map (up to 3x), drag to pan once zoomed, double-tap to zoom in or back out. With a
// mouse nothing changes. Taps still land where they look: the map works out positions from its on-screen transform.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const MAX = 3;

export function PinchZoom({ children, className = '' }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [z, setZ] = useState({ k: 1, x: 0, y: 0 });
  const zr = useRef(z);
  zr.current = z;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let start: { d: number; mx: number; my: number; k: number; x: number; y: number } | null = null;
    let pan: { px: number; py: number; x: number; y: number } | null = null;
    let lastTap = 0;
    const clamp = (k: number, x: number, y: number) => {
      const w = el.clientWidth, h = el.clientHeight;
      return { k, x: Math.min(0, Math.max(w - w * k, x)), y: Math.min(0, Math.max(h - h * k, y)) };
    };
    const local = (t: Touch) => { const r = el.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top] as const; };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [a, b] = [local(e.touches[0]), local(e.touches[1])];
        start = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, ...zr.current };
        pan = null;
      } else if (e.touches.length === 1) {
        const [px, py] = local(e.touches[0]);
        const now = Date.now();
        if (now - lastTap < 300) {
          // Double-tap: zoom to 2x around the tap, or back out.
          const c = zr.current;
          const k = c.k > 1 ? 1 : 2;
          setZ(clamp(k, px - ((px - c.x) / c.k) * k, py - ((py - c.y) / c.k) * k));
          lastTap = 0;
          e.preventDefault();
          return;
        }
        lastTap = now;
        if (zr.current.k > 1) pan = { px, py, x: zr.current.x, y: zr.current.y };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (start && e.touches.length === 2) {
        e.preventDefault();
        const [a, b] = [local(e.touches[0]), local(e.touches[1])];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const k = Math.max(1, Math.min(MAX, start.k * (d / start.d)));
        // Keep the point under the fingers' midpoint where it is.
        const cx = (start.mx - start.x) / start.k, cy = (start.my - start.y) / start.k;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        setZ(clamp(k, mx - cx * k, my - cy * k));
      } else if (pan && e.touches.length === 1) {
        e.preventDefault();
        const [px, py] = local(e.touches[0]);
        setZ(clamp(zr.current.k, pan.x + px - pan.px, pan.y + py - pan.py));
      }
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) start = null; if (!e.touches.length) pan = null; };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); };
  }, []);
  return (
    <div>
      <div ref={box} className={`relative overflow-hidden ${className}`} style={{ touchAction: z.k > 1 ? 'none' : 'pan-y' }}>
        <div style={{ transform: `translate(${z.x}px,${z.y}px) scale(${z.k})`, transformOrigin: '0 0' }}>{children}</div>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-ops-dim [@media(pointer:fine)]:hidden">
        <span>Pinch to zoom, double-tap to zoom in or out{z.k > 1 ? ', drag to move' : ''}.</span>
        {z.k > 1 && <button className="btn px-2" onClick={() => setZ({ k: 1, x: 0, y: 0 })}>Reset zoom</button>}
      </div>
    </div>
  );
}
