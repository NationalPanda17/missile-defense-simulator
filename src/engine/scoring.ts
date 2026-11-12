// Scoring, objective evaluation and after-action analysis.
import { DECOY_EFFICIENCY_PENALTY, PROTECTION_SCORE_WEIGHT, SCORE_WEIGHTS, TACTICAL_CONFIG } from './config';
import { clamp } from './rng';
import type { ObjectiveResult, PhaseConfig, RegionId, SimState } from './types';
import { REGION_IDS } from './types';

export function objectiveValue(s: SimState, metric: PhaseConfig['objectives'][number]['metric']): number {
  switch (metric) {
    case 'readiness': return s.metrics.globalReadiness;
    case 'network': return s.metrics.network;
    case 'stability': return s.metrics.stability;
    case 'infrastructure': return s.metrics.infrastructure;
    case 'maintenanceDone': return s.counters.maintenanceDone;
    case 'confirmations': return s.counters.confirmations;
    case 'escalationsMax': return s.counters.escalations;
    case 'resolved': return s.counters.resolved;
    case 'falseDismissed': return s.counters.falseDismissed;
    case 'credits': return s.credits;
  }
}

export function objectiveMet(metric: string, value: number, target: number) {
  return metric === 'escalationsMax' ? value <= target : value >= target;
}

export function evaluateObjectives(s: SimState, phase: PhaseConfig): ObjectiveResult[] {
  return phase.objectives.map((o) => {
    const value = objectiveValue(s, o.metric);
    return { phase: phase.id, objectiveId: o.id, text: o.text, met: objectiveMet(o.metric, value, o.target), value };
  });
}

export type ScoreKey = keyof typeof SCORE_WEIGHTS | 'protection';

export interface ScoreBreakdown {
  components: Partial<Record<ScoreKey, number>> & Record<keyof typeof SCORE_WEIGHTS, number>;
  /** Effective weight of each component in this run (protection only when the tactical layer is active). */
  weights: Partial<Record<ScoreKey, number>>;
  objectiveBonus: number;
  total: number;
  grade: string;
}

/**
 * Share (0-100) of incoming threat damage that was prevented, weighting each threat by its damage and its target's
 * importance. Null when the tactical layer is off; 75 (neutral, like other components) before any threat arrives.
 */
export function protectionScore(s: SimState): number | null {
  const t = s.tactical;
  if (!t?.enabled) return null;
  const sites = new Map(t.sites.map((x) => [x.id, x]));
  let potential = 0;
  let prevented = 0;
  for (const w of t.waves) {
    if (!w.resolved) continue;
    for (const tr of w.tracks) {
      if (tr.decoy) continue;
      const v = TACTICAL_CONFIG.threatDamage[tr.cls] * (sites.get(tr.siteId)?.importance ?? 1);
      potential += v;
      if (tr.outcome === 'stopped') prevented += v;
    }
  }
  return potential > 0 ? (prevented / potential) * 100 : 75;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeScore(s: SimState): ScoreBreakdown {
  const h = s.history.length ? s.history : [{ readiness: s.metrics.globalReadiness, network: s.metrics.network, stability: s.metrics.stability }];
  const c = s.counters;
  const readiness = avg(h.map((x) => x.readiness));
  const network = avg(h.map((x) => x.network));
  const stability = avg(h.map((x) => x.stability));

  const bad = c.escalations * 1.5 + c.genuineDismissed * 1.5 + c.failedResponses * 0.5;
  let response = c.resolved + bad > 0 ? (c.resolved / (c.resolved + bad)) * 100 : 75;
  const rt = avg(c.responseTimes);
  if (c.responseTimes.length) response -= clamp((rt - 6) * 1.5, 0, 15);
  response = clamp(response);

  const infraBase = s.baseline.infrastructure || 70;
  const infrastructure = clamp(100 * (s.metrics.infrastructure / infraBase) - 0, 0, 100);

  // Efficiency: penalize waste (spurious responses, failed responses) and idle hoarding — not spending per se.
  let efficiency = 65;
  if (c.totalSpent > 0) {
    const waste = c.wastedCredits / c.totalSpent;
    efficiency = 100 - waste * 160 - c.failedResponses * 2;
  }
  const hoard = Math.max(0, s.credits - 2000) / 60;
  const decoyWaste = Math.min(DECOY_EFFICIENCY_PENALTY.max, (s.tactical?.stats.decoysEngaged ?? 0) * DECOY_EFFICIENCY_PENALTY.perShot);
  efficiency = clamp(efficiency - hoard - decoyWaste);

  let information = 70;
  if (c.responsesTotal > 0 || c.falseDismissed + c.falseResponded > 0) {
    const onConf = c.responsesTotal ? c.responsesOnConfirmed / c.responsesTotal : 0.7;
    const falseHandling = c.falseDismissed + c.falseResponded > 0 ? c.falseDismissed / (c.falseDismissed + c.falseResponded) : 0.7;
    information = onConf * 55 + falseHandling * 45;
  }
  information = clamp(information - c.genuineDismissed * 8);

  const startR = s.baseline.readiness || 80;
  const endR = s.metrics.globalReadiness;
  let recovery: number;
  if (s.minReadiness >= startR - 3) recovery = clamp(80 + (endR - startR));
  else recovery = clamp(((endR - s.minReadiness) / Math.max(1, startR - s.minReadiness)) * 100);

  const base = { readiness, network, stability, response, infrastructure, efficiency, information, recovery };
  const protection = protectionScore(s);
  const share = protection === null ? 1 : 1 - PROTECTION_SCORE_WEIGHT;
  const weights: ScoreBreakdown['weights'] = {};
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) weights[k] = SCORE_WEIGHTS[k] * share;
  const components: ScoreBreakdown['components'] = { ...base };
  if (protection !== null) {
    components.protection = protection;
    weights.protection = PROTECTION_SCORE_WEIGHT;
  }
  const weighted = (Object.keys(weights) as ScoreKey[]).reduce((x, k) => x + weights[k]! * components[k]!, 0);
  const met = s.objectiveResults.filter((r) => r.met).length;
  const objectiveBonus = Math.min(8, met * 1);
  const total = clamp(weighted + objectiveBonus);
  const grade = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F';
  return { components, weights, objectiveBonus, total, grade };
}

export interface Lesson { tone: 'good' | 'poor' | 'neutral'; text: string }

export function lessonsLearned(s: SimState): Lesson[] {
  const c = s.counters;
  const out: Lesson[] = [];
  if (c.falseResponded > 0)
    out.push({ tone: 'poor', text: `${c.falseResponded} response(s) were committed to spurious reports, wasting ${Math.round(c.wastedCredits)} credits. Task an independent confirmation before committing resources to low-confidence reports.` });
  if (c.falseDismissed > 0)
    out.push({ tone: 'good', text: `${c.falseDismissed} spurious report(s) were exposed through confirmation, avoiding wasted effort.` });
  if (c.genuineDismissed > 0)
    out.push({ tone: 'poor', text: `${c.genuineDismissed} genuine event(s) were dismissed and continued to develop out of sight. Dismiss only when confidence is low and the region has good awareness.` });
  if (c.escalations > 3)
    out.push({ tone: 'poor', text: `${c.escalations} events escalated. Escalations cause permanent infrastructure and stability damage and can trigger follow-on events. Act on high-severity events early.` });
  else if (c.escalations <= 1 && s.hour > 48)
    out.push({ tone: 'good', text: `Only ${c.escalations} escalation(s) occurred — events were handled inside their decision windows.` });
  if (c.assetFailures > 0)
    out.push({ tone: 'poor', text: `${c.assetFailures} asset(s) failed (condition below 20%). Overdue maintenance accelerates decay by 2.5x — keep the maintenance backlog low.` });
  if (c.maintenanceDone >= 6)
    out.push({ tone: 'good', text: `${c.maintenanceDone} maintenance cycles completed. Preventive maintenance kept domain readiness high.` });
  if (s.resilience >= 50)
    out.push({ tone: 'good', text: `Network resilience reached ${Math.round(s.resilience)}, cushioning communications disruptions across all domains.` });
  else if (s.history.some((h) => h.network < 50))
    out.push({ tone: 'poor', text: 'Network health fell below 50% at least once. Investing in network resilience reduces the impact of communications disruptions on every domain.' });
  if (c.failedResponses > 2)
    out.push({ tone: 'poor', text: `${c.failedResponses} responses failed. Responses that depend on a degraded domain or poor regional comms have lower success chances — check the odds before committing.` });
  const rt = c.responseTimes.length ? c.responseTimes.reduce((a, b) => a + b, 0) / c.responseTimes.length : 0;
  if (rt > 0) out.push({ tone: rt <= 6 ? 'good' : 'neutral', text: `Average time from report to response: ${rt.toFixed(1)}h.` });
  if (s.credits > 2000) out.push({ tone: 'neutral', text: `${Math.round(s.credits)} credits were left unspent. Idle reserves earn no score — invest in resilience or modernization.` });
  if (s.spendByCategory.investment === 0 && s.hour > 72)
    out.push({ tone: 'poor', text: 'No long-term investments were made. Infrastructure, resilience and modernization compound over a campaign.' });
  out.push(...tacticalLessons(s));
  const worst = Object.values(s.regions).sort((a, b) => a.stability - b.stability)[0];
  if (worst.stability < 50) out.push({ tone: 'poor', text: `${worst.name} ended at stability ${Math.round(worst.stability)}. Regional recovery packages and resolving unrest early prevent cascading instability.` });
  if (!out.length) out.push({ tone: 'neutral', text: 'Not enough activity yet to draw conclusions.' });
  return out;
}

// ── Tactical layer analysis (AAR) ────────────────────────────────────────

export interface TacticalReport {
  stopRate: number | null; // 0-1, null before any threat
  byPhase: { phase: number; waves: number; tracks: number; stopped: number }[];
  byRegion: { region: RegionId; deployments: number; waves: number; tracks: number; stopped: number; damage: number }[];
  undefendedForecastWaves: number; // forecast waves that drew no fire: nothing deployed, out of rounds, or out of service
  surpriseWaves: number;
  kills: { equipmentId: string; kills: number }[]; // threats stopped, by system type
  damagedSites: { name: string; region: string; integrity: number }[];
}

export function tacticalReport(s: SimState): TacticalReport | null {
  const t = s.tactical;
  if (!t?.enabled) return null;
  const resolved = t.waves.filter((w) => w.resolved);
  const real = (w: (typeof resolved)[number]) => w.tracks.filter((x) => !x.decoy);
  const byPhase = s.phases.map((p, i) => {
    const ws = resolved.filter((w) => w.phaseIndex === i);
    return { phase: p.id, waves: ws.length, tracks: ws.reduce((a, w) => a + real(w).length, 0), stopped: ws.reduce((a, w) => a + real(w).filter((x) => x.outcome === 'stopped').length, 0) };
  });
  const byRegion = REGION_IDS.map((region) => {
    const ws = resolved.filter((w) => w.region === region);
    return {
      region, deployments: t.deployments.filter((d) => d.region === region).length, waves: ws.length,
      tracks: ws.reduce((a, w) => a + real(w).length, 0),
      stopped: ws.reduce((a, w) => a + real(w).filter((x) => x.outcome === 'stopped').length, 0),
      damage: ws.reduce((a, w) => a + real(w).reduce((b, x) => b + (x.damage ?? 0), 0), 0),
    };
  });
  const depType = new Map(t.deployments.map((d) => [d.id, d.equipmentId]));
  const killMap = new Map<string, number>();
  for (const w of resolved) for (const tr of real(w)) {
    const type = tr.stoppedBy && depType.get(tr.stoppedBy);
    if (type) killMap.set(type, (killMap.get(type) ?? 0) + 1);
  }
  return {
    stopRate: t.stats.tracks ? t.stats.stopped / t.stats.tracks : null,
    byPhase,
    byRegion,
    undefendedForecastWaves: resolved.filter((w) => w.forecast && w.tracks.every((x) => x.shots === 0)).length,
    surpriseWaves: resolved.filter((w) => !w.forecast).length,
    kills: [...killMap].map(([equipmentId, kills]) => ({ equipmentId, kills })).sort((a, b) => b.kills - a.kills),
    damagedSites: t.sites.filter((x) => x.integrity < 100).sort((a, b) => a.integrity - b.integrity)
      .map((x) => ({ name: x.name, region: s.regions[x.region].name, integrity: x.integrity })),
  };
}

function tacticalLessons(s: SimState): Lesson[] {
  const r = tacticalReport(s);
  if (!r || r.stopRate === null) return [];
  const out: Lesson[] = [];
  const pct = Math.round(r.stopRate * 100);
  if (r.stopRate >= 0.7) out.push({ tone: 'good', text: `Tactical defenses stopped ${pct}% of incoming threats.` });
  else out.push({ tone: r.stopRate >= 0.4 ? 'neutral' : 'poor', text: `Only ${pct}% of incoming threats were stopped. Place long-range systems where their rings cover most sites, and point defense at the most important ones.` });
  if (r.undefendedForecastWaves > 0)
    out.push({ tone: 'poor', text: `${r.undefendedForecastWaves} forecast wave(s) met no working defenses: nothing deployed, out of rounds, or out of service. Deploy in every forecast region, resupply before magazines run dry, and keep systems maintained.` });
  const decoys = s.tactical!.stats.decoysEngaged;
  if (decoys >= 5)
    out.push({ tone: 'poor', text: `${decoys} false tracks drew fire. Poor regional awareness produces decoys; sensors and comms in threatened regions cut the waste.` });
  const lost = r.damagedSites.filter((x) => x.integrity <= 50).length;
  if (lost > 0) out.push({ tone: 'poor', text: `${lost} site(s) were left at half integrity or worse.` });
  return out;
}

export interface WaveExchange {
  waveId: string;
  region: RegionId;
  atHour: number;
  threats: number; // genuine
  stopped: number;
  decoysEngaged: number;
  spent: number; // credits of interceptor rounds fired at the wave (decoys included)
  wasted: number; // of which at decoys
  valueStopped: number; // attacker cost of the genuine threats stopped
  damageTaken: number; // site integrity lost
}

/** Cost exchange per resolved wave: what the defense spent against what it stopped. */
export function costExchange(s: SimState): WaveExchange[] {
  const t = s.tactical;
  if (!t) return [];
  const costOf = TACTICAL_CONFIG.threatCost;
  return t.waves.filter((w) => w.resolved).sort((a, b) => a.atHour - b.atHour).map((w) => {
    const real = w.tracks.filter((x) => !x.decoy);
    const decoys = w.tracks.filter((x) => x.decoy);
    return {
      waveId: w.id, region: w.region, atHour: w.atHour,
      threats: real.length,
      stopped: real.filter((x) => x.outcome === 'stopped').length,
      decoysEngaged: decoys.filter((x) => x.shots > 0).length,
      spent: Math.round(w.tracks.reduce((a, x) => a + (x.cost ?? 0), 0)),
      wasted: Math.round(decoys.reduce((a, x) => a + (x.cost ?? 0), 0)),
      valueStopped: real.filter((x) => x.outcome === 'stopped').reduce((a, x) => a + costOf[x.cls], 0),
      damageTaken: real.reduce((a, x) => a + (x.damage ?? 0), 0),
    };
  });
}
