// The front page for a finished phase: a headline and a few short stories written from what happened.
import { useState } from 'react';
import { dispatchText, phaseDispatch, type SimState } from '../engine';

export function DispatchCard({ s, phaseIndex, compact = false }: { s: SimState; phaseIndex: number; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const d = phaseDispatch(s, phaseIndex);
  if (!d) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dispatchText(d));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable: nothing to do */ }
  };
  return (
    <article className="rounded border border-[#cbbf9f]/40 bg-[#efe6cf]/[0.06] p-3" aria-label={`News report for phase ${d.phase}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#cbbf9f]/30 pb-1">
        <span className="font-serif text-[13px] font-bold uppercase tracking-[0.25em] text-[#e9dfc4]">The Meridian Dispatch</span>
        <span className="flex items-center gap-2 text-[10px] text-ops-dim">
          Phase {d.phase} · {d.phaseName}
          <button className="btn px-1.5 py-0 text-[10px]" onClick={copy} title="Copy this report as text">{copied ? 'Copied' : 'Copy'}</button>
        </span>
      </header>
      <h3 className="mt-2 font-serif text-[clamp(1.1rem,3vw,1.6rem)] font-bold leading-tight text-white">{d.headline}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-ops-text">{d.deck}</p>
      {d.stories.length > 0 && (
        <div className={`mt-2 grid gap-x-4 gap-y-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
          {d.stories.map((x) => (
            <section key={x.title} className="text-[11px] leading-relaxed">
              <h4 className="font-semibold text-[#e9dfc4]">{x.title}</h4>
              <p className="text-ops-dim">{x.text}</p>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
