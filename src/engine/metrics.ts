// Derived-metric computation and the cross-domain dependency model.
import { SIM_CONFIG } from './config';
import { clamp } from './rng';
import type { AlertLevel, Asset, Domain, EffectSpec, GameEvent, RegionId, SimState } from './types';
import { DOMAINS, REGION_IDS } from './types';

export const isActive = (e: GameEvent) => e.status === 'reported' || e.status === 'confirming' || e.status === 'responding';
export const isKnown = (s: SimState, e: GameEvent) => e.reportedAt <= s.hour;

export function deriveStatus(a: Asset): Asset['status'] {
  if (a.status === 'maintenance' || a.status === 'transit') return a.status;
  if (a.condition < SIM_CONFIG.statusThresholds.offline) return 'offline';
  if (a.condition < SIM_CONFIG.statusThresholds.degraded) return 'degraded';
  return 'operational';
}

/** Collect flat penalties from active, genuine events. */
function collectPenalties(s: SimState) {
  const comms: Partial<Record<RegionId, number>> = {};
  const awareness: Partial<Record<RegionId, number>> = {};
  const domain: Partial<Record<string, number>> = {};
  let global = 0;
  for (const e of s.events) {
    if (!isActive(e) || !e.isGenuine) continue;
    for (const f of e.effects) applyFlat(f, e.region);
  }
  function applyFlat(f: EffectSpec, r: RegionId) {
    if (f.kind === 'commsPenalty') comms[r] = (comms[r] ?? 0) + f.value;
    if (f.kind === 'awarenessPenalty') awareness[r] = (awareness[r] ?? 0) + f.value;
    if (f.kind === 'globalCommsPenalty') global += f.value;
    if (f.kind === 'domainPenalty' && f.domain) domain[`${r}:${f.domain}`] = (domain[`${r}:${f.domain}`] ?? 0) + f.value;
  }
  return { comms, awareness, domain, global };
}

export function mitigation(s: SimState) {
  return 1 - Math.min(0.5, s.resilience * SIM_CONFIG.resilienceMitigation);
}

/** Fraction (0-1+) of nominal output an asset currently provides. */
export function availability(s: SimState, a: Asset, domainPen?: Partial<Record<string, number>>): number {
  if (a.status === 'maintenance' || a.status === 'transit' || a.status === 'offline') return 0;
  let v = a.condition / 100;
  if (a.status === 'degraded') v *= 0.75;
  v *= 1 + s.modernization / 100;
  const pen = domainPen?.[`${a.region}:${a.domain}`] ?? 0;
  return Math.max(0, v * (1 - pen / 100));
}

export function recomputeMetrics(s: SimState): void {
  for (const a of s.assets) a.status = deriveStatus(a);
  const pen = collectPenalties(s);
  const mit = mitigation(s);
  const av = new Map<string, number>();
  for (const a of s.assets) av.set(a.id, availability(s, a, pen.domain));

  // Raw domain readiness
  const raw = {} as Record<Domain, number>;
  const commsRaw = {} as Record<Domain, number>;
  for (const d of DOMAINS) {
    const list = s.assets.filter((a) => a.domain === d);
    const cap = list.reduce((x, a) => x + a.capability, 0) || 1;
    raw[d] = clamp((list.reduce((x, a) => x + a.capability * av.get(a.id)!, 0) / cap) * 100, 0, 110);
    const comms = list.filter((a) => a.role === 'comms' || a.role === 'command');
    const ccap = comms.reduce((x, a) => x + a.capability * (a.role === 'command' ? 0.5 : 1), 0) || 1;
    commsRaw[d] = comms.length
      ? (comms.reduce((x, a) => x + a.capability * (a.role === 'command' ? 0.5 : 1) * av.get(a.id)!, 0) / ccap) * 100
      : raw[d];
  }

  // Global network health
  let network = DOMAINS.reduce((x, d) => x + SIM_CONFIG.commsWeight[d] * commsRaw[d], 0);
  network = clamp(network - pen.global * mit);

  // Effective domain readiness with cross-domain dependencies
  const eff = {} as Record<Domain, number>;
  for (const d of DOMAINS) {
    let v = raw[d];
    const deps = SIM_CONFIG.dependencies[d];
    for (const dep of Object.keys(deps) as Domain[]) {
      v *= 1 - (deps[dep] ?? 0) * (1 - Math.min(100, raw[dep]) / 100);
    }
    v *= 1 - SIM_CONFIG.networkWeight[d] * (1 - network / 100);
    eff[d] = clamp(v);
  }
  const effRatio = (d: Domain) => (raw[d] > 0 ? eff[d] / Math.min(100, raw[d]) : 0);

  // Regional metrics
  for (const id of REGION_IDS) {
    const r = s.regions[id];
    const local = s.assets.filter(
      (a) => (a.role === 'comms' || a.role === 'command') && (a.domain === 'space' ? a.coverage.includes(id) : a.region === id),
    );
    const lcap = local.reduce((x, a) => x + a.capability, 0) || 1;
    const localComms = local.length ? local.reduce((x, a) => x + a.capability * av.get(a.id)!, 0) / lcap : 0.5;
    r.comms = clamp((network * 0.55 + localComms * 100 * 0.45 - (pen.comms[id] ?? 0) * mit) * (0.7 + 0.3 * (r.infrastructure / 100)));

    const sensors = s.assets.filter((a) => a.role === 'sensor' && (a.coverage.includes(id) || a.region === id) && a.status !== 'transit');
    const sum = sensors.reduce((x, a) => x + a.capability * av.get(a.id)! * effRatio(a.domain), 0);
    r.awareness = clamp(Math.min(100, (sum / 70) * 100) * (0.6 + 0.4 * (r.comms / 100)) - (pen.awareness[id] ?? 0) * mit);

    const home = s.assets.filter((a) => a.region === id && a.domain !== 'space');
    const homeR = home.length ? home.reduce((x, a) => x + Math.min(1, av.get(a.id)!) * effRatio(a.domain), 0) / home.length : 0.5;
    r.readiness = clamp(homeR * 100 * (0.6 + 0.4 * (r.infrastructure / 100)));

    r.threatLevel = s.events
      .filter((e) => isActive(e) && e.isGenuine && e.region === id)
      .reduce((x, e) => x + e.severity * 6, 0);
  }

  const regs = REGION_IDS.map((id) => s.regions[id]);
  const avg = (f: (r: (typeof regs)[number]) => number) => regs.reduce((x, r) => x + f(r), 0) / regs.length;
  const sensorAssets = s.assets.filter((a) => a.role === 'sensor');
  const scap = sensorAssets.reduce((x, a) => x + a.capability, 0) || 1;

  const globalReadiness = clamp(DOMAINS.reduce((x, d) => x + SIM_CONFIG.readinessWeight[d] * eff[d], 0));
  const activeKnown = s.events.filter((e) => isActive(e) && isKnown(s, e));
  const avgConf = activeKnown.length ? activeKnown.reduce((x, e) => x + e.confidence, 0) / activeKnown.length : 80;
  const infoQuality = clamp(0.45 * avg((r) => r.awareness) + 0.35 * avg((r) => r.comms) + 0.2 * avgConf);

  const sevActive = activeKnown.filter((e) => e.severity >= 3).length;
  let alert: AlertLevel = 'NORMAL';
  if (activeKnown.some((e) => e.severity === 4) || globalReadiness < 50 || network < 40) alert = 'SEVERE';
  else if (sevActive >= 2 || network < 55 || globalReadiness < 60) alert = 'HIGH';
  else if (activeKnown.length >= 3 || globalReadiness < 70) alert = 'ELEVATED';

  s.metrics = {
    globalReadiness,
    network,
    sensorAvailability: clamp((sensorAssets.reduce((x, a) => x + a.capability * Math.min(1, av.get(a.id)!), 0) / scap) * 100),
    infrastructure: avg((r) => r.infrastructure),
    stability: avg((r) => r.stability),
    infoQuality,
    domainRaw: raw,
    domainEffective: eff,
    maintenanceBacklog: s.assets.filter((a) => a.hoursToService < 0 && a.status !== 'maintenance').length,
    alert,
  };
}

export function confidenceLabel(c: number): { label: string; tone: 'green' | 'cyan' | 'amber' | 'red' } {
  if (c >= 85) return { label: 'CONFIRMED', tone: 'green' };
  if (c >= 60) return { label: 'PROBABLE', tone: 'cyan' };
  if (c >= 35) return { label: 'POSSIBLE', tone: 'amber' };
  return { label: 'UNVERIFIED', tone: 'red' };
}
