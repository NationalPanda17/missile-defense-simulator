// Scoring, objective evaluation and after-action analysis.
import { SCORE_WEIGHTS } from './config';
import { clamp } from './rng';
import type { ObjectiveResult, PhaseConfig, SimState } from './types';

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

export interface ScoreBreakdown {
  components: Record<keyof typeof SCORE_WEIGHTS, number>;
  objectiveBonus: number;
  total: number;
  grade: string;
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

  const base = s.baseline.infrastructure || 70;
  const infrastructure = clamp(100 * (s.metrics.infrastructure / base) - 0, 0, 100);

  // Efficiency: penalize waste (spurious responses, failed responses) and idle hoarding — not spending per se.
  let efficiency = 65;
  if (c.totalSpent > 0) {
    const waste = c.wastedCredits / c.totalSpent;
    efficiency = 100 - waste * 160 - c.failedResponses * 2;
  }
  const hoard = Math.max(0, s.credits - 2000) / 60;
  efficiency = clamp(efficiency - hoard);

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

  const components = { readiness, network, stability, response, infrastructure, efficiency, information, recovery };
  const weighted = (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce(
    (x, k) => x + SCORE_WEIGHTS[k] * components[k], 0,
  );
  const met = s.objectiveResults.filter((r) => r.met).length;
  const objectiveBonus = Math.min(8, met * 1);
  const total = clamp(weighted + objectiveBonus);
  const grade = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F';
  return { components, objectiveBonus, total, grade };
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
  const worst = Object.values(s.regions).sort((a, b) => a.stability - b.stability)[0];
  if (worst.stability < 50) out.push({ tone: 'poor', text: `${worst.name} ended at stability ${Math.round(worst.stability)}. Regional recovery packages and resolving unrest early prevent cascading instability.` });
  if (!out.length) out.push({ tone: 'neutral', text: 'Not enough activity yet to draw conclusions.' });
  return out;
}
