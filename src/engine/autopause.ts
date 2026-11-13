// Auto-pause: moments that need the commander, found by comparing the state before and after an hour of simulation.
// Pure; the store decides whether to pause (players choose which moments count, see the UI's pacing settings).
import { incomingWaves } from './tactical';
import { isActive } from './metrics';
import type { CommandLevel, RegionId, SimState } from './types';

export type PauseKind = 'launch' | 'report' | 'deadline';

export interface PauseReason {
  kind: PauseKind;
  text: string;
  region?: RegionId;
  waveId?: string;
  eventId?: string;
}

export interface PauseMemo {
  campaignId: string | undefined;
  warned: Set<string>; // waves already announced as launch warnings
  seen: Set<string>; // reports already known
  urged: Set<string>; // reports already flagged as about to escalate
}

/** Hours before escalation at which an untouched report pauses the game. */
export const DEADLINE_HOURS = 4;

/**
 * Report and escalation pauses are batched: after one, they wait this many sim hours before pausing again (they
 * still appear in the next prompt). Launch warnings always pause.
 */
export const BATCH_HOURS = 6;

export const pauseMemo = (s: SimState): PauseMemo => ({
  campaignId: s.campaignId,
  warned: new Set(incomingWaves(s).filter((x) => !x.launched).map((x) => x.wave.id)),
  seen: new Set(s.events.filter((e) => e.reportedAt <= s.hour).map((e) => e.id)),
  urged: new Set(s.events.filter((e) => urgent(s, e)).map((e) => e.id)),
});

const urgent = (s: SimState, e: SimState['events'][number]) =>
  e.status === 'reported' && e.reportedAt <= s.hour && e.deadline - s.hour <= DEADLINE_HOURS && e.deadline >= s.hour;

/** What happened since `prev` that a commander should stop for, most urgent first. */
export function pauseReasons(prev: PauseMemo | null, s: SimState): { reasons: PauseReason[]; memo: PauseMemo } {
  const memo = pauseMemo(s);
  if (!prev || prev.campaignId !== s.campaignId || s.status !== 'running') return { reasons: [], memo };
  const reasons: PauseReason[] = [];
  const name = (r: RegionId) => s.regions[r].name;
  for (const x of incomingWaves(s)) {
    if (x.launched || prev.warned.has(x.wave.id)) continue;
    reasons.push({
      kind: 'launch', region: x.wave.region, waveId: x.wave.id,
      text: `Launch expected at ${name(x.wave.region)} from the ${x.wave.axis} in about ${Math.max(1, Math.round(x.launchIn))}h${x.wave.forecast ? '' : ', outside the forecast'}.`,
    });
  }
  for (const e of s.events.filter((x) => isActive(x) && urgent(s, x) && !prev.urged.has(x.id))) {
    reasons.push({ kind: 'deadline', eventId: e.id, region: e.region, text: `${e.title} (${name(e.region)}) escalates in ${Math.max(1, Math.round(e.deadline - s.hour))}h and nothing has been ordered.` });
  }
  for (const e of s.events.filter((x) => isActive(x) && x.reportedAt <= s.hour && !prev.seen.has(x.id))) {
    reasons.push({ kind: 'report', eventId: e.id, region: e.region, text: `New report: ${e.title} in ${name(e.region)}.` });
  }
  return { reasons, memo };
}

export interface AutoPauseSettings { launch: boolean; deadline: boolean; report: boolean }

/**
 * The player's saved choice applied to a scenario. "Waves only" means "only the urgent moments": where there are no
 * waves it stops before escalations instead of never stopping at all. "Never" (nothing ticked) is respected.
 */
export function applyPacing(p: AutoPauseSettings, hasWaves: boolean): AutoPauseSettings {
  if (!hasWaves && p.launch && !p.deadline && !p.report) return { ...p, deadline: true };
  return p;
}

/**
 * Defaults by difficulty. Launch warnings pause on every difficulty (the decision window is too short in real time
 * otherwise); Recruit also stops for every report, Officer for reports about to escalate, Commander for launches only.
 * Scenarios without threat waves (Crisis, Sandbox) never have a launch to stop for, so they always stop before a
 * report escalates.
 */
export function defaultAutoPause(level: CommandLevel | undefined, hasWaves = true): AutoPauseSettings {
  if (!hasWaves) return { launch: true, deadline: true, report: level === 'recruit' };
  if (level === 'commander') return { launch: true, deadline: false, report: false };
  if (level === 'recruit') return { launch: true, deadline: true, report: true };
  return { launch: true, deadline: true, report: false };
}
