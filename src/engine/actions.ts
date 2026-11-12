// Player commands. Every command validates, applies costs, mutates state and records itself in the command log.
import { INVESTMENTS, SIM_CONFIG, TACTICAL_CONFIG } from './config';
import { log, maintenanceCostMult, beginPhase as begin, advance } from './engine';
import { EQUIPMENT_MAP, equipmentCost, equipmentUpkeep } from './equipment';
import { addDeployment, ensureTactical, insideTheater, isUnlimited, removeDeployment, theaterToLonLat } from './tactical';
import { TEMPLATE_MAP } from './events';
import { isActive, recomputeMetrics } from './metrics';
import type { Domain, RegionId, SimState, SpendCategory } from './types';

export type Command =
  | { type: 'respond'; eventId: string; responseId: string }
  | { type: 'confirm'; eventId: string }
  | { type: 'dismiss'; eventId: string }
  | { type: 'maintain'; assetId: string }
  | { type: 'redeploy'; assetId: string; region: RegionId }
  | { type: 'invest'; investmentId: string; region?: RegionId; domain?: Domain }
  | { type: 'cancelMaintenance'; assetId: string }
  | { type: 'deploy'; equipmentId: string; region: RegionId; x: number; y: number }
  | { type: 'relocate'; deploymentId: string; x: number; y: number }
  | { type: 'withdraw'; deploymentId: string }
  | { type: 'resupply'; deploymentId: string }
  | { type: 'beginPhase' }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setSpeed'; speed: 1 | 2 | 4 | 8 }
  | { type: 'setTurnBased'; on: boolean }
  | { type: 'advance'; hours: number };

export interface CommandResult { ok: boolean; message: string }

const fail = (message: string): CommandResult => ({ ok: false, message });

function spend(s: SimState, credits: number, personnel: number, cat: SpendCategory) {
  s.credits -= credits;
  s.personnel -= personnel;
  s.spendByCategory[cat] += credits;
  s.counters.totalSpent += credits;
}

function record(s: SimState, kind: string, text: string, credits: number, category: SpendCategory | 'control', eventId?: string) {
  s.commands.push({ t: s.hour, kind, text, credits, category, eventId });
  if (s.commands.length > 600) s.commands.shift();
}

export function crewsFree(s: SimState) {
  return s.crews - s.crewsBusy;
}

export function maintenanceCost(s: SimState, domain: Domain) {
  return Math.round(SIM_CONFIG.maintenanceCost[domain] * maintenanceCostMult(s));
}

export function canAfford(s: SimState, credits: number, personnel: number, crews: number): string | null {
  if (s.credits < credits) return `Insufficient credits (${credits} required).`;
  if (s.personnel < personnel) return `Insufficient personnel (${personnel} required).`;
  if (crewsFree(s) < crews) return `No maintenance crew available (${crews} required).`;
  return null;
}

export function execute(s: SimState, cmd: Command): CommandResult {
  const res = run(s, cmd);
  if (res.ok) recomputeMetrics(s);
  return res;
}

function run(s: SimState, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'setPaused':
      if (s.status !== 'running') return fail('Simulation is not running.');
      s.paused = cmd.paused;
      record(s, 'control', cmd.paused ? 'Simulation paused.' : 'Simulation resumed.', 0, 'control');
      return { ok: true, message: cmd.paused ? 'Paused' : 'Resumed' };
    case 'setSpeed':
      s.speed = cmd.speed;
      return { ok: true, message: `Speed ${cmd.speed}x` };
    case 'setTurnBased':
      s.turnBased = cmd.on;
      if (cmd.on) s.paused = true;
      record(s, 'control', `Turn-based mode ${cmd.on ? 'enabled' : 'disabled'}.`, 0, 'control');
      return { ok: true, message: `Turn-based ${cmd.on ? 'on' : 'off'}` };
    case 'advance':
      if (s.status !== 'running') return fail('Simulation is not running.');
      advance(s, cmd.hours);
      return { ok: true, message: `Advanced ${cmd.hours}h` };
    case 'beginPhase':
      begin(s);
      return { ok: true, message: 'Phase started' };
  }

  if (s.status === 'complete') return fail('Scenario is complete.');

  switch (cmd.type) {
    case 'respond': {
      const e = s.events.find((x) => x.id === cmd.eventId);
      if (!e || !isActive(e)) return fail('Event is not active.');
      if (e.status === 'responding') return fail('A response is already underway.');
      const t = TEMPLATE_MAP.get(e.templateId)!;
      const r = t.responses.find((x) => x.id === cmd.responseId);
      if (!r) return fail('Unknown response.');
      if (r.passive) {
        if (e.monitored) return fail('Monitoring extension already used for this event.');
        e.monitored = true;
        e.deadline += r.hours;
        e.log.push({ t: s.hour, text: `Monitoring only. Decision window extended by ${r.hours}h.` });
        record(s, 'monitor', `${e.id}: monitor only (+${r.hours}h window).`, 0, 'response', e.id);
        log(s, 'info', `${e.id} placed under monitoring.`, e.region, e.id);
        return { ok: true, message: 'Monitoring' };
      }
      const err = canAfford(s, r.credits, r.personnel, r.crews);
      if (err) return fail(err);
      spend(s, r.credits, r.personnel, 'response');
      s.crewsBusy += r.crews;
      if (e.status === 'confirming') e.confirmProgress = 0;
      e.status = 'responding';
      e.responseId = r.id;
      e.responseStarted = s.hour;
      e.responseHours = r.hours;
      e.progress = 0;
      e.spent += r.credits;
      s.counters.responsesTotal++;
      if (e.confidence >= 85) s.counters.responsesOnConfirmed++;
      s.counters.responseTimes.push(Math.max(0, s.hour - e.reportedAt));
      e.log.push({ t: s.hour, text: `Response ordered: ${r.label} (${r.credits} cr, ${r.hours}h).` });
      record(s, 'respond', `${e.id} ${e.title}: ${r.label} (confidence ${Math.round(e.confidence)}%).`, r.credits, 'response', e.id);
      log(s, 'info', `Response ordered for ${e.id}: ${r.label}.`, e.region, e.id);
      return { ok: true, message: `${r.label} ordered` };
    }
    case 'confirm': {
      const e = s.events.find((x) => x.id === cmd.eventId);
      if (!e || e.status !== 'reported') return fail('Event cannot be confirmed now.');
      if (e.confidence >= 92) return fail('Event already confirmed.');
      if (s.credits < SIM_CONFIG.confirmCost) return fail('Insufficient credits.');
      spend(s, SIM_CONFIG.confirmCost, 0, 'confirmation');
      e.status = 'confirming';
      e.confirmProgress = 0;
      e.spent += SIM_CONFIG.confirmCost;
      e.log.push({ t: s.hour, text: 'Independent confirmation tasked.' });
      record(s, 'confirm', `${e.id}: independent confirmation tasked.`, SIM_CONFIG.confirmCost, 'confirmation', e.id);
      return { ok: true, message: 'Confirmation tasked' };
    }
    case 'dismiss': {
      const e = s.events.find((x) => x.id === cmd.eventId);
      if (!e || (e.status !== 'reported' && e.status !== 'confirming')) return fail('Event cannot be dismissed now.');
      e.status = 'dismissed';
      e.resolvedAt = s.hour;
      e.log.push({ t: s.hour, text: 'Dismissed by command as unreliable/irrelevant.' });
      if (e.isGenuine) {
        e.hiddenLive = true;
        s.counters.genuineDismissed++;
        e.outcome = 'Dismissed — but the event was genuine and continued to develop.';
      } else {
        s.counters.falseDismissed++;
        e.outcome = 'Dismissed — correctly identified as a spurious report.';
      }
      record(s, 'dismiss', `${e.id} ${e.title} dismissed at ${Math.round(e.confidence)}% confidence.`, 0, 'response', e.id);
      log(s, 'info', `${e.id} dismissed by command.`, e.region, e.id);
      return { ok: true, message: 'Dismissed' };
    }
    case 'maintain': {
      const a = s.assets.find((x) => x.id === cmd.assetId);
      if (!a) return fail('Unknown asset.');
      if (a.status === 'maintenance' || a.status === 'transit') return fail('Asset is not available for maintenance.');
      const cost = maintenanceCost(s, a.domain);
      const err = canAfford(s, cost, 2, 1);
      if (err) return fail(err);
      spend(s, cost, 2, 'maintenance');
      s.crewsBusy += 1;
      a.status = 'maintenance';
      a.maintenanceRemaining = SIM_CONFIG.maintenanceHours[a.domain];
      record(s, 'maintain', `Maintenance scheduled: ${a.name} (${a.maintenanceRemaining}h).`, cost, 'maintenance');
      log(s, 'info', `${a.name} entered maintenance (${a.maintenanceRemaining}h).`, a.region);
      return { ok: true, message: `${a.name} in maintenance` };
    }
    case 'cancelMaintenance': {
      const a = s.assets.find((x) => x.id === cmd.assetId);
      if (!a || a.status !== 'maintenance') return fail('Asset is not in maintenance.');
      a.status = 'operational';
      a.maintenanceRemaining = 0;
      s.crewsBusy = Math.max(0, s.crewsBusy - 1);
      record(s, 'maintain', `Maintenance cancelled: ${a.name}.`, 0, 'maintenance');
      return { ok: true, message: 'Maintenance cancelled' };
    }
    case 'redeploy': {
      const a = s.assets.find((x) => x.id === cmd.assetId);
      if (!a) return fail('Unknown asset.');
      if (a.role === 'defense') return fail('Tactical equipment is moved with relocate, during a briefing.');
      if (a.domain !== 'air' && a.domain !== 'sea') return fail('Only air and maritime assets can be redeployed.');
      if (a.status === 'maintenance' || a.status === 'transit') return fail('Asset is busy.');
      if (a.region === cmd.region) return fail('Asset is already assigned there.');
      const cost = SIM_CONFIG.redeployCost[a.domain];
      const err = canAfford(s, cost, 2, 0);
      if (err) return fail(err);
      spend(s, cost, 2, 'redeploy');
      a.status = 'transit';
      a.transitTo = cmd.region;
      a.maintenanceRemaining = SIM_CONFIG.redeployHours[a.domain];
      record(s, 'redeploy', `${a.name} redeployed ${a.region} → ${cmd.region}.`, cost, 'redeploy');
      log(s, 'info', `${a.name} en route to ${s.regions[cmd.region].name} (${a.maintenanceRemaining}h).`, cmd.region);
      return { ok: true, message: 'Redeploying' };
    }
    case 'invest': {
      const inv = INVESTMENTS.find((i) => i.id === cmd.investmentId);
      if (!inv) return fail('Unknown investment.');
      if (inv.scope === 'region' && !cmd.region) return fail('Select a region.');
      if (inv.scope === 'domain' && !cmd.domain) return fail('Select a domain.');
      if (s.projects.some((p) => p.investmentId === inv.id && p.region === cmd.region && p.domain === cmd.domain))
        return fail('An identical project is already underway.');
      if (inv.id === 'modernize' && s.modernization >= 30) return fail('Modernization is at maximum.');
      const err = canAfford(s, inv.credits, inv.personnel, 0);
      if (err) return fail(err);
      spend(s, inv.credits, inv.personnel, 'investment');
      const target = cmd.region ? ` — ${s.regions[cmd.region].name}` : cmd.domain ? ` — ${cmd.domain.toUpperCase()}` : '';
      s.projects.push({
        id: `PRJ-${s.nextId++}`, investmentId: inv.id, label: inv.label + target, region: cmd.region, domain: cmd.domain,
        startedAt: s.hour, hours: inv.hours, progress: 0,
      });
      record(s, 'invest', `Investment: ${inv.label}${target}.`, inv.credits, 'investment');
      log(s, 'info', `Project started: ${inv.label}${target} (${inv.hours}h).`, cmd.region);
      return { ok: true, message: 'Project started' };
    }
    case 'deploy': {
      const t = ensureTactical(s);
      if (!t.enabled) return fail('The tactical layer is only available in the campaign.');
      if (s.status !== 'briefing') return fail('Equipment can only be deployed during a briefing.');
      const spec = EQUIPMENT_MAP.get(cmd.equipmentId);
      if (!spec) return fail('Unknown equipment.');
      if (!s.regions[cmd.region]) return fail('Unknown region.');
      if (!insideTheater(cmd.x, cmd.y)) return fail('Position is outside the theater.');
      const cost = equipmentCost(spec);
      const err = canAfford(s, cost, TACTICAL_CONFIG.deployPersonnel, 0);
      if (err) return fail(err);
      spend(s, cost, TACTICAL_CONFIG.deployPersonnel, 'investment');
      const d = addDeployment(s, spec, cmd.region, Math.round(cmd.x), Math.round(cmd.y), equipmentUpkeep(spec));
      record(s, 'deploy', `Deployed ${spec.name} to ${s.regions[cmd.region].name}.`, cost, 'investment');
      log(s, 'info', `${spec.name} deployed in ${s.regions[cmd.region].name} (${d.id}).`, cmd.region);
      return { ok: true, message: `${spec.name} deployed` };
    }
    case 'relocate': {
      const t = ensureTactical(s);
      const d = t.deployments.find((x) => x.id === cmd.deploymentId);
      if (!d) return fail('Unknown deployment.');
      if (s.status !== 'briefing') return fail('Equipment can only be relocated during a briefing.');
      if (!insideTheater(cmd.x, cmd.y)) return fail('Position is outside the theater.');
      const err = canAfford(s, TACTICAL_CONFIG.relocateCost, 0, 0);
      if (err) return fail(err);
      spend(s, TACTICAL_CONFIG.relocateCost, 0, 'redeploy');
      d.x = Math.round(cmd.x);
      d.y = Math.round(cmd.y);
      const a = s.assets.find((x) => x.id === d.assetId);
      if (a) a.pos = theaterToLonLat(s, d.region, d.x, d.y);
      const name = EQUIPMENT_MAP.get(d.equipmentId)?.name ?? d.equipmentId;
      record(s, 'relocate', `Relocated ${name} (${d.id}).`, TACTICAL_CONFIG.relocateCost, 'redeploy');
      return { ok: true, message: `${name} relocated` };
    }
    case 'withdraw': {
      const t = ensureTactical(s);
      const d = t.deployments.find((x) => x.id === cmd.deploymentId);
      if (!d) return fail('Unknown deployment.');
      const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
      const refund = Math.floor(equipmentCost(spec) * TACTICAL_CONFIG.withdrawRefund);
      removeDeployment(s, d);
      s.credits += refund;
      s.personnel = Math.min(s.personnelMax, s.personnel + TACTICAL_CONFIG.deployPersonnel);
      record(s, 'withdraw', `Withdrew ${spec.name} (${d.id}), +${refund} credits recovered.`, 0, 'investment');
      log(s, 'info', `${spec.name} withdrawn from ${s.regions[d.region].name}.`, d.region);
      return { ok: true, message: `${spec.name} withdrawn` };
    }
    case 'resupply': {
      const t = ensureTactical(s);
      const d = t.deployments.find((x) => x.id === cmd.deploymentId);
      if (!d) return fail('Unknown deployment.');
      const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
      if (isUnlimited(spec)) return fail(`${spec.name} does not need resupply.`);
      if (d.reloadRemaining !== undefined) return fail('A resupply is already underway.');
      if (d.stock >= spec.magazine) return fail('Magazine is already full.');
      if (s.logistics < TACTICAL_CONFIG.minLogisticsForResupply) return fail('Logistics capacity is too low to resupply.');
      const cost = Math.ceil(equipmentCost(spec) * TACTICAL_CONFIG.resupplyRate * (1 - d.stock / spec.magazine));
      const err = canAfford(s, cost, 0, 0);
      if (err) return fail(err);
      spend(s, cost, 0, 'maintenance');
      d.reloadRemaining = spec.reloadHours;
      record(s, 'resupply', `Resupply ordered: ${spec.name} (${d.id}), ${spec.reloadHours}h.`, cost, 'maintenance');
      log(s, 'info', `${spec.name} resupplying (${spec.reloadHours}h).`, d.region);
      return { ok: true, message: 'Resupply ordered' };
    }
  }
}
