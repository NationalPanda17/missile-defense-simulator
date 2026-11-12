// Challenge links: share a run's starting world with a friend, and accept one from a link.
import { useState } from 'react';
import { COMMAND_LEVELS, challengeOf, challengeSettings, computeScore, decodeChallenge, encodeChallenge, type Challenge, type SimState } from '../engine';
import { store } from '../store/simStore';
import { useUI } from './uiState';

// Read ?challenge= once, then take it out of the address bar so a reload doesn't ask again.
let pending: Challenge | null = null;
if (typeof window !== 'undefined') {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('challenge');
  if (code) {
    pending = decodeChallenge(code);
    url.searchParams.delete('challenge');
    window.history.replaceState(null, '', url.toString());
  }
}

const describe = (c: Challenge) =>
  [c.mode === 'campaign' ? 'Campaign' : 'Crisis', c.level && COMMAND_LEVELS[c.level].label, c.scenario].filter(Boolean).join(' · ');

/** "You've been challenged" card, shown once after opening a challenge link. */
export function ChallengeInvite() {
  const ui = useUI();
  const [c, setC] = useState(pending);
  if (!c) return null;
  const close = () => { pending = null; setC(null); };
  return (
    <div className="fixed inset-x-2 top-2 z-[58] mx-auto max-w-md rounded border border-ops-amber/60 bg-ops-panel p-3 shadow-2xl sm:top-4" role="dialog" aria-label="Challenge">
      <div className="label text-ops-amber">You’ve been challenged</div>
      <div className="mt-1 font-sans text-lg font-semibold text-white">{describe(c)}</div>
      <p className="mt-1 text-[11px] leading-relaxed text-ops-dim">
        Same starting world, same seed{c.mode === 'campaign' ? ' and the same threat scenario' : ''}.
        {c.score !== undefined ? <> Score to beat: <b className="text-white">{c.score.toFixed(1)}</b>{c.grade ? ` (${c.grade})` : ''}.</> : ' No score was shared.'}
        {store.state && ' Accepting starts a new game; save your current one first if you want to keep it.'}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn" onClick={close}>Not now</button>
        <button className="btn btn-primary" onClick={() => { store.newGame(challengeSettings(c)); ui.setView('global'); close(); }}>Accept challenge ▶</button>
      </div>
    </div>
  );
}

/** In the after-action review: the score to beat, and a link to challenge someone with this run. */
export function ChallengePanel({ s }: { s: SimState }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const score = computeScore(s);
  const final = s.status === 'complete';
  const c = challengeOf(s, final ? score : undefined);
  const vs = s.settings.challenge;
  if (!c) return null;
  const share = async () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('challenge', encodeChallenge(c));
    const text = url.toString();
    setLink(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { setCopied(false); }
  };
  return (
    <div className="space-y-2">
      {vs && vs.score >= 0 && (
        <div className={`rounded border p-2 text-[12px] ${final ? (score.total >= vs.score ? 'border-ops-green/60 text-ops-green' : 'border-ops-amber/60 text-ops-amber') : 'border-ops-line text-ops-dim'}`}>
          Challenge: you {score.total.toFixed(1)} vs {vs.score.toFixed(1)}
          {final ? (score.total >= vs.score ? ' — you beat it!' : ' — not this time.') : ' (so far)'}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={share} title="A link to this run's starting world, with your score">Challenge a friend</button>
        {!final && <span className="text-[10px] text-ops-dim">Finish the run to include your score.</span>}
      </div>
      {link && (
        <div className="space-y-1">
          <input readOnly value={link} className="input w-full text-[10px]" aria-label="Challenge link" onFocus={(e) => e.currentTarget.select()} />
          <div className="text-[10px] text-ops-dim">{copied ? 'Copied to the clipboard.' : 'Copy the link above and send it.'} It opens the same starting world{final ? ' and shows your score to beat' : ''}.</div>
        </div>
      )}
    </div>
  );
}
