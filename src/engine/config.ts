// All tunable simulation rules live here so they can be adjusted without touching engine logic.
import type { CommandLevel, Domain, Investment, PhaseConfig, RegionId, SiteType, ThreatClass } from './types';

export const SIM_CONFIG = {
  /** Real milliseconds per simulated hour at 1x speed. */
  msPerHourAt1x: 2000,
  turnHours: 6,

  /** Cross-domain dependency weights: domain -> { dependsOn: weight }.
   * Effective readiness = raw * Π(1 - w * (1 - rawDep/100)) * networkFactor */
  dependencies: {
    space: { ground: 0.2 },
    air: { space: 0.25, ground: 0.15 },
    sea: { space: 0.3, ground: 0.1 },
    ground: { space: 0.15, sea: 0.05 },
  } as Record<Domain, Partial<Record<Domain, number>>>,

  /** How strongly network health scales each domain (0 = not at all). */
  networkWeight: { space: 0.15, air: 0.3, sea: 0.3, ground: 0.25 } as Record<Domain, number>,

  /** Contribution of each domain's comms assets to global network health. */
  commsWeight: { space: 0.4, ground: 0.35, sea: 0.15, air: 0.1 } as Record<Domain, number>,

  /** Weight of each domain in global readiness. */
  readinessWeight: { space: 0.25, air: 0.25, sea: 0.2, ground: 0.3 } as Record<Domain, number>,

  /** Fraction of a penalty negated per point of network resilience (max at 100 = 50% reduction). */
  resilienceMitigation: 0.005,

  /** Condition decay per hour by domain (before overdue penalty). */
  decayPerHour: { space: 0.06, air: 0.16, sea: 0.12, ground: 0.09 } as Record<Domain, number>,
  overdueDecayMult: 2.5,
  /**
   * Unspent reserves are reclaimed: credits above the threshold lose this share of the excess every hour, so banking
   * everything is not a safe strategy. Not applied in training.
   */
  reserve: { threshold: 1200, ratePerHour: 0.02 },
  serviceInterval: { space: 220, air: 90, sea: 130, ground: 160 } as Record<Domain, number>,
  maintenanceHours: { space: 18, air: 10, sea: 16, ground: 12 } as Record<Domain, number>,
  maintenanceCost: { space: 120, air: 50, sea: 75, ground: 55 } as Record<Domain, number>,
  redeployHours: { space: 0, air: 8, sea: 30, ground: 0 } as Record<Domain, number>,
  redeployCost: { space: 0, air: 40, sea: 70, ground: 0 } as Record<Domain, number>,
  confirmCost: 15,
  confirmHours: 6,

  baseIncomePerHour: 34,
  personnelRegenPerHour: 1.1,

  /** Stability drift toward target per hour (fraction of gap). */
  stabilityInertia: 0.03,

  statusThresholds: { degraded: 55, offline: 20 },
};

export const REGION_DEFS: { id: RegionId; name: string; short: string; center: [number, number] }[] = [
  { id: 'NAM', name: 'North America', short: 'NORAM', center: [-100, 45] },
  { id: 'SAM', name: 'South America', short: 'SOAM', center: [-60, -15] },
  { id: 'EUR', name: 'Europe', short: 'EURO', center: [15, 52] },
  { id: 'AFR', name: 'Africa', short: 'AFRI', center: [20, 5] },
  { id: 'MDE', name: 'Middle East', short: 'MIDE', center: [48, 28] },
  { id: 'IPA', name: 'Indo-Pacific', short: 'INPAC', center: [108, 24] },
  { id: 'POL', name: 'Polar Regions', short: 'POLAR', center: [-40, 75] },
];

export const INVESTMENTS: Investment[] = [
  {
    id: 'rebuild', label: 'Rebuild Damaged Sites', category: 'recovery', scope: 'region',
    description: 'Repairs the region\'s sites hit by threat waves (+35 integrity each). Damaged sites drag stability down and make the region a likelier target.',
    credits: 160, personnel: 6, hours: 18,
  },
  {
    id: 'harden', label: 'Harden Regional Infrastructure', category: 'infrastructure', scope: 'region',
    description: '+18 infrastructure resilience in the region on completion. Slows infrastructure drift from events.',
    credits: 220, personnel: 8, hours: 24,
  },
  {
    id: 'resilience', label: 'Network Resilience Program', category: 'resilience', scope: 'global',
    description: '+15 network resilience. Each point mitigates communications penalties across all domains.',
    credits: 300, personnel: 6, hours: 36,
  },
  {
    id: 'crews', label: 'Expand Maintenance Crews', category: 'maintenance', scope: 'global',
    description: '+1 permanent maintenance crew. Raises how many repairs and responses can run at once.',
    credits: 260, personnel: 10, hours: 24,
  },
  {
    id: 'recruit', label: 'Personnel Recruitment Drive', category: 'personnel', scope: 'global',
    description: '+15 personnel capacity and +25 available personnel on completion.',
    credits: 160, personnel: 0, hours: 30,
  },
  {
    id: 'restore_comms', label: 'Communications Restoration Team', category: 'comms', scope: 'region',
    description: 'Restores all comms-role assets in the region by +30 condition and clears minor comms disruptions.',
    credits: 140, personnel: 6, hours: 10,
  },
  {
    id: 'recalibrate', label: 'Sensor Recalibration Campaign', category: 'sensors', scope: 'domain',
    description: '+20 condition to every sensor-role asset in the chosen domain.',
    credits: 180, personnel: 6, hours: 14,
  },
  {
    id: 'recovery', label: 'Regional Recovery Package', category: 'recovery', scope: 'region',
    description: '+20 stability and +8 infrastructure in the region on completion.',
    credits: 200, personnel: 10, hours: 18,
  },
  {
    id: 'modernize', label: 'Long-Term Modernization', category: 'modernization', scope: 'global',
    description: '+6% capability for every asset (max +30%) and -10% upkeep. Slow, expensive, permanent.',
    credits: 480, personnel: 12, hours: 72,
  },
];

const baseCats: PhaseConfig['categories'] = ['sensor', 'aircraft', 'maritime', 'ground', 'logistics', 'weather'];

export const CAMPAIGN_PHASES: PhaseConfig[] = [
  {
    id: 1, name: 'Network Establishment', hours: 48, eventRate: 0.07, falseRate: 0.12, maxSeverity: 2,
    delayedInfo: false, conflicting: false, chains: false, categories: baseCats, scripted: [
      { atHour: 3, templateId: 'sensor_drift', region: 'EUR' },
    ], grant: 0,
    situation:
      'The Integrated Defense Network has just been placed under unified command. Domain components were operated separately until today and several assets are behind on servicing. Expect routine disruptions while the network settles.',
    special: ['Quietest phase of the campaign', 'Fewest false reports of the campaign', 'No event chains'],
    objectives: [
      { id: 'p1_net', text: 'End the phase with network health at 80% or higher', metric: 'network', target: 80, byLevel: { recruit: 76, commander: 83 }, reward: 150 },
      { id: 'p1_maint', text: 'Complete at least 3 maintenance cycles', metric: 'maintenanceDone', target: 3, reward: 100 },
      { id: 'p1_ready', text: 'End the phase with global readiness at 72% or higher', metric: 'readiness', target: 72, byLevel: { recruit: 68, commander: 75 }, reward: 120 },
    ],
  },
  {
    id: 2, name: 'Regional Instability', hours: 72, eventRate: 0.12, falseRate: 0.2, maxSeverity: 3,
    delayedInfo: false, conflicting: true, chains: true,
    categories: [...baseCats, 'comms', 'satellite', 'instability', 'personnel'], scripted: [
      { atHour: 6, templateId: 'unrest', region: 'AFR' },
      { atHour: 30, templateId: 'storm', region: 'IPA' },
    ], grant: 250,
    situation:
      'Political and economic pressure is building in several regions. Unrest and severe weather will strain maintenance capacity, and ignored problems will now trigger follow-on complications.',
    special: ['Event chains enabled', 'Some reports conflict on severity', 'Regional instability events'],
    objectives: [
      { id: 'p2_stab', text: 'Keep average regional stability at or above 60', metric: 'stability', target: 60, reward: 180 },
      { id: 'p2_conf', text: 'Task at least 4 independent confirmations', metric: 'confirmations', target: 4, reward: 100 },
      { id: 'p2_esc', text: 'Allow no more than 3 escalations in total', metric: 'escalationsMax', target: 3, reward: 150 },
    ],
  },
  {
    id: 3, name: 'Global Crisis', hours: 72, eventRate: 0.17, falseRate: 0.28, maxSeverity: 4,
    delayedInfo: true, conflicting: true, chains: true,
    categories: [...baseCats, 'comms', 'satellite', 'instability', 'personnel', 'information'], scripted: [
      { atHour: 2, templateId: 'solar_surge' },
      { atHour: 14, templateId: 'global_outage' },
      { atHour: 40, templateId: 'unrest', region: 'MDE' },
    ], grant: 350,
    situation:
      'Intense solar activity and a cascading communications failure will hit multiple regions at once. Reports will arrive late and often contradict each other. You will not be able to fix everything — prioritize.',
    special: ['Delayed information from low-comms regions', 'High false-report rate', 'Scripted global outage', 'Critical-severity events possible'],
    objectives: [
      { id: 'p3_net', text: 'Keep network health at or above 55%', metric: 'network', target: 55, reward: 200 },
      { id: 'p3_res', text: 'Resolve at least 14 events in total', metric: 'resolved', target: 14, reward: 150 },
      { id: 'p3_false', text: 'Correctly dismiss at least 3 false reports', metric: 'falseDismissed', target: 3, reward: 120 },
    ],
  },
  {
    id: 4, name: 'Recovery', hours: 48, eventRate: 0.06, falseRate: 0.12, maxSeverity: 2,
    delayedInfo: false, conflicting: false, chains: true, categories: baseCats, scripted: [], grant: 600,
    situation:
      'The crisis has passed. Reconstruction funding has been released. Restore readiness, repair infrastructure and leave the network in a sustainable state.',
    special: ['Reconstruction grant released', 'Quieter than the crisis', 'Final evaluation at end of phase'],
    objectives: [
      { id: 'p4_ready', text: 'Raise global readiness by at least 4 points during the phase', metric: 'readinessGain', target: 4, byLevel: { recruit: 2, commander: 5 }, reward: 0 },
      { id: 'p4_infra', text: 'Raise average infrastructure by at least 3 points during the phase', metric: 'infrastructureGain', target: 3, byLevel: { recruit: 1, commander: 4 }, reward: 0 },
      { id: 'p4_cred', text: 'Finish with at least 300 credits in reserve', metric: 'credits', target: 300, byLevel: { recruit: 200 }, reward: 0 },
    ],
  },
];

/** Weights of the management score components (sum to 1). */
export const SCORE_WEIGHTS = {
  readiness: 0.18,
  network: 0.13,
  stability: 0.13,
  response: 0.16,
  infrastructure: 0.1,
  efficiency: 0.1,
  information: 0.1,
  recovery: 0.1,
};

/**
 * When the tactical layer is active, protection takes this share of the score and the management components share
 * the rest in their usual proportions. Other modes are scored on management alone.
 */
export const PROTECTION_SCORE_WEIGHT = 0.15;
/** Efficiency points lost per false track that drew fire (capped). */
export const DECOY_EFFICIENCY_PENALTY = { perShot: 0.5, max: 10 };

/** Tactical layer tuning. Real equipment figures live in equipment.ts; these are the game's own choices. */
export const TACTICAL_CONFIG = {
  /** Turns the tactical layer on for new and loaded campaigns. A browser can opt out with ?tactical=0. */
  enabledInCampaign: true,
  /**
   * Credits = creditsScale × (unit cost in $M) ^ costExponent × range factor, at least minCost. The power curve
   * compresses a 0.1–2200 $M spread; the range factor, (1 + min(range, rangeCostCapKm) / rangeCostKm) ^ exponent,
   * makes reach cost money so a long-range system isn't a bargain just because its real price was compressed.
   */
  creditsScale: 2.5,
  costExponent: 0.5,
  minCost: 4,
  rangeCostKm: 100,
  rangeCostCapKm: 500,
  rangeCostExponent: { effector: 0.5, sensor: 0.25 },
  /** Hourly upkeep as a fraction of deployment cost. */
  upkeepRate: 0.001,
  /** Size of each region's theater map, in km. */
  theaterKm: { width: 600, height: 400 },

  // ── Deployment commands ──
  deployPersonnel: 2,
  relocateCost: 10,
  withdrawRefund: 0.5, // share of deployment cost returned
  resupplyRate: 0.8, // a full resupply costs this share of the deployment cost
  resupplyMinCost: 5, // every resupply run costs at least this (transport and handling)
  minLogisticsForResupply: 25,

  // ── In-phase orders ──
  /** Emergency redeploy: hours out of action and credits. Moving to another region takes the domain's transit time. */
  emergencyRedeploy: { sameRegionHours: 3, otherRegionHours: { ground: 12, air: 4, sea: 18, space: 24 }, cost: 30, otherRegionCost: 40 },
  /** Raise alert: detection and reaction boost in one region for a few hours, at a cost and extra wear. */
  alert: { hours: 8, baseCost: 20, perDeploymentCost: 4, detectionBonus: 0.2, minDetectionUnseen: 0.7, reactionMult: 0.7, wearPerHour: 0.4 },

  // ── Sites ──
  /** Site types placed in every theater, with their importance. */
  siteMix: [
    { type: 'city', count: 3, importance: 3 },
    { type: 'port', count: 1, importance: 2 },
    { type: 'power', count: 2, importance: 2 },
    { type: 'comms', count: 1, importance: 1.5 },
    { type: 'command', count: 1, importance: 2.5 },
  ] as { type: SiteType; count: number; importance: number }[],
  /** Sites keep this margin (km) from the theater edge so threats have room to be engaged. */
  siteMarginKm: 80,

  // ── Threats ──
  /**
   * Low-flying threats hide below the radar horizon: surface radars see and engage them only within `horizonKm`
   * (doubled on a massif), and massifs block line of sight. Airborne early warning removes both limits by cueing.
   */
  lowAltitude: {
    classes: ['slowDrone', 'fastDrone', 'cruise'] as ThreatClass[],
    horizonKm: 40,
    massifHorizonMult: 2,
  },
  /** Altitude (km) at which each class is engaged; a system whose ceiling is lower can't engage it. */
  threatAltitudeKm: { slowDrone: 0.1, fastDrone: 0.3, cruise: 0.05, rocket: 3, ballistic: 12 } as Record<ThreatClass, number>,
  /**
   * Time in flight (sim hours) from launch to impact, per class (game values, chosen to be watchable). A wave
   * launches early enough that its slowest threat arrives at the wave's impact hour; interception is decided at launch.
   */
  flightHours: { slowDrone: 3, fastDrone: 1.5, cruise: 1.2, rocket: 0.4, ballistic: 0.6 } as Record<ThreatClass, number>,
  /** Threat speed in km per second (game values). Sets how long a threat stays in each system's range. */
  threatSpeedKmS: { slowDrone: 0.05, fastDrone: 0.15, cruise: 0.25, rocket: 0.8, ballistic: 2 } as Record<ThreatClass, number>,
  /**
   * Rough attacker cost of each threat, in the game's credits, for the after-action cost-exchange readout (a decoy
   * counts as a cheap drone). Game values, chosen to show the usual pattern: cheap drones, expensive missiles.
   */
  threatCost: { slowDrone: 2, fastDrone: 5, cruise: 30, rocket: 1, ballistic: 70 } as Record<ThreatClass, number>,
  /** Site integrity lost when a threat of each class gets through. */
  threatDamage: { slowDrone: 4, fastDrone: 6, cruise: 10, rocket: 5, ballistic: 15 } as Record<ThreatClass, number>,
  /** Regional infrastructure and stability lost per point of site damage, scaled by site importance / 3. */
  infraPerDamage: 0.12,
  stabilityPerDamage: 0.06,
  /** Most engagements one system makes against one threat (shoot-look-shoot). */
  maxShotsPerSystem: 2,
  /** Detection: a threat seen by a covering sensor is engaged at full quality; otherwise at this quality. */
  unseenDetection: 0.45,
  /** Magazine size treated as unlimited (jammers, lasers, microwave). */
  unlimitedMagazine: 999,
  /** Standard scenario: chance each wave beyond one per forecast region strikes outside the forecast. */
  surpriseRate: 0.2,
  /** Waves per campaign phase (by phase index): count, tracks per wave and threat mix weights. */
  waves: [
    { count: 2, tracks: [5, 8], mix: { slowDrone: 6, fastDrone: 2, cruise: 1, rocket: 1, ballistic: 0 } },
    { count: 3, tracks: [8, 12], mix: { slowDrone: 5, fastDrone: 3, cruise: 2, rocket: 2, ballistic: 1 } },
    { count: 4, tracks: [12, 18], mix: { slowDrone: 5, fastDrone: 3, cruise: 3, rocket: 2, ballistic: 2 } },
    { count: 2, tracks: [6, 9], mix: { slowDrone: 5, fastDrone: 2, cruise: 1, rocket: 1, ballistic: 1 } },
  ] as { count: number; tracks: [number, number]; mix: Record<ThreatClass, number> }[],
  /**
   * Threats that change direction mid-flight: a share of drones and cruise missiles in later phases fly a dog-leg
   * around the defenses' expected axis, so a defense built for one approach can be outflanked.
   */
  turning: { classes: ['slowDrone', 'fastDrone', 'cruise'] as ThreatClass[], chanceByPhase: [0, 0.15, 0.2, 0.1], offsetKm: [50, 110] as [number, number] },
  /** Standard scenario: regions named in each briefing's forecast. */
  forecastRegions: 2,
  /** Warning before a wave arrives: base hours plus extra hours at full regional awareness. */
  warningHours: { base: 2, atFullAwareness: 6 },
  /**
   * Damage carries over: a region's damaged sites (share of site value lost, 0-1) pull its stability target down by
   * up to `stability` points, and add up to `targeting` to its weight when forecasts pick where attacks come.
   */
  consequences: { stability: 35, targeting: 60 },
  /** Share of a region's site value that must be covered to count as protected, or thin. */
  protection: { protected: 0.7, thin: 0.3 },
};

/**
 * Campaign difficulty. Officer is the campaign as designed (every multiplier 1). Credits are added to the starting
 * budget; the rest scale event frequency, the chance a report is false, wave size, surprise attacks and decoys.
 */
export const COMMAND_LEVELS: Record<CommandLevel, {
  label: string; description: string; credits: number; eventFrequency: number; falseMult: number; waveSize: number; surpriseMult: number; decoyMult: number;
  /** Hourly income and the time a report allows before it escalates, as multipliers. */
  incomeMult: number; deadlineMult: number;
}> = {
  recruit: {
    label: 'Recruit', description: 'Fewer and clearer reports, more time to act on each one, and smaller attacks that rarely surprise you, on the standard budget. For learning the campaign.',
    credits: 0, eventFrequency: 0.75, falseMult: 0.6, waveSize: 0.75, surpriseMult: 0.5, decoyMult: 0.6, incomeMult: 1, deadlineMult: 1.15,
  },
  officer: {
    label: 'Officer', description: 'The campaign as designed. Interceptor rounds come from a national stockpile, restocked each phase.',
    credits: 0, eventFrequency: 1, falseMult: 1, waveSize: 1, surpriseMult: 1, decoyMult: 1, incomeMult: 1, deadlineMult: 1,
  },
  commander: {
    label: 'Commander', description: 'A tighter budget (less to start with and 10% less income), more incidents and false reports with less time to act, and bigger attacks that strike outside the forecast more often. Interceptor stockpiles are thinner. The adjutant starts off.',
    credits: -250, eventFrequency: 1.3, falseMult: 1.3, waveSize: 1.3, surpriseMult: 1.6, decoyMult: 1.4, incomeMult: 0.9, deadlineMult: 0.9,
  },
};
export const COMMAND_LEVEL_IDS: CommandLevel[] = ['recruit', 'officer', 'commander'];

/**
 * Interceptor stockpiles (campaign, Officer and Commander only): each interceptor type has a national reserve of
 * rounds that resupply draws from. Sizes are in magazines per unit fielded: the reserve starts at `initial`, gains
 * `restock` at each later phase start, and never holds more than `cap`. Recruit has unlimited reserves.
 */
export const STOCKPILES: Partial<Record<CommandLevel, { initial: number; restock: number; cap: number }>> = {
  officer: { initial: 1, restock: 1, cap: 3 },
  commander: { initial: 0.5, restock: 0.5, cap: 2 },
};

/** The difficulty settings for a scenario (Officer unless it is a campaign with another level). */
export const levelOf = (settings: { mode: string; level?: CommandLevel }) =>
  COMMAND_LEVELS[settings.mode === 'campaign' && settings.level && settings.level in COMMAND_LEVELS ? settings.level : 'officer'];
