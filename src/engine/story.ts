// Turning what happened into words: the narrated replay of a wave, the story of one threat, the front page for a
// phase, and the medals a finished game earns. Pure: everything is read from the recorded state.
import { TACTICAL_CONFIG, enemyStyleOf } from './config';
import { THREAT_LABELS } from './equipment';
import { computeScore, protectionScore } from './scoring';
import { leakText, unitName, veteranOf } from './tactical';
import { QUICK_BATTLE_ID, starsFor, LESSON_MAP } from './training';
import type { Deployment, SimState, ThreatClass, ThreatWave, Track } from './types';

const PLURAL: Record<ThreatClass, string> = {
  slowDrone: 'slow drones', fastDrone: 'fast drones', cruise: 'cruise missiles', rocket: 'rockets', ballistic: 'ballistic missiles', hypersonic: 'hypersonic gliders',
};
const SINGLE: Record<ThreatClass, string> = {
  slowDrone: 'slow drone', fastDrone: 'fast drone', cruise: 'cruise missile', rocket: 'rocket', ballistic: 'ballistic missile', hypersonic: 'hypersonic glider',
};
const count = (n: number, cls: ThreatClass) => `${n} ${n === 1 ? SINGLE[cls] : PLURAL[cls]}`;
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');
const byClass = (trs: Track[]) => {
  const n = new Map<ThreatClass, number>();
  for (const tr of trs) n.set(tr.cls, (n.get(tr.cls) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
};
const mixText = (trs: Track[]) => list(byClass(trs).map(([c, k]) => count(k, c)));

function depName(s: SimState, id: string | undefined): string {
  const d = s.tactical?.deployments.find((x) => x.id === id);
  return d ? unitName(s, d) : 'a system since withdrawn';
}

/** What a track was aimed at, in words. */
export function targetName(s: SimState, tr: Track): string {
  if (tr.depTarget) return `${depName(s, tr.depTarget)} (hunting the radar)`;
  return s.tactical?.sites.find((x) => x.id === tr.siteId)?.name ?? 'a site';
}

/** The whole story of one threat in two or three sentences: what it was, who saw it, who fired, how it ended. */
export function trackStory(s: SimState, w: ThreatWave, tr: Track): string {
  const t = s.tactical!;
  const what = `${tr.decoy ? 'Decoy (looked like a ' + SINGLE[tr.cls] + ')' : THREAT_LABELS[tr.cls]} aimed at ${targetName(s, tr)}${tr.via ? ', turning in flight' : ''}.`;
  if (!w.resolved) return `${what} Not launched yet.`;
  const seen = tr.detected === false ? 'No sensor saw it coming.'
    : tr.band ? `Tracked by ${tr.band === 'passive' ? 'a passive sensor' : `${tr.band}-band radar`}.` : 'Tracked by sensors.';
  if (tr.rejected) return `${what} ${seen} The radar recognised it as a decoy, so nothing fired.`;
  const fired = tr.fired?.length ? `${list(tr.fired.map((f) => `${depName(s, f.dep)} fired ${f.shots}`))}.` : '';
  let end: string;
  if (tr.outcome === 'stopped' || tr.outcome === 'decoyStopped') end = `Stopped by ${depName(s, tr.stoppedBy)}${tr.decoy ? ': rounds wasted on a fake' : ''}.`;
  else if (tr.decoy) end = tr.shots ? 'It drew fire and flew on: rounds wasted on a fake.' : 'Nothing fired at it; it did no harm.';
  else end = `Got through${tr.depTarget ? ' and hit the system' : tr.damage ? ` (−${tr.damage} integrity)` : ''}. ${leakText(tr, t.deployments)}`;
  return [what, seen, fired, end].filter(Boolean).join(' ');
}

export interface Caption { tone: 'info' | 'good' | 'bad'; text: string }

/** A wave told as a short sequence of captions, in the order things happened, for the narrated replay. */
export function narrateWave(s: SimState, w: ThreatWave): Caption[] {
  const t = s.tactical!;
  if (!w.resolved) return [];
  const real = w.tracks.filter((x) => !x.decoy);
  const decoys = w.tracks.filter((x) => x.decoy);
  const out: Caption[] = [];
  const c = w.conditions;
  out.push({
    tone: 'info',
    text: `${mixText(real) || 'No threats'} ${real.length === 1 ? 'comes' : 'come'} in from the ${w.axis}${c?.night ? ', at night' : ''}${c?.storm ? ', through a storm' : ''}${decoys.length ? `, with ${decoys.length} decoy${decoys.length === 1 ? '' : 's'} among them` : ''}.`,
  });
  const unseen = real.filter((x) => x.detected === false);
  if (real.length && unseen.length === real.length) out.push({ tone: 'bad', text: 'No sensor sees any of them: every shot will be late and hurried.' });
  else if (unseen.length) out.push({ tone: 'bad', text: `Sensors track ${real.length - unseen.length} of ${real.length}; ${mixText(unseen)} ${unseen.length === 1 ? 'slips' : 'slip'} in unseen.` });
  else if (real.length) out.push({ tone: 'good', text: 'Sensors track every one of them.' });

  const hunters = real.filter((x) => x.depTarget);
  if (hunters.length) out.push({ tone: 'bad', text: `${mixText(hunters)} ${hunters.length === 1 ? 'peels' : 'peel'} off toward your radars: ${list([...new Set(hunters.map((x) => depName(s, x.depTarget)))])}.` });

  // Each shooter's work, busiest first.
  const stops = new Map<string, Track[]>();
  for (const tr of real) if (tr.outcome === 'stopped' && tr.stoppedBy) stops.set(tr.stoppedBy, [...(stops.get(tr.stoppedBy) ?? []), tr]);
  for (const [dep, trs] of [...stops].sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
    const where = new Map<string, number>();
    for (const tr of trs) where.set(targetName(s, tr), (where.get(targetName(s, tr)) ?? 0) + 1);
    const top = [...where].sort((a, b) => b[1] - a[1])[0][0];
    const d = t.deployments.find((x) => x.id === dep);
    const vet = d ? veteranOf(d) : null;
    out.push({ tone: 'good', text: `${depName(s, dep)}${vet ? ` (${vet.label.toLowerCase()})` : ''} stops ${mixText(trs)} ${trs.some((x) => x.depTarget) ? 'bound for' : 'over'} ${top}.` });
  }
  if (stops.size > 5) out.push({ tone: 'good', text: `${stops.size - 5} more systems add to the tally.` });

  if (decoys.length) {
    const spotted = decoys.filter((x) => x.rejected).length;
    const drew = decoys.filter((x) => x.shots > 0);
    const wasted = drew.reduce((a, x) => a + x.shots, 0);
    out.push({
      tone: drew.length > spotted ? 'bad' : 'good',
      text: `Decoys: ${spotted} recognised and ignored${drew.length ? `, ${drew.length} drew fire (${wasted} round${wasted === 1 ? '' : 's'} wasted)` : ''}.`,
    });
  }

  // What got through, by target.
  const leaks = new Map<string, Track[]>();
  for (const tr of real) if (tr.outcome === 'leaked') leaks.set(targetName(s, tr), [...(leaks.get(targetName(s, tr)) ?? []), tr]);
  for (const [name, trs] of [...leaks].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    const why = new Map<string, number>();
    for (const tr of trs) { const x = leakText(tr, t.deployments); why.set(x, (why.get(x) ?? 0) + 1); }
    const reason = [...why].sort((a, b) => b[1] - a[1])[0][0];
    const dmg = trs.reduce((a, x) => a + (x.damage ?? 0), 0);
    out.push({ tone: 'bad', text: `${mixText(trs)} ${trs.length === 1 ? 'gets' : 'get'} through to ${name}${dmg ? ` (−${dmg} integrity)` : ''}. ${reason}` });
  }
  const stopped = real.filter((x) => x.outcome === 'stopped').length;
  if (real.length) {
    out.push({
      tone: stopped === real.length ? 'good' : stopped * 2 >= real.length ? 'info' : 'bad',
      text: stopped === real.length ? `Clean sweep: all ${real.length} stopped.` : `${stopped} of ${real.length} stopped; ${real.length - stopped} got through.`,
    });
  }
  return out;
}

// ── The front page ───────────────────────────────────────────────────────

export interface Dispatch {
  phase: number; // phase number (1-based)
  phaseName: string;
  headline: string;
  deck: string;
  stories: { title: string; text: string }[];
}

/** The front page for a finished phase, written from what happened in it. Null if the phase is not over. */
export function phaseDispatch(s: SimState, phaseIndex: number): Dispatch | null {
  const phase = s.phases[phaseIndex];
  const done = phaseIndex < s.phaseIndex || s.status === 'complete';
  if (!phase || !done) return null;
  const t = s.tactical?.enabled ? s.tactical : null;
  const waves = t ? t.waves.filter((w) => w.phaseIndex === phaseIndex && w.resolved) : [];
  const real = waves.flatMap((w) => w.tracks.filter((x) => !x.decoy));
  const stopped = real.filter((x) => x.outcome === 'stopped');
  const leaked = real.filter((x) => x.outcome === 'leaked');
  const rate = real.length ? stopped.length / real.length : 1;
  const regions = [...new Set(waves.map((w) => w.region))];
  const regionNames = list(regions.map((r) => s.regions[r].name));
  const results = s.objectiveResults.filter((r) => r.phase === phase.id);
  const stories: Dispatch['stories'] = [];

  // Worst-hit site.
  const hits = new Map<string, { n: number; dmg: number }>();
  for (const tr of leaked) {
    if (tr.depTarget) continue;
    const e = hits.get(tr.siteId) ?? { n: 0, dmg: 0 };
    hits.set(tr.siteId, { n: e.n + 1, dmg: e.dmg + (tr.damage ?? 0) });
  }
  const worst = [...hits].sort((a, b) => b[1].dmg - a[1].dmg)[0];
  const worstSite = worst && t?.sites.find((x) => x.id === worst[0]);

  let headline: string;
  let deck: string;
  if (!real.length) {
    headline = 'A QUIET WATCH';
    deck = `No attack came during ${phase.name}. Command used the calm to put its house in order.`;
  } else if (rate >= 0.9) {
    headline = `SKIES HELD OVER ${regions.length === 1 ? s.regions[regions[0]].name.toUpperCase() : `${regions.length} REGIONS`}`;
    deck = `Defenders stopped ${stopped.length} of ${real.length} incoming threats across ${regionNames}.`;
  } else if (rate >= 0.6) {
    headline = worstSite ? `${worstSite.name.toUpperCase()} HIT AS DEFENSES BEND` : 'DEFENSES BEND BUT HOLD';
    deck = `${stopped.length} of ${real.length} threats were stopped over ${regionNames}; ${leaked.length} got through.`;
  } else {
    headline = worstSite ? `${worstSite.name.toUpperCase()} BURNS` : 'RAIDS BREAK THROUGH';
    deck = `Only ${stopped.length} of ${real.length} threats were stopped over ${regionNames}. Questions are being asked of command.`;
  }

  if (worstSite && worst) {
    stories.push({
      title: `${worstSite.name}: ${worst[1].n} strike${worst[1].n === 1 ? '' : 's'}`,
      text: `${worstSite.name} took ${worst[1].n} hit${worst[1].n === 1 ? '' : 's'} and now stands at ${Math.round(worstSite.integrity)}% integrity. Until it is rebuilt the region earns less, and is a likelier target.`,
    });
  }
  // Unit of the phase.
  const tally = new Map<string, number>();
  for (const tr of stopped) if (tr.stoppedBy) tally.set(tr.stoppedBy, (tally.get(tr.stoppedBy) ?? 0) + 1);
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  const bestDep: Deployment | undefined = best && t?.deployments.find((d) => d.id === best[0]);
  if (best && bestDep && best[1] >= 2) {
    const vet = veteranOf(bestDep);
    stories.push({
      title: `Crew of the phase: ${unitName(s, bestDep)}`,
      text: `${unitName(s, bestDep)} in ${s.regions[bestDep.region].name} stopped ${best[1]} threats this phase${bestDep.kills ? `, ${bestDep.kills} in all` : ''}${vet ? `, and is now rated ${vet.label}` : ''}.`,
    });
  }
  const hit = waves.flatMap((w) => w.tracks).filter((x) => x.depTarget && x.outcome === 'leaked').length;
  if (hit) stories.push({ title: 'Radars under fire', text: `${hit} missile${hit === 1 ? '' : 's'} found ${hit === 1 ? 'its' : 'their'} way to the defenders’ own radars. Damaged systems need maintenance before the next raid.` });
  if (results.length) {
    const met = results.filter((r) => r.met).length;
    stories.push({
      title: `Command meets ${met} of ${results.length} goals`,
      text: results.map((r) => `${r.met ? '✔' : '✘'} ${r.text}`).join(' · '),
    });
  }
  const style = enemyStyleOf(s.settings);
  const plan = t?.enemy?.find((p) => p.phaseIndex === phaseIndex + 1);
  if (plan?.learned.length) stories.push({ title: `${style.name} takes notes`, text: plan.learned.slice(0, 2).join(' ') });
  else if (s.settings.mode === 'campaign' && s.settings.enemy && s.settings.enemy !== 'planner' && phaseIndex === 0) {
    stories.push({ title: `Opposite number: ${style.name}, ${style.title}`, text: style.text });
  }
  return { phase: phase.id, phaseName: phase.name, headline, deck, stories };
}

/** A dispatch as plain text, for copying. */
export function dispatchText(d: Dispatch): string {
  return [`THE MERIDIAN DISPATCH · Phase ${d.phase}: ${d.phaseName}`, d.headline, d.deck, ...d.stories.map((x) => `${x.title}. ${x.text}`)].join('\n');
}

// ── Medals ───────────────────────────────────────────────────────────────

export interface Medal { id: string; name: string; text: string; earned: (s: SimState) => boolean }

const campaignDone = (s: SimState) => s.settings.mode === 'campaign' && s.status === 'complete';
const tracksOf = (s: SimState) => s.tactical?.waves.flatMap((w) => w.tracks) ?? [];
const gradeAtLeast = (s: SimState, min: number) => computeScore(s).total >= min;

/** Medals a finished game can earn. Kept in the player's service record; some unlock map themes. */
export const MEDALS: Medal[] = [
  { id: 'first-watch', name: 'First Watch', text: 'Finish any scenario.', earned: (s) => s.status === 'complete' },
  { id: 'shield', name: 'Shield of the Regions', text: 'Finish a campaign having prevented 80% or more of the threat damage.', earned: (s) => campaignDone(s) && (protectionScore(s) ?? 0) >= 80 && (s.tactical?.stats.tracks ?? 0) >= 20 },
  { id: 'clean-sweep', name: 'Clean Sweep', text: 'Stop every threat in a wave of eight or more.',
    earned: (s) => !!s.tactical?.waves.some((w) => { const r = w.tracks.filter((x) => !x.decoy); return w.resolved && r.length >= 8 && r.every((x) => x.outcome === 'stopped'); }) },
  { id: 'sharp-eye', name: 'Sharp Eye', text: 'Have your radars recognise ten decoys in one game.', earned: (s) => (s.tactical?.stats.decoysSpotted ?? 0) >= 10 },
  { id: 'ace-crew', name: 'Ace Crew', text: `Raise a unit to Elite (${TACTICAL_CONFIG.veteran[0].kills} threats stopped).`, earned: (s) => !!s.tactical?.deployments.some((d) => (d.kills ?? 0) >= TACTICAL_CONFIG.veteran[0].kills) },
  { id: 'glider', name: 'Glider Killer', text: 'Stop a hypersonic glider.', earned: (s) => tracksOf(s).some((x) => x.cls === 'hypersonic' && x.outcome === 'stopped') },
  { id: 'steady-hand', name: 'Steady Hand', text: 'Finish a campaign with no more than two escalations and no genuine report dismissed.', earned: (s) => campaignDone(s) && s.counters.escalations <= 2 && s.counters.genuineDismissed === 0 },
  { id: 'skeptic', name: 'Healthy Skeptic', text: 'Expose five false reports in one game without wasting a response on one.', earned: (s) => s.status === 'complete' && s.counters.falseDismissed >= 5 && s.counters.falseResponded === 0 },
  { id: 'quick-three', name: 'Three Stars', text: 'Earn three stars in a Quick Battle.',
    earned: (s) => { const l = LESSON_MAP.get(QUICK_BATTLE_ID)!; return s.settings.lesson === QUICK_BATTLE_ID && s.status === 'complete' && starsFor(l.drill!, l.drill!.score(s)) >= 3; } },
  { id: 'officer-a', name: 'Distinguished Service', text: 'Finish a campaign on Officer or Commander with grade A or better.', earned: (s) => campaignDone(s) && s.settings.level !== 'recruit' && gradeAtLeast(s, 80) },
  { id: 'commander-b', name: 'Commander’s Star', text: 'Finish a campaign on Commander with grade B or better.', earned: (s) => campaignDone(s) && s.settings.level === 'commander' && gradeAtLeast(s, 70) },
  { id: 'rivals', name: 'Know Your Enemy', text: 'Finish a campaign against the Swarm, the Fox or the Hunter with grade C or better.', earned: (s) => campaignDone(s) && !!s.settings.enemy && s.settings.enemy !== 'planner' && gradeAtLeast(s, 60) },
];

/** Ids of the medals this state has earned. */
export const earnedMedals = (s: SimState): string[] => MEDALS.filter((m) => { try { return m.earned(s); } catch { return false; } }).map((m) => m.id);

/** Medals needed to unlock each map theme. */
export const THEME_UNLOCKS: { id: string; name: string; medals: number }[] = [
  { id: 'standard', name: 'Standard', medals: 0 },
  { id: 'amber', name: 'Amber scope', medals: 3 },
  { id: 'arctic', name: 'Arctic', medals: 6 },
];
