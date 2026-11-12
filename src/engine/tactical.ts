// Tactical layer: theaters, sites, threat waves and their resolution. Campaign mode only.
//
// The tactical layer draws from its own RNG stream (`tactical.rng`), so adding it does not change how the
// management simulation plays out for a given seed.
import { SIM_CONFIG, TACTICAL_CONFIG, levelOf } from './config';
import { EQUIPMENT_MAP, equipmentCost, isEffector, type EquipmentSpec } from './equipment';
import { availability } from './metrics';
import { clamp, rand } from './rng';
import { normalizeTactical } from './scenarios';
import { LESSON_MAP, type ScriptedWave } from './training';
import { TERRAIN_PROFILES, generateTerrain, isSea, lowHorizonKm, masked, randomCoastal, randomLand } from './terrain';
import type {
  Deployment, LogLevel, RegionId, SimState, Site, SiteType, TacticalState, TacticalStats, TheaterTerrain, ThreatAxis, ThreatClass,
  ThreatWave, Track,
} from './types';
import { REGION_IDS } from './types';

type Rng = { rng: number };

const AXES: ThreatAxis[] = ['north', 'south', 'east', 'west'];
const CLASSES: ThreatClass[] = ['slowDrone', 'fastDrone', 'cruise', 'rocket', 'ballistic'];

const emptyStats = (): TacticalStats => ({ tracks: 0, stopped: 0, leaked: 0, decoysEngaged: 0, shots: 0, siteDamage: 0 });

/** Training lesson with scripted threat waves, if this is one. The only training scenarios with a tactical layer. */
const tacticalLesson = (s: SimState) => (s.settings.mode === 'training' && s.settings.lesson ? LESSON_MAP.get(s.settings.lesson) : undefined);
const tacticalAllowed = (s: SimState) =>
  (s.settings.mode === 'campaign' && TACTICAL_CONFIG.enabledInCampaign) || !!tacticalLesson(s)?.waves?.length;

/** A fresh tactical state for a game. Sites are generated from the seed; waves are scheduled separately. */
export function createTactical(s: SimState): TacticalState {
  const t: TacticalState = {
    enabled: tacticalAllowed(s),
    rng: (s.settings.seed * 2654435761 + 0x7ac7) >>> 0,
    nextId: 1,
    sites: [],
    terrain: {} as Record<RegionId, TheaterTerrain>,
    deployments: [],
    waves: [],
    forecast: [],
    stats: emptyStats(),
  };
  for (const region of REGION_IDS) {
    t.terrain![region] = generateTerrain(t, region);
    t.sites.push(...generateSites(t, region));
  }
  return t;
}

/**
 * Bring any state up to the current tactical shape: saves from before the tactical layer have none, and saves from
 * its first release only have `deployments`. Safe to call on any state.
 */
export function ensureTactical(s: SimState): TacticalState {
  const old = s.tactical as Partial<TacticalState> | undefined;
  if (old && Array.isArray(old.sites) && Array.isArray(old.waves) && old.stats) {
    // Saves from before terrain: add maps from a separate stream so the save's own wave sequence is untouched.
    // Existing sites keep their positions.
    if (!old.terrain) {
      const r = { rng: (s.settings.seed * 2246822519 + 0x3c1) >>> 0 };
      old.terrain = Object.fromEntries(REGION_IDS.map((id) => [id, generateTerrain(r, id)])) as Record<RegionId, TheaterTerrain>;
    }
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
  const terrain = t.terrain![region];
  const profileClusters = TERRAIN_PROFILES[region].clusters;
  const used = new Set<string>();
  const out: Site[] = [];
  const fallback = (): [number, number] => [Math.round(m + rand(t) * (width - 2 * m)), Math.round(m + rand(t) * (height - 2 * m))];
  const spaced = (p: [number, number] | null) => !!p && out.every((o) => Math.hypot(o.x - p[0], o.y - p[1]) > 35);
  // Cities gather around a few metro centres; everything else is spread over the land.
  const centres = Array.from({ length: profileClusters }, () => randomLand(t, terrain, m + 30, 25) ?? fallback());
  let cityIndex = 0;
  for (const mix of TACTICAL_CONFIG.siteMix) {
    for (let i = 0; i < mix.count; i++) {
      let p: [number, number] | null = null;
      for (let tries = 0; tries < 12 && !spaced(p); tries++) {
        if (mix.type === 'city') p = randomLand(t, terrain, m - 30, 10, { at: centres[cityIndex % centres.length], within: 75 });
        else if (mix.type === 'port') p = randomCoastal(t, terrain, m - 40);
        else p = randomLand(t, terrain, m - 20, 10);
      }
      if (!p) p = fallback();
      if (mix.type === 'city') cityIndex++;
      out.push({
        id: `${region}-S${out.length + 1}`, name: siteName(t, used) + SITE_SUFFIX[mix.type], region, type: mix.type,
        x: p[0], y: p[1], importance: mix.importance, integrity: 100,
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
  const base = TACTICAL_CONFIG.waves[s.phaseIndex];
  const phase = s.phases[s.phaseIndex];
  t.waves = t.waves.filter((w) => w.phaseIndex !== s.phaseIndex);
  t.forecast = [];
  const lesson = tacticalLesson(s);
  if (lesson?.waves) return scheduleLessonWaves(s, t, lesson.waves);
  if (!base || !phase) return;
  // Apply the scenario's multipliers. The standard scenario (all 1s) reproduces the base profile exactly.
  const sc = normalizeTactical(s.settings.tactical);
  const lv = levelOf(s.settings);
  if (lv.waveSize !== 1) sc.waveSize *= lv.waveSize;
  if (lv.surpriseMult !== 1) sc.surpriseRate = Math.min(0.9, sc.surpriseRate * lv.surpriseMult);
  const scaledMix = Object.fromEntries(CLASSES.map((c) => [c, base.mix[c] * sc.mix[c]])) as Record<ThreatClass, number>;
  const profile = {
    count: Math.max(1, Math.round(base.count * sc.waveCount)),
    tracks: [Math.max(1, Math.round(base.tracks[0] * sc.waveSize)), Math.max(1, Math.round(base.tracks[1] * sc.waveSize))] as const,
    mix: CLASSES.some((c) => scaledMix[c] > 0) ? scaledMix : base.mix, // never leave a phase with no possible threat
  };

  // Forecast: regions under the most strain are the likeliest targets.
  const pool = [...REGION_IDS];
  for (let i = 0; i < sc.forecastRegions && pool.length; i++) {
    const id = weighted(t, pool.map((r) => ({ item: r, w: 20 + (100 - s.regions[r].stability) })));
    t.forecast.push(id);
    pool.splice(pool.indexOf(id), 1);
  }

  const start = s.status === 'running' ? s.phaseStartHour : s.hour; // in a briefing, the phase starts at s.hour
  const first = Math.max((fromHour ?? 0) + 3, start + 6); // leaves room for the longest flight before impact
  const last = start + phase.hours - 2;
  if (last <= first) return;
  const hours = Array.from({ length: profile.count }, () => first + Math.floor(rand(t) * (last - first + 1))).sort((a, b) => a - b);
  // Every forecast region gets one wave first; only the extra waves can strike elsewhere. A forecast that never
  // comes true would teach players to ignore it. The assignments are shuffled so the timing gives nothing away.
  const others = REGION_IDS.filter((r) => !t.forecast.includes(r));
  const targets: { region: RegionId; surprise: boolean }[] = [];
  for (let i = 0; i < hours.length; i++) {
    if (i < t.forecast.length) targets.push({ region: t.forecast[i], surprise: false });
    else if (others.length && rand(t) < sc.surpriseRate) targets.push({ region: others[Math.floor(rand(t) * others.length)], surprise: true });
    else targets.push({ region: t.forecast[Math.floor(rand(t) * t.forecast.length)], surprise: false });
  }
  for (let i = targets.length - 1; i > 0; i--) {
    const j = Math.floor(rand(t) * (i + 1));
    [targets[i], targets[j]] = [targets[j], targets[i]];
  }
  for (const [k, atHour] of hours.entries()) {
    const { region, surprise } = targets[k];
    const axis = AXES[Math.floor(rand(t) * AXES.length)];
    const n = profile.tracks[0] + Math.floor(rand(t) * (profile.tracks[1] - profile.tracks[0] + 1));
    const tracks: Track[] = [];
    for (let i = 0; i < n; i++) {
      const cls = weighted(t, CLASSES.map((c) => ({ item: c, w: profile.mix[c] })));
      const tr = makeTrack(t, region, cls, axis, false);
      if (!tr) continue;
      const turnChance = TACTICAL_CONFIG.turning.chanceByPhase[s.phaseIndex] ?? 0;
      if (turnChance > 0 && TACTICAL_CONFIG.turning.classes.includes(cls) && rand(t) < turnChance) tr.via = turnPoint(t, tr);
      tracks.push(tr);
    }
    t.waves.push({
      id: `WAVE-${t.nextId++}`, region, phaseIndex: s.phaseIndex, atHour, launchAt: atHour - waveLeadHours(tracks), axis, forecast: !surprise, tracks,
      resolved: false,
    });
  }
}

/** A turn point off to one side of the straight path, so the threat comes in from an unexpected angle. */
function turnPoint(t: TacticalState, tr: Track): [number, number] {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const site = t.sites.find((x) => x.id === tr.siteId)!;
  const [fx, fy] = tr.from;
  const dx = site.x - fx;
  const dy = site.y - fy;
  const len = Math.hypot(dx, dy) || 1;
  const k = 0.35 + rand(t) * 0.25;
  const [lo, hi] = TACTICAL_CONFIG.turning.offsetKm;
  const off = (lo + rand(t) * (hi - lo)) * (rand(t) < 0.5 ? -1 : 1);
  const x = fx + dx * k + (-dy / len) * off;
  const y = fy + dy * k + (dx / len) * off;
  return [Math.round(Math.max(10, Math.min(width - 10, x))), Math.round(Math.max(10, Math.min(height - 10, y)))];
}

/** A training lesson's waves are written out in full, so every player meets the same attacks. */
function scheduleLessonWaves(s: SimState, t: TacticalState, waves: ScriptedWave[]) {
  const start = s.status === 'running' ? s.phaseStartHour : s.hour;
  t.forecast = [...new Set(waves.filter((w) => w.forecast).map((w) => w.region))];
  for (const sw of waves) {
    const tracks: Track[] = [];
    for (const cls of CLASSES) {
      for (let i = 0; i < (sw.tracks[cls] ?? 0); i++) {
        const tr = makeTrack(t, sw.region, cls, sw.axis, false);
        if (tr) tracks.push(tr);
      }
    }
    const atHour = start + sw.atHour;
    t.waves.push({
      id: `WAVE-${t.nextId++}`, region: sw.region, phaseIndex: s.phaseIndex, atHour, launchAt: atHour - waveLeadHours(tracks), axis: sw.axis,
      forecast: sw.forecast, tracks, resolved: false,
    });
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────

/** Where (0-1 along a→b) the segment enters and leaves the circle at c with radius r, or null if it doesn't. */
export function chordSpan(a: [number, number], b: [number, number], c: [number, number], r: number): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return null;
  const fx = a[0] - c[0];
  const fy = a[1] - c[1];
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = clamp((-B - sq) / (2 * A), 0, 1);
  const t2 = clamp((-B + sq) / (2 * A), 0, 1);
  return t2 > t1 ? [t1, t2] : null;
}

/** Length (km) of the segment a→b that lies inside the circle at c with radius r. */
export function chordInside(a: [number, number], b: [number, number], c: [number, number], r: number): number {
  const span = chordSpan(a, b, c, r);
  return span ? (span[1] - span[0]) * Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

export const isLowFlying = (cls: ThreatClass) => TACTICAL_CONFIG.lowAltitude.classes.includes(cls);
/** Passive sensors listen rather than look, so they aren't horizon-limited (their range is short anyway). */
const isPassive = (spec: EquipmentSpec) => spec.id === 'acoustic-net' || spec.id === 'passive-rf';

/**
 * The part of a path (a→b) a deployment can work against, for one threat class: its range, cut to the radar
 * horizon for low-flying threats unless cued from the air, and dropped if a massif hides the path from it.
 * `range` is the system's own reach (detection or engagement). Returns the chord length in km.
 */
function reachSpan(terrain: TheaterTerrain | undefined, d: Deployment, spec: EquipmentSpec, cls: ThreatClass, a: [number, number], b: [number, number], range: number, cued: boolean): [number, number] | null {
  if (range <= 0) return null;
  const low = isLowFlying(cls) && spec.domain !== 'air';
  const limited = low && !cued && !isPassive(spec) ? Math.min(range, lowHorizonKm(terrain, [d.x, d.y])) : range;
  const span = chordSpan(a, b, [d.x, d.y], limited);
  if (!span) return null;
  if (low && !cued) {
    const mid = (span[0] + span[1]) / 2;
    if (masked(terrain, [d.x, d.y], [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid])) return null;
  }
  return span;
}

function reach(terrain: TheaterTerrain | undefined, d: Deployment, spec: EquipmentSpec, cls: ThreatClass, a: [number, number], b: [number, number], range: number, cued: boolean): number {
  const span = reachSpan(terrain, d, spec, cls, a, b, range, cued);
  return span ? (span[1] - span[0]) * Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
}

/** A track's flight path: straight in, or bent at its turn point. */
export function trackPath(tr: { from: [number, number]; via?: [number, number] }, target: [number, number]): [number, number][] {
  return tr.via ? [tr.from, tr.via, target] : [tr.from, target];
}

/** The point a fraction f (0-1) of the way along a path, and the heading (degrees) there. */
export function pointAlong(path: [number, number][], f: number): { p: [number, number]; heading: number } {
  const lens = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let d = Math.max(0, Math.min(1, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 0;
      return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], heading: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
    }
    d -= lens[i];
  }
  return { p: path[path.length - 1], heading: 0 };
}

/** Length of path inside a system's reach, summed over the path's legs. */
function reachPath(terrain: TheaterTerrain | undefined, d: Deployment, spec: EquipmentSpec, cls: ThreatClass, path: [number, number][], range: number, cued: boolean): number {
  let sum = 0;
  for (let i = 0; i + 1 < path.length; i++) sum += reach(terrain, d, spec, cls, path[i], path[i + 1], range, cued);
  return sum;
}

/** Where (0-1 along the whole path) a system's reach starts and ends, on the first leg it covers. */
function reachSpanPath(terrain: TheaterTerrain | undefined, d: Deployment, spec: EquipmentSpec, cls: ThreatClass, path: [number, number][], range: number, cued: boolean): [number, number] | null {
  const lens = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  for (let i = 0; i < lens.length; i++) {
    const sp = reachSpan(terrain, d, spec, cls, path[i], path[i + 1], range, cued);
    if (sp) return [(before + sp[0] * lens[i]) / total, (before + sp[1] * lens[i]) / total];
    before += lens[i];
  }
  return null;
}

/** Can this system engage this class at all (kill rate and altitude ceiling)? */
export const canEngageClass = (spec: EquipmentSpec, cls: ThreatClass) =>
  spec.killRate[cls] > 0 && spec.altitudeKm >= TACTICAL_CONFIG.threatAltitudeKm[cls];

/**
 * Best single-shot kill rate against each class for a threat aimed at this point, from systems that can engage now.
 * Uses the same rules as wave resolution (altitude, horizon, terrain, airborne cueing), approximating the path as
 * the last 40 km into the point from every direction.
 */
export function coverageAt(s: SimState, region: RegionId, x: number, y: number): Record<ThreatClass, number> {
  const out = { slowDrone: 0, fastDrone: 0, cruise: 0, rocket: 0, ballistic: 0 };
  const t = s.tactical;
  if (!t) return out;
  const terrain = t.terrain?.[region];
  const deps = t.deployments.filter((d) => d.region === region && canEngage(s, d));
  const air = t.deployments.filter((d) => d.region === region && EQUIPMENT_MAP.get(d.equipmentId)!.domain === 'air' && s.assets.some((a) => a.id === d.assetId && availability(s, a) > 0));
  const target: [number, number] = [x, y];
  for (const cls of CLASSES) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const from: [number, number] = [x + dx * 40, y + dy * 40];
      const cued = isLowFlying(cls) && air.some((d) => reach(terrain, d, EQUIPMENT_MAP.get(d.equipmentId)!, cls, from, target, detectionRange(EQUIPMENT_MAP.get(d.equipmentId)!, cls), true) > 0);
      for (const d of deps) {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        if (!canEngageClass(spec, cls)) continue;
        if (reach(terrain, d, spec, cls, from, target, spec.rangeKm, cued) > 0) out[cls] = Math.max(out[cls], spec.killRate[cls]);
      }
    }
  }
  return out;
}

/** Why a system can't be placed here, or null. Ships go at sea; everything else on land. */
export function placementError(s: SimState, spec: EquipmentSpec, region: RegionId, x: number, y: number): string | null {
  if (!insideTheater(x, y)) return 'Position is outside the theater.';
  const sea = isSea(s.tactical?.terrain?.[region], [x, y]);
  if (spec.domain === 'sea' && !sea) return `${spec.name} must be placed at sea.`;
  if (spec.domain === 'ground' && sea) return `${spec.name} must be placed on land.`;
  return null;
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
  const path = trackPath(tr, target);
  const assetOf = (d: Deployment) => s.assets.find((a) => a.id === d.assetId);
  const terrain = t.terrain?.[w.region];
  const working = deps.filter((d) => { const a = assetOf(d); return !!a && availability(s, a) > 0; });

  // Airborne early warning sees low threats beyond the horizon and over terrain, and cues surface systems.
  const cued = isLowFlying(tr.cls) && working.some((d) => {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return spec.domain === 'air' && reachPath(terrain, d, spec, tr.cls, path, detectionRange(spec, tr.cls), true) > 0;
  });
  const seen = cued || working.some((d) => {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return reachPath(terrain, d, spec, tr.cls, path, detectionRange(spec, tr.cls), false) > 0;
  });
  const alert = alertActive(s, w.region);
  const A = TACTICAL_CONFIG.alert;
  const unseen = alert ? Math.max(TACTICAL_CONFIG.unseenDetection, A.minDetectionUnseen) : TACTICAL_CONFIG.unseenDetection;
  const detection = Math.min(1, (seen ? 1 : unseen) * (0.7 + 0.3 * (region.awareness / 100)) * (alert ? 1 + A.detectionBonus : 1));
  const commsF = 0.6 + 0.4 * (region.comms / 100);
  const speed = TACTICAL_CONFIG.threatSpeedKmS[tr.cls];

  // Outer layers engage first.
  const shooters = deps
    .map((d) => ({ d, spec: EQUIPMENT_MAP.get(d.equipmentId)!, asset: assetOf(d) }))
    .filter((x) => x.asset && isEffector(x.spec) && canEngageClass(x.spec, tr.cls))
    .map((x) => ({ ...x, chord: reachPath(terrain, x.d, x.spec, tr.cls, path, x.spec.rangeKm, cued) }))
    .filter((x) => x.chord > 0)
    .sort((a, b) => b.spec.rangeKm - a.spec.rangeKm);

  let stopped = false;
  for (const { d, spec, asset, chord } of shooters) {
    if (stopped) break;
    const avail = Math.min(1, availability(s, asset!));
    if (avail <= 0) continue;
    const reaction = spec.reactionSec * (seen ? 1 : 2) * (alert ? A.reactionMult : 1);
    const window = chord / speed - reaction;
    if (window <= 0) continue;
    const shots = Math.min(TACTICAL_CONFIG.maxShotsPerSystem, 1 + Math.floor(window / Math.max(reaction, 30)));
    for (let i = 0; i < shots && !stopped; i++) {
      if (!isUnlimited(spec)) {
        if (d.stock <= 0) break;
        d.stock -= 1;
        tr.cost = (tr.cost ?? 0) + roundCost(spec);
      }
      tr.shots += 1;
      t.stats.shots += 1;
      if (rand(t) < spec.killRate[tr.cls] * avail * detection * commsF) {
        stopped = true;
        tr.stoppedBy = d.id;
        // Where along the path it dies: inside the stopper's reach, later for each extra shot it took.
        const span = reachSpanPath(terrain, d, spec, tr.cls, path, spec.rangeKm, cued);
        if (span) tr.stopAt = Math.min(0.97, span[0] + (span[1] - span[0]) * (0.25 + 0.3 * i));
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
}

/** At impact: threats that got through damage their site and the region. */
function applyImpacts(s: SimState, t: TacticalState, w: ThreatWave) {
  const region = s.regions[w.region];
  for (const tr of w.tracks) {
    if (tr.decoy || tr.outcome !== 'leaked') continue;
    const site = t.sites.find((x) => x.id === tr.siteId);
    if (!site) continue;
    const damage = Math.min(site.integrity, TACTICAL_CONFIG.threatDamage[tr.cls]);
    tr.damage = damage;
    site.integrity -= damage;
    t.stats.siteDamage += damage;
    const weight = damage * (site.importance / 3);
    region.infrastructure = clamp(region.infrastructure - weight * TACTICAL_CONFIG.infraPerDamage);
    region.stability = clamp(region.stability - weight * TACTICAL_CONFIG.stabilityPerDamage);
  }
  w.applied = true;
  const real = w.tracks.filter((x) => !x.decoy);
  if (!real.length) return;
  const leaked = real.filter((x) => x.outcome === 'leaked').length;
  const where = `${region.name}, from the ${w.axis}`;
  if (leaked === 0) tlog(s, 'success', `Threat wave ${w.id} (${real.length} threats) defeated in ${where}.`, w.region);
  else tlog(s, leaked * 3 >= real.length ? 'crit' : 'warn', `Threat wave ${w.id} in ${where}: ${real.length - leaked}/${real.length} stopped, ${leaked} got through.`, w.region);
}

function resolveWave(s: SimState, t: TacticalState, w: ThreatWave) {
  const region = s.regions[w.region];
  const phase = s.phases[s.phaseIndex];
  // Poor awareness means more false tracks that draw fire.
  const decoyScale = normalizeTactical(s.settings.tactical).decoys * levelOf(s.settings).decoyMult;
  const decoys = Math.round(w.tracks.length * phase.falseRate * (1.4 - region.awareness / 100) * 0.6 * decoyScale);
  for (let i = 0; i < decoys; i++) {
    const tr = makeTrack(t, w.region, rand(t) < 0.7 ? 'slowDrone' : 'fastDrone', w.axis, true);
    if (tr) w.tracks.push(tr);
  }
  const deps = t.deployments.filter((d) => d.region === w.region);
  for (const tr of w.tracks) {
    tr.launchAt = w.atHour - TACTICAL_CONFIG.flightHours[tr.cls];
    resolveTrack(s, t, w, tr, deps);
  }
  w.resolved = true;
  w.applied = false;
  const real = w.tracks.filter((x) => !x.decoy).length;
  if (real) tlog(s, 'crit', `LAUNCH: threat wave ${w.id} (${real} threats) inbound to ${region.name} from the ${w.axis}, impact T+${w.atHour}h.`, w.region);
}

export interface DefensePreview {
  waves: number; // forecast waves still to come in the region this phase
  threats: number; // genuine threats in them
  stopRate: number; // expected share of genuine threats stopped (0-1)
  prevented: number; // expected share of their damage prevented, weighted by site importance (0-1)
  mix: Partial<Record<ThreatClass, number>>; // threats by class
}

/**
 * What-if for a briefing: plays the region's forecast waves against the current layout many times with fresh
 * random numbers (never the game's own stream) and averages the result. Uses the real engagement rules, so moving
 * or adding a system changes the estimate exactly as it would change the fight. Surprise waves are not included.
 */
export function previewDefense(s: SimState, region: RegionId, runs = 24): DefensePreview | null {
  const t = s.tactical;
  if (!t?.enabled) return null;
  const waves = t.waves.filter((w) => w.region === region && w.phaseIndex === s.phaseIndex && !w.resolved && w.forecast);
  if (!waves.length) return null;
  const sites = new Map(t.sites.map((x) => [x.id, x]));
  const mix: Partial<Record<ThreatClass, number>> = {};
  for (const w of waves) for (const tr of w.tracks) if (!tr.decoy) mix[tr.cls] = (mix[tr.cls] ?? 0) + 1;
  let stopped = 0;
  let total = 0;
  let saved = 0;
  let potential = 0;
  for (let k = 0; k < runs; k++) {
    const t2: TacticalState = {
      ...t,
      rng: (0x9e3779b9 + k * 2654435761 + s.hour * 97) >>> 0,
      deployments: t.deployments.map((d) => ({ ...d })),
      waves: waves.map((w) => ({ ...w, tracks: w.tracks.map((tr) => ({ ...tr, shots: 0, outcome: undefined, stoppedBy: undefined, stopAt: undefined })) })),
      stats: emptyStats(),
    };
    const s2 = { ...s, tactical: t2, log: [] } as SimState;
    for (const w of t2.waves) {
      resolveWave(s2, t2, w);
      for (const tr of w.tracks) {
        if (tr.decoy) continue;
        const v = TACTICAL_CONFIG.threatDamage[tr.cls] * (sites.get(tr.siteId)?.importance ?? 1);
        total++;
        potential += v;
        if (tr.outcome === 'stopped') { stopped++; saved += v; }
      }
    }
  }
  return {
    waves: waves.length, threats: Math.round(total / runs), stopRate: total ? stopped / total : 0,
    prevented: potential ? saved / potential : 0, mix,
  };
}

/** Is a raised alert in force in this region now? */
export function alertActive(s: SimState, region: RegionId): boolean {
  return !!s.tactical?.alerts?.some((a) => a.region === region && a.until > s.hour);
}

/** Hours left on a region's alert (0 if none). */
export function alertHoursLeft(s: SimState, region: RegionId): number {
  const a = s.tactical?.alerts?.find((x) => x.region === region && x.until > s.hour);
  return a ? a.until - s.hour : 0;
}

export function alertCost(s: SimState, region: RegionId): number {
  const n = s.tactical?.deployments.filter((d) => d.region === region).length ?? 0;
  return TACTICAL_CONFIG.alert.baseCost + TACTICAL_CONFIG.alert.perDeploymentCost * n;
}

/** Hours an emergency redeploy takes. */
export function redeployHours(spec: EquipmentSpec, from: RegionId, to: RegionId): number {
  const r = TACTICAL_CONFIG.emergencyRedeploy;
  return from === to ? r.sameRegionHours : r.otherRegionHours[spec.domain];
}

export function redeployCost(from: RegionId, to: RegionId): number {
  const r = TACTICAL_CONFIG.emergencyRedeploy;
  return r.cost + (from === to ? 0 : r.otherRegionCost);
}

/** Hourly tactical update: transits, alerts, resupply timers, then any waves arriving this hour. */
export function tickTactical(s: SimState) {
  const t = s.tactical;
  if (!t?.enabled) return;
  for (const d of t.deployments) {
    if (!d.transit) continue;
    d.transit.remaining -= 1;
    if (d.transit.remaining > 0) continue;
    const { region, x, y } = d.transit;
    d.region = region;
    d.x = x;
    d.y = y;
    d.transit = undefined;
    const a = s.assets.find((z) => z.id === d.assetId);
    if (a) {
      a.region = region;
      a.coverage = [region];
      a.pos = theaterToLonLat(s, region, x, y);
      a.status = 'operational';
      a.maintenanceRemaining = 0;
      tlog(s, 'info', `${a.name} is in position in ${s.regions[region].name}.`, region);
    }
  }
  if (t.alerts?.length) {
    for (const al of t.alerts) {
      if (al.until <= s.hour) continue;
      for (const d of t.deployments) {
        if (d.region !== al.region) continue;
        const a = s.assets.find((z) => z.id === d.assetId);
        if (a && a.status !== 'transit' && a.status !== 'maintenance') a.condition = clamp(a.condition - TACTICAL_CONFIG.alert.wearPerHour);
      }
    }
    t.alerts = t.alerts.filter((al) => al.until > s.hour);
  }
  for (const d of t.deployments) {
    if (d.reloadRemaining === undefined) continue;
    d.reloadRemaining -= 1;
    if (d.reloadRemaining <= 0) {
      d.reloadRemaining = undefined;
      d.stock = EQUIPMENT_MAP.get(d.equipmentId)!.magazine;
    }
  }
  for (const w of t.waves) {
    // Launch: outcome decided with the defenses as they stand. Impact: damage lands.
    if (!w.resolved && (w.launchAt ?? w.atHour) <= s.hour) resolveWave(s, t, w);
    if (w.resolved && w.applied === false && w.atHour <= s.hour) applyImpacts(s, t, w);
  }
}

/** Hours from launch to impact for a wave: its slowest threat's flight time, in whole hours (ticks are hourly). */
export function waveLeadHours(tracks: { cls: ThreatClass }[]): number {
  return Math.ceil(Math.max(0, ...tracks.map((x) => TACTICAL_CONFIG.flightHours[x.cls])));
}

// ── Read-only helpers for the UI ─────────────────────────────────────────

/** Credits to refill a deployment's magazine: a share of its cost, in proportion to the rounds missing. */
/** Credits one interceptor round costs to replace (the resupply price per round). Unlimited systems: 0. */
export function roundCost(spec: EquipmentSpec): number {
  if (isUnlimited(spec) || spec.magazine <= 0) return 0;
  return (equipmentCost(spec) * TACTICAL_CONFIG.resupplyRate) / spec.magazine;
}

export function resupplyCost(d: Deployment): number {
  const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
  if (isUnlimited(spec) || spec.magazine <= 0) return 0;
  return Math.ceil(equipmentCost(spec) * TACTICAL_CONFIG.resupplyRate * (1 - d.stock / spec.magazine));
}

export type ProtectionLevel = 'protected' | 'thin' | 'exposed';

/** Can this deployment engage right now (available, with rounds left)? */
export function canEngage(s: SimState, d: Deployment): boolean {
  const spec = EQUIPMENT_MAP.get(d.equipmentId);
  const asset = s.assets.find((a) => a.id === d.assetId);
  if (!spec || !asset || !isEffector(spec)) return false;
  return availability(s, asset) > 0 && (isUnlimited(spec) || d.stock > 0);
}

/** Share of a region's remaining site value within range of at least one system able to engage. */
export function regionProtection(s: SimState, region: RegionId): { coverage: number; level: ProtectionLevel } {
  const t = s.tactical;
  const sites = t?.sites.filter((x) => x.region === region && x.integrity > 0) ?? [];
  const total = sites.reduce((a, x) => a + x.importance, 0);
  if (!t || !total) return { coverage: 0, level: 'exposed' };
  const covered = sites
    .filter((x) => Object.values(coverageAt(s, region, x.x, x.y)).some((k) => k > 0))
    .reduce((a, x) => a + x.importance, 0);
  const coverage = covered / total;
  const { protected: p, thin } = TACTICAL_CONFIG.protection;
  return { coverage, level: coverage >= p ? 'protected' : coverage >= thin ? 'thin' : 'exposed' };
}

/** Hours of warning before a wave reaches a region; better awareness gives earlier warning. */
export function warningHours(s: SimState, region: RegionId): number {
  const { base, atFullAwareness } = TACTICAL_CONFIG.warningHours;
  return Math.round(base + atFullAwareness * (s.regions[region].awareness / 100));
}

/** Unresolved waves of the current phase that are inside their region's warning window. */
export function incomingWaves(s: SimState): { wave: ThreatWave; eta: number; launched: boolean; launchIn: number }[] {
  const t = s.tactical;
  if (!t?.enabled || s.status !== 'running') return [];
  return t.waves
    .filter((w) => w.applied !== true && !(w.resolved && w.applied === undefined) && w.phaseIndex === s.phaseIndex
      && (w.launchAt ?? w.atHour) - s.hour <= warningHours(s, w.region))
    .map((wave) => ({ wave, eta: wave.atHour - s.hour, launched: wave.resolved, launchIn: (wave.launchAt ?? wave.atHour) - s.hour }))
    .sort((a, b) => a.eta - b.eta);
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
    if (d.transit && (!REGION_IDS.includes(d.transit.region) || !insideTheater(d.transit.x, d.transit.y))) return 'state.tactical deployment transit is invalid';
  }
  return null;
}
