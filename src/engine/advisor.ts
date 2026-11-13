// The adjutant: an optional advisor that points out things a commander might miss. Pure: it only reads the state,
// and it only uses what the player could know (forecasts and warnings, never hidden ground truth).
import { SIM_CONFIG } from './config';
import { EQUIPMENT_MAP, isEffector } from './equipment';
import { isActive } from './metrics';
import { incomingWaves, isUnlimited, resupplyRounds, siteDamageShare, stockpileOf } from './tactical';
import { formatObjective, objectiveMet, objectiveValue } from './scoring';
import { WEATHER, conditionsAt } from './weather';
import type { Domain, Objective, RegionId, SimState } from './types';
import { REGION_IDS } from './types';

export type AdviceLevel = 'urgent' | 'warn' | 'info';

export interface Advice {
  /** Stable while the situation lasts, so a dismissed piece of advice stays dismissed until it changes. */
  id: string;
  level: AdviceLevel;
  text: string;
  /** Where to go to act on it. */
  action?: { label: string; view: string; region?: RegionId; eventId?: string; assetId?: string; deploy?: boolean };
}

const DOMAIN_VIEW: Record<Domain, string> = { space: 'space', air: 'air', sea: 'sea', ground: 'ground' };
/** Where to go to work on each kind of objective. */
const OBJECTIVE_VIEW: Record<Objective['metric'], string> = {
  readiness: 'global', network: 'comms', stability: 'global', infrastructure: 'infra', maintenanceDone: 'air',
  confirmations: 'intel', escalationsMax: 'global', resolved: 'global', falseDismissed: 'intel', credits: 'logistics',
  readinessGain: 'global', infrastructureGain: 'infra',
};
const ORDER: Record<AdviceLevel, number> = { urgent: 0, warn: 1, info: 2 };

/** Should the adjutant be available for this scenario? Training lessons have the coach instead. */
export const adjutantApplies = (s: SimState) => s.settings.mode !== 'training';

export function advise(s: SimState): Advice[] {
  if (s.status === 'complete') return [];
  const out: Advice[] = [];
  const t = s.tactical?.enabled ? s.tactical : null;
  const name = (r: RegionId) => s.regions[r].name;

  if (t) {
    const upcoming = t.waves.filter((w) => w.phaseIndex === s.phaseIndex && !w.resolved);
    const incoming = incomingWaves(s);
    // Regions the player has been told to expect attacks in: the forecast, plus any wave already in the warning window.
    const threatened = new Set<RegionId>([
      ...t.forecast.filter((r) => upcoming.some((w) => w.region === r)),
      ...incoming.map((x) => x.wave.region),
    ]);

    // Forecast regions with nothing that can shoot.
    for (const r of threatened) {
      const armed = t.deployments.some((d) => (d.region === r || d.transit?.region === r) && isEffector(EQUIPMENT_MAP.get(d.equipmentId)!));
      if (armed) continue;
      const surprise = incoming.some((x) => x.wave.region === r && !x.wave.forecast);
      out.push({
        id: `undefended:${r}:${s.phaseIndex}`,
        level: 'urgent',
        text: surprise
          ? `A wave is heading for ${name(r)}, outside the forecast, and nothing there can engage it. Emergency-redeploy a system now.`
          : `Attacks are expected in ${name(r)}, but nothing there can engage threats.${s.status === 'running' ? (t.deployments.length ? ' Emergency-redeploy a system there.' : ' New defenses can only be placed in the next briefing.') : ''}`,
        action: s.status === 'briefing' ? { label: 'Deploy', view: 'theater', region: r, deploy: true } : { label: 'Theater', view: 'theater', region: r },
      });
    }

    // Low magazines where an attack is expected.
    for (const d of t.deployments) {
      const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
      if (!isEffector(spec) || isUnlimited(spec) || d.reloadRemaining !== undefined || d.transit || !threatened.has(d.region)) continue;
      if (d.stock > Math.max(2, Math.floor(spec.magazine * 0.25))) continue;
      if (resupplyRounds(s, d) <= 0) continue; // nothing to resupply with: the stockpile warning covers it
      out.push({
        id: `ammo:${d.id}:${d.stock}`,
        level: d.stock === 0 ? 'urgent' : 'warn',
        text: `${name(d.region)}’s ${spec.name} is ${d.stock === 0 ? 'out of rounds' : `down to ${d.stock} round${d.stock === 1 ? '' : 's'}`} and a wave is expected. Resupply it.`,
        action: { label: 'Theater', view: 'theater', region: d.region },
      });
    }

    // An interceptor type whose national stockpile is empty while its units run low.
    for (const [id, left] of Object.entries(t.stockpile ?? {})) {
      if (!Number.isFinite(stockpileOf(s, id)) || left > 0) continue;
      const lowUnits = t.deployments.filter((d) => d.equipmentId === id && d.stock <= EQUIPMENT_MAP.get(id)!.magazine / 2);
      if (!lowUnits.length) continue;
      const spec = EQUIPMENT_MAP.get(id)!;
      out.push({
        id: `stockpile:${id}:${s.phaseIndex}`,
        level: 'warn',
        text: `The national stockpile of ${spec.name} rounds is empty until the next phase, and ${lowUnits.length} unit${lowUnits.length === 1 ? ' is' : 's are'} below half. Save them for the waves that matter, or lean on other systems.`,
        action: { label: 'Theater', view: 'theater', region: lowUnits[0].region },
      });
    }

    // Weather or darkness at an incoming wave's launch.
    for (const x of incoming) {
      if (x.launched) continue;
      const c = conditionsAt(s, x.wave.region, x.wave.launchAt ?? x.wave.atHour);
      if (!c.storm && !c.night) continue;
      const nightGuns = c.night && t.deployments.some((d) => d.region === x.wave.region && WEATHER.nightLimited.includes(d.equipmentId));
      if (!c.storm && !nightGuns) continue;
      out.push({
        id: `wx:${x.wave.id}`,
        level: 'info',
        text: `The wave due at ${name(x.wave.region)} launches ${c.storm ? 'in a storm: sensors there see only 60% of their normal range' : ''}${c.storm && nightGuns ? ', and ' : ''}${nightGuns ? 'at night: Stinger, Avenger and ZU-23-2 are less accurate in the dark' : ''}. An alert helps detection.`,
        action: { label: 'Theater', view: 'theater', region: x.wave.region },
      });
    }

    // A wave inside the warning window, defended, with no alert raised.
    if (s.status === 'running') {
      for (const x of incoming) {
        const r = x.wave.region;
        if (x.launched || x.launchIn > 3 || (t.alerts ?? []).some((a) => a.region === r && a.until > s.hour)) continue;
        if (!t.deployments.some((d) => d.region === r)) continue;
        out.push({
          id: `alert:${x.wave.id}`,
          level: 'info',
          text: `A wave is due to launch at ${name(r)} in about ${Math.max(1, Math.round(x.launchIn))}h. Raising an alert now improves detection and reaction.`,
          action: { label: 'Theater', view: 'theater', region: r },
        });
      }
    }
  }

  // Damage that carries over: badly hit regions keep losing stability and draw more attacks until rebuilt.
  if (t) {
    for (const r of REGION_IDS) {
      const share = siteDamageShare(s, r);
      if (share < 0.2 || s.projects.some((p) => p.investmentId === 'rebuild' && p.region === r)) continue;
      out.push({
        id: `rebuild:${r}:${Math.round(share * 10)}`,
        level: 'info',
        text: `${name(r)}’s sites are down to ${Math.round(100 - share * 100)}% of their value. That keeps pulling stability down and makes it a likelier target; Rebuild Damaged Sites repairs them.`,
        action: { label: 'Logistics', view: 'logistics' },
      });
    }
  }

  // Assets overdue for service.
  const overdue = s.assets.filter((a) => a.role !== 'defense' && a.hoursToService < 0 && a.status !== 'maintenance' && a.status !== 'transit');
  if (overdue.length) {
    const byDomain = new Map<Domain, number>();
    for (const a of overdue) byDomain.set(a.domain, (byDomain.get(a.domain) ?? 0) + 1);
    const top = [...byDomain.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const crewsFree = s.crews - s.crewsBusy;
    out.push({
      id: `overdue:${overdue.length}`,
      level: overdue.length >= 3 ? 'warn' : 'info',
      text: `${overdue.length === 1 ? `${overdue[0].name} is` : `${overdue.length} assets are`} overdue for service and wearing ${SIM_CONFIG.overdueDecayMult}x faster.${crewsFree > 0 ? ` ${crewsFree} crew${crewsFree === 1 ? ' is' : 's are'} free.` : ' All crews are busy.'}`,
      action: overdue.length === 1 ? { label: 'Open', view: DOMAIN_VIEW[overdue[0].domain], assetId: overdue[0].id } : { label: 'Show', view: DOMAIN_VIEW[top] },
    });
  }

  // Phase objectives heading for a miss.
  if (s.status === 'running') {
    const phase = s.phases[s.phaseIndex];
    const elapsed = s.hour - s.phaseStartHour;
    const left = phase.hours - elapsed;
    if (phase.objectives.length) {
      for (const o of phase.objectives) {
        const v = objectiveValue(s, o.metric);
        if (objectiveMet(o.metric, v, o.target) && !(o.metric === 'escalationsMax' && v === o.target)) continue;
        // Counts and gains start at zero, so they are only "at risk" once a third of the phase has gone; a level below
        // its target (network, readiness, stability...) is worth saying at once.
        const isCount = ['maintenanceDone', 'confirmations', 'resolved', 'falseDismissed', 'readinessGain', 'infrastructureGain'].includes(o.metric);
        if (isCount && elapsed < phase.hours / 3) continue;
        const shown = Number.isInteger(o.target) && ['maintenanceDone', 'confirmations', 'resolved', 'falseDismissed', 'escalationsMax'].includes(o.metric)
          ? `${Math.round(v)} of ${o.target}` : `${formatObjective(o.metric, v)} vs ${formatObjective(o.metric, o.target)}`;
        out.push({
          id: `objective:${s.phaseIndex}:${o.id}:${Math.round(v)}`,
          level: left <= phase.hours / 4 ? 'warn' : 'info',
          text: o.metric === 'escalationsMax'
            ? `Objective at its limit: ${o.text} (${shown}). One more escalation misses it.`
            : `Objective at risk: ${o.text} (${shown}), ${left}h left in the phase.`,
          action: { label: 'How', view: OBJECTIVE_VIEW[o.metric] },
        });
      }
    }
  }

  if (s.status === 'running') {
    const known = s.events.filter((e) => isActive(e) && e.reportedAt <= s.hour);
    // Reports about to escalate with nothing done.
    for (const e of known) {
      const left = e.deadline - s.hour;
      if (e.status === 'reported' && left <= 4 && left >= 0) {
        out.push({
          id: `deadline:${e.id}`,
          level: e.severity >= 3 ? 'urgent' : 'warn',
          text: `${e.title} (${name(e.region)}) escalates in ${Math.max(1, Math.round(left))}h and nothing has been ordered.`,
          action: { label: 'Open', view: 'global', eventId: e.id },
        });
      }
    }
    // Uncertain reports left sitting.
    const stale = known.filter((e) => e.status === 'reported' && e.confidence < 55 && s.hour - e.reportedAt >= 6 && e.deadline - s.hour > 4);
    if (stale.length) {
      out.push({
        id: `stale:${stale.map((e) => e.id).join(',')}`,
        level: 'info',
        text: `${stale.length === 1 ? 'A low-confidence report has' : `${stale.length} low-confidence reports have`} waited 6h or more. A confirmation (${SIM_CONFIG.confirmCost} cr) would settle ${stale.length === 1 ? 'it' : 'them'}.`,
        action: { label: 'Open', view: 'intel', eventId: stale[0].id },
      });
    }
    // Running out of money with work still open.
    if (s.credits < 150 && known.length) {
      out.push({
        id: `credits:${Math.floor(s.hour / 24)}`,
        level: 'warn',
        text: `Only ${Math.round(s.credits)} credits left with ${known.length} event${known.length === 1 ? '' : 's'} open. Hold back on new investments.`,
        action: { label: 'Logistics', view: 'logistics' },
      });
    }
  }

  return out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
