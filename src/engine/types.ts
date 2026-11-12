// Core data model for the simulation. Pure data — no UI or DOM dependencies.

export type Domain = 'space' | 'air' | 'sea' | 'ground';
export const DOMAINS: Domain[] = ['space', 'air', 'sea', 'ground'];

export type RegionId = 'NAM' | 'SAM' | 'EUR' | 'AFR' | 'MDE' | 'IPA' | 'POL';
export const REGION_IDS: RegionId[] = ['NAM', 'SAM', 'EUR', 'AFR', 'MDE', 'IPA', 'POL'];

export type AssetRole = 'sensor' | 'comms' | 'support' | 'command' | 'defense'; // defense = tactical layer equipment

export type ThreatClass = 'slowDrone' | 'fastDrone' | 'cruise' | 'rocket' | 'ballistic';
export type AssetStatus = 'operational' | 'degraded' | 'maintenance' | 'offline' | 'transit';

export interface Asset {
  id: string;
  name: string;
  className: string;
  domain: Domain;
  role: AssetRole;
  region: RegionId; // home / assigned region
  coverage: RegionId[]; // regions this asset contributes to (satellites cover several)
  condition: number; // 0-100 material condition
  capability: number; // nominal contribution weight (fictional, abstract)
  status: AssetStatus;
  hoursToService: number; // hours until scheduled maintenance is due (negative = overdue)
  maintenanceRemaining: number; // hours left in maintenance / transit
  transitTo?: RegionId;
  upkeep: number; // credits per hour
  pos: [number, number]; // lon, lat for map placement
  history: number[]; // condition samples (every 6h)
  restoredAt?: number; // sim hour of last return to service
}

export interface Region {
  id: RegionId;
  name: string;
  short: string;
  stability: number; // 0-100
  infrastructure: number; // 0-100 physical infrastructure resilience
  center: [number, number]; // lon, lat
  // Derived each tick:
  awareness: number;
  comms: number;
  readiness: number;
  threatLevel: number; // aggregated active event pressure
}

export type Severity = 1 | 2 | 3 | 4;
export const SEVERITY_LABEL: Record<Severity, string> = { 1: 'LOW', 2: 'MODERATE', 3: 'HIGH', 4: 'CRITICAL' };

export type EventCategory =
  | 'sensor'
  | 'comms'
  | 'satellite'
  | 'aircraft'
  | 'maritime'
  | 'ground'
  | 'logistics'
  | 'weather'
  | 'instability'
  | 'information'
  | 'personnel';

export type EventStatus =
  | 'reported' // known to command, awaiting decision
  | 'confirming' // independent confirmation tasked
  | 'responding' // management response underway
  | 'resolved'
  | 'escalated' // timer ran out, consequences applied
  | 'dismissed' // player dismissed as false/irrelevant
  | 'expired'; // false report that faded without action

export interface EffectSpec {
  kind:
    | 'assetDecay' // per hour condition loss on the target asset
    | 'stabilityDrift' // per hour stability change in region
    | 'infraDrift' // per hour infrastructure change in region
    | 'personnelDrift' // per hour personnel change (global)
    | 'creditsDrain' // per hour credits change (global)
    | 'commsPenalty' // flat comms penalty in region while active
    | 'awarenessPenalty' // flat awareness penalty in region while active
    | 'domainPenalty' // flat % availability penalty for a domain in region
    | 'globalCommsPenalty' // flat network penalty
    | 'maintenanceCostMult'; // multiplier on maintenance cost while active
  value: number;
  domain?: Domain;
}

export interface OneTimeEffects {
  stability?: number;
  infrastructure?: number;
  assetCondition?: number; // applied to target asset
  personnel?: number;
  credits?: number;
  resilience?: number;
}

export interface ResponseSpec {
  id: string;
  label: string;
  description: string;
  credits: number;
  personnel: number;
  crews: number;
  hours: number;
  baseSuccess: number; // 0-1
  domainDependency?: Domain; // success scaled by effectiveness of this domain
  networkDependent?: boolean; // success scaled by regional comms
  onSuccess: OneTimeEffects;
  passive?: boolean; // "accept/monitor" — no resolution, extends timer
}

export interface GameEvent {
  id: string;
  templateId: string;
  category: EventCategory;
  title: string;
  narrative: string;
  severity: Severity;
  region: RegionId;
  domains: Domain[];
  assetId?: string;
  occurredAt: number; // sim hour
  reportedAt: number; // sim hour when command learned (delayed information)
  deadline: number; // sim hour when it escalates if unresolved
  status: EventStatus;
  confidence: number; // 0-100 reported confidence
  isGenuine: boolean; // hidden ground truth
  conflicting: boolean; // sources disagree on severity
  reportedSeverity: [Severity, Severity]; // range as reported
  effects: EffectSpec[];
  responseId?: string;
  responseStarted?: number;
  responseHours?: number;
  progress: number; // 0-100
  confirmProgress: number; // 0-100
  parentId?: string;
  outcome?: string;
  resolvedAt?: number;
  log: { t: number; text: string }[];
  spent: number; // credits spent on this event
  monitored?: boolean; // passive monitoring extension already used
  hiddenLive?: boolean; // dismissed but actually genuine — still develops out of sight
  global?: boolean; // affects all regions
}

export interface Investment {
  id: string;
  label: string;
  description: string;
  category: 'infrastructure' | 'resilience' | 'maintenance' | 'personnel' | 'comms' | 'sensors' | 'recovery' | 'modernization';
  credits: number;
  personnel: number;
  hours: number; // project duration
  scope: 'global' | 'region' | 'domain';
}

export interface Project {
  id: string;
  investmentId: string;
  label: string;
  region?: RegionId;
  domain?: Domain;
  startedAt: number;
  hours: number;
  progress: number;
}

export type LogLevel = 'info' | 'warn' | 'crit' | 'success' | 'intel';
export interface LogEntry {
  t: number;
  level: LogLevel;
  text: string;
  region?: RegionId;
  eventId?: string;
}

export type SpendCategory = 'response' | 'maintenance' | 'investment' | 'redeploy' | 'confirmation';
export interface CommandEntry {
  t: number;
  kind: string;
  text: string;
  credits: number;
  category: SpendCategory | 'control';
  eventId?: string;
  verdict?: 'good' | 'poor' | 'neutral'; // filled by AAR analysis
}

export interface HistorySample {
  t: number;
  readiness: number;
  network: number;
  stability: number;
  infoQuality: number;
  infrastructure: number;
  credits: number;
  domains: Record<Domain, number>;
  regions: Record<RegionId, number>;
  activeEvents: number;
}

export type GameMode = 'campaign' | 'sandbox' | 'crisis' | 'training';

export interface Objective {
  id: string;
  text: string;
  metric:
    | 'readiness'
    | 'network'
    | 'stability'
    | 'infrastructure'
    | 'maintenanceDone'
    | 'confirmations'
    | 'escalationsMax'
    | 'resolved'
    | 'falseDismissed'
    | 'credits';
  target: number;
  reward: number; // credits granted when met
}

export interface PhaseConfig {
  id: number;
  name: string;
  hours: number;
  eventRate: number; // expected events per hour (global)
  falseRate: number; // chance a report is spurious
  maxSeverity: Severity;
  delayedInfo: boolean;
  conflicting: boolean;
  chains: boolean;
  categories: EventCategory[];
  scripted: { atHour: number; templateId: string; region?: RegionId }[];
  grant: number; // credits granted at phase start
  objectives: Objective[];
  situation: string;
  special: string[];
}

export interface ObjectiveResult {
  phase: number;
  objectiveId: string;
  text: string;
  met: boolean;
  value: number;
}

export interface Counters {
  maintenanceDone: number;
  confirmations: number;
  escalations: number;
  resolved: number;
  failedResponses: number;
  falseDismissed: number; // correctly dismissed false reports
  genuineDismissed: number; // dismissed real events (bad)
  falseResponded: number; // spent resources on false reports
  responsesOnConfirmed: number;
  responsesTotal: number;
  assetFailures: number;
  wastedCredits: number;
  totalSpent: number;
  responseTimes: number[]; // hours between report and response
}

/** Campaign tactical-layer scenario. Multipliers apply on top of each phase's profile in TACTICAL_CONFIG.waves. */
export interface TacticalSettings {
  preset: string; // preset id, or 'custom'
  waveCount: number; // × waves per phase
  waveSize: number; // × threats per wave
  mix: Record<ThreatClass, number>; // × weight of each threat class
  surpriseRate: number; // chance each extra wave strikes outside the forecast
  forecastRegions: number; // regions named in each forecast
  decoys: number; // × false tracks
  budget: number; // extra starting credits (negative = less)
}

export interface ScenarioSettings {
  name: string;
  mode: GameMode;
  seed: number;
  startCredits: number;
  startPersonnel: number;
  crews: number;
  eventFrequency: number; // multiplier
  falseReportRate: number; // override for sandbox (0-1)
  durationHours: number;
  regionStability: Partial<Record<RegionId, number>>;
  regionInfrastructure: Partial<Record<RegionId, number>>;
  domainCondition: Partial<Record<Domain, number>>;
  tactical?: TacticalSettings; // campaign only; absent means the standard scenario
}

// ── Tactical layer ─────────────────────────────────────────────────────
// Each region has a theater map (TACTICAL_CONFIG.theaterKm). Positions are km from the theater's top-left corner.

/** A real-world system placed in a region's theater. Backed by an Asset (role 'defense') for condition and upkeep. */
export interface Deployment {
  id: string;
  equipmentId: string; // key into EQUIPMENT
  assetId: string; // the Asset that carries condition, maintenance and upkeep
  region: RegionId;
  x: number;
  y: number;
  stock: number; // engagements left before resupply
  reloadRemaining?: number; // hours until a resupply completes
  deployedAt: number; // sim hour
}

export type SiteType = 'city' | 'port' | 'power' | 'comms' | 'command';

/** A fictional place worth defending. */
export interface Site {
  id: string;
  name: string;
  region: RegionId;
  type: SiteType;
  x: number;
  y: number;
  importance: number; // relative value, also how often attacks target it
  integrity: number; // 0-100, lowered by threats that get through
}

export type ThreatAxis = 'north' | 'south' | 'east' | 'west';

export type TrackOutcome = 'stopped' | 'leaked' | 'decoyStopped' | 'decoyLeaked';

/** One incoming threat in a wave. Resolved in a single tick; the record lets the UI replay it. */
export interface Track {
  id: string;
  cls: ThreatClass;
  siteId: string;
  from: [number, number]; // entry point on the theater edge
  decoy: boolean; // a false track: draws fire, does no damage
  outcome?: TrackOutcome;
  stoppedBy?: string; // deployment id
  shots: number; // engagements fired at it
  damage?: number; // integrity lost by the target site
}

export interface ThreatWave {
  id: string;
  region: RegionId;
  phaseIndex: number;
  atHour: number; // sim hour the wave arrives
  axis: ThreatAxis;
  forecast: boolean; // whether the briefing forecast this region
  tracks: Track[];
  resolved: boolean;
}

export interface TacticalStats {
  tracks: number; // genuine tracks
  stopped: number;
  leaked: number;
  decoysEngaged: number; // decoys that drew at least one shot
  shots: number;
  siteDamage: number; // total integrity lost across sites
}

/** A region's theater terrain (see terrain.ts). */
export interface TheaterTerrain {
  coast: 'north' | 'south' | 'east' | 'west';
  coastline: [number, number][];
  sea: [number, number][]; // polygon
  massifs: { x: number; y: number; r: number }[];
}

/** Tactical layer state. Optional on SimState so saves from before the tactical layer still load. */
export interface TacticalState {
  enabled: boolean; // campaign only
  rng: number; // own RNG stream, so the management simulation stays reproducible on its own
  nextId: number;
  sites: Site[];
  terrain?: Record<RegionId, TheaterTerrain>; // absent in saves made before terrain existed
  deployments: Deployment[];
  waves: ThreatWave[];
  forecast: RegionId[]; // regions the current briefing warns about
  stats: TacticalStats;
}

export interface SimState {
  version: number;
  campaignId?: string; // stable id of this scenario run (used by the persistence service)
  settings: ScenarioSettings;
  hour: number; // simulation hour since start
  startDate: number; // epoch ms of fictional start date
  rng: number;
  paused: boolean;
  speed: 1 | 2 | 4 | 8;
  turnBased: boolean;
  status: 'briefing' | 'running' | 'complete';
  phaseIndex: number;
  phaseStartHour: number;
  phases: PhaseConfig[];

  credits: number;
  personnel: number;
  personnelMax: number;
  crews: number;
  crewsBusy: number;
  resilience: number; // 0-100 network resilience investment level
  modernization: number; // 0-30 capability bonus %
  logistics: number; // 0-100 logistics capacity

  regions: Record<RegionId, Region>;
  assets: Asset[];
  events: GameEvent[];
  projects: Project[];
  log: LogEntry[];
  commands: CommandEntry[];
  history: HistorySample[];
  objectiveResults: ObjectiveResult[];
  achievements: string[];
  counters: Counters;
  spendByCategory: Record<SpendCategory, number>;
  nextId: number;
  difficulty: number; // adaptive director multiplier

  tactical?: TacticalState; // absent in saves made before the tactical layer

  // Derived metrics (recomputed each tick)
  metrics: Metrics;
  baseline: { infrastructure: number; readiness: number };
  minReadiness: number;
}

export interface Metrics {
  globalReadiness: number;
  network: number;
  sensorAvailability: number;
  infrastructure: number;
  stability: number;
  infoQuality: number;
  domainRaw: Record<Domain, number>;
  domainEffective: Record<Domain, number>;
  maintenanceBacklog: number;
  alert: AlertLevel;
}

export type AlertLevel = 'NORMAL' | 'ELEVATED' | 'HIGH' | 'SEVERE';
