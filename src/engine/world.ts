// Fictional starting world: regions and asset inventory. All names and figures are invented and abstract.
import { STORIES, CAMPAIGN_PHASES, COMMAND_LEVELS, REGION_DEFS, SIM_CONFIG, levelOf } from './config';
import { LESSON_MAP, lessonPhase } from './training';
import { recomputeMetrics } from './metrics';
import { rand } from './rng';
import { normalizeTactical } from './scenarios';
import { createTactical, scheduleWaves } from './tactical';
import { SAT_CLASS, tickSpace } from './space';
import { hash01 } from './weather';
import type {
  Asset, AssetRole, Domain, GameMode, Orbit, PhaseConfig, Region, RegionId, ScenarioSettings, SimState,
  CommandLevel,
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
  orbit?: Orbit;
}

/** Satellites added with real orbits. Listed after the original inventory so every older asset keeps its id. */
const NEW_SATS: AssetSeed[] = [
  { name: 'ARGUS-1', className: SAT_CLASS['SSO:imaging'], domain: 'space', role: 'sensor', region: 'EUR', capability: 10, pos: [0, 0], orbit: { regime: 'SSO', mission: 'imaging', incl: 98, raan: 20, phase: 0, fuel: 85 } },
  { name: 'ARGUS-2', className: SAT_CLASS['SSO:imaging'], domain: 'space', role: 'sensor', region: 'IPA', capability: 10, pos: [0, 0], orbit: { regime: 'SSO', mission: 'imaging', incl: 98, raan: 110, phase: 0.5, fuel: 90 } },
  { name: 'TRACER', className: SAT_CLASS['LEO:tracking'], domain: 'space', role: 'sensor', region: 'NAM', capability: 12, pos: [-30, 30], orbit: { regime: 'LEO', mission: 'tracking', incl: 53, fuel: 90, size: 24 } },
];

const SEEDS: AssetSeed[] = [
  // ── SPACE ─────────────────────────────────────────────
  { name: 'VIGIL-1', className: SAT_CLASS['GEO:warning'], domain: 'space', role: 'sensor', region: 'NAM', capability: 30, pos: [-100, 0], orbit: { regime: 'GEO', mission: 'warning', lon: -100, fuel: 80 } },
  { name: 'VIGIL-2', className: SAT_CLASS['GEO:warning'], domain: 'space', role: 'sensor', region: 'EUR', capability: 30, pos: [20, 0], orbit: { regime: 'GEO', mission: 'warning', lon: 20, fuel: 75 } },
  { name: 'VIGIL-3', className: SAT_CLASS['GEO:warning'], domain: 'space', role: 'sensor', region: 'IPA', capability: 30, pos: [105, 0], orbit: { regime: 'GEO', mission: 'warning', lon: 105, fuel: 70 } },
  { name: 'AURORA-P', className: SAT_CLASS['HEO:warning'], domain: 'space', role: 'sensor', region: 'POL', capability: 22, pos: [-40, 63], orbit: { regime: 'HEO', mission: 'warning', lon: -40, phase: 0.3, fuel: 60 } },
  { name: 'LODESTAR-A', className: SAT_CLASS['GEO:relay'], domain: 'space', role: 'comms', region: 'NAM', capability: 34, pos: [-60, 0], orbit: { regime: 'GEO', mission: 'relay', lon: -60, fuel: 70 } },
  { name: 'LODESTAR-B', className: SAT_CLASS['GEO:relay'], domain: 'space', role: 'comms', region: 'MDE', capability: 34, pos: [40, 0], orbit: { regime: 'GEO', mission: 'relay', lon: 40, fuel: 65 } },
  { name: 'LODESTAR-C', className: SAT_CLASS['GEO:relay'], domain: 'space', role: 'comms', region: 'IPA', capability: 34, pos: [140, 0], orbit: { regime: 'GEO', mission: 'relay', lon: 140, fuel: 75 } },
  { name: 'HALCYON', className: SAT_CLASS['MEO:nav'], domain: 'space', role: 'comms', region: 'AFR', capability: 18, pos: [0, -20], orbit: { regime: 'MEO', mission: 'nav', fuel: 100, size: 24 } },
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

/** Campaign settings at a difficulty level. Officer leaves the defaults untouched. */
export function withLevel(settings: ScenarioSettings, level: CommandLevel): ScenarioSettings {
  const lv = COMMAND_LEVELS[level];
  if (settings.mode !== 'campaign' || level === 'officer') return { ...settings, level: settings.mode === 'campaign' ? level : undefined };
  return {
    ...settings, level, name: `${settings.name} · ${lv.label}`,
    startCredits: Math.max(200, settings.startCredits + lv.credits), eventFrequency: settings.eventFrequency * lv.eventFrequency,
  };
}

/** One line for the briefing: what the difficulty level changes, with this phase's real false-report rate. */
function levelNote(lv: (typeof COMMAND_LEVELS)[CommandLevel], baseFalse: number, falseRate: number) {
  const pct = (x: number) => Math.round(x * 100);
  const more = (m: number, up: string, down: string) => (m > 1 ? `${pct(m - 1)}% ${up}` : `${pct(1 - m)}% ${down}`);
  const time = lv.deadlineMult === 1 ? '' : `, ${more(lv.deadlineMult, 'more', 'less')} time before reports escalate`;
  const income = lv.incomeMult === 1 ? '' : `, ${more(lv.incomeMult, 'more', 'less')} income`;
  return `${lv.label} difficulty: ${more(lv.eventFrequency, 'more', 'fewer')} incidents, ${pct(falseRate)}% of reports false (Officer ${pct(baseFalse)}%)${time}${income}, ${lv.waveSize > 1 ? 'bigger' : 'smaller'} attack waves`;
}

export function buildPhases(settings: ScenarioSettings): PhaseConfig[] {
  if (settings.mode === 'campaign') {
    const lv = levelOf(settings);
    const level = settings.level && settings.level in COMMAND_LEVELS ? settings.level : 'officer';
    return CAMPAIGN_PHASES.map((p) => {
      const falseRate = lv.falseMult === 1 ? p.falseRate : Math.min(0.6, p.falseRate * lv.falseMult);
      return {
        ...p,
        falseRate,
        objectives: p.objectives.map(({ byLevel, ...o }) => {
          const target = byLevel?.[level] ?? o.target;
          return target === o.target ? o : { ...o, target, text: o.text.replace(String(o.target), String(target)) };
        }),
        // The phase notes compare phases with each other; say plainly how the difficulty shifts all of them.
        special: level === 'officer' ? p.special : [levelNote(lv, p.falseRate, falseRate), ...p.special],
        // A written campaign renames the chapters and tells its own story.
        ...(settings.story && STORIES[settings.story]?.chapters[p.id - 1] ? { name: STORIES[settings.story].chapters[p.id - 1].name, situation: STORIES[settings.story].chapters[p.id - 1].situation } : {}),
      };
    });
  }
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
        { id: 'c_net', text: 'Average network health of 50% or more over the scenario', metric: 'networkAvg', target: 50, reward: 0 },
        { id: 'c_stab', text: 'Average regional stability of 50 or more over the scenario', metric: 'stabilityAvg', target: 50, reward: 0 },
        { id: 'c_esc', text: 'Allow no more than 5 escalations', metric: 'escalationsMax', target: 5, reward: 0 },
      ],
    }];
  }
  if (settings.mode === 'training') {
    const lesson = settings.lesson ? LESSON_MAP.get(settings.lesson) : undefined;
    if (lesson?.endless) {
      // Endless Defense: a briefing before every wave, for as long as the region holds.
      return Array.from({ length: lesson.endless.waves }, (_, i) => ({
        ...lessonPhase(lesson, settings), id: i + 1, name: `Wave ${i + 1}`, hours: lesson.endless!.hours, grant: i === 0 ? 0 : lesson.endless!.grant + lesson.endless!.grantStep * i,
      }));
    }
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
      { id: 's_ready', text: 'End with global readiness at 70% or higher', metric: 'readiness', target: 70, reward: 0 },
      { id: 's_net', text: 'Average network health of 70% or more over the scenario', metric: 'networkAvg', target: 70, reward: 0 },
      { id: 's_stab', text: 'Average regional stability of 60 or more over the scenario', metric: 'stabilityAvg', target: 60, reward: 0 },
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
      ...(s.orbit ? { orbit: { ...s.orbit } } : {}),
    };
  });
  // The newer satellites draw nothing from the random stream (from the seed instead), so every campaign that existed
  // before them still plays out the same way on the ground.
  NEW_SATS.forEach((sd, k) => {
    const h = (salt: number) => hash01(settings.seed, k, salt);
    const condition = Math.round(Math.max(30, Math.min(100, (settings.domainCondition.space ?? 84) + (h(1) - 0.5) * 24)));
    assets.push({
      id: `A${(assets.length + 1).toString().padStart(3, '0')}`, name: sd.name, className: sd.className, domain: sd.domain, role: sd.role, region: sd.region,
      coverage: [], condition, capability: sd.capability, status: 'operational',
      hoursToService: Math.round(SIM_CONFIG.serviceInterval.space * (0.15 + h(2) * 0.85)), maintenanceRemaining: 0, upkeep: UPKEEP.space,
      pos: sd.pos, history: [condition], orbit: { ...sd.orbit! },
    });
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
  tickSpace(state); // place satellites and work out what each one covers
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
