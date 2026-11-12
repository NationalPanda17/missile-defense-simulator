// Tactical layer: theaters, sites, threat waves and their resolution. Campaign mode only.
//
// The tactical layer draws from its own RNG stream (`tactical.rng`), so adding it does not change how the
// management simulation plays out for a given seed.
import { SIM_CONFIG, TACTICAL_CONFIG } from './config';
import { EQUIPMENT_MAP, isEffector, type EquipmentSpec } from './equipment';
import { availability } from './metrics';
import { clamp, rand } from './rng';
import type {
  Deployment, LogLevel, RegionId, SimState, Site, SiteType, TacticalState, TacticalStats, ThreatAxis, ThreatClass, ThreatWave, Track,
} from './types';
import { REGION_IDS } from './types';

type Rng = { rng: number };

const AXES: ThreatAxis[] = ['north', 'south', 'east', 'west'];
const CLASSES: ThreatClass[] = ['slowDrone', 'fastDrone', 'cruise', 'rocket', 'ballistic'];

const emptyStats = (): TacticalStats => ({ tracks: 0, stopped: 0, leaked: 0, decoysEngaged: 0, shots: 0, siteDamage: 0 });

const tacticalAllowed = (s: SimState) => s.settings.mode === 'campaign' && TACTICAL_CONFIG.enabledInCampaign;

/** A fresh tactical state for a game. Sites are generated from the seed; waves are scheduled separately. */
export function createTactical(s: SimState): TacticalState {
  const t: TacticalState = {
    enabled: tacticalAllowed(s),
    rng: (s.settings.seed * 2654435761 + 0x7ac7) >>> 0,
    nextId: 1,
    sites: [],
    deployments: [],
    waves: [],
    forecast: [],
    stats: emptyStats(),
  };
  for (const region of REGION_IDS) t.sites.push(...generateSites(t, region));
  return t;
}

/**
 * Bring any state up to the current tactical shape: saves from before the tactical layer have none, and saves from
 * its first release only have `deployments`. Safe to call on any state.
 */
export function ensureTactical(s: SimState): TacticalState {
  const old = s.tactical as Partial<TacticalState> | undefined;
  if (old && Array.isArray(old.sites) && Array.isArray(old.waves) && old.stats) {
    // A campaign started while the feature flag was off picks the tactical layer up once it is on.
    if (!old.enabled && tacticalAllowed(s)) {
      old.enabled = true;
      if (s.status === 'briefing') scheduleWaves(s);
      else if (s.status === 'running') scheduleWaves(s, s.hour + 1);
    }
    return s.tactical!;
  }
  const t = createTactical(s);
  if (old?.deployments?.length) t.deployments = old.deployments;
  s.tactical = t;
  if (s.status === 'briefing') scheduleWaves(s);
  else if (s.status === 'running') scheduleWaves(s, s.hour + 1);
  return t;
}

// ── Theater generation ──────────────────────────────────────────────────

const NAME_START = ['Kar', 'Vel', 'Mor', 'Tal', 'Bren', 'Os', 'Lun', 'Dar', 'Fen', 'Ist', 'Rho', 'Sav', 'Ket', 'Ard', 'Mal', 'Cor', 'Qen', 'Zar', 'Ilv', 'Tor'];
const NAME_END = ['ova', 'ent', 'haven', 'mont', 'ara', 'ford', 'enz', 'vel', 'ia', 'ulo', 'ek', 'ston', 'is', 'mar', 'ane', 'oth'];
const SITE_SUFFIX: Record<SiteType, string> = { city: '', port: ' Harbor', power: ' Power Station', comms: ' Signal Hub', command: ' Command Post' };

function siteName(r: Rng, used: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const n = NAME_START[Math.floor(rand(r) * NAME_START.length)] + NAME_END[Math.floor(rand(r) * NAME_END.length)];
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return `Site ${used.size + 1}`;
}

function generateSites(t: TacticalState, region: RegionId): Site[] {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const m = TACTICAL_CONFIG.siteMarginKm;
  const used = new Set<string>();
  const out: Site[] = [];
  for (const mix of TACTICAL_CONFIG.siteMix) {
    for (let i = 0; i < mix.count; i++) {
      // Keep sites apart so one system can't cover everything.
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 30; tries++) {
        x = Math.round(m + rand(t) * (width - 2 * m));
        y = Math.round(m + rand(t) * (height - 2 * m));
        if (out.every((o) => Math.hypot(o.x - x, o.y - y) > 60)) break;
      }
      out.push({
        id: `${region}-S${out.length + 1}`, name: siteName(t, used) + SITE_SUFFIX[mix.type], region, type: mix.type,
        x, y, importance: mix.importance, integrity: 100,
      });
    }
  }
  return out;
}

// ── Waves ────────────────────────────────────────────────────────────────

function weighted<T>(r: Rng, items: { item: T; w: number }[]): T {
  const total = items.reduce((a, b) => a + Math.max(0, b.w), 0);
  let x = rand(r) * total;
  for (const it of items) {
    x -= Math.max(0, it.w);
    if (x <= 0) return it.item;
  }
  return items[items.length - 1].item;
}

function edgePoint(r: Rng, axis: ThreatAxis): [number, number] {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const along = 0.1 + rand(r) * 0.8;
  switch (axis) {
    case 'north': return [Math.round(along * width), 0];
    case 'south': return [Math.round(along * width), height];
    case 'west': return [0, Math.round(along * height)];
    case 'east': return [width, Math.round(along * height)];
  }
}

function makeTrack(t: TacticalState, region: RegionId, cls: ThreatClass, axis: ThreatAxis, decoy: boolean): Track | null {
  const targets = t.sites.filter((x) => x.region === region && x.integrity > 0);
  if (!targets.length) return null;
  const site = weighted(t, targets.map((x) => ({ item: x, w: x.importance })));
  return { id: `TRK-${t.nextId++}`, cls, siteId: site.id, from: edgePoint(t, axis), decoy, shots: 0 };
}

/**
 * Schedule the current phase's threat waves and set the briefing forecast. Called when a briefing opens, so the
 * player sees the forecast before deploying. `fromHour` lets a mid-phase upgrade schedule only what is left.
 */
export function scheduleWaves(s: SimState, fromHour?: number) {
  const t = s.tactical;
  if (!t?.enabled) return;
  const profile = TACTICAL_CONFIG.waves[s.phaseIndex];
  const phase = s.phases[s.phaseIndex];
  t.waves = t.waves.filter((w) => w.phaseIndex !== s.phaseIndex);
  t.forecast = [];
  if (!profile || !phase) return;

  // Forecast: regions under the most strain are the likeliest targets.
  const pool = [...REGION_IDS];
  for (let i = 0; i < TACTICAL_CONFIG.forecastRegions && pool.length; i++) {
    const id = weighted(t, pool.map((r) => ({ item: r, w: 20 + (100 - s.regions[r].stability) })));
    t.forecast.push(id);
    pool.splice(pool.indexOf(id), 1);
  }

  const start = s.status === 'running' ? s.phaseStartHour : s.hour; // in a briefing, the phase starts at s.hour
  const first = Math.max(fromHour ?? 0, start + 6);
  const last = start + phase.hours - 2;
  if (last <= first) return;
  const hours = Array.from({ length: profile.count }, () => first + Math.floor(rand(t) * (last - first + 1))).sort((a, b) => a - b);
  const others = REGION_IDS.filter((r) => !t.forecast.includes(r));
  // Forecast regions take turns (in random order), so every forecast region sees at least one wave when there are
  // enough waves. A forecast that never comes true would teach players to ignore it.
  const order = [...t.forecast].sort(() => rand(t) - 0.5);
  let next = 0;
  for (const atHour of hours) {
    const surprise = others.length > 0 && rand(t) < TACTICAL_CONFIG.surpriseRate;
    const region = surprise ? others[Math.floor(rand(t) * others.length)] : order[next++ % order.length];
    const axis = AXES[Math.floor(rand(t) * AXES.length)];
    const n = profile.tracks[0] + Math.floor(rand(t) * (profile.tracks[1] - profile.tracks[0] + 1));
    const tracks: Track[] = [];
    for (let i = 0; i < n; i++) {
      const cls = weighted(t, CLASSES.map((c) => ({ item: c, w: profile.mix[c] })));
      const tr = makeTrack(t, region, cls, axis, false);
      if (tr) tracks.push(tr);
    }
    t.waves.push({
      id: `WAVE-${t.nextId++}`, region, phaseIndex: s.phaseIndex, atHour, axis, forecast: !surprise, tracks, resolved: false,
    });
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────

/** Length (km) of the segment a→b that lies inside the circle at c with radius r. */
export function chordInside(a: [number, number], b: [number, number], c: [number, number], r: number): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const fx = a[0] - c[0];
  const fy = a[1] - c[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return 0;
  const sq = Math.sqrt(disc);
  const t1 = clamp((-B - sq) / (2 * A), 0, 1);
  const t2 = clamp((-B + sq) / (2 * A), 0, 1);
  return Math.max(0, t2 - t1) * len;
}

/** Range (km) at which a system detects a threat class, or 0 if it can't. */
export function detectionRange(spec: EquipmentSpec, cls: ThreatClass): number {
  const dronesOnly = spec.id === 'acoustic-net' || spec.id === 'passive-rf';
  if (dronesOnly && cls !== 'slowDrone' && cls !== 'fastDrone') return 0;
  if (spec.layer === 'detection') return spec.rangeKm;
  return spec.radar?.rangeKm ?? 0;
}

export const isUnlimited = (spec: EquipmentSpec) => spec.magazine >= TACTICAL_CONFIG.unlimitedMagazine;

// ── Resolution ───────────────────────────────────────────────────────────

function tlog(s: SimState, level: LogLevel, text: string, region?: RegionId) {
  s.log.push({ t: s.hour, level, text, region });
  if (s.log.length > 800) s.log.splice(0, s.log.length - 800);
}

function resolveTrack(s: SimState, t: TacticalState, w: ThreatWave, tr: Track, deps: Deployment[]) {
  const site = t.sites.find((x) => x.id === tr.siteId);
  if (!site) return;
  const region = s.regions[w.region];
  const target: [number, number] = [site.x, site.y];
  const assetOf = (d: Deployment) => s.assets.find((a) => a.id === d.assetId);

  const seen = deps.some((d) => {
    const asset = assetOf(d);
    if (!asset || availability(s, asset) <= 0) return false;
    const range = detectionRange(EQUIPMENT_MAP.get(d.equipmentId)!, tr.cls);
    return range > 0 && chordInside(tr.from, target, [d.x, d.y], range) > 0;
  });
  const detection = (seen ? 1 : TACTICAL_CONFIG.unseenDetection) * (0.7 + 0.3 * (region.awareness / 100));
  const commsF = 0.6 + 0.4 * (region.comms / 100);
  const speed = TACTICAL_CONFIG.threatSpeedKmS[tr.cls];

  // Outer layers engage first.
  const shooters = deps
    .map((d) => ({ d, spec: EQUIPMENT_MAP.get(d.equipmentId)!, asset: assetOf(d) }))
    .filter((x) => x.asset && isEffector(x.spec) && x.spec.killRate[tr.cls] > 0)
    .map((x) => ({ ...x, chord: chordInside(tr.from, target, [x.d.x, x.d.y], x.spec.rangeKm) }))
    .filter((x) => x.chord > 0)
    .sort((a, b) => b.spec.rangeKm - a.spec.rangeKm);

  let stopped = false;
  for (const { d, spec, asset, chord } of shooters) {
    if (stopped) break;
    const avail = Math.min(1, availability(s, asset!));
    if (avail <= 0) continue;
    const reaction = spec.reactionSec * (seen ? 1 : 2);
    const window = chord / speed - reaction;
    if (window <= 0) continue;
    const shots = Math.min(TACTICAL_CONFIG.maxShotsPerSystem, 1 + Math.floor(window / Math.max(reaction, 30)));
    for (let i = 0; i < shots && !stopped; i++) {
      if (!isUnlimited(spec)) {
        if (d.stock <= 0) break;
        d.stock -= 1;
      }
      tr.shots += 1;
      t.stats.shots += 1;
      if (rand(t) < spec.killRate[tr.cls] * avail * detection * commsF) {
        stopped = true;
        tr.stoppedBy = d.id;
      }
    }
  }

  if (tr.decoy) {
    tr.outcome = stopped ? 'decoyStopped' : 'decoyLeaked';
    if (tr.shots > 0) t.stats.decoysEngaged += 1;
    return;
  }
  t.stats.tracks += 1;
  if (stopped) {
    tr.outcome = 'stopped';
    t.stats.stopped += 1;
    return;
  }
  tr.outcome = 'leaked';
  t.stats.leaked += 1;
  const damage = Math.min(site.integrity, TACTICAL_CONFIG.threatDamage[tr.cls]);
  tr.damage = damage;
  site.integrity -= damage;
  t.stats.siteDamage += damage;
  const weight = damage * (site.importance / 3);
  region.infrastructure = clamp(region.infrastructure - weight * TACTICAL_CONFIG.infraPerDamage);
  region.stability = clamp(region.stability - weight * TACTICAL_CONFIG.stabilityPerDamage);
}

function resolveWave(s: SimState, t: TacticalState, w: ThreatWave) {
  const region = s.regions[w.region];
  const phase = s.phases[s.phaseIndex];
  // Poor awareness means more false tracks that draw fire.
  const decoys = Math.round(w.tracks.length * phase.falseRate * (1.4 - region.awareness / 100) * 0.6);
  for (let i = 0; i < decoys; i++) {
    const tr = makeTrack(t, w.region, rand(t) < 0.7 ? 'slowDrone' : 'fastDrone', w.axis, true);
    if (tr) w.tracks.push(tr);
  }
  const deps = t.deployments.filter((d) => d.region === w.region);
  for (const tr of w.tracks) resolveTrack(s, t, w, tr, deps);
  w.resolved = true;

  const real = w.tracks.filter((x) => !x.decoy);
  if (!real.length) return;
  const leaked = real.filter((x) => x.outcome === 'leaked').length;
  const where = `${region.name}, from the ${w.axis}`;
  if (leaked === 0) tlog(s, 'success', `Threat wave ${w.id} (${real.length} threats) defeated in ${where}.`, w.region);
  else tlog(s, leaked * 3 >= real.length ? 'crit' : 'warn', `Threat wave ${w.id} in ${where}: ${real.length - leaked}/${real.length} stopped, ${leaked} got through.`, w.region);
}

/** Hourly tactical update: resupply timers, then any waves arriving this hour. */
export function tickTactical(s: SimState) {
  const t = s.tactical;
  if (!t?.enabled) return;
  for (const d of t.deployments) {
    if (d.reloadRemaining === undefined) continue;
    d.reloadRemaining -= 1;
    if (d.reloadRemaining <= 0) {
      d.reloadRemaining = undefined;
      d.stock = EQUIPMENT_MAP.get(d.equipmentId)!.magazine;
    }
  }
  for (const w of t.waves) {
    if (!w.resolved && w.atHour === s.hour) resolveWave(s, t, w);
  }
}

// ── Deployment helpers (called from actions.ts) ─────────────────────────

/** Map a theater position to lon/lat near the region centre, for the world map. */
export function theaterToLonLat(s: SimState, region: RegionId, x: number, y: number): [number, number] {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const c = s.regions[region].center;
  return [+(c[0] + (x / width - 0.5) * 16).toFixed(2), +(c[1] + (0.5 - y / height) * 10).toFixed(2)];
}

export function insideTheater(x: number, y: number): boolean {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= width && y >= 0 && y <= height;
}

/** Create the deployment and its backing asset. Validation and charging happen in actions.ts. */
export function addDeployment(s: SimState, spec: EquipmentSpec, region: RegionId, x: number, y: number, upkeep: number): Deployment {
  const t = ensureTactical(s);
  const n = t.nextId++;
  const assetId = `TAC-${n}`;
  // Number units per system type: "NASAMS 1", "NASAMS 2"… reusing numbers freed by withdrawals.
  const taken = new Set(s.assets.filter((a) => a.role === 'defense' && a.className === spec.name).map((a) => a.name));
  let unit = 1;
  while (taken.has(`${spec.name} ${unit}`)) unit++;
  s.assets.push({
    id: assetId, name: `${spec.name} ${unit}`, className: spec.name, domain: spec.domain, role: 'defense', region,
    coverage: [region], condition: 100, capability: 0, status: 'operational',
    hoursToService: SIM_CONFIG.serviceInterval[spec.domain], maintenanceRemaining: 0, upkeep,
    pos: theaterToLonLat(s, region, x, y), history: [100],
  });
  const d: Deployment = { id: `DEP-${n}`, equipmentId: spec.id, assetId, region, x, y, stock: spec.magazine, deployedAt: s.hour };
  t.deployments.push(d);
  return d;
}

/** Remove a deployment and its asset. Frees a crew if the asset was in maintenance. */
export function removeDeployment(s: SimState, d: Deployment) {
  const t = ensureTactical(s);
  const a = s.assets.find((x) => x.id === d.assetId);
  if (a?.status === 'maintenance') s.crewsBusy = Math.max(0, s.crewsBusy - 1);
  s.assets = s.assets.filter((x) => x.id !== d.assetId);
  t.deployments = t.deployments.filter((x) => x.id !== d.id);
}

/** Structural check for the optional tactical state. Returns an error message or null. */
export function tacticalShapeError(x: unknown): string | null {
  if (x === undefined) return null;
  const tac = x as TacticalState;
  if (!tac || typeof tac !== 'object' || !Array.isArray(tac.deployments)) return 'state.tactical is invalid';
  if (tac.sites !== undefined && !Array.isArray(tac.sites)) return 'state.tactical.sites is invalid';
  if (tac.waves !== undefined && !Array.isArray(tac.waves)) return 'state.tactical.waves is invalid';
  for (const d of tac.deployments) {
    if (!d || typeof d.id !== 'string' || !EQUIPMENT_MAP.has(d.equipmentId)) return 'state.tactical deployment has unknown equipment';
    if (!REGION_IDS.includes(d.region)) return 'state.tactical deployment has an invalid region';
    if (!insideTheater(d.x, d.y)) return 'state.tactical deployment is outside the theater';
    if (!Number.isFinite(d.stock) || d.stock < 0) return 'state.tactical deployment stock is invalid';
  }
  return null;
}
