// Button with display and accessibility settings: high contrast, reduced motion, screen-reader announcements.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { a11y, setA11y, subscribeA11y } from './settings';
import { PacingSettings } from '../PausePrompt';

export function DisplaySettings() {
  const st = useSyncExternalStore(subscribeA11y, a11y);
  const row = (label: string, desc: string, on: boolean, set: (v: boolean) => void) => (
    <div className="flex items-start justify-between gap-3">
      <div><div className="text-white">{label}</div><div className="text-[10px] leading-relaxed text-ops-dim">{desc}</div></div>
      <button role="switch" aria-checked={on} aria-label={label} className={`btn shrink-0 ${on ? 'btn-active' : ''}`} onClick={() => set(!on)}>{on ? 'On' : 'Off'}</button>
    </div>
  );
  return (
    <div className="space-y-3 text-[11px]">
      {row('High contrast', 'Brighter text and borders, solid panels.', st.contrast, (v) => setA11y({ contrast: v }))}
      {row('Reduce motion', 'Stops pulsing, sweeping and gliding animations. Threats still move on the map.', st.reduceMotion, (v) => setA11y({ reduceMotion: v }))}
      {row('Screen-reader announcements', 'Reads out new reports, launches, wave results and phase changes.', st.announce, (v) => setA11y({ announce: v }))}
    </div>
  );
}

export function DisplayControl() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className="btn px-2" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" title="Display & accessibility" aria-label="Display and accessibility settings">
        <span aria-hidden className="font-sans text-[13px] font-bold normal-case leading-none">Aa</span>
      </button>
      {/* Dim the page behind the popover, and close it on a click outside. */}
      {open && createPortal(<div className="fixed inset-0 z-[35] bg-black/40" aria-hidden onMouseDown={() => setOpen(false)} />, document.body)}
      {open && (
        <div role="dialog" aria-label="Display and accessibility" className="panel fadein absolute right-0 top-full z-[60] mt-1 max-h-[80vh] w-72 overflow-y-auto border-ops-cyan/40 bg-ops-panel p-3">
          <div className="label mb-2">Display & accessibility</div>
          <DisplaySettings />
          <div className="label mb-2 mt-4">Auto-pause</div>
          <PacingSettings />
        </div>
      )}
    </div>
  );
}
