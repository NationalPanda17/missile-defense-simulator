// Challenge links: the seed, difficulty and tactical scenario of a run (and the sharer's score), packed into a URL so
// a friend can play the same starting world and threats and compare. No server needed.
import { COMMAND_LEVEL_IDS } from './config';
import { normalizeTactical } from './scenarios';
import { defaultSettings, withLevel } from './world';
import type { CommandLevel, ScenarioSettings, SimState, TacticalSettings } from './types';

export interface Challenge {
  v: 1;
  mode: 'campaign' | 'crisis';
  seed: number;
  level?: CommandLevel;
  tactical?: TacticalSettings;
  scenario?: string; // tactical scenario name, for display
  score?: number;
  grade?: string;
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export function challengeOf(s: SimState, score?: { total: number; grade: string }): Challenge | null {
  const m = s.settings.mode;
  if (m !== 'campaign' && m !== 'crisis') return null;
  return {
    v: 1, mode: m, seed: s.settings.seed,
    ...(m === 'campaign' ? { level: s.settings.level ?? 'officer', tactical: s.settings.tactical } : {}),
    ...(s.settings.tactical && s.settings.tactical.preset !== 'standard' ? { scenario: s.settings.name.split(' · ')[1] } : {}),
    ...(score ? { score: Math.round(score.total * 10) / 10, grade: score.grade } : {}),
  };
}

export const encodeChallenge = (c: Challenge) => b64url(JSON.stringify(c));

/** Parses and checks a challenge from a link. Anything malformed gives null. */
export function decodeChallenge(code: string): Challenge | null {
  try {
    if (!code || code.length > 4000) return null;
    const x = JSON.parse(unb64url(code)) as Partial<Challenge>;
    if (x.v !== 1 || (x.mode !== 'campaign' && x.mode !== 'crisis') || !Number.isInteger(x.seed) || x.seed! < 0 || x.seed! > 2 ** 32) return null;
    const out: Challenge = { v: 1, mode: x.mode, seed: x.seed! };
    if (x.mode === 'campaign') {
      out.level = x.level && COMMAND_LEVEL_IDS.includes(x.level) ? x.level : 'officer';
      if (x.tactical) out.tactical = normalizeTactical(x.tactical);
      if (typeof x.scenario === 'string') out.scenario = x.scenario.slice(0, 40);
    }
    if (typeof x.score === 'number' && x.score >= 0 && x.score <= 100) out.score = x.score;
    if (typeof x.grade === 'string') out.grade = x.grade.slice(0, 3);
    return out;
  } catch {
    return null;
  }
}

/** Scenario settings that reproduce the challenge's starting world. */
export function challengeSettings(c: Challenge): ScenarioSettings {
  const base = defaultSettings(c.mode, { seed: c.seed });
  const withScenario = c.tactical ? { ...base, tactical: c.tactical, name: c.scenario ? `${base.name} · ${c.scenario}` : base.name } : base;
  const s = c.mode === 'campaign' ? withLevel(withScenario, c.level ?? 'officer') : withScenario;
  return { ...s, challenge: c.score !== undefined ? { score: c.score, grade: c.grade ?? '' } : { score: -1, grade: '' } };
}
