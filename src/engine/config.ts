// All tunable simulation rules live here so they can be adjusted without touching engine logic.
import type { Domain, Investment, PhaseConfig, RegionId } from './types';

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
  { id: 'IPA', name: 'Indo-Pacific', short: 'INPAC', center: [115, 20] },
  { id: 'POL', name: 'Polar Regions', short: 'POLAR', center: [-40, 75] },
];

export const INVESTMENTS: Investment[] = [
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
    special: ['Low event tempo', 'Reports are mostly reliable', 'No event chains'],
    objectives: [
      { id: 'p1_net', text: 'Raise network health to 80% or higher', metric: 'network', target: 80, reward: 150 },
      { id: 'p1_maint', text: 'Complete at least 3 maintenance cycles', metric: 'maintenanceDone', target: 3, reward: 100 },
      { id: 'p1_ready', text: 'Hold global readiness at or above 72%', metric: 'readiness', target: 72, reward: 120 },
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
    special: ['Reconstruction grant released', 'Low event tempo', 'Final evaluation at end of phase'],
    objectives: [
      { id: 'p4_ready', text: 'Restore global readiness to 78% or higher', metric: 'readiness', target: 78, reward: 0 },
      { id: 'p4_infra', text: 'Restore average infrastructure to 70 or higher', metric: 'infrastructure', target: 70, reward: 0 },
      { id: 'p4_cred', text: 'Finish with at least 300 credits in reserve', metric: 'credits', target: 300, reward: 0 },
    ],
  },
];

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

/** Tactical layer tuning. Real equipment figures live in equipment.ts; these are the game's own choices. */
export const TACTICAL_CONFIG = {
  /** Credits = creditsScale × (unit cost in $M) ^ costExponent, at least minCost. Compresses a 0.1–2200 $M spread. */
  creditsScale: 6,
  costExponent: 0.5,
  minCost: 4,
  /** Hourly upkeep as a fraction of deployment cost. */
  upkeepRate: 0.004,
  /** Size of each region's theater map, in km. */
  theaterKm: { width: 600, height: 400 },
};
