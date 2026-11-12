// Where a threat is at any moment: shared by the live theater view and the world map.
import type { ThreatWave, Track } from '../engine';

export type TrackPhase =
  | { kind: 'pending' }
  | { kind: 'flight'; f: number } // fraction along its path, 0-1
  | { kind: 'intercepted'; f: number; age: number } // stopped at fraction f; age in hours since
  | { kind: 'impact'; age: number } // reached its target; age in hours since
  | { kind: 'gone' };

/** How long (sim hours) interception and impact markers linger, fading. */
export const LINGER = { intercepted: 2, impact: 6 };

/** When a track's flight ends (interception or arrival), and where along its path. */
export function trackEnd(w: ThreatWave, tr: Track): { launch: number; flight: number; end: number; endTime: number; stopped: boolean } {
  const launch = tr.launchAt ?? w.launchAt ?? w.atHour;
  const flight = Math.max(0.05, w.atHour - launch);
  const stopped = tr.outcome === 'stopped' || tr.outcome === 'decoyStopped';
  const end = stopped ? tr.stopAt ?? 0.8 : 1;
  return { launch, flight, end, endTime: launch + flight * end, stopped };
}

export function trackPhase(w: ThreatWave, tr: Track, t: number): TrackPhase {
  const { launch, flight, end, endTime, stopped } = trackEnd(w, tr);
  if (t < launch || !w.resolved) return { kind: 'pending' };
  if (t < endTime) return { kind: 'flight', f: ((t - launch) / flight) };
  const age = t - endTime;
  if (stopped) return age < LINGER.intercepted ? { kind: 'intercepted', f: end, age } : { kind: 'gone' };
  if (tr.decoy) return { kind: 'gone' }; // a false track that drew no fire simply fades from the scope
  return age < LINGER.impact ? { kind: 'impact', age } : { kind: 'gone' };
}

/** Is anything from this wave on screen at time t (launch marker, tracks in flight, or lingering markers)? */
export function waveVisible(w: ThreatWave, t: number): boolean {
  if (!w.resolved) return false;
  const launch = w.launchAt ?? w.atHour;
  return t >= launch && t < w.atHour + LINGER.impact;
}
