// The adjutant's advice in the sidebar and the briefing, with its on/off setting.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { adjutantApplies, advise, type Advice, type SimState } from '../engine';
import { store } from '../store/simStore';
import { useUI, type ViewId } from './uiState';

// ── Setting: on by default, except at Commander level where it starts off. ──
const KEY = 'mds.adjutant';
type Pref = 'on' | 'off';
const listeners = new Set<() => void>();
let pref: Pref | null = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch { return null; }
})();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function adjutantOn(s: SimState): boolean {
  if (!adjutantApplies(s)) return false;
  if (pref) return pref === 'on';
  return s.settings.level !== 'commander';
}

export function setAdjutant(on: boolean) {
  pref = on ? 'on' : 'off';
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

// Dismissed advice, per scenario: it stays dismissed until the situation changes (its id changes).
const dismissed = new Map<string, Set<string>>();
const dismissedFor = (s: SimState) => {
  const k = s.campaignId ?? s.settings.name;
  if (!dismissed.has(k)) dismissed.set(k, new Set());
  return dismissed.get(k)!;
};

const TONE: Record<Advice['level'], string> = {
  urgent: 'border-ops-red/60 bg-ops-red/10 text-ops-red',
  warn: 'border-ops-amber/50 bg-ops-amber/5 text-ops-amber',
  info: 'border-ops-line text-ops-cyan',
};
const ICON: Record<Advice['level'], string> = { urgent: '⚠', warn: '▲', info: '●' };

/** The current advice the player hasn't dismissed. */
export function useAdvice(s: SimState): Advice[] {
  useSyncExternalStore(subscribe, () => pref);
  if (!adjutantOn(s)) return [];
  const gone = dismissedFor(s);
  return advise(s).filter((a) => !gone.has(a.id));
}

export function AdviceList({ s, items, onDeploy, compact }: { s: SimState; items: Advice[]; onDeploy?: () => void; compact?: boolean }) {
  const ui = useUI();
  const [, force] = useState(0);
  const go = (a: Advice) => {
    const act = a.action;
    if (!act) return;
    if (act.deploy && onDeploy) return onDeploy();
    if (act.region && act.view === 'theater') ui.setTheaterFocus(act.region);
    ui.setView(act.view as ViewId);
    if (act.eventId) ui.openEvent(act.eventId);
    if (act.assetId) ui.openAsset(act.assetId);
  };
  const dismiss = (a: Advice) => {
    dismissedFor(s).add(a.id);
    force((x) => x + 1);
  };
  return (
    <ul className="space-y-1.5">
      {items.slice(0, compact ? 3 : 6).map((a) => (
        <li key={a.id} className={`flex items-start gap-2 rounded border p-2 text-[11px] ${TONE[a.level]}`}>
          <span aria-hidden className="mt-px">{ICON[a.level]}</span>
          <span className="sr-only">{a.level === 'urgent' ? 'Urgent:' : a.level === 'warn' ? 'Warning:' : 'Note:'}</span>
          <span className="min-w-0 flex-1 leading-relaxed text-ops-text">{a.text}</span>
          <span className="flex shrink-0 gap-1">
            {a.action && <button className="btn px-1.5 py-0 text-[10px]" onClick={() => go(a)}>{a.action.deploy && onDeploy ? 'Deploy' : a.action.label}</button>}
            <button className="btn px-1.5 py-0 text-[10px]" onClick={() => dismiss(a)} aria-label="Dismiss advice" title="Dismiss until this changes">✕</button>
          </span>
        </li>
      ))}
      {items.length > (compact ? 3 : 6) && <li className="text-[10px] text-ops-dim">+{items.length - (compact ? 3 : 6)} more</li>}
    </ul>
  );
}

/** Sidebar section. Announces new urgent advice with a toast so it isn't missed while looking elsewhere. */
export function AdjutantSection({ s }: { s: SimState }) {
  const on = useSyncExternalStore(subscribe, () => adjutantOn(s));
  const items = useAdvice(s);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const a of items) {
      if (a.level !== 'urgent' || seen.current.has(a.id)) continue;
      seen.current.add(a.id);
      if (s.status === 'running') store.toast('err', `Adjutant: ${a.text}`);
    }
  }, [items, s.status]);
  if (!adjutantApplies(s)) return null;
  return (
    <div className="border-b border-ops-line px-3 py-2" aria-label="Adjutant">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-ops-cyan">
          Adjutant{on && items.length > 0 && <span className="ml-1.5 text-ops-dim">({items.length})</span>}
        </span>
        <button role="switch" aria-checked={on} className={`btn px-1.5 py-0 text-[10px] ${on ? 'btn-active' : ''}`} onClick={() => setAdjutant(!on)}
          title="The adjutant points out things you might miss">{on ? 'On' : 'Off'}</button>
      </div>
      {!on ? <div className="text-[10px] text-ops-dim">Off. Turn on for reminders about low magazines, overdue service and reports about to escalate.</div>
        : items.length ? <AdviceList s={s} items={items} />
          : <div className="text-[11px] text-ops-dim">Nothing needs your attention.</div>}
    </div>
  );
}
