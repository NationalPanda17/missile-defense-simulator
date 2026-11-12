// Which sounds a change in the simulation should make. Pure, so it can be tested without a browser.
import type { CommandEntry, SimState } from '../../engine';
import { trackEnd } from '../threatTimeline';

export type Cue =
  | 'click' | 'report' | 'reportCritical' | 'confirm' | 'dismiss' | 'respond' | 'maintain' | 'invest' | 'deploy'
  | 'alert' | 'resupply' | 'redeploy' | 'launch' | 'intercept' | 'impact' | 'phaseStart' | 'phaseEnd' | 'complete'
  | 'escalation' | 'resolved' | 'success';

/** What the detector remembers between looks at the state. */
export interface CueMemo {
  campaignId: string | undefined;
  seenEvents: Set<string>;
  lastCommand: CommandEntry | undefined;
  launchedWaves: Set<string>;
  status: SimState['status'];
  phaseIndex: number;
  escalations: number;
  resolved: number;
}

const COMMAND_CUE: Record<string, Cue> = {
  confirm: 'confirm', dismiss: 'dismiss', respond: 'respond', monitor: 'respond', maintain: 'maintain', invest: 'invest',
  deploy: 'deploy', relocate: 'deploy', withdraw: 'deploy', alert: 'alert', resupply: 'resupply', redeploy: 'redeploy',
};

export function memoOf(s: SimState): CueMemo {
  return {
    campaignId: s.campaignId,
    seenEvents: new Set(s.events.filter((e) => e.reportedAt <= s.hour).map((e) => e.id)),
    lastCommand: s.commands[s.commands.length - 1],
    launchedWaves: new Set((s.tactical?.waves ?? []).filter((w) => w.resolved).map((w) => w.id)),
    status: s.status,
    phaseIndex: s.phaseIndex,
    escalations: s.counters.escalations,
    resolved: s.counters.resolved,
  };
}

/**
 * Cues for what changed since `prev`. A new or different scenario (or the first look) makes no sound, so loading a
 * save doesn't play its whole history.
 */
export function detectCues(prev: CueMemo | null, s: SimState): { cues: Cue[]; memo: CueMemo } {
  const memo = memoOf(s);
  if (!prev || prev.campaignId !== s.campaignId) return { cues: [], memo };
  const cues: Cue[] = [];

  // The player's own orders.
  const i = prev.lastCommand ? s.commands.lastIndexOf(prev.lastCommand) : -1;
  const fresh = prev.lastCommand ? (i >= 0 ? s.commands.slice(i + 1) : []) : s.commands;
  for (const c of fresh) {
    const cue = COMMAND_CUE[c.kind];
    if (cue) cues.push(cue);
  }

  // Phase flow.
  if (prev.status === 'briefing' && s.status === 'running') cues.push('phaseStart');
  if (s.status === 'complete' && prev.status !== 'complete') cues.push('complete');
  else if (s.phaseIndex > prev.phaseIndex || (prev.status === 'running' && s.status === 'briefing')) cues.push('phaseEnd');

  // New reports, worst first.
  const reports = s.events.filter((e) => e.reportedAt <= s.hour && !prev.seenEvents.has(e.id));
  if (reports.some((e) => e.severity >= 3)) cues.push('reportCritical');
  else if (reports.length) cues.push('report');

  if (s.counters.escalations > prev.escalations) cues.push('escalation');
  if (s.counters.resolved > prev.resolved) cues.push('resolved');

  // Waves launching.
  if ((s.tactical?.waves ?? []).some((w) => w.resolved && !prev.launchedWaves.has(w.id))) cues.push('launch');
  return { cues, memo };
}

/**
 * Interceptions and hits that happen between two moments of continuous sim time, in time order, so the sound lands
 * when the map shows it. Decoys that get through make no sound (they do no damage).
 */
export function trackCues(s: SimState, from: number, to: number): Cue[] {
  if (!(to > from)) return [];
  const out: { at: number; cue: Cue }[] = [];
  for (const w of s.tactical?.waves ?? []) {
    if (!w.resolved || w.atHour < from || (w.launchAt ?? w.atHour) > to) continue;
    for (const tr of w.tracks) {
      const e = trackEnd(w, tr);
      if (e.endTime <= from || e.endTime > to) continue;
      if (e.stopped) out.push({ at: e.endTime, cue: 'intercept' });
      else if (!tr.decoy) out.push({ at: e.endTime, cue: 'impact' });
    }
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.cue);
}

/** How tense the music should be, 0-1: the alert level, raised while threats are in flight. */
export function tensionOf(s: SimState | null, t: number): number {
  if (!s || s.status !== 'running') return 0.12;
  const base = { NORMAL: 0.18, ELEVATED: 0.38, HIGH: 0.6, SEVERE: 0.8 }[s.metrics.alert] ?? 0.2;
  const inFlight = (s.tactical?.waves ?? []).some((w) => w.resolved && (w.launchAt ?? w.atHour) <= t && t < w.atHour);
  return Math.min(1, inFlight ? Math.max(base, 0.75) + 0.15 : base);
}
