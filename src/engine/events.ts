// Event template library and generation. Templates are data; behaviour is driven by the engine.
import { clamp, rand, randInt, randRange, weightedPick, pick } from './rng';
import type {
  Asset, AssetRole, Domain, EffectSpec, EventCategory, GameEvent, OneTimeEffects, Region, RegionId,
  ResponseSpec, Severity, SimState,
} from './types';
import { REGION_IDS } from './types';

export interface EventTemplate {
  id: string;
  category: EventCategory;
  title: string;
  narrative: (ctx: { region: Region; asset?: Asset; sev: Severity }) => string;
  domains: Domain[];
  target?: { domains: Domain[]; roles?: AssetRole[] };
  severity: [Severity, Severity];
  duration: [number, number];
  effects: EffectSpec[];
  escalation: { effects: OneTimeEffects; spawns: { templateId: string; chance: number }[]; text: string };
  responses: ResponseSpec[];
  weight: (s: SimState, r: Region) => number;
  scriptedOnly?: boolean;
  global?: boolean;
  forceFalse?: boolean;
}

const monitor = (hours = 8): ResponseSpec => ({
  id: 'monitor', label: 'Monitor Only', passive: true,
  description: `No resources committed. Extends the decision window by ${hours}h once; effects continue.`,
  credits: 0, personnel: 0, crews: 0, hours, baseSuccess: 1, onSuccess: {},
});

const avgCond = (s: SimState, r: RegionId, role?: AssetRole) => {
  const l = s.assets.filter((a) => a.region === r && a.role !== 'defense' && (!role || a.role === role));
  return l.length ? l.reduce((x, a) => x + a.condition, 0) / l.length : 80;
};

export const TEMPLATES: EventTemplate[] = [
  {
    id: 'sensor_drift', category: 'sensor', title: 'Sensor Calibration Drift', domains: ['ground', 'air', 'sea'],
    target: { domains: ['ground', 'air', 'sea'], roles: ['sensor'] }, severity: [1, 2], duration: [18, 30],
    narrative: ({ region, asset }) =>
      `${asset?.name ?? 'A regional sensor'} in ${region.name} is reporting calibration drift. Picture quality is degrading and data from the affected sector is becoming less reliable.`,
    effects: [{ kind: 'assetDecay', value: 0.6 }, { kind: 'awarenessPenalty', value: 8 }],
    escalation: { effects: { assetCondition: -20 }, spawns: [{ templateId: 'sensor_failure', chance: 0.6 }], text: 'Drift uncorrected — sensor suffered a hard fault.' },
    responses: [
      { id: 'remote', label: 'Remote Recalibration', description: 'Push a calibration update over the network. Cheap and fast; depends on regional comms.', credits: 40, personnel: 2, crews: 0, hours: 4, baseSuccess: 0.72, networkDependent: true, onSuccess: { assetCondition: 10 } },
      { id: 'field', label: 'Dispatch Field Team', description: 'Send a maintenance crew to recalibrate on site. Reliable and restores condition.', credits: 90, personnel: 6, crews: 1, hours: 10, baseSuccess: 0.95, onSuccess: { assetCondition: 25 } },
      monitor(),
    ],
    weight: (s, r) => 0.6 + (100 - avgCond(s, r.id, 'sensor')) / 35,
  },
  {
    id: 'sensor_failure', category: 'sensor', title: 'Sensor Station Fault', domains: ['ground'],
    target: { domains: ['ground', 'sea', 'air'], roles: ['sensor'] }, severity: [3, 3], duration: [14, 20],
    narrative: ({ region, asset }) =>
      `${asset?.name ?? 'A sensor asset'} has suffered a major fault. Regional awareness over ${region.name} is significantly reduced until the asset is repaired or coverage is backfilled.`,
    effects: [{ kind: 'assetDecay', value: 1.5 }, { kind: 'awarenessPenalty', value: 18 }, { kind: 'stabilityDrift', value: -0.15 }],
    escalation: { effects: { infrastructure: -6, stability: -8, assetCondition: -20 }, spawns: [], text: 'Extended outage eroded regional confidence and damaged supporting infrastructure.' },
    responses: [
      { id: 'repair', label: 'Emergency Repair', description: 'Full repair team with priority parts.', credits: 150, personnel: 8, crews: 1, hours: 14, baseSuccess: 0.9, onSuccess: { assetCondition: 40 } },
      { id: 'backfill', label: 'Backfill with Airborne Coverage', description: 'Re-task airborne surveillance to cover the gap. Depends on Air readiness.', credits: 80, personnel: 4, crews: 0, hours: 6, baseSuccess: 0.82, domainDependency: 'air', onSuccess: { stability: 3, assetCondition: 8 } },
      monitor(6),
    ],
    weight: (s, r) => (avgCond(s, r.id, 'sensor') < 50 ? 0.8 : 0.1),
  },
  {
    id: 'relay_degradation', category: 'comms', title: 'Relay Link Degradation', domains: ['ground', 'space'],
    target: { domains: ['ground'], roles: ['comms'] }, severity: [1, 3], duration: [16, 28],
    narrative: ({ region, asset }) =>
      `${asset?.name ?? 'The regional relay hub'} is dropping links intermittently. Command traffic in ${region.name} is being queued and delayed.`,
    effects: [{ kind: 'commsPenalty', value: 15 }, { kind: 'assetDecay', value: 0.4 }],
    escalation: { effects: { stability: -4, assetCondition: -15 }, spawns: [{ templateId: 'network_alert', chance: 0.45 }, { templateId: 'comms_blackout', chance: 0.35 }], text: 'Link degradation spread to adjacent nodes.' },
    responses: [
      { id: 'reroute', label: 'Reroute via Orbital Relay', description: 'Shift traffic to relay satellites. Fast; depends on Space readiness.', credits: 50, personnel: 2, crews: 0, hours: 3, baseSuccess: 0.85, domainDependency: 'space', onSuccess: {} },
      { id: 'mobile', label: 'Deploy Mobile Comms Team', description: 'On-site repair and temporary links.', credits: 110, personnel: 6, crews: 1, hours: 8, baseSuccess: 0.95, onSuccess: { assetCondition: 20 } },
      monitor(),
    ],
    weight: (s, r) => 0.4 + (100 - r.comms) / 30 + (100 - avgCond(s, r.id, 'comms')) / 50,
  },
  {
    id: 'network_alert', category: 'comms', title: 'Network Security Alert', domains: ['ground', 'space', 'air', 'sea'],
    severity: [2, 3], duration: [12, 20],
    narrative: ({ region }) =>
      `Anomalous traffic has been detected on the ${region.name} network segment. Automated safeguards have throttled several links as a precaution.`,
    effects: [{ kind: 'globalCommsPenalty', value: 7 }, { kind: 'commsPenalty', value: 10 }],
    escalation: { effects: { resilience: -4, stability: -3 }, spawns: [{ templateId: 'comms_blackout', chance: 0.55 }], text: 'Throttling cascaded into a regional blackout.' },
    responses: [
      { id: 'isolate', label: 'Isolate Segment', description: 'Quarantine the segment and restore from known-good configuration.', credits: 70, personnel: 4, crews: 0, hours: 6, baseSuccess: 0.8, onSuccess: {} },
      { id: 'audit', label: 'Full Network Audit', description: 'Comprehensive audit. Slow but permanently improves resilience.', credits: 160, personnel: 8, crews: 1, hours: 16, baseSuccess: 0.97, onSuccess: { resilience: 3 } },
      monitor(6),
    ],
    weight: (s) => 0.2 + (100 - s.metrics.network) / 60,
  },
  {
    id: 'comms_blackout', category: 'comms', title: 'Regional Communications Blackout', domains: ['ground', 'air', 'sea'],
    severity: [3, 4], duration: [12, 18],
    narrative: ({ region }) =>
      `Most command links into ${region.name} are down. Regional assets are operating on local authority and reports from the area are sparse and delayed.`,
    effects: [{ kind: 'commsPenalty', value: 35 }, { kind: 'awarenessPenalty', value: 12 }, { kind: 'stabilityDrift', value: -0.3 }],
    escalation: { effects: { infrastructure: -10, stability: -10 }, spawns: [{ templateId: 'unrest', chance: 0.4 }], text: 'Prolonged blackout undermined regional continuity.' },
    responses: [
      { id: 'restore', label: 'Emergency Restoration', description: 'Two crews restore primary links.', credits: 200, personnel: 10, crews: 2, hours: 12, baseSuccess: 0.9, onSuccess: { infrastructure: 3 } },
      { id: 'bridge', label: 'Airborne Relay Bridge', description: 'Bridge links via airborne relay. Depends on Air readiness.', credits: 120, personnel: 6, crews: 0, hours: 6, baseSuccess: 0.75, domainDependency: 'air', onSuccess: {} },
      monitor(4),
    ],
    weight: (_s, r) => (r.comms < 55 ? 0.6 : 0.05),
  },
  {
    id: 'sat_power', category: 'satellite', title: 'Orbital Platform Power Anomaly', domains: ['space'],
    target: { domains: ['space'] }, severity: [2, 3], duration: [20, 30],
    narrative: ({ asset }) =>
      `${asset?.name ?? 'A satellite'} reports an irregular power budget. Payload duty cycle has been reduced while telemetry is reviewed.`,
    effects: [{ kind: 'assetDecay', value: 0.8 }],
    escalation: { effects: { assetCondition: -30 }, spawns: [], text: 'Platform entered extended safe mode with lasting capacity loss.' },
    responses: [
      { id: 'diagnose', label: 'Safe-Mode & Diagnose', description: 'Controlled diagnosis from ground control. Depends on Ground readiness.', credits: 90, personnel: 3, crews: 0, hours: 12, baseSuccess: 0.88, domainDependency: 'ground', onSuccess: { assetCondition: 20 } },
      { id: 'reposition', label: 'Rebalance Constellation', description: 'Shift coverage to other platforms and load-shed. Cheap, partial fix.', credits: 60, personnel: 2, crews: 0, hours: 6, baseSuccess: 0.7, onSuccess: { assetCondition: 5 } },
      monitor(),
    ],
    weight: (s) => 0.3 + (100 - s.metrics.domainRaw.space) / 40,
  },
  {
    id: 'solar_surge', category: 'satellite', title: 'Solar Activity Surge', domains: ['space'], global: true, scriptedOnly: true,
    target: { domains: ['space'] }, severity: [3, 3], duration: [26, 30],
    narrative: () =>
      'A strong solar event is degrading orbital platforms and long-haul links worldwide. Space-based coverage and relay capacity will fall until platforms are protected or the event passes.',
    effects: [{ kind: 'assetDecay', value: 0.7, domain: 'space' }, { kind: 'globalCommsPenalty', value: 14 }],
    escalation: { effects: { resilience: -5 }, spawns: [{ templateId: 'sat_power', chance: 0.7 }], text: 'Unprotected platforms accumulated lasting damage.' },
    responses: [
      { id: 'harden', label: 'Protective Configuration — All Platforms', description: 'Coordinated protective configuration across the constellation.', credits: 180, personnel: 6, crews: 1, hours: 10, baseSuccess: 0.9, domainDependency: 'ground', onSuccess: { resilience: 2 } },
      monitor(10),
    ],
    weight: () => 0,
  },
  {
    id: 'global_outage', category: 'comms', title: 'Global Communications Outage', domains: ['space', 'ground', 'air', 'sea'], global: true, scriptedOnly: true,
    severity: [4, 4], duration: [18, 22],
    narrative: () =>
      'A cascading failure across the backbone has severed most long-haul links. Every domain is affected. Restoring the backbone should take priority over local issues.',
    effects: [{ kind: 'globalCommsPenalty', value: 30 }, { kind: 'stabilityDrift', value: -0.2 }],
    escalation: { effects: { stability: -12, infrastructure: -8 }, spawns: [{ templateId: 'comms_blackout', chance: 1 }, { templateId: 'unrest', chance: 0.5 }], text: 'The outage persisted long enough to fracture regional continuity.' },
    responses: [
      { id: 'backup', label: 'Activate Backup Architecture', description: 'Switch to the backup backbone. Fast; depends on Ground readiness.', credits: 260, personnel: 12, crews: 2, hours: 10, baseSuccess: 0.85, domainDependency: 'ground', onSuccess: { resilience: 3 } },
      { id: 'phased', label: 'Phased Restoration', description: 'Methodical node-by-node restoration. Slow but reliable.', credits: 150, personnel: 8, crews: 1, hours: 16, baseSuccess: 0.96, onSuccess: {} },
      monitor(4),
    ],
    weight: () => 0,
  },
  {
    id: 'airframe', category: 'aircraft', title: 'Fleet Component Inspection Required', domains: ['air'],
    target: { domains: ['air'] }, severity: [1, 3], duration: [16, 26],
    narrative: ({ asset, region }) =>
      `A component advisory affects ${asset?.name ?? 'regional aircraft'} in ${region.name}. Flight hours are restricted until inspection.`,
    effects: [{ kind: 'domainPenalty', value: 30, domain: 'air' }, { kind: 'assetDecay', value: 0.5 }],
    escalation: { effects: { assetCondition: -25 }, spawns: [{ templateId: 'parts_shortage', chance: 0.3 }], text: 'Uninspected airframe grounded indefinitely.' },
    responses: [
      { id: 'expedite', label: 'Expedited Inspection', description: 'Priority crew inspection and component swap.', credits: 100, personnel: 5, crews: 1, hours: 10, baseSuccess: 0.92, onSuccess: { assetCondition: 25 } },
      { id: 'rotate', label: 'Rotate Airframes', description: 'Swap in aircraft from reserve rotation. Cheap, less reliable.', credits: 50, personnel: 2, crews: 0, hours: 4, baseSuccess: 0.7, onSuccess: { assetCondition: 5 } },
      monitor(),
    ],
    weight: (s, r) => (s.assets.some((a) => a.region === r.id && a.domain === 'air') ? 0.5 + (100 - avgCond(s, r.id)) / 40 : 0),
  },
  {
    id: 'port', category: 'maritime', title: 'Port Facility Disruption', domains: ['sea'],
    target: { domains: ['sea'] }, severity: [1, 3], duration: [18, 30],
    narrative: ({ region }) =>
      `A key support facility in ${region.name} has suspended operations. Vessels in the region cannot resupply or receive repairs.`,
    effects: [{ kind: 'domainPenalty', value: 35, domain: 'sea' }, { kind: 'stabilityDrift', value: -0.1 }],
    escalation: { effects: { infrastructure: -8 }, spawns: [{ templateId: 'parts_shortage', chance: 0.25 }], text: 'Prolonged closure damaged regional maritime infrastructure.' },
    responses: [
      { id: 'alternate', label: 'Use Alternate Port', description: 'Redirect support to an alternate facility. Depends on Sea readiness.', credits: 80, personnel: 3, crews: 0, hours: 8, baseSuccess: 0.8, domainDependency: 'sea', onSuccess: {} },
      { id: 'repair', label: 'Repair Facility', description: 'Restore the facility and improve its resilience.', credits: 150, personnel: 8, crews: 1, hours: 18, baseSuccess: 0.95, onSuccess: { infrastructure: 6 } },
      monitor(),
    ],
    weight: (s, r) => (s.assets.some((a) => a.region === r.id && a.domain === 'sea') ? 0.4 + (100 - r.infrastructure) / 40 : 0),
  },
  {
    id: 'power_fault', category: 'ground', title: 'Power Grid Fault at Command Facility', domains: ['ground'],
    target: { domains: ['ground'], roles: ['command', 'comms'] }, severity: [2, 3], duration: [14, 22],
    narrative: ({ asset, region }) =>
      `${asset?.name ?? 'A command facility'} in ${region.name} has lost primary power and is running on limited backup.`,
    effects: [{ kind: 'assetDecay', value: 1.0 }, { kind: 'commsPenalty', value: 10 }, { kind: 'infraDrift', value: -0.15 }],
    escalation: { effects: { infrastructure: -10, assetCondition: -25 }, spawns: [{ templateId: 'relay_degradation', chance: 0.5 }], text: 'Backup power exhausted; facility went dark.' },
    responses: [
      { id: 'backup', label: 'Bring Up Backup Generation', description: 'Stabilize with mobile generation. Quick, partial.', credits: 60, personnel: 3, crews: 0, hours: 4, baseSuccess: 0.75, onSuccess: { assetCondition: 5 } },
      { id: 'grid', label: 'Grid Repair', description: 'Full repair of the facility power feed.', credits: 140, personnel: 7, crews: 1, hours: 12, baseSuccess: 0.95, onSuccess: { infrastructure: 5, assetCondition: 15 } },
      monitor(),
    ],
    weight: (_s, r) => 0.3 + (100 - r.infrastructure) / 30,
  },
  {
    id: 'parts_shortage', category: 'logistics', title: 'Spare Parts Shortage', domains: ['air', 'sea', 'ground'],
    severity: [2, 3], duration: [20, 30],
    narrative: ({ region }) =>
      `The ${region.name} logistics depot has run short of critical spares. Maintenance costs are inflated until supply recovers.`,
    effects: [{ kind: 'maintenanceCostMult', value: 1.5 }, { kind: 'creditsDrain', value: -1 }],
    escalation: { effects: { personnel: -5 }, spawns: [{ templateId: 'airframe', chance: 0.5 }], text: 'Shortage forced deferred maintenance across the region.' },
    responses: [
      { id: 'procure', label: 'Emergency Procurement', description: 'Buy spares at premium prices.', credits: 160, personnel: 2, crews: 0, hours: 12, baseSuccess: 0.9, onSuccess: {} },
      { id: 'redistribute', label: 'Redistribute Stock by Air', description: 'Move stock from other depots. Depends on Air readiness.', credits: 40, personnel: 4, crews: 0, hours: 18, baseSuccess: 0.75, domainDependency: 'air', onSuccess: {} },
      monitor(),
    ],
    weight: (s) => 0.25 + (100 - s.logistics) / 40,
  },
  {
    id: 'storm', category: 'weather', title: 'Severe Storm System', domains: ['air', 'sea'],
    severity: [2, 3], duration: [20, 30],
    narrative: ({ region }) =>
      `A severe storm system is moving across ${region.name}. Air and maritime operations are restricted and exposed infrastructure is at risk.`,
    effects: [{ kind: 'domainPenalty', value: 40, domain: 'air' }, { kind: 'domainPenalty', value: 40, domain: 'sea' }, { kind: 'awarenessPenalty', value: 10 }],
    escalation: { effects: { infrastructure: -7, assetCondition: -15 }, spawns: [{ templateId: 'port', chance: 0.4 }, { templateId: 'power_fault', chance: 0.4 }], text: 'Unprepared assets and facilities took storm damage.' },
    responses: [
      { id: 'shelter', label: 'Shelter & Secure Assets', description: 'Move aircraft and vessels to protected positions.', credits: 70, personnel: 4, crews: 0, hours: 4, baseSuccess: 0.9, onSuccess: {} },
      { id: 'preposition', label: 'Pre-position Repair Crews', description: 'Secure assets and stage crews to repair damage immediately.', credits: 120, personnel: 6, crews: 1, hours: 6, baseSuccess: 0.97, onSuccess: { infrastructure: 3 } },
      monitor(6),
    ],
    weight: (_s, r) => ({ IPA: 1.2, NAM: 0.9, SAM: 0.8, POL: 0.9 } as Record<string, number>)[r.id] ?? 0.4,
  },
  {
    id: 'unrest', category: 'instability', title: 'Regional Unrest', domains: ['ground'],
    severity: [2, 3], duration: [24, 36],
    narrative: ({ region }) =>
      `Economic pressure has triggered unrest across ${region.name}. Host-nation support for network facilities is weakening.`,
    effects: [{ kind: 'stabilityDrift', value: -0.5 }, { kind: 'infraDrift', value: -0.1 }],
    escalation: { effects: { stability: -12, infrastructure: -6 }, spawns: [{ templateId: 'power_fault', chance: 0.5 }, { templateId: 'port', chance: 0.3 }], text: 'Unrest spread and disrupted facility operations.' },
    responses: [
      { id: 'liaison', label: 'Civil Liaison & Support', description: 'Fund local support programs and liaison teams.', credits: 120, personnel: 8, crews: 0, hours: 16, baseSuccess: 0.82, onSuccess: { stability: 10 } },
      { id: 'logistics', label: 'Logistics Support Surge', description: 'Surge logistics into the region. Depends on Ground readiness.', credits: 90, personnel: 6, crews: 0, hours: 10, baseSuccess: 0.72, domainDependency: 'ground', onSuccess: { stability: 6 } },
      monitor(),
    ],
    weight: (_s, r) => Math.max(0, (75 - r.stability) / 18),
  },
  {
    id: 'conflicting', category: 'information', title: 'Conflicting Sensor Reports', domains: ['space', 'air', 'ground'],
    severity: [1, 2], duration: [14, 22],
    narrative: ({ region }) =>
      `Space, air and ground sensors over ${region.name} are producing inconsistent pictures. Confidence in all reporting from the region is reduced.`,
    effects: [{ kind: 'awarenessPenalty', value: 15 }],
    escalation: { effects: { stability: -4 }, spawns: [{ templateId: 'false_contact', chance: 0.6 }], text: 'Unreconciled data led to further spurious reports.' },
    responses: [
      { id: 'correlate', label: 'Cross-Domain Correlation', description: 'Fuse data across domains to reconcile the picture. Depends on regional comms.', credits: 60, personnel: 3, crews: 0, hours: 6, baseSuccess: 0.9, networkDependent: true, onSuccess: {} },
      monitor(),
    ],
    weight: (_s, r) => 0.2 + (100 - r.awareness) / 50,
  },
  {
    id: 'false_contact', category: 'information', title: 'Unexplained Activity Report', domains: ['air', 'sea'],
    severity: [1, 2], duration: [16, 24],
    narrative: ({ region }) =>
      `A single source reports unexplained activity in ${region.name}. No other sensor has yet corroborated the report.`,
    effects: [{ kind: 'awarenessPenalty', value: 5 }, { kind: 'stabilityDrift', value: -0.2 }],
    escalation: { effects: { stability: -6 }, spawns: [], text: 'Unaddressed reports fed regional uncertainty.' },
    responses: [
      { id: 'task', label: 'Task Surveillance Coverage', description: 'Dedicate airborne surveillance to the area. Depends on Air readiness.', credits: 70, personnel: 3, crews: 0, hours: 8, baseSuccess: 0.85, domainDependency: 'air', onSuccess: { stability: 3 } },
      monitor(),
    ],
    weight: (_s, r) => 0.3 + (100 - r.awareness) / 40,
  },
  {
    id: 'fatigue', category: 'personnel', title: 'Personnel Fatigue', domains: ['ground'],
    severity: [1, 2], duration: [24, 36],
    narrative: ({ region }) =>
      `Extended shifts in ${region.name} have left watch teams fatigued. Error rates are rising and available personnel is shrinking.`,
    effects: [{ kind: 'personnelDrift', value: -0.4 }, { kind: 'domainPenalty', value: 10, domain: 'ground' }],
    escalation: { effects: { personnel: -15 }, spawns: [], text: 'Fatigue caused extended absences.' },
    responses: [
      { id: 'rotate', label: 'Crew Rotation', description: 'Bring in relief teams.', credits: 60, personnel: 0, crews: 0, hours: 12, baseSuccess: 0.9, onSuccess: { personnel: 10 } },
      { id: 'standdown', label: 'Mandatory Rest Period', description: 'Free, but slow.', credits: 0, personnel: 0, crews: 0, hours: 24, baseSuccess: 1, onSuccess: { personnel: 15 } },
      monitor(),
    ],
    weight: (s) => 0.2 + (s.personnelMax - s.personnel) / 60,
  },
  // ── Added for campaign variety ──
  {
    id: 'feed_corruption', category: 'information', title: 'Corrupted Data Feed', domains: ['air', 'ground'],
    severity: [1, 3], duration: [14, 24],
    narrative: ({ region }) =>
      `A data feed into the ${region.name} air picture is carrying malformed tracks. Operators are spending time chasing ghosts and real contacts may be lost in the noise.`,
    effects: [{ kind: 'awarenessPenalty', value: 12 }, { kind: 'domainPenalty', value: 6, domain: 'air' }],
    escalation: { effects: { stability: -5 }, spawns: [{ templateId: 'false_contact', chance: 0.7 }, { templateId: 'network_alert', chance: 0.3 }], text: 'The bad feed polluted the picture and triggered more false reports.' },
    responses: [
      { id: 'isolate', label: 'Isolate the Feed', description: 'Cut the feed and fall back to local sensors. Quick; depends on regional comms.', credits: 50, personnel: 2, crews: 0, hours: 5, baseSuccess: 0.84, networkDependent: true, onSuccess: {} },
      { id: 'authenticate', label: 'Authenticate & Restore', description: 'Trace the fault, restore the feed with authenticated data. Slower but hardens the network.', credits: 110, personnel: 5, crews: 0, hours: 10, baseSuccess: 0.95, onSuccess: { resilience: 2 } },
      monitor(),
    ],
    weight: (_s, r) => 0.1 + (100 - r.awareness) / 120,
  },
  {
    id: 'cable_fault', category: 'comms', title: 'Undersea Cable Fault', domains: ['sea', 'ground'],
    severity: [2, 3], duration: [20, 32],
    narrative: ({ region }) =>
      `An undersea communications cable serving ${region.name} has failed. Traffic is squeezing onto backup routes and the wider network is feeling it.`,
    effects: [{ kind: 'commsPenalty', value: 12 }, { kind: 'globalCommsPenalty', value: 1.5 }],
    escalation: { effects: { infrastructure: -6, stability: -4 }, spawns: [{ templateId: 'comms_blackout', chance: 0.35 }], text: 'Backup routes saturated and regional links collapsed.' },
    responses: [
      { id: 'reroute', label: 'Reroute via Satellite', description: 'Move priority traffic onto orbital relays. Fast; depends on Space readiness.', credits: 80, personnel: 3, crews: 0, hours: 4, baseSuccess: 0.8, domainDependency: 'space', onSuccess: {} },
      { id: 'repair', label: 'Dispatch Repair Ship', description: 'Locate and splice the cable. Slow but restores capacity for good.', credits: 180, personnel: 8, crews: 1, hours: 20, baseSuccess: 0.95, onSuccess: { infrastructure: 4 } },
      monitor(),
    ],
    weight: (_s, r) => 0.12 + (100 - r.infrastructure) / 160,
  },
  {
    id: 'debris', category: 'satellite', title: 'Orbital Debris Conjunction', domains: ['space'],
    target: { domains: ['space'] }, severity: [1, 3], duration: [8, 14],
    narrative: ({ asset }) =>
      `Tracking predicts a close approach between ${asset?.name ?? 'an orbital platform'} and a debris fragment. A collision would damage or disable it.`,
    effects: [{ kind: 'assetDecay', value: 0.4 }],
    escalation: { effects: { assetCondition: -35 }, spawns: [{ templateId: 'sat_power', chance: 0.4 }], text: 'No avoidance manoeuvre: the platform was struck by debris.' },
    responses: [
      { id: 'maneuver', label: 'Avoidance Manoeuvre', description: 'Burn propellant to move clear. Depends on Ground control readiness.', credits: 60, personnel: 2, crews: 0, hours: 3, baseSuccess: 0.9, domainDependency: 'ground', onSuccess: {} },
      { id: 'safe', label: 'Safe Mode & Shield', description: 'Orient the platform to minimise exposure. Cheaper; less certain.', credits: 30, personnel: 1, crews: 0, hours: 2, baseSuccess: 0.7, onSuccess: {} },
      monitor(4),
    ],
    weight: () => 0.15,
  },
  {
    id: 'heat', category: 'weather', title: 'Extreme Heat', domains: ['ground', 'air'],
    severity: [1, 2], duration: [24, 40],
    narrative: ({ region }) =>
      `An extended heatwave across ${region.name} is straining power, cooling and flight operations. Equipment is wearing faster and maintenance costs are rising.`,
    effects: [{ kind: 'domainPenalty', value: 6, domain: 'ground' }, { kind: 'maintenanceCostMult', value: 1.1 }],
    escalation: { effects: { infrastructure: -5 }, spawns: [{ templateId: 'power_fault', chance: 0.5 }], text: 'Grid and cooling failures followed the heat.' },
    responses: [
      { id: 'cooling', label: 'Emergency Cooling & Power', description: 'Bring in mobile cooling and generation for key sites.', credits: 100, personnel: 5, crews: 1, hours: 8, baseSuccess: 0.92, onSuccess: { infrastructure: 2 } },
      { id: 'tempo', label: 'Reduce Operating Tempo', description: 'Shift work to cooler hours. Costs nothing but takes time.', credits: 0, personnel: 0, crews: 0, hours: 14, baseSuccess: 0.85, onSuccess: {} },
      monitor(),
    ],
    weight: () => 0.12,
  },
  {
    id: 'fuel', category: 'logistics', title: 'Fuel Contamination', domains: ['air'],
    target: { domains: ['air'] }, severity: [1, 3], duration: [16, 26],
    narrative: ({ region }) =>
      `Contaminated fuel has been found at an airbase in ${region.name}. Aircraft are grounded until supplies are flushed or replaced.`,
    effects: [{ kind: 'domainPenalty', value: 12, domain: 'air' }, { kind: 'assetDecay', value: 0.3 }],
    escalation: { effects: { assetCondition: -15 }, spawns: [{ templateId: 'airframe', chance: 0.5 }], text: 'Contaminated fuel damaged aircraft engines.' },
    responses: [
      { id: 'flush', label: 'Flush & Inspect', description: 'Drain tanks and inspect engines. Reliable.', credits: 110, personnel: 5, crews: 1, hours: 10, baseSuccess: 0.93, onSuccess: { assetCondition: 10 } },
      { id: 'resupply', label: 'Truck in Clean Fuel', description: 'Bring clean fuel from another depot. Depends on Ground readiness.', credits: 60, personnel: 3, crews: 0, hours: 6, baseSuccess: 0.78, domainDependency: 'ground', onSuccess: {} },
      monitor(),
    ],
    weight: (s, r) => 0.1 + (100 - avgCond(s, r.id)) / 240,
  },
];

export const TEMPLATE_MAP = new Map(TEMPLATES.map((t) => [t.id, t]));

export const SEV_FACTOR: Record<Severity, number> = { 1: 0.6, 2: 1, 3: 1.5, 4: 2.2 };

function pickTarget(s: SimState, t: EventTemplate, region: RegionId): Asset | undefined {
  if (!t.target) return undefined;
  const ok = (a: Asset) =>
    a.role !== 'defense' && t.target!.domains.includes(a.domain) && (!t.target!.roles || t.target!.roles.includes(a.role));
  let list = s.assets.filter((a) => ok(a) && (a.domain === 'space' ? a.coverage.includes(region) : a.region === region));
  if (!list.length) list = s.assets.filter(ok);
  if (!list.length) return undefined;
  // prefer assets in poorer condition
  return weightedPick(s, list.map((a) => ({ item: a, w: 1 + (100 - a.condition) / 25 })));
}

export function spawnEvent(
  s: SimState,
  templateId: string,
  opts: { region?: RegionId; parentId?: string; scripted?: boolean } = {},
): GameEvent | undefined {
  const t = TEMPLATE_MAP.get(templateId);
  if (!t) return undefined;
  const phase = s.phases[s.phaseIndex];
  const region = opts.region ?? (t.global ? 'POL' : pickRegion(s));
  const r = s.regions[region];
  const asset = pickTarget(s, t, region);

  const maxSev = opts.scripted ? 4 : phase.maxSeverity;
  let sev = randInt(s, t.severity[0], t.severity[1]) as Severity;
  if (r.stability < 45 && sev < 4 && rand(s) < 0.3) sev = (sev + 1) as Severity;
  sev = Math.min(sev, Math.max(maxSev, t.severity[0])) as Severity;

  let isGenuine = true;
  if (t.forceFalse || (opts.scripted && templateId === 'false_contact' && s.settings.mode === 'training')) isGenuine = false;
  else if (!opts.scripted && !opts.parentId) {
    const falseChance = phase.falseRate * (1.4 - r.awareness / 100);
    isGenuine = rand(s) > falseChance;
  }

  const aw = r.awareness;
  let confidence = isGenuine ? 28 + aw * 0.45 + rand(s) * 15 : 12 + aw * 0.35 + rand(s) * 22;
  const conflicting = phase.conflicting && !opts.scripted && rand(s) < 0.3;
  let reportedSeverity: [Severity, Severity] = [sev, sev];
  if (conflicting) {
    reportedSeverity = [Math.max(1, sev - 1) as Severity, Math.min(4, sev + 1) as Severity];
    confidence -= 12;
  }
  if (opts.scripted && isGenuine) confidence = Math.max(confidence, 70);

  let reportedAt = s.hour;
  if (phase.delayedInfo && r.comms < 70 && !opts.scripted) reportedAt = s.hour + Math.round((70 - r.comms) / 10 + rand(s) * 3);

  const duration = randRange(s, t.duration[0], t.duration[1]) * (sev === 4 ? 0.8 : 1);
  const sf = SEV_FACTOR[sev];
  const effects = t.effects.map((f) => ({ ...f, value: f.kind === 'maintenanceCostMult' ? f.value : f.value * sf }));

  const e: GameEvent = {
    id: `EV-${String(s.nextId++).padStart(4, '0')}`,
    templateId: t.id,
    category: t.category,
    title: t.title,
    narrative: t.narrative({ region: r, asset, sev }),
    severity: sev,
    region,
    domains: t.domains,
    assetId: asset?.id,
    occurredAt: s.hour,
    reportedAt,
    deadline: Math.round(s.hour + duration),
    status: 'reported',
    confidence: clamp(confidence, 5, 95),
    isGenuine,
    conflicting,
    reportedSeverity,
    effects,
    progress: 0,
    confirmProgress: 0,
    parentId: opts.parentId,
    log: [{ t: s.hour, text: 'Initial report received.' }],
    spent: 0,
    global: t.global,
  };
  s.events.push(e);

  if (t.id === 'conflicting') {
    for (const o of s.events) if (o !== e && o.region === region && o.status === 'reported') o.confidence = clamp(o.confidence - 15, 5, 95);
  }
  return e;
}

function pickRegion(s: SimState): RegionId {
  return (
    weightedPick(s, REGION_IDS.map((id) => {
      const r = s.regions[id];
      return { item: id, w: 1 + (100 - r.stability) / 30 + r.threatLevel / 40 };
    })) ?? pick(s, REGION_IDS)
  );
}

/** Roll for a new random event this hour. Returns the event if one was generated. */
export function maybeGenerateEvent(s: SimState): GameEvent | undefined {
  const phase = s.phases[s.phaseIndex];
  const active = s.events.filter((e) => e.status === 'reported' || e.status === 'confirming' || e.status === 'responding').length;
  if (active >= 14) return undefined;
  const freq = s.settings.mode === 'sandbox' ? 1 : s.settings.eventFrequency;
  const lambda = phase.eventRate * s.difficulty * freq;
  if (rand(s) > lambda) return undefined;
  const region = pickRegion(s);
  const r = s.regions[region];
  const candidates = TEMPLATES.filter((t) => !t.scriptedOnly && phase.categories.includes(t.category)).map((t) => ({
    item: t, w: t.weight(s, r),
  }));
  const t = weightedPick(s, candidates);
  if (!t) return undefined;
  return spawnEvent(s, t.id, { region });
}
