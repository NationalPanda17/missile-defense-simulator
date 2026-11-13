// The simulation tick. Advances one simulated hour. Pure state mutation — no UI dependencies.
import { INVESTMENTS, SIM_CONFIG, TACTICAL_CONFIG, levelOf } from './config';
import { restockStockpiles, siteDamageShare } from './tactical';
import { SEV_FACTOR, TEMPLATE_MAP, maybeGenerateEvent, spawnEvent } from './events';
import { isActive, recomputeMetrics } from './metrics';
import { clamp, rand } from './rng';
import { evaluateObjectives } from './scoring';
import { scheduleWaves, tickTactical } from './tactical';
import type { Asset, GameEvent, LogLevel, OneTimeEffects, RegionId, SimState } from './types';
import { DOMAINS, REGION_IDS } from './types';

export function log(s: SimState, level: LogLevel, text: string, region?: RegionId, eventId?: string) {
  s.log.push({ t: s.hour, level, text, region, eventId });
  if (s.log.length > 800) s.log.splice(0, s.log.length - 800);
}

export function applyOneTime(s: SimState, e: GameEvent | null, fx: OneTimeEffects, region?: RegionId) {
  const rid = region ?? e?.region;
  const regions = e?.global ? REGION_IDS : rid ? [rid] : [];
  for (const id of regions) {
    const r = s.regions[id];
    if (fx.stability) r.stability = clamp(r.stability + fx.stability * (e?.global ? 0.6 : 1));
    if (fx.infrastructure) r.infrastructure = clamp(r.infrastructure + fx.infrastructure * (e?.global ? 0.6 : 1));
  }
  if (fx.assetCondition) {
    for (const a of targetAssets(s, e)) a.condition = clamp(a.condition + fx.assetCondition);
  }
  if (fx.personnel) s.personnel = clamp(s.personnel + fx.personnel, 0, s.personnelMax);
  if (fx.credits) s.credits += fx.credits;
  if (fx.resilience) s.resilience = clamp(s.resilience + fx.resilience);
}

function targetAssets(s: SimState, e: GameEvent | null, domain?: string): Asset[] {
  if (!e) return [];
  if (e.assetId && !domain) {
    const a = s.assets.find((x) => x.id === e.assetId);
    return a ? [a] : [];
  }
  const t = TEMPLATE_MAP.get(e.templateId);
  const doms = domain ? [domain] : t?.target?.domains ?? e.domains;
  return s.assets.filter(
    (a) => doms.includes(a.domain) && (e.global || (a.domain === 'space' ? a.coverage.includes(e.region) : a.region === e.region)),
  );
}

export function maintenanceCostMult(s: SimState): number {
  let m = 1;
  for (const e of s.events) {
    if (!isActive(e) || !e.isGenuine) continue;
    for (const f of e.effects) if (f.kind === 'maintenanceCostMult') m = Math.max(m, f.value);
  }
  return m;
}

function supportBonus(s: SimState, region: RegionId) {
  return s.assets.some((a) => a.region === region && a.role === 'support' && a.status === 'operational') ? 0.05 : 0;
}

export function responseSuccessChance(s: SimState, e: GameEvent, responseId: string): number {
  const t = TEMPLATE_MAP.get(e.templateId);
  const resp = t?.responses.find((r) => r.id === responseId);
  if (!resp) return 0;
  let p = resp.baseSuccess;
  if (resp.domainDependency) p *= 0.5 + 0.5 * (s.metrics.domainEffective[resp.domainDependency] / 100);
  if (resp.networkDependent) p *= 0.5 + 0.5 * (s.regions[e.region].comms / 100);
  p += supportBonus(s, e.region);
  return clamp(p, 0.05, 0.99);
}

function releaseCrews(s: SimState, n: number) {
  s.crewsBusy = Math.max(0, s.crewsBusy - n);
}

function tickAssets(s: SimState) {
  const weatherRegions = new Set(s.events.filter((e) => isActive(e) && e.category === 'weather' && e.isGenuine).map((e) => e.region));
  for (const a of s.assets) {
    if (a.status === 'maintenance') {
      a.maintenanceRemaining -= 1;
      if (a.maintenanceRemaining <= 0) {
        a.status = 'operational';
        a.condition = Math.max(a.condition, 96);
        a.hoursToService = SIM_CONFIG.serviceInterval[a.domain];
        a.restoredAt = s.hour;
        releaseCrews(s, 1);
        s.counters.maintenanceDone++;
        log(s, 'success', `${a.name} returned to service after maintenance.`, a.region);
      }
      continue;
    }
    if (a.status === 'transit') {
      a.maintenanceRemaining -= 1;
      if (a.maintenanceRemaining <= 0 && a.transitTo) {
        a.region = a.transitTo;
        a.coverage = [a.transitTo];
        if (a.transitRoute) a.pos = [...a.transitRoute.to];
        else {
          const c = s.regions[a.transitTo].center;
          a.pos = [c[0] + (rand(s) - 0.5) * 14, c[1] + (rand(s) - 0.5) * 8];
        }
        a.transitTo = undefined;
        a.transitRoute = undefined;
        a.status = 'operational';
        log(s, 'info', `${a.name} arrived on station in ${s.regions[a.region].name}.`, a.region);
      }
      continue;
    }
    const before = a.condition;
    let decay = SIM_CONFIG.decayPerHour[a.domain];
    if (a.hoursToService < 0) decay *= SIM_CONFIG.overdueDecayMult;
    if (weatherRegions.has(a.region) && (a.domain === 'air' || a.domain === 'sea')) decay *= 1.6;
    a.condition = clamp(a.condition - decay);
    a.hoursToService -= 1;
    if (a.hoursToService === 0) log(s, 'warn', `${a.name} is due for scheduled maintenance.`, a.region);
    if (before >= SIM_CONFIG.statusThresholds.offline && a.condition < SIM_CONFIG.statusThresholds.offline) {
      s.counters.assetFailures++;
      log(s, 'crit', `${a.name} has dropped OFFLINE (condition ${a.condition.toFixed(0)}%).`, a.region);
    }
    if (s.hour % 6 === 0) {
      a.history.push(Math.round(a.condition));
      if (a.history.length > 120) a.history.shift();
    }
  }
}

function applyEventDrift(s: SimState, e: GameEvent) {
  for (const f of e.effects) {
    switch (f.kind) {
      case 'assetDecay':
        for (const a of targetAssets(s, e, f.domain)) if (a.status !== 'maintenance') a.condition = clamp(a.condition - f.value);
        break;
      case 'stabilityDrift':
        for (const id of e.global ? REGION_IDS : [e.region]) s.regions[id].stability = clamp(s.regions[id].stability + f.value);
        break;
      case 'infraDrift':
        s.regions[e.region].infrastructure = clamp(s.regions[e.region].infrastructure + f.value * (1 - s.regions[e.region].infrastructure / 250));
        break;
      case 'personnelDrift':
        s.personnel = clamp(s.personnel + f.value, 0, s.personnelMax);
        break;
      case 'creditsDrain':
        s.credits = Math.max(0, s.credits + f.value);
        break;
    }
  }
}

function escalate(s: SimState, e: GameEvent) {
  const t = TEMPLATE_MAP.get(e.templateId);
  const wasHidden = e.hiddenLive;
  e.status = 'escalated';
  e.hiddenLive = false;
  e.resolvedAt = s.hour;
  e.outcome = t?.escalation.text ?? 'Event escalated.';
  e.log.push({ t: s.hour, text: `ESCALATED: ${e.outcome}` });
  s.counters.escalations++;
  if (t) {
    const fx = { ...t.escalation.effects };
    const sf = SEV_FACTOR[e.severity];
    for (const k of Object.keys(fx) as (keyof OneTimeEffects)[]) fx[k] = (fx[k] ?? 0) * sf;
    applyOneTime(s, e, fx);
  }
  log(s, 'crit', `${wasHidden ? 'Previously dismissed report ' : ''}${e.id} ${e.title} (${s.regions[e.region].name}) ESCALATED. ${e.outcome}`, e.region, e.id);
  const phase = s.phases[s.phaseIndex];
  if (t && phase.chains) {
    for (const sp of t.escalation.spawns) {
      if (rand(s) < sp.chance) {
        const child = spawnEvent(s, sp.templateId, { region: e.region, parentId: e.id });
        if (child) {
          child.log.push({ t: s.hour, text: `Follow-on complication from ${e.id}.` });
          log(s, 'warn', `Follow-on event ${child.id} ${child.title} triggered by ${e.id}.`, child.region, child.id);
        }
      }
    }
  }
}

function completeResponse(s: SimState, e: GameEvent) {
  const t = TEMPLATE_MAP.get(e.templateId)!;
  const resp = t.responses.find((r) => r.id === e.responseId)!;
  releaseCrews(s, resp.crews);
  e.progress = 100;
  if (!e.isGenuine) {
    e.status = 'dismissed';
    e.resolvedAt = s.hour;
    e.outcome = 'Response teams found no actionable issue. The report was spurious; resources were expended without effect.';
    s.counters.falseResponded++;
    s.counters.wastedCredits += e.spent;
    log(s, 'warn', `${e.id}: ${resp.label} complete — report was SPURIOUS. ${e.spent} credits expended without effect.`, e.region, e.id);
    e.log.push({ t: s.hour, text: 'Response complete. No issue found — report spurious.' });
    return;
  }
  const p = e.responseChance ?? responseSuccessChance(s, e, resp.id); // older saves have no locked chance
  if (rand(s) < p) {
    e.status = 'resolved';
    e.resolvedAt = s.hour;
    e.outcome = `Resolved by ${resp.label}.`;
    applyOneTime(s, e, resp.onSuccess);
    s.counters.resolved++;
    log(s, 'success', `${e.id} ${e.title} RESOLVED (${resp.label}).`, e.region, e.id);
    e.log.push({ t: s.hour, text: `Resolved by ${resp.label}.` });
  } else {
    e.status = 'reported';
    e.progress = 0;
    e.responseId = undefined;
    e.deadline = Math.max(e.deadline, s.hour + 6);
    s.counters.failedResponses++;
    log(s, 'warn', `${e.id}: ${resp.label} did not succeed (${Math.round(p * 100)}% chance). Event remains active.`, e.region, e.id);
    e.log.push({ t: s.hour, text: `${resp.label} unsuccessful. Decision window extended to T+${e.deadline}h.` });
  }
}

function tickEvents(s: SimState) {
  for (const e of s.events) {
    const live = isActive(e) || e.hiddenLive;
    if (!live) continue;
    if (e.reportedAt === s.hour && e.reportedAt > e.occurredAt) {
      log(s, 'intel', `DELAYED REPORT ${e.id}: ${e.title} in ${s.regions[e.region].name} (occurred ${s.hour - e.occurredAt}h ago).`, e.region, e.id);
    } else if (e.reportedAt === s.hour && e.occurredAt === s.hour) {
      // reported on creation — already logged in generation step
    }
    if (e.isGenuine) applyEventDrift(s, e);
    if (e.hiddenLive) {
      if (s.hour >= e.deadline) escalate(s, e);
      continue;
    }
    if (e.reportedAt > s.hour) {
      if (s.hour >= e.deadline) {
        if (e.isGenuine) escalate(s, e);
        else e.status = 'expired';
      }
      continue;
    }

    // Confidence evolution
    const r = s.regions[e.region];
    if (e.status !== 'confirming') {
      if (e.isGenuine) e.confidence = clamp(e.confidence + (r.awareness / 100) * 1.2, 5, 97);
      else e.confidence = clamp(e.confidence - (r.awareness / 100) * 0.8, 3, 97);
    }

    if (e.status === 'confirming') {
      const hours = SIM_CONFIG.confirmHours * (1.5 - r.comms / 200);
      e.confirmProgress = Math.min(100, e.confirmProgress + 100 / hours);
      if (e.confirmProgress >= 100) {
        s.counters.confirmations++;
        if (e.isGenuine) {
          e.status = 'reported';
          e.confidence = Math.max(e.confidence, 92);
          e.conflicting = false;
          e.reportedSeverity = [e.severity, e.severity];
          log(s, 'intel', `${e.id} CONFIRMED by independent source. Severity assessed ${e.severity}.`, e.region, e.id);
          e.log.push({ t: s.hour, text: 'Independent confirmation: CONFIRMED.' });
        } else {
          e.status = 'expired';
          e.confidence = 4;
          e.resolvedAt = s.hour;
          e.outcome = 'Independent confirmation found no corroborating evidence. Report closed as spurious.';
          s.counters.falseDismissed++;
          log(s, 'intel', `${e.id} NOT CORROBORATED — closed as a spurious report.`, e.region, e.id);
          e.log.push({ t: s.hour, text: 'Independent confirmation: NOT CORROBORATED. Closed.' });
        }
        continue;
      }
    }

    if (e.status === 'responding' && e.responseHours) {
      e.progress = Math.min(100, e.progress + 100 / e.responseHours);
      if (e.progress >= 99.999) completeResponse(s, e);
      continue;
    }

    if (s.hour >= e.deadline) {
      if (e.isGenuine) escalate(s, e);
      else {
        e.status = 'expired';
        e.resolvedAt = s.hour;
        e.outcome = 'No corroborating evidence emerged. Report lapsed.';
        log(s, 'info', `${e.id} lapsed — no corroborating evidence.`, e.region, e.id);
      }
    } else if (e.deadline - s.hour === 4 && e.status === 'reported') {
      log(s, 'warn', `${e.id} ${e.title}: decision window closes in 4h.`, e.region, e.id);
    }
  }
  // Trim old closed events to bound memory
  if (s.events.length > 400) s.events = s.events.filter((e, i) => isActive(e) || e.hiddenLive || i > s.events.length - 300);
}

function tickProjects(s: SimState) {
  for (const p of s.projects) {
    p.progress = Math.min(100, p.progress + 100 / p.hours);
  }
  const done = s.projects.filter((p) => p.progress >= 100);
  s.projects = s.projects.filter((p) => p.progress < 100);
  for (const p of done) completeProject(s, p.investmentId, p.region, p.domain, p.label);
}

function completeProject(s: SimState, id: string, region?: RegionId, domain?: string, label?: string) {
  switch (id) {
    case 'harden':
      if (region) s.regions[region].infrastructure = clamp(s.regions[region].infrastructure + 18);
      break;
    case 'resilience':
      s.resilience = clamp(s.resilience + 15);
      break;
    case 'crews':
      s.crews += 1;
      break;
    case 'recruit':
      s.personnelMax += 15;
      s.personnel = clamp(s.personnel + 25, 0, s.personnelMax);
      break;
    case 'restore_comms':
      for (const a of s.assets) if ((a.role === 'comms' || a.role === 'command') && a.region === region) a.condition = clamp(a.condition + 30);
      for (const e of s.events) {
        if (isActive(e) && e.region === region && e.category === 'comms' && e.severity <= 2 && e.status !== 'responding') {
          e.status = 'resolved'; e.resolvedAt = s.hour; e.outcome = 'Cleared by communications restoration team.';
          if (e.isGenuine) s.counters.resolved++;
        }
      }
      break;
    case 'recalibrate':
      for (const a of s.assets) if (a.role === 'sensor' && a.domain === domain) a.condition = clamp(a.condition + 20);
      break;
    case 'rebuild':
      if (region && s.tactical) {
        for (const site of s.tactical.sites) if (site.region === region) site.integrity = Math.min(100, site.integrity + 35);
        log(s, 'success', `Damaged sites in ${s.regions[region].name} rebuilt.`, region);
      }
      break;
    case 'recovery':
      if (region) {
        s.regions[region].stability = clamp(s.regions[region].stability + 20);
        s.regions[region].infrastructure = clamp(s.regions[region].infrastructure + 8);
      }
      break;
    case 'modernize':
      s.modernization = Math.min(30, s.modernization + 6);
      for (const a of s.assets) a.upkeep *= 0.9;
      break;
  }
  const inv = INVESTMENTS.find((i) => i.id === id);
  log(s, 'success', `Project complete: ${label ?? inv?.label}.`, region);
}

function tickEconomy(s: SimState) {
  const upkeep = s.assets.reduce((x, a) => x + a.upkeep, 0);
  const income = SIM_CONFIG.baseIncomePerHour * levelOf(s.settings).incomeMult * (0.5 + s.metrics.stability / 200);
  s.credits = Math.max(0, s.credits + income - upkeep);
  const drain = reserveDrain(s);
  if (drain > 0) {
    s.credits -= drain;
    s.reserveLost = (s.reserveLost ?? 0) + drain;
  }
  s.personnel = clamp(s.personnel + SIM_CONFIG.personnelRegenPerHour, 0, s.personnelMax);
  const shortage = s.events.some((e) => isActive(e) && e.isGenuine && e.category === 'logistics');
  s.logistics = clamp(s.logistics + (shortage ? -0.6 : 0.3));
}

function tickRegions(s: SimState) {
  for (const id of REGION_IDS) {
    const r = s.regions[id];
    const target = 30 + 0.25 * r.readiness + 0.2 * r.awareness + 0.2 * r.infrastructure + 0.1 * r.comms - r.threatLevel * 0.8
      - TACTICAL_CONFIG.consequences.stability * siteDamageShare(s, id); // damaged sites keep weighing on the region
    r.stability = clamp(r.stability + (target - r.stability) * SIM_CONFIG.stabilityInertia);
    if (r.stability > 60) r.infrastructure = clamp(r.infrastructure + 0.015);
  }
}

function sample(s: SimState) {
  const m = s.metrics;
  s.history.push({
    t: s.hour,
    readiness: +m.globalReadiness.toFixed(1),
    network: +m.network.toFixed(1),
    stability: +m.stability.toFixed(1),
    infoQuality: +m.infoQuality.toFixed(1),
    infrastructure: +m.infrastructure.toFixed(1),
    credits: Math.round(s.credits),
    domains: Object.fromEntries(DOMAINS.map((d) => [d, +m.domainEffective[d].toFixed(1)])) as SimState['history'][number]['domains'],
    regions: Object.fromEntries(REGION_IDS.map((id) => [id, +s.regions[id].readiness.toFixed(1)])) as SimState['history'][number]['regions'],
    activeEvents: s.events.filter(isActive).length,
  });
  if (s.history.length > 2400) s.history.shift();
  s.minReadiness = Math.min(s.minReadiness, m.globalReadiness);
}

function checkAchievements(s: SimState) {
  const add = (id: string, text: string) => {
    if (!s.achievements.includes(id)) {
      s.achievements.push(id);
      log(s, 'success', `ACHIEVEMENT UNLOCKED: ${text}`);
    }
  };
  if (s.counters.resolved >= 10) add('resolver', 'Crisis Manager — resolve 10 events');
  if (s.counters.falseDismissed >= 3) add('skeptic', 'Healthy Skepticism — expose 3 spurious reports');
  if (s.metrics.network >= 90) add('backbone', 'Iron Backbone — network health 90%+');
  if (s.counters.maintenanceDone >= 10) add('wrench', 'Preventive Mindset — 10 maintenance cycles');
  if (s.modernization >= 12) add('modern', 'Future Force — two modernization tranches');
  if (s.hour >= 48 && s.counters.escalations === 0) add('clean48', 'Clean Watch — 48h with zero escalations');
}

/** Advance the simulation one hour. */
/** Credits reclaimed this hour from reserves above the threshold (0 in training). */
export function reserveDrain(s: SimState): number {
  if (s.settings.mode === 'training') return 0;
  const { threshold, ratePerHour } = SIM_CONFIG.reserve;
  return Math.max(0, s.credits - threshold) * ratePerHour;
}

export function tick(s: SimState): void {
  if (s.status !== 'running') return;
  s.hour += 1;
  const phase = s.phases[s.phaseIndex];
  const phaseHour = s.hour - s.phaseStartHour;

  tickAssets(s);
  tickEvents(s);
  for (const sc of phase.scripted) {
    if (sc.atHour === phaseHour) {
      const e = spawnEvent(s, sc.templateId, { region: sc.region, scripted: true });
      if (e) log(s, e.severity >= 3 ? 'crit' : 'warn', `NEW ${e.id}: ${e.title} — ${s.regions[e.region].name}${e.global ? ' (GLOBAL)' : ''}.`, e.region, e.id);
    }
  }
  const ne = maybeGenerateEvent(s);
  if (ne && ne.reportedAt <= s.hour) {
    log(s, ne.severity >= 3 ? 'crit' : 'warn', `NEW ${ne.id}: ${ne.title} — ${s.regions[ne.region].name}.`, ne.region, ne.id);
  }
  tickTactical(s);
  tickProjects(s);
  tickEconomy(s);
  recomputeMetrics(s);
  tickRegions(s);
  sample(s);
  checkAchievements(s);

  if (s.hour % 12 === 0) {
    const perf = (s.metrics.globalReadiness + s.metrics.network) / 2;
    s.difficulty = clamp(0.8 + (perf - 60) / 80, 0.8, 1.3);
  }

  if (phaseHour >= phase.hours) endPhase(s);
}

export function endPhase(s: SimState) {
  const phase = s.phases[s.phaseIndex];
  const results = evaluateObjectives(s, phase);
  for (const r of results) {
    s.objectiveResults.push(r);
    const obj = phase.objectives.find((o) => o.id === r.objectiveId);
    if (r.met && obj?.reward) s.credits += obj.reward;
  }
  const met = results.filter((r) => r.met).length;
  log(s, met === results.length ? 'success' : 'warn', `PHASE ${phase.id} "${phase.name}" complete — ${met}/${results.length} objectives met.`);
  s.paused = true;
  if (s.phaseIndex < s.phases.length - 1) {
    s.phaseIndex += 1;
    s.status = 'briefing';
    scheduleWaves(s); // forecast the next phase's waves before the player deploys
  } else {
    s.status = 'complete';
    log(s, 'info', 'Scenario complete. After-action review available.');
  }
}

/** Called when the player accepts a briefing. */
export function beginPhase(s: SimState) {
  if (s.status !== 'briefing') return;
  const phase = s.phases[s.phaseIndex];
  if (s.hour === 0 && s.history.length === 0) {
    recomputeMetrics(s);
    s.baseline = { infrastructure: s.metrics.infrastructure, readiness: s.metrics.globalReadiness };
    sample(s);
  }
  s.phaseStartHour = s.hour;
  recomputeMetrics(s);
  s.phaseStart = { readiness: s.metrics.globalReadiness, infrastructure: s.metrics.infrastructure };
  if (s.phaseIndex > 0) restockStockpiles(s);
  s.status = 'running';
  s.paused = false;
  if (phase.grant) {
    s.credits += phase.grant;
    log(s, 'success', `Phase funding released: +${phase.grant} credits.`);
  }
  log(s, 'info', `PHASE ${phase.id} BEGINS — ${phase.name}.`);
}

export function advance(s: SimState, hours: number) {
  for (let i = 0; i < hours && s.status === 'running'; i++) tick(s);
}

/** Where an asset is at continuous sim time t (hours, may be fractional): moves along its transit route if any. */
export function assetPosAt(a: Asset, t: number, hour: number): [number, number] {
  const r = a.transitRoute;
  if (a.status !== 'transit' || !r) return a.pos;
  const remaining = Math.max(0, a.maintenanceRemaining - (t - hour));
  const k = Math.min(1, Math.max(0, 1 - remaining / r.hours));
  return [r.from[0] + (r.to[0] - r.from[0]) * k, r.from[1] + (r.to[1] - r.from[1]) * k];
}
