// Display and accessibility settings, kept in this browser and applied to <html> before the first render.
import { store } from '../../store/simStore';
import { describeChanges, type AnnounceMemo } from './announce';

const KEY = 'mds.a11y';
export interface A11ySettings { contrast: boolean; reduceMotion: boolean; announce: boolean }
const DEFAULTS: A11ySettings = { contrast: false, reduceMotion: false, announce: true };

let current: A11ySettings = load();
const listeners = new Set<() => void>();

function load(): A11ySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<A11ySettings>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export const a11y = () => current;
export function subscribeA11y(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function setA11y(p: Partial<A11ySettings>) {
  current = { ...current, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  apply();
  listeners.forEach((f) => f());
}

function apply() {
  const el = document.documentElement;
  el.classList.toggle('hc', current.contrast);
  el.classList.toggle('reduce-motion', current.reduceMotion);
}

/** Live regions a screen reader reads out: polite for news, assertive for attacks and critical reports. */
function liveRegion(level: 'polite' | 'assertive'): HTMLElement {
  const id = `mds-live-${level}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.setAttribute('aria-live', level);
    el.setAttribute('role', level === 'assertive' ? 'alert' : 'status');
    el.className = 'sr-only';
    document.body.appendChild(el);
  }
  return el;
}

function say(level: 'polite' | 'assertive', lines: string[]) {
  if (!lines.length) return;
  const el = liveRegion(level);
  // At high speed many things happen at once: read the first few and summarise the rest.
  const text = lines.length > 3 ? `${lines.slice(0, 3).join(' ')} And ${lines.length - 3} more updates.` : lines.join(' ');
  el.textContent = '';
  window.setTimeout(() => { el.textContent = text; }, 50);
}

export function installA11y() {
  if (typeof window === 'undefined') return;
  apply();
  let memo: AnnounceMemo | null = null;
  store.subscribe(() => {
    const s = store.state;
    if (!s) { memo = null; return; }
    const r = describeChanges(memo, s);
    memo = r.memo;
    if (!current.announce) return;
    say('assertive', r.out.assertive);
    say('polite', r.out.polite);
  });
}
