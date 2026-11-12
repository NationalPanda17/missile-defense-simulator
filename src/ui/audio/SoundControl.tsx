// Speaker button with mute and volume sliders for effects and music.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { sound } from './sound';

let version = 0;
const sub = (f: () => void) => sound.subscribe(() => { version++; f(); });
const useSound = () => useSyncExternalStore(sub, () => version);

export function SoundControl() {
  useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = sound.settings;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const off = st.muted || (st.sfx === 0 && st.music === 0);
  return (
    <div ref={ref} className="relative">
      <button className={`btn px-2 ${off ? '' : 'text-ops-cyan'}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog"
        title={`Sound: ${off ? 'off' : 'on'} (V to mute)`} aria-label={`Sound settings, sound ${off ? 'off' : 'on'}`}>
        <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden className="inline-block align-[-2px]">
          <path d="M1 5h3l4-3.5v11L4 9H1z" fill="currentColor" />
          {off ? <path d="M10.5 4.5l4.5 5M15 4.5l-4.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            : <path d="M10.5 4.5a3 3 0 010 5M12.5 2.5a6 6 0 010 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Sound" className="panel fadein absolute right-0 top-full z-[60] mt-1 w-60 space-y-3 border-ops-cyan/40 bg-ops-panel p-3 text-[11px]">
          <label className="flex items-center justify-between gap-2">
            <span className="label">Sound</span>
            <button className={`btn ${st.muted ? '' : 'btn-active'}`} onClick={() => sound.toggleMute()} aria-pressed={!st.muted}>{st.muted ? 'Off' : 'On'}</button>
          </label>
          <Slider label="Effects" value={st.sfx} onChange={(v) => { sound.update({ sfx: v, muted: false }); sound.cue('report'); }} />
          <Slider label="Music" value={st.music} onChange={(v) => sound.update({ music: v, muted: false })} />
          <p className="text-[10px] leading-relaxed text-ops-dim">
            Effects mark new reports, your orders, launches, interceptions and hits. The music gets tenser as the alert level rises.
            {!sound.started && ' Sound starts after your first click.'} Press V to mute.
          </p>
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="flex justify-between"><span className="label">{label}</span><span className="tabular-nums text-ops-dim">{Math.round(value * 100)}%</span></span>
      <input type="range" min={0} max={1} step={0.05} value={value} className="w-full accent-[#38d6f5]" onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
