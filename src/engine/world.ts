// Fictional starting world: regions and asset inventory. All names and figures are invented and abstract.
import { CAMPAIGN_PHASES, REGION_DEFS, SIM_CONFIG } from './config';
import { LESSON_MAP, lessonPhase } from './training';
import { recomputeMetrics } from './metrics';
import { rand } from './rng';
import { normalizeTactical } from './scenarios';
import { createTactical, scheduleWaves } from './tactical';
import type {
  Asset, AssetRole, Domain, GameMode, PhaseConfig, Region, RegionId, ScenarioSettings, SimState,
} from './types';
import { DOMAINS, REGION_IDS } from './types';

interface AssetSeed {
  name: string;
  className: string;
  domain: Domain;
  role: AssetRole;
  region: RegionId;
  coverage?: RegionId[];
  capability: number;
  pos: [number, number];
}

const SEEDS: AssetSeed[] = [
  // ── SPACE ─────────────────────────────────────────────
  { name: 'VIGIL-1', className: 'Survey Satellite', domain: 'space', role: 'sensor', region: 'NAM', coverage: ['NAM', 'SAM', 'POL'], capability: 30, pos: [-100, 60] },
  { name: 'VIGIL-2', className: 'Survey Satellite', domain: 'space', role: 'sensor', region: 'EUR', coverage: ['EUR', 'AFR', 'MDE'], capability: 30, pos: [20, 60] },
  { name: 'VIGIL-3', className: 'Survey Satellite', domain: 'space', role: 'sensor', region: 'IPA', coverage: ['IPA', 'MDE', 'POL'], capability: 30, pos: [120, 50] },
  { name: 'AURORA-P', className: 'Polar Survey Satellite', domain: 'space', role: 'sensor', region: 'POL', coverage: ['POL', 'NAM', 'EUR', 'IPA'], capability: 22, pos: [-20, 80] },
  { name: 'LODESTAR-A', className: 'Relay Satellite', domain: 'space', role: 'comms', region: 'NAM', coverage: ['NAM', 'SAM', 'EUR'], capability: 34, pos: [-60, 0] },
  { name: 'LODESTAR-B', className: 'Relay Satellite', domain: 'space', role: 'comms', region: 'MDE', coverage: ['EUR', 'AFR', 'MDE'], capability: 34, pos: [40, 0] },
  { name: 'LODESTAR-C', className: 'Relay Satellite', domain: 'space', role: 'comms', region: 'IPA', coverage: ['IPA', 'POL', 'SAM'], capability: 34, pos: [140, 0] },
  { name: 'HALCYON', className: 'Orbital Resilience Node', domain: 'space', role: 'comms', region: 'AFR', coverage: ['AFR', 'SAM', 'MDE', 'POL'], capability: 18, pos: [0, -20] },
  // ── AIR ───────────────────────────────────────────────
  { name: 'KESTREL-07', className: 'Airborne Surveillance Platform', domain: 'air', role: 'sensor', region: 'NAM', capability: 24, pos: [-88, 38] },
  { name: 'KESTREL-11', className: 'Airborne Surveillance Platform', domain: 'air', role: 'sensor', region: 'EUR', capability: 24, pos: [8, 49] },
  { name: 'KESTREL-14', className: 'Airborne Surveillance Platform', domain: 'air', role: 'sensor', region: 'IPA', capability: 24, pos: [132, 30] },
  { name: 'KESTREL-19', className: 'Airborne Surveillance Platform', domain: 'air', role: 'sensor', region: 'MDE', capability: 24, pos: [50, 30] },
  { name: 'ALBATROSS-2', className: 'Airborne Relay Aircraft', domain: 'air', role: 'comms', region: 'AFR', capability: 16, pos: [22, -5] },
  { name: 'HERON-5', className: 'Support Transport Wing', domain: 'air', role: 'support', region: 'SAM', capability: 14, pos: [-55, -12] },
  // ── SEA ───────────────────────────────────────────────
  { name: 'TIDEWATCH', className: 'Ocean Survey Vessel', domain: 'sea', role: 'sensor', region: 'IPA', capability: 22, pos: [150, 10] },
  { name: 'NORTHGALE', className: 'Ocean Survey Vessel', domain: 'sea', role: 'sensor', region: 'EUR', capability: 22, pos: [-25, 50] },
  { name: 'ICEWARD', className: 'Polar Survey Vessel', domain: 'sea', role: 'sensor', region: 'POL', capability: 20, pos: [-10, 72] },
  { name: 'MERIDIAN', className: 'Maritime Command Ship', domain: 'sea', role: 'comms', region: 'IPA', capability: 20, pos: [88, -8] },
  { name: 'CORMORANT', className: 'Fleet Support Vessel', domain: 'sea', role: 'support', region: 'AFR', capability: 14, pos: [-15, -12] },
  { name: 'PELICAN', className: 'Fleet Support Vessel', domain: 'sea', role: 'support', region: 'SAM', capability: 14, pos: [-30, -30] },
];

// Ground network: one sensor station, relay hub and command center per region (fewer in the polar zone).
const GROUND_POS: Record<RegionId, [number, number][]> = {
  NAM: [[-110, 52], [-82, 40], [-98, 32]],
  SAM: [[-65, -5], [-47, -18], [-66, -30]],
  EUR: [[2, 47], [22, 54], [12, 60]],
  AFR: [[3, 12], [28, -5], [24, -26]],
  MDE: [[44, 32], [55, 24], [38, 25]],
  IPA: [[100, 40], [134, -25], [78, 22]],
  POL: [[-42, 72], [30, -78]],
};

function groundSeeds(): AssetSeed[] {
  const out: AssetSeed[] = [];
  for (const id of REGION_IDS) {
    const p = GROUND_POS[id];
    out.push({ name: `BASTION-${id}`, className: 'Regional Sensor Station', domain: 'ground', role: 'sensor', region: id, capability: 26, pos: p[0] });
    out.push({ name: `RELAY-${id}`, className: 'Communications Relay Hub', domain: 'ground', role: 'comms', region: id, capability: 22, pos: p[1] });
    if (p[2]) out.push({ name: `KEYSTONE-${id}`, className: 'Regional Command Center', domain: 'ground', role: 'command', region: id, capability: 24, pos: p[2] });
  }
  return out;
}

const UPKEEP: Record<Domain, number> = { space: 0.6, air: 0.35, sea: 0.4, ground: 0.2 };

export function defaultSettings(mode: GameMode, overrides: Partial<ScenarioSettings> = {}): ScenarioSettings {
  const base: ScenarioSettings = {
    name: 'Operation Steadfast Horizon',
    mode,
    seed: Math.floor(Math.random() * 1e9),
    startCredits: 1200,
    startPersonnel: 80,
    crews: 4,
    eventFrequency: 1,
    falseReportRate: 0.18,
    durationHours: 240,
    regionStability: {},
    regionInfrastructure: {},
    domainCondition: {},
  };
  if (mode === 'crisis') {
    Object.assign(base, {
      name: 'Crisis Scenario: Cascading Blackout',
      startCredits: 650, startPersonnel: 55, crews: 3, eventFrequency: 1.4, falseReportRate: 0.3, durationHours: 96,
      regionStability: { MDE: 42, AFR: 48, IPA: 55 },
      regionInfrastructure: { MDE: 50, AFR: 55 },
      domainCondition: { space: 70, air: 62 },
    });
  }
  if (mode === 'training') {
    Object.assign(base, { name: 'Training: Command Familiarization', startCredits: 1500, eventFrequency: 0.5, falseReportRate: 0.2, durationHours: 96, seed: 4242 });
  }
  if (mode === 'sandbox') base.name = 'Sandbox Simulation';
  return { ...base, ...overrides };
}

export function buildPhases(settings: ScenarioSettings): PhaseConfig[] {
  if (settings.mode === 'campaign') return CAMPAIGN_PHASES.map((p) => ({ ...p }));
  if (settings.mode === 'crisis') {
    const p3 = CAMPAIGN_PHASES[2];
    return [{
      ...p3, id: 1, name: 'Cascading Blackout', hours: settings.durationHours, grant: 0,
      eventRate: p3.eventRate * settings.eventFrequency, falseRate: settings.falseReportRate,
      scripted: [
        { atHour: 1, templateId: 'solar_surge' },
        { atHour: 4, templateId: 'unrest', region: 'MDE' },
        { atHour: 10, templateId: 'global_outage' },
        { atHour: 30, templateId: 'storm', region: 'IPA' },
        { atHour: 52, templateId: 'parts_shortage', region: 'EUR' },
      ],
      situation: 'A geomagnetic storm has coincided with unrest in two regions. Communications are fragile, resources are thin and reports are unreliable. Hold the network together for four days.',
      objectives: [
        { id: 'c_net', text: 'Keep network health at or above 50%', metric: 'network', target: 50, reward: 0 },
        { id: 'c_stab', text: 'Keep average stability at or above 50', metric: 'stability', target: 50, reward: 0 },
        { id: 'c_esc', text: 'Allow no more than 5 escalations', metric: 'escalationsMax', target: 5, reward: 0 },
      ],
    }];
  }
  if (settings.mode === 'training') {
    const lesson = settings.lesson ? LESSON_MAP.get(settings.lesson) : undefined;
    if (lesson) return [lessonPhase(lesson, settings)];
    return [{
      id: 1, name: 'Command Familiarization', hours: settings.durationHours, eventRate: 0.05, falseRate: settings.falseReportRate,
      maxSeverity: 2, delayedInfo: false, conflicting: false, chains: false,
      categories: ['sensor', 'aircraft', 'ground', 'weather', 'comms'],
      scripted: [
        { atHour: 1, templateId: 'sensor_drift', region: 'EUR' },
        { atHour: 2, templateId: 'false_contact', region: 'SAM' },
        { atHour: 8, templateId: 'relay_degradation', region: 'AFR' },
      ],
      grant: 0,
      situation: 'This is a guided training scenario. Events are slow and forgiving. Follow the tutorial panel to learn each part of the command interface.',
      special: ['Reduced event tempo', 'Tutorial guidance enabled', 'Scripted teaching events'],
      objectives: [
        { id: 't_conf', text: 'Task an independent confirmation', metric: 'confirmations', target: 1, reward: 0 },
        { id: 't_maint', text: 'Complete one maintenance cycle', metric: 'maintenanceDone', target: 1, reward: 0 },
        { id: 't_res', text: 'Resolve two events', metric: 'resolved', target: 2, reward: 0 },
      ],
    }];
  }
  // sandbox
  return [{
    id: 1, name: 'Open Simulation', hours: settings.durationHours, eventRate: 0.12 * settings.eventFrequency,
    falseRate: settings.falseReportRate, maxSeverity: 4, delayedInfo: true, conflicting: true, chains: true,
    categories: ['sensor', 'comms', 'satellite', 'aircraft', 'maritime', 'ground', 'logistics', 'weather', 'instability', 'information', 'personnel'],
    scripted: [], grant: 0,
    situation: 'Free-play simulation using your custom configuration. All event categories, chains and uncertainty systems are active.',
    special: ['All event types enabled', `Event frequency x${settings.eventFrequency.toFixed(1)}`, `False report rate ${Math.round(settings.falseReportRate * 100)}%`],
    objectives: [
      { id: 's_ready', text: 'Hold global readiness at or above 70%', metric: 'readiness', target: 70, reward: 0 },
      { id: 's_net', text: 'Hold network health at or above 70%', metric: 'network', target: 70, reward: 0 },
      { id: 's_stab', text: 'Hold average stability at or above 60', metric: 'stability', target: 60, reward: 0 },
    ],
  }];
}

export function createInitialState(settings: ScenarioSettings): SimState {
  const rngHolder = { rng: settings.seed >>> 0 };
  const jitter = (a: number) => (rand(rngHolder) - 0.5) * 2 * a;

  const regions = {} as Record<RegionId, Region>;
  for (const def of REGION_DEFS) {
    regions[def.id] = {
      id: def.id, name: def.name, short: def.short, center: def.center,
      stability: settings.regionStability[def.id] ?? Math.round(72 + jitter(8)),
      infrastructure: settings.regionInfrastructure[def.id] ?? Math.round(74 + jitter(10)),
      awareness: 0, comms: 0, readiness: 0, threatLevel: 0,
    };
  }

  const assets: Asset[] = [...SEEDS, ...groundSeeds()].map((s, i) => {
    const baseCond = settings.domainCondition[s.domain] ?? 84;
    const condition = Math.round(Math.max(30, Math.min(100, baseCond + jitter(12))));
    const interval = SIM_CONFIG.serviceInterval[s.domain];
    return {
      id: `A${(i + 1).toString().padStart(3, '0')}`,
      name: s.name,
      className: s.className,
      domain: s.domain,
      role: s.role,
      region: s.region,
      coverage: s.coverage ?? [s.region],
      condition,
      capability: s.capability,
      status: 'operational',
      hoursToService: Math.round(interval * (0.15 + rand(rngHolder) * 0.85)),
      maintenanceRemaining: 0,
      upkeep: UPKEEP[s.domain],
      pos: s.pos,
      history: [condition],
    };
  });

  const phases = buildPhases(settings);
  const zeroDomains = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;

  const state: SimState = {
    version: 1,
    settings,
    hour: 0,
    startDate: Date.UTC(2031, 2, 14, 6, 0, 0),
    rng: rngHolder.rng,
    paused: true,
    speed: 1,
    turnBased: false,
    status: 'briefing',
    phaseIndex: 0,
    phaseStartHour: 0,
    phases,
    credits: settings.startCredits,
    personnel: settings.startPersonnel,
    personnelMax: 100,
    crews: settings.crews,
    crewsBusy: 0,
    resilience: 20,
    modernization: 0,
    logistics: 80,
    regions,
    assets,
    events: [],
    projects: [],
    log: [],
    commands: [],
    history: [],
    objectiveResults: [],
    achievements: [],
    counters: {
      maintenanceDone: 0, confirmations: 0, escalations: 0, resolved: 0, failedResponses: 0,
      falseDismissed: 0, genuineDismissed: 0, falseResponded: 0, responsesOnConfirmed: 0, responsesTotal: 0,
      assetFailures: 0, wastedCredits: 0, totalSpent: 0, responseTimes: [],
    },
    spendByCategory: { response: 0, maintenance: 0, investment: 0, redeploy: 0, confirmation: 0 },
    nextId: 1,
    difficulty: 1,
    metrics: {
      globalReadiness: 0, network: 0, sensorAvailability: 0, infrastructure: 0, stability: 0, infoQuality: 0,
      domainRaw: { ...zeroDomains }, domainEffective: { ...zeroDomains }, maintenanceBacklog: 0, alert: 'NORMAL',
    },
    baseline: { infrastructure: 0, readiness: 0 },
    minReadiness: 100,
  };
  recomputeMetrics(state);
  // Settle derived regional values so the opening briefing shows a coherent picture.
  recomputeMetrics(state);
  state.tactical = createTactical(state);
  if (state.tactical.enabled && settings.tactical) {
    state.settings.tactical = normalizeTactical(settings.tactical);
    state.credits = Math.max(0, state.credits + state.settings.tactical.budget);
  }
  scheduleWaves(state); // the first briefing forecasts phase 1's waves
  return state;
}
