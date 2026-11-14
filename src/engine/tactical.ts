// Tactical layer: theaters, sites, threat waves and their resolution. Campaign mode only.
//
// The tactical layer draws from its own RNG stream (`tactical.rng`), so adding it does not change how the
// management simulation plays out for a given seed.
import { SIM_CONFIG, STOCKPILES, STORIES, TACTICAL_CONFIG, enemyStyleOf, levelOf } from './config';
import { EQUIPMENT, EQUIPMENT_MAP, RADAR_BAND_IDS, channelsOf, equipmentCost, isEffector, loadoutOf, sensorTraits, type EquipmentSpec, type RadarBand } from './equipment';
import { availability } from './metrics';
import { clamp, rand } from './rng';
import { normalizeTactical } from './scenarios';
import { LESSON_MAP, type ScriptedWave } from './training';
import { WEATHER, conditionsAt, hash01, nearestNightHour } from './weather';
import { ADAPTATION, enemyPlan } from './adaptation';
import { siteDamageShare } from './sites';
import { TERRAIN_PROFILES, generateTerrain, isSea, lowHorizonKm, masked, randomCoastal, randomLand } from './terrain';
import type {
  Deployment, FireDoctrine, LogLevel, RegionId, SimState, Site, SiteType, TacticalState, TacticalStats, TheaterTerrain, ThreatAxis, ThreatClass,
  ThreatWave, Track,
} from './types';
import { REGION_IDS } from './types';

type Rng = { rng: number };

const AXES: ThreatAxis[] = ['north', 'south', 'east', 'west'];
const CLASSES: ThreatClass[] = ['slowDrone', 'fastDrone', 'cruise', 'rocket', 'ballistic', 'hypersonic'];

const emptyStats = (): TacticalStats => ({ tracks: 0, stopped: 0, leaked: 0, decoysEngaged: 0, shots: 0, siteDamage: 0 });

/** Training lesson with scripted threat waves, if this is one. The only training scenarios with a tactical layer. */
const tacticalLesson = (s: SimState) => (s.settings.mode === 'training' && s.settings.lesson ? LESSON_MAP.get(s.settings.lesson) : undefined);
const tacticalAllowed = (s: SimState) =>
  (s.settings.mode === 'campaign' && TACTICAL_CONFIG.enabledInCampaign) || !!tacticalLesson(s)?.waves?.length || !!tacticalLesson(s)?.makeWaves
  || ((s.settings.mode === 'sandbox' || s.settings.mode === 'crisis') && s.settings.waves === true);

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
    // Worked out from the seed alone, so the game's random stream (and every existing scenario) is unchanged.
    t.terrain![region].valleys = makeValleys(s.settings.seed, region, t.terrain![region]);
    t.terrain![region].cities = t.sites.filter((x) => x.region === region && x.type === 'city').map((x) => [x.x, x.y]);
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

/** One or two valleys per theater, each running in from a landward edge. */
function makeValleys(seed: number, region: RegionId, terrain: TheaterTerrain): NonNullable<TheaterTerrain['valleys']> {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const V = TACTICAL_CONFIG.valley;
  const k = REGION_IDS.indexOf(region);
  const sides = AXES.filter((a) => a !== terrain.coast);
  const n = hash01(seed, k, 0x71) < 0.45 ? 2 : 1;
  const out: NonNullable<TheaterTerrain['valleys']> = [];
  for (let i = 0; i < n; i++) {
    const side = sides[Math.floor(hash01(seed, k, i, 0x72) * sides.length)];
    if (out.some((v) => v.side === side)) continue;
    const along = 0.25 + hash01(seed, k, i, 0x73) * 0.5;
    const len = V.lengthKm[0] + hash01(seed, k, i, 0x74) * (V.lengthKm[1] - V.lengthKm[0]);
    const bend = (hash01(seed, k, i, 0x75) - 0.5) * 120;
    const a: [number, number] = side === 'north' ? [along * width, 0] : side === 'south' ? [along * width, height] : side === 'west' ? [0, along * height] : [width, along * height];
    const b: [number, number] = side === 'north' ? [a[0] + bend, len] : side === 'south' ? [a[0] + bend, height - len] : side === 'west' ? [len, a[1] + bend] : [width - len, a[1] + bend];
    const clampXY = (p: [number, number]): [number, number] => [Math.round(Math.max(20, Math.min(width - 20, p[0]))), Math.round(Math.max(20, Math.min(height - 20, p[1])))];
    out.push({ a: [Math.round(a[0]), Math.round(a[1])], b: clampXY(b), w: V.widthKm, side });
  }
  return out;
}

/** Distance (km) from a point to the segment a→b. */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** The valley a path leg runs along, if any. */
function valleyOf(terrain: TheaterTerrain | undefined, a: [number, number], b: [number, number]) {
  return terrain?.valleys?.find((v) => Math.hypot(v.a[0] - a[0], v.a[1] - a[1]) < 3 && Math.hypot(v.b[0] - b[0], v.b[1] - b[1]) < 3);
}

/** A weapon's reach from where it stands: line-of-fire weapons among a city's buildings lose part of it. */
export function engageRange(terrain: TheaterTerrain | undefined, d: Pick<Deployment, 'x' | 'y'>, spec: EquipmentSpec): number {
  const U = TACTICAL_CONFIG.urban;
  const built = U.ids.includes(spec.id) && !!terrain?.cities?.some((c) => Math.hypot(c[0] - d.x, c[1] - d.y) <= U.km);
  return spec.rangeKm * (built ? U.reach : 1);
}

/** Is this spot among a city's buildings (for line-of-fire weapons)? */
export const inCity = (terrain: TheaterTerrain | undefined, spec: EquipmentSpec, x: number, y: number) =>
  TACTICAL_CONFIG.urban.ids.includes(spec.id) && !!terrain?.cities?.some((c) => Math.hypot(c[0] - x, c[1] - y) <= TACTICAL_CONFIG.urban.km);

/** A deployment's chance to stop a class with its chosen interceptor load. */
export function killRateOf(d: Pick<Deployment, 'loadout'>, spec: EquipmentSpec, cls: ThreatClass): number {
  return Math.min(0.97, spec.killRate[cls] * (loadoutOf(spec, d.loadout)?.kill[cls] ?? 1));
}

/** Credits one round costs for this deployment: its load, and the defense industry's discount. */
export function roundCostOf(s: Pick<SimState, 'industry'> | undefined, d: Pick<Deployment, 'loadout'>, spec: EquipmentSpec): number {
  return roundCost(spec) * (loadoutOf(spec, d.loadout)?.price ?? 1) * (1 - TACTICAL_CONFIG.industry.price * Math.min(TACTICAL_CONFIG.industry.max, s?.industry ?? 0));
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

/** A point on a theater edge, a share of the way along it. */
function edgePointAt(axis: ThreatAxis, along: number): [number, number] {
  const { width, height } = TACTICAL_CONFIG.theaterKm;
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
 * The regions that can be reinforced before the current phase: the forecast regions and the worst-damaged other
 * region. One is chosen per phase; the choices made trace the player's path through the campaign.
 */
export function reinforceOptions(s: SimState): RegionId[] {
  const t = s.tactical;
  if (!t?.enabled || s.settings.mode !== 'campaign' || s.phaseIndex === 0) return [];
  const others = REGION_IDS.filter((r) => !t.forecast.includes(r)).sort((a, b) => siteDamageShare(s, b) - siteDamageShare(s, a) || s.regions[a].stability - s.regions[b].stability);
  return [...t.forecast, ...others.slice(0, 1)];
}

/** How the war is going for the enemy, and what it does about it. */
export interface Escalation { level: 'heavy' | 'steady' | 'light'; rate: number | null; mix: Partial<Record<ThreatClass, number>>; text: string }

/**
 * The escalation ladder (campaign): judged on everything sent in earlier phases. A defense that has held provokes
 * heavier weapons; one that is failing does not need them.
 */
export function escalationOf(s: SimState): Escalation {
  const E = TACTICAL_CONFIG.escalation;
  const steady: Escalation = { level: 'steady', rate: null, mix: {}, text: '' };
  if (s.settings.mode !== 'campaign' || !s.tactical || s.phaseIndex === 0) return steady;
  const real = s.tactical.waves.filter((w) => w.resolved && w.phaseIndex < s.phaseIndex).flatMap((w) => w.tracks.filter((x) => !x.decoy));
  if (real.length < E.minThreats) return steady;
  const rate = real.filter((x) => x.outcome === 'stopped').length / real.length;
  const pct = Math.round(rate * 100);
  if (rate >= E.high) return { level: 'heavy', rate, mix: E.heavy, text: `Your defense has stopped ${pct}% of what was sent, so the enemy is escalating: expect more ballistic and cruise missiles, and gliders where it has them.` };
  if (rate <= E.low) return { level: 'light', rate, mix: E.light, text: `Only ${pct}% of what was sent has been stopped, so the enemy sees no need for its heavier weapons: expect more drones.` };
  return { ...steady, rate, text: `About ${pct}% of what was sent has been stopped. The enemy is holding its mix of weapons steady.` };
}

/**
 * Schedule the current phase's threat waves and set the briefing forecast. Called when a briefing opens, so the
 * player sees the forecast before deploying. `fromHour` lets a mid-phase upgrade schedule only what is left.
 */
export function scheduleWaves(s: SimState, fromHour?: number) {
  const t = s.tactical;
  if (!t?.enabled) return;
  const phase = s.phases[s.phaseIndex];
  // Sandbox and crisis have one long phase: use the mid-campaign profile, with waves spread over its length.
  const single = s.settings.mode === 'sandbox' || s.settings.mode === 'crisis';
  const base = single && phase
    ? { ...TACTICAL_CONFIG.waves[1], count: Math.max(1, Math.round(TACTICAL_CONFIG.waves[1].count * phase.hours / 72)) }
    : TACTICAL_CONFIG.waves[s.phaseIndex];
  t.waves = t.waves.filter((w) => w.phaseIndex !== s.phaseIndex);
  t.forecast = [];
  const lesson = tacticalLesson(s);
  const lessonWaves = lesson?.makeWaves?.(s.settings.seed, s.phaseIndex, s.settings) ?? lesson?.waves;
  if (lessonWaves) return scheduleLessonWaves(s, t, lessonWaves);
  if (!base || !phase) return;
  // Apply the scenario's multipliers. The standard scenario (all 1s) reproduces the base profile exactly.
  const sc = normalizeTactical(s.settings.tactical);
  const lv = levelOf(s.settings);
  if (lv.waveSize !== 1) sc.waveSize *= lv.waveSize;
  if (lv.surpriseMult !== 1) sc.surpriseRate = Math.min(0.9, sc.surpriseRate * lv.surpriseMult);
  // Commander: the enemy adapts to what it saw in earlier phases.
  const plan = enemyPlan(s);
  // The enemy commander's style: the Planner changes nothing.
  const style = enemyStyleOf(s.settings);
  const esc = escalationOf(s);
  if (style.surprise !== 1) sc.surpriseRate = Math.min(0.9, sc.surpriseRate * style.surprise);
  const scaledMix = Object.fromEntries(CLASSES.map((c) => [c, base.mix[c] * sc.mix[c] * (plan?.mix[c] ?? 1) * (style.mix[c] ?? 1) * (esc.mix[c] ?? 1)])) as Record<ThreatClass, number>;
  const profile = {
    count: Math.max(1, Math.round(base.count * sc.waveCount * style.waveCount)),
    tracks: [Math.max(1, Math.round(base.tracks[0] * sc.waveSize * style.waveSize)), Math.max(1, Math.round(base.tracks[1] * sc.waveSize * style.waveSize))] as const,
    mix: CLASSES.some((c) => scaledMix[c] > 0) ? scaledMix : base.mix, // never leave a phase with no possible threat
  };

  // A written campaign is fought where its story is set.
  const storyRegions = s.settings.story ? STORIES[s.settings.story]?.regions : undefined;
  // Forecast: regions under the most strain are the likeliest targets.
  const pool = [...REGION_IDS];
  for (let i = 0; i < sc.forecastRegions && pool.length; i++) {
    // Strained and badly damaged regions are likelier targets: attackers press where defenses already failed.
    const id = weighted(t, pool.map((r) => ({ item: r, w: Math.max(5, 20 + (100 - s.regions[r].stability) + TACTICAL_CONFIG.consequences.targeting * siteDamageShare(s, r) + (plan?.target[r] ?? 0) + (storyRegions?.includes(r) ? 150 : 0)) })));
    t.forecast.push(id);
    pool.splice(pool.indexOf(id), 1);
  }

  const start = s.status === 'running' ? s.phaseStartHour : s.hour; // in a briefing, the phase starts at s.hour
  // The campaign's opening wave comes after a settling-in period, so the first hours are for reading the situation.
  const opening = s.settings.mode === 'campaign' && s.phaseIndex === 0;
  const first = Math.max((fromHour ?? 0) + 3, start + (opening ? 12 : 6)); // leaves room for the longest flight before impact
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
  const addWave = (region: RegionId, surprise: boolean, atHour: number, maxTracks = Infinity) => {
    let axis = AXES[Math.floor(rand(t) * AXES.length)];
    const preferred = plan?.axis[region];
    if (preferred && hash01(s.settings.seed, s.phaseIndex, atHour, 0x41) < ADAPTATION.axisPreference) axis = preferred;
    const n = Math.min(maxTracks, profile.tracks[0] + Math.floor(rand(t) * (profile.tracks[1] - profile.tracks[0] + 1)));
    const tracks: Track[] = [];
    for (let i = 0; i < n; i++) {
      const cls = weighted(t, CLASSES.map((c) => ({ item: c, w: profile.mix[c] })));
      const tr = makeTrack(t, region, cls, axis, false);
      if (!tr) continue;
      const turnChance = Math.min(0.9, (TACTICAL_CONFIG.turning.chanceByPhase[s.phaseIndex] ?? 0) * style.turn);
      if (turnChance > 0 && TACTICAL_CONFIG.turning.classes.includes(cls) && rand(t) < turnChance) tr.via = turnPoint(t, tr);
      if (TACTICAL_CONFIG.alwaysTurn.includes(cls)) tr.via = turnPoint(t, tr);
      tracks.push(tr);
    }
    // Everything below is decided from the seed, never the random stream, so earlier scenarios play as before.
    const H = (i: number, salt: number) => hash01(s.settings.seed, s.phaseIndex, atHour, i, salt);
    // Two sides at once: part of the wave swings round to a second approach.
    let axis2: ThreatAxis | undefined;
    if (tracks.length >= 6 && H(0, 0x81) < (TACTICAL_CONFIG.raids.pincerByPhase[s.phaseIndex] ?? 0)) {
      axis2 = AXES.filter((a) => a !== axis)[Math.floor(H(0, 0x82) * 3)];
      tracks.forEach((tr, i) => {
        if (i % 2 === 0 || TACTICAL_CONFIG.alwaysTurn.includes(tr.cls)) return;
        tr.from = edgePointAt(axis2!, 0.1 + H(i, 0x83) * 0.8);
        if (tr.via) tr.via = undefined;
      });
    }
    // Valleys: low fliers coming from a valley's side follow it in.
    const terrain = t.terrain?.[region];
    tracks.forEach((tr, i) => {
      // Not in the opening phase (index 0), which stays simple.
      if (s.phaseIndex === 0 || !isLowFlying(tr.cls) || tr.via) return;
      const side = Math.abs(tr.from[1]) < 1 ? 'north' : Math.abs(tr.from[1] - TACTICAL_CONFIG.theaterKm.height) < 1 ? 'south' : Math.abs(tr.from[0]) < 1 ? 'west' : 'east';
      const v = terrain?.valleys?.find((x) => x.side === side);
      if (!v || H(i, 0x84) >= TACTICAL_CONFIG.valley.useChance) return;
      tr.from = [v.a[0], v.a[1]];
      tr.via = [v.b[0], v.b[1]];
      tr.valley = true;
    });
    const make = (trs: Track[], at: number, follow = false): ThreatWave => {
      const w: ThreatWave = {
        id: `WAVE-${t.nextId++}`, region, phaseIndex: s.phaseIndex, atHour: at, launchAt: at - waveLeadHours(trs), axis, forecast: !surprise, tracks: trs,
        resolved: false, ...(axis2 ? { axis2 } : {}), ...(follow ? { follow: true } : {}),
      };
      t.waves.push(w);
      return w;
    };
    // Timed raid: the drones go in first to draw fire, and the missiles arrive an hour behind them.
    const drones = tracks.filter((x) => DRONES.includes(x.cls));
    const heavy = tracks.filter((x) => !DRONES.includes(x.cls));
    if (drones.length >= 3 && heavy.length >= 2 && atHour + 1 <= last && H(0, 0x85) < (TACTICAL_CONFIG.raids.timedByPhase[s.phaseIndex] ?? 0)) {
      make(drones, atHour);
      return make(heavy, atHour + 1, true);
    }
    return make(tracks, atHour);
  };
  for (const [k, scheduled] of hours.entries()) {
    const { region, surprise } = targets[k];
    // Some raids are timed to arrive in the dark (decided from the seed, not the game's random stream).
    let atHour = scheduled;
    // Combat is decided at launch, which comes up to ~3h before arrival, so it is the launch that is moved into the
    // night: to the closest dark hour, earlier or later, so night raids don't pile up at the end of a phase.
    if (hash01(s.settings.seed, s.phaseIndex, k, 0x4e) < WEATHER.nightRaids) atHour = nearestNightHour(s, region, scheduled - 3, first - 3, last - 3) + 3;
    // Ramp up: the campaign's first wave is never bigger than the standard scenario's largest opening wave, whatever
    // the difficulty and scenario multipliers, so the danger builds instead of arriving all at once.
    addWave(region, surprise, atHour, opening && k === 0 ? Math.min(profile.tracks[0], base.tracks[1]) : Infinity);
  }
  // Commander: a region whose magazines ran low gets a second wave soon after its first, before reloads finish.
  if (plan?.doubleTap && fromHour === undefined) {
    const firstThere = t.waves.filter((w) => w.phaseIndex === s.phaseIndex && w.region === plan.doubleTap).sort((a, b) => a.atHour - b.atHour)[0];
    const at = firstThere ? firstThere.atHour + 3 : Math.round((first + last) / 2);
    if (at <= last) addWave(plan.doubleTap, !t.forecast.includes(plan.doubleTap), at);
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
    // A player-written raid can aim a whole wave at one site, split it between two sides and choose its route.
    const aimed = sw.target ? t.sites.find((x) => x.id === sw.target && x.region === sw.region && x.integrity > 0) : undefined;
    const terrain = t.terrain?.[sw.region];
    for (const cls of CLASSES) {
      for (let i = 0; i < (sw.tracks[cls] ?? 0); i++) {
        const tr = makeTrack(t, sw.region, cls, sw.axis, false);
        if (!tr) continue;
        if (aimed) tr.siteId = aimed.id;
        const side = sw.axis2 && tracks.length % 2 === 1 ? sw.axis2 : sw.axis;
        if (side !== sw.axis) tr.from = edgePoint(t, side);
        if (TACTICAL_CONFIG.alwaysTurn.includes(cls)) tr.via = turnPoint(t, tr);
        else if (sw.route === 'turn' && TACTICAL_CONFIG.turning.classes.includes(cls)) tr.via = turnPoint(t, tr);
        else if (sw.route === 'valley' && isLowFlying(cls)) {
          const v = terrain?.valleys?.find((x) => x.side === side);
          if (v) { tr.from = [v.a[0], v.a[1]]; tr.via = [v.b[0], v.b[1]]; tr.valley = true; }
        }
        tracks.push(tr);
      }
    }
    const atHour = start + sw.atHour;
    t.waves.push({
      id: `WAVE-${t.nextId++}`, region: sw.region, phaseIndex: s.phaseIndex, atHour, launchAt: atHour - waveLeadHours(tracks), axis: sw.axis,
      forecast: sw.forecast, tracks, resolved: false,
      ...(sw.axis2 ? { axis2: sw.axis2 } : {}), ...(sw.decoys !== undefined ? { decoys: sw.decoys } : {}), ...(sw.hunt !== undefined ? { hunt: sw.hunt } : {}),
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
  const limited = low && !isPassive(spec) ? Math.min(range, lowHorizonKm(terrain, [d.x, d.y]) * (cued ? TACTICAL_CONFIG.lowAltitude.cuedHorizonMult : 1)) : range;
  // A low flier in a valley is hidden from ground systems that are not in or beside the valley.
  if (low && !cued) {
    const v = valleyOf(terrain, a, b);
    if (v && segDist([d.x, d.y], a, b) > v.w) return null;
  }
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
  const out = { slowDrone: 0, fastDrone: 0, cruise: 0, rocket: 0, ballistic: 0, hypersonic: 0 };
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
        if (reach(terrain, d, spec, cls, from, target, engageRange(terrain, d, spec), cued) > 0) out[cls] = Math.max(out[cls], killRateOf(d, spec, cls));
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
  if (spec.lure) return 0; // a decoy emitter sees nothing
  if (spec.layer === 'detection') return spec.rangeKm;
  return spec.radar?.rangeKm ?? 0;
}

/** Enemy jamming of one radar band (Commander): the share of range and of decoy recognition a jammed radar keeps. */
export const JAMMING = { range: 0.5, sharp: 0.5 };

/** The radar band the enemy is jamming in the current phase, if any. */
export const jammedBand = (s: SimState): RadarBand | undefined => jamIn(s, s.phaseIndex);
/** The band jammed in a phase: the adapting enemy's choice (Commander), or the one a raid's author paid for. */
export const jamIn = (s: SimState, phaseIndex: number): RadarBand | undefined =>
  (s.tactical?.enemy?.find((p) => p.phaseIndex === phaseIndex)?.jam ?? s.settings.raid?.jam) as RadarBand | undefined;

/** The fire orders a system can be given, with what each means in a sentence. */
export const DOCTRINES: Record<FireDoctrine, { label: string; short: string; text: string }> = {
  free: { label: 'Engage everything', short: 'all', text: 'Fires at any threat it can reach. The default.' },
  missiles: { label: 'Missiles only', short: 'missiles', text: 'Holds fire against drones, and so against decoys. Saves costly rounds for cruise missiles, rockets and ballistic missiles; drones in its area are left to other systems.' },
  backup: { label: 'Backup', short: 'backup', text: 'Fires only after every other system in reach has had its shots. Lets cheap guns go first and keeps this system for what they miss.' },
};
const DRONES: ThreatClass[] = ['slowDrone', 'fastDrone'];

export const isUnlimited = (spec: EquipmentSpec) => spec.magazine >= TACTICAL_CONFIG.unlimitedMagazine;

/** The shortest-wave (sharpest) radar band among some systems, or null if none of them has a radar. */
export function sharpestBand(specs: EquipmentSpec[]): RadarBand | null {
  let best = -1;
  for (const sp of specs) if (sp.radar) best = Math.max(best, RADAR_BAND_IDS.indexOf(sp.radar.band));
  return best < 0 ? null : RADAR_BAND_IDS[best];
}

// ── Resolution ───────────────────────────────────────────────────────────

function tlog(s: SimState, level: LogLevel, text: string, region?: RegionId) {
  s.log.push({ t: s.hour, level, text, region });
  if (s.log.length > 800) s.log.splice(0, s.log.length - 800);
}

/** Where a track is headed: the site it is aimed at, or the spot where the system it is hunting stood. */
export function trackTarget(t: Pick<TacticalState, 'sites'>, tr: Pick<Track, 'siteId' | 'aim'>): [number, number] | null {
  if (tr.aim) return tr.aim;
  const site = t.sites.find((x) => x.id === tr.siteId);
  return site ? [site.x, site.y] : null;
}

/** What a threat is worth to the protection score: its damage × the importance of what it is aimed at. */
export function trackValue(t: Pick<TacticalState, 'sites'>, tr: Track): number {
  const importance = tr.depTarget ? TACTICAL_CONFIG.strikes.value : t.sites.find((x) => x.id === tr.siteId)?.importance ?? 1;
  return TACTICAL_CONFIG.threatDamage[tr.cls] * importance;
}

/** A unit's standing from its service record (threats stopped), or null for a new unit. */
export function veteranOf(d: Pick<Deployment, 'kills'>) {
  return TACTICAL_CONFIG.veteran.find((v) => (d.kills ?? 0) >= v.kills) ?? null;
}

export const hasResearch = (s: SimState, id: string) => !!s.research?.includes(id);

/** Share of a wave's missiles that go for the defender's radars, for this scenario and phase. */
function strikeShare(s: SimState, w: ThreatWave): number {
  if (w.hunt !== undefined) return w.hunt;
  if (s.settings.mode !== 'campaign') return 0;
  const style = enemyStyleOf(s.settings);
  if (w.phaseIndex < style.strikeFrom) return 0;
  const base = TACTICAL_CONFIG.strikes.byPhase[w.phaseIndex] || TACTICAL_CONFIG.strikes.byPhase[1];
  return Math.min(0.5, base * style.strike * (s.settings.level === 'commander' ? 1.5 : s.settings.level === 'recruit' ? 0.5 : 1));
}

export function resolveTrack(s: SimState, t: TacticalState, w: ThreatWave, tr: Track, deps: Deployment[], load?: Map<string, number>) {
  const target = trackTarget(t, tr);
  if (!target) return;
  const region = s.regions[w.region];
  const path = trackPath(tr, target);
  const assetOf = (d: Deployment) => s.assets.find((a) => a.id === d.assetId);
  const terrain = t.terrain?.[w.region];
  const working = deps.filter((d) => { const a = assetOf(d); return !!a && availability(s, a) > 0; });

  // Airborne early warning sees low threats beyond the horizon and over terrain, and cues surface systems.
  // Weather and daylight when the wave launches (when its outcome is decided).
  const wx = conditionsAt(s, w.region, w.launchAt ?? w.atHour);
  // Every working sensor that tracks it: surface sensors within their horizon and line of sight, aircraft from above.
  // A storm shortens each sensor's range by its radar band (long waves barely notice, short waves lose most of it).
  // Commander: the enemy jams one radar band for the phase, shortening those radars' range and blurring their picture.
  const jam = t.enemy?.find((p) => p.phaseIndex === w.phaseIndex)?.jam ?? s.settings.raid?.jam;
  const jammed = (spec: EquipmentSpec) => !!jam && spec.radar?.band === jam && !hasResearch(s, 'r_ecm');
  const sharpOf = (spec: EquipmentSpec) => Math.min(0.97, (sensorTraits(spec).sharp + (spec.radar && hasResearch(s, 'r_discrim') ? TACTICAL_CONFIG.research.discrim : 0)) * (jammed(spec) ? JAMMING.sharp : 1));
  const watchers = working
    .map((d) => ({ d, spec: EQUIPMENT_MAP.get(d.equipmentId)! }))
    .filter(({ d }) => !d.emcon) // a silent radar sees nothing
    .filter(({ d, spec }) => reachPath(terrain, d, spec, tr.cls, path, detectionRange(spec, tr.cls) * (wx.storm ? sensorTraits(spec).storm : 1) * (jammed(spec) ? JAMMING.range : 1), false) > 0);
  const cued = isLowFlying(tr.cls) && watchers.some((x) => x.spec.domain === 'air');
  const seen = watchers.length > 0;
  const alert = alertActive(s, w.region);
  const A = TACTICAL_CONFIG.alert;
  const unseen = alert ? Math.max(TACTICAL_CONFIG.unseenDetection, A.minDetectionUnseen) : TACTICAL_CONFIG.unseenDetection;
  /**
   * How good a track a system shoots on: its own sensor's track is full quality; otherwise the best track another
   * sensor can hand it, which depends on that sensor's band; with no track at all, the unseen value.
   */
  const trackQuality = (d: Deployment) => {
    if (!seen) return unseen;
    if (watchers.some((x) => x.d === d)) return 1;
    if (hasResearch(s, 'r_network')) return 1; // networked fire control: any track is as good as its own
    return Math.max(unseen, ...watchers.map((x) => sensorTraits(x.spec).cue));
  };
  const awarenessF = (0.7 + 0.3 * (region.awareness / 100)) * (alert ? 1 + A.detectionBonus : 1);
  tr.detected = seen;
  if (seen) tr.band = sharpestBand(watchers.map((x) => x.spec)) ?? 'passive';
  // A sharp radar can tell a decoy from the real thing: recognised decoys are left alone and cost nothing.
  if (tr.decoy && seen && rand(t) < Math.max(...watchers.map((x) => sharpOf(x.spec)))) {
    tr.rejected = true;
    tr.outcome = 'decoyLeaked';
    tr.fired = [];
    t.stats.decoysSpotted = (t.stats.decoysSpotted ?? 0) + 1;
    return;
  }
  const commsF = 0.6 + 0.4 * (region.comms / 100);
  const speed = TACTICAL_CONFIG.threatSpeedKmS[tr.cls];

  // Outer layers engage first.
  const shooters = deps
    .map((d) => ({ d, spec: EQUIPMENT_MAP.get(d.equipmentId)!, asset: assetOf(d) }))
    .filter((x) => x.asset && isEffector(x.spec) && canEngageClass(x.spec, tr.cls))
    .map((x) => ({ ...x, chord: reachPath(terrain, x.d, x.spec, tr.cls, path, engageRange(terrain, x.d, x.spec), cued) }))
    .filter((x) => x.chord > 0)
    .filter((x) => !(x.d.doctrine === 'missiles' && DRONES.includes(tr.cls))) // standing orders: no shots at drones
    // Outer layers first, then systems held back as backup (longest reach first within each group).
    .sort((a, b) => Number(a.d.doctrine === 'backup') - Number(b.d.doctrine === 'backup') || b.spec.rangeKm - a.spec.rangeKm);

  // Diagnostics only (what happened and why): nothing below changes the outcome or draws random numbers.
  const fired: { dep: string; shots: number }[] = [];
  const why = new Map<string, string>();
  for (const d of deps) {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    if (!isEffector(spec)) continue;
    const a = assetOf(d);
    if (!a || availability(s, a) <= 0) why.set(d.id, 'oa');
    else if (spec.altitudeKm < TACTICAL_CONFIG.threatAltitudeKm[tr.cls]) why.set(d.id, 'alt');
    else if (spec.killRate[tr.cls] <= 0) why.set(d.id, 'type');
    else if (d.doctrine === 'missiles' && DRONES.includes(tr.cls)) why.set(d.id, 'hold');
    else if (!shooters.some((x) => x.d === d)) {
      const blind = isLowFlying(tr.cls) && !cued && reachPath(terrain, d, spec, tr.cls, path, engageRange(terrain, d, spec), true) > 0;
      why.set(d.id, blind ? 'blind' : 'range');
    }
  }

  let stopped = false;
  let missed = false; // an earlier layer fired at it and missed
  for (const { d, spec, asset, chord } of shooters) {
    if (stopped) { why.set(d.id, 'done'); continue; }
    // Saturation: a system can only handle so many threats in one wave.
    if (load && (load.get(d.id) ?? 0) >= channelsOf(spec) * TACTICAL_CONFIG.saturationPasses) { why.set(d.id, 'sat'); continue; }
    const avail = Math.min(1, availability(s, asset!));
    if (avail <= 0) { why.set(d.id, 'oa'); continue; }
    const vet = veteranOf(d);
    const reaction = spec.reactionSec * (seen ? 1 : 2) * (alert ? A.reactionMult : 1) * (vet?.reaction ?? 1);
    const window = chord / speed - reaction;
    if (window <= 0) { why.set(d.id, seen ? 'fast' : 'late'); continue; }
    const shots = Math.min(TACTICAL_CONFIG.maxShotsPerSystem, 1 + Math.floor(window / Math.max(reaction, 30)));
    let firedHere = 0;
    for (let i = 0; i < shots && !stopped; i++) {
      if (!isUnlimited(spec)) {
        if (d.stock <= 0) { if (!firedHere) why.set(d.id, 'mag'); break; }
        d.stock -= 1;
        tr.cost = (tr.cost ?? 0) + roundCostOf(s, d, spec);
      }
      firedHere++;
      tr.shots += 1;
      t.stats.shots += 1;
      const dark = wx.night && WEATHER.nightLimited.includes(spec.id) ? WEATHER.nightKill : 1;
      const quality = trackQuality(d);
      if (seen) tr.cueQ = Math.min(tr.cueQ ?? 1, quality);
      const need = Math.min(0.98, (killRateOf(d, spec, tr.cls) + (vet?.kill ?? 0)) * (missed ? 1 + TACTICAL_CONFIG.handoff : 1)) * avail * Math.min(1, quality * awarenessF) * commsF * dark;
      const roll = rand(t);
      if (t.recordRolls) (tr.rolls ??= []).push({ dep: d.id, need, roll, window: Math.round(window), reaction: Math.round(reaction), quality });
      if (roll < need) {
        stopped = true;
        tr.stoppedBy = d.id;
        if (missed) tr.handoff = true;
        if (!tr.decoy) d.kills = (d.kills ?? 0) + 1;
        // Where along the path it dies: inside the stopper's reach, later for each extra shot it took.
        const span = reachSpanPath(terrain, d, spec, tr.cls, path, engageRange(terrain, d, spec), cued);
        if (span) tr.stopAt = Math.min(0.97, span[0] + (span[1] - span[0]) * (0.25 + 0.3 * i));
      }
    }
    if (firedHere) {
      fired.push({ dep: d.id, shots: firedHere });
      load?.set(d.id, (load.get(d.id) ?? 0) + 1);
      if (!stopped) missed = true;
    }
  }
  tr.fired = fired;
  tr.why = [...why].filter(([dep]) => !fired.some((f) => f.dep === dep));

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
  // The sentence explaining a leak is built when shown (leakText), keeping saves small.
}

/** "A —", "A and B —", "A, B and C —": the systems a reason applies to. */
const listNames = (names: string[]) => `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]} —`;

const THREAT_WORDS: Record<ThreatClass, string> = { slowDrone: 'slow drone', fastDrone: 'fast drone', cruise: 'cruise missile', rocket: 'rocket', ballistic: 'ballistic missile', hypersonic: 'hypersonic glider' };

/** What each reason code means, for a threat class. */
export function reasonText(code: string, cls: ThreatClass): string {
  switch (code) {
    case 'oa': return 'out of action (maintenance, damage or moving)';
    case 'alt': return `cannot reach a ${THREAT_WORDS[cls]}’s altitude`;
    case 'type': return `cannot engage ${THREAT_WORDS[cls]}s`;
    case 'blind': return 'it flew below the radar horizon or behind terrain';
    case 'range': return 'out of range';
    case 'done': return 'not needed: already stopped';
    case 'fast': return 'too fast: inside its range too briefly to react';
    case 'late': return 'not detected in time to react';
    case 'mag': return 'magazine empty';
    case 'hold': return 'held fire: its orders are missiles only';
    case 'sat': return 'saturated: already engaging as many threats as it can handle';
    default: return code; // older saves stored the words themselves
  }
}

/** A track's "did not engage" list as { dep, reason } in words, from either save format. */
export function whyEntries(tr: Track): { dep: string; reason: string }[] {
  return (tr.why ?? []).map((w) => (Array.isArray(w) ? { dep: w[0], reason: reasonText(w[1], tr.cls) } : w));
}

/** One plain sentence on why a genuine threat got through (built on demand; older saves stored it). */
export function leakText(tr: Track, deps: Deployment[]): string {
  if (tr.leak) return tr.leak;
  const name = (id: string) => EQUIPMENT_MAP.get(deps.find((d) => d.id === id)?.equipmentId ?? '')?.name ?? 'a system since withdrawn';
  const shooters = deps.filter((d) => isEffector(EQUIPMENT_MAP.get(d.equipmentId)!));
  if (tr.fired?.length) {
    const shots = tr.fired.reduce((a, f) => a + f.shots, 0);
    return `Engaged by ${tr.fired.map((f) => name(f.dep)).join(', ')} (${shots} shot${shots === 1 ? '' : 's'}) but not stopped${!tr.detected ? '; it was not seen by a sensor, which lowers the chance'
      : (tr.cueQ ?? 1) < 0.9 ? `; the shot was guided by another sensor’s ${tr.band === 'passive' ? 'passive' : `${tr.band}-band`} track, which is coarser than the system’s own radar` : ''}.`;
  }
  const reasons = whyEntries(tr);
  if (!reasons.length) return shooters.length ? 'No system engaged it.' : 'Nothing deployed in the region could engage it.';
  const groups = new Map<string, string[]>();
  for (const r of reasons) groups.set(r.reason, [...(groups.get(r.reason) ?? []), name(r.dep)]);
  return `Nothing engaged it: ${[...groups].map(([reason, names]) => `${listNames([...new Set(names)])} ${reason}`).join('; ')}.`;
}

/** At impact: threats that got through damage their site and the region. */
function applyImpacts(s: SimState, t: TacticalState, w: ThreatWave) {
  const region = s.regions[w.region];
  for (const tr of w.tracks) {
    if (tr.decoy || tr.outcome !== 'leaked') continue;
    if (tr.depTarget) {
      // It was hunting one of the defender's systems: the system takes the hit, not a site.
      tr.damage = 0;
      const d = t.deployments.find((x) => x.id === tr.depTarget);
      const a = d && s.assets.find((x) => x.id === d.assetId);
      // A system that has since moved away from where it stood is missed.
      if (d && a && !d.transit && d.region === w.region && Math.hypot(d.x - tr.aim![0], d.y - tr.aim![1]) < 5) {
        a.condition = clamp(a.condition - TACTICAL_CONFIG.strikes.damage);
        t.stats.systemsHit = (t.stats.systemsHit ?? 0) + 1;
        tlog(s, 'crit', `${a.name} was hit by a ${THREAT_WORDS[tr.cls]} and is down to ${Math.round(a.condition)}% condition. Send it for maintenance.`, w.region);
      }
      continue;
    }
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
  else {
    // The most common reason, so the log says why, not just how many.
    const counts = new Map<string, number>();
    for (const tr of real) if (tr.outcome === 'leaked') { const why = leakText(tr, t.deployments); counts.set(why, (counts.get(why) ?? 0) + 1); }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    tlog(s, leaked * 3 >= real.length ? 'crit' : 'warn',
      `Threat wave ${w.id} in ${where}: ${real.length - leaked}/${real.length} stopped, ${leaked} got through.${top ? ` Mostly: ${top[0]}` : ''}`, w.region);
  }
}

function resolveWave(s: SimState, t: TacticalState, w: ThreatWave, live = false) {
  const region = s.regions[w.region];
  const phase = s.phases[s.phaseIndex];
  // Poor awareness means more false tracks that draw fire.
  const decoyScale = normalizeTactical(s.settings.tactical).decoys * levelOf(s.settings).decoyMult * enemyStyleOf(s.settings).decoys * (t.enemy?.find((p) => p.phaseIndex === w.phaseIndex)?.decoys ?? 1);
  const decoys = w.decoys ?? Math.round(w.tracks.length * phase.falseRate * (1.4 - region.awareness / 100) * TACTICAL_CONFIG.decoysPerTrack * decoyScale);
  for (let i = 0; i < decoys; i++) {
    const tr = makeTrack(t, w.region, rand(t) < 0.7 ? 'slowDrone' : 'fastDrone', w.axis, true);
    if (tr) w.tracks.push(tr);
  }
  const deps = t.deployments.filter((d) => d.region === w.region);
  // Some missiles home on the defender's radars instead of a site (their emissions give them away).
  const share = strikeShare(s, w);
  if (share > 0) {
    // Silent radars give nothing away; decoy emitters shine brightest of all.
    const emitters = deps.filter((d) => { const sp = EQUIPMENT_MAP.get(d.equipmentId)!; return ((!!sp.radar && !d.emcon) || !!sp.lure) && sp.domain !== 'air' && !d.transit; });
    for (const tr of w.tracks) {
      if (tr.decoy || tr.depTarget || !emitters.length || !TACTICAL_CONFIG.strikes.classes.includes(tr.cls) || rand(t) >= share) continue;
      // The farther a radar reaches, the brighter it shines.
      const d = weighted(t, emitters.map((x) => { const sp = EQUIPMENT_MAP.get(x.equipmentId)!; return { item: x, w: sp.lure ? 2500 : 20 + (sp.radar?.rangeKm ?? 0) }; }));
      tr.depTarget = d.id;
      tr.aim = [d.x, d.y];
      if (tr.via) tr.via = undefined; // it flies straight down the beam
    }
  }
  w.conditions = conditionsAt(s, w.region, w.launchAt ?? w.atHour);
  // Ships on patrol steam toward where the wave is headed before it arrives.
  const terrainHere = t.terrain?.[w.region];
  for (const d of deps) {
    const sp = EQUIPMENT_MAP.get(d.equipmentId)!;
    if (!d.patrol || sp.domain !== 'sea' || d.transit || !w.tracks.length) continue;
    const pts = w.tracks.map((tr) => trackTarget(t, tr)).filter((p): p is [number, number] => !!p);
    if (!pts.length) continue;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const dist = Math.hypot(cx - d.x, cy - d.y);
    // The farthest point along the way that is still at sea.
    for (let step = Math.min(TACTICAL_CONFIG.patrol.km, dist); step >= 5; step -= 5) {
      const p: [number, number] = [Math.round(d.x + ((cx - d.x) / dist) * step), Math.round(d.y + ((cy - d.y) / dist) * step)];
      if (!isSea(terrainHere, p)) continue;
      d.x = p[0];
      d.y = p[1];
      if (live) { const a = s.assets.find((z) => z.id === d.assetId); if (a) a.pos = theaterToLonLat(s, w.region, d.x, d.y); }
      break;
    }
  }
  const load = new Map<string, number>();
  for (const tr of w.tracks) {
    tr.launchAt = w.atHour - TACTICAL_CONFIG.flightHours[tr.cls];
    resolveTrack(s, t, w, tr, deps, load);
  }
  // Shoot and scoot: systems with those orders that fired move off, out of action while they do.
  if (live) {
    const firedIds = new Set(w.tracks.flatMap((tr) => (tr.fired ?? []).map((f) => f.dep)));
    for (const d of deps) {
      const sp = EQUIPMENT_MAP.get(d.equipmentId)!;
      const a = s.assets.find((z) => z.id === d.assetId);
      if (!d.scoot || sp.domain !== 'ground' || d.transit || !a || !firedIds.has(d.id)) continue;
      const k = hash01(s.settings.seed, w.atHour, t.deployments.indexOf(d), 0x91) * Math.PI * 2;
      const p = spotNear(s, sp, w.region, d.x + Math.cos(k) * TACTICAL_CONFIG.scoot.km, d.y + Math.sin(k) * TACTICAL_CONFIG.scoot.km);
      if (!p) continue;
      d.transit = { region: w.region, x: p[0], y: p[1], remaining: TACTICAL_CONFIG.scoot.hours, hours: TACTICAL_CONFIG.scoot.hours };
      a.status = 'transit';
      a.maintenanceRemaining = TACTICAL_CONFIG.scoot.hours;
    }
  }
  w.resolved = true;
  w.applied = false;
  const real = w.tracks.filter((x) => !x.decoy).length;
  if (real) tlog(s, 'crit', `LAUNCH: threat wave ${w.id} (${real} threats) inbound to ${region.name} from the ${w.axis}${w.axis2 ? ` and the ${w.axis2}` : ''}${w.follow ? ', timed behind the drones' : ''}, impact T+${w.atHour}h.`, w.region);
}

export interface DefensePreview {
  waves: number; // forecast waves still to come in the region this phase
  threats: number; // genuine threats in them
  stopRate: number; // expected share of genuine threats stopped (0-1)
  prevented: number; // expected share of their damage prevented, weighted by site importance (0-1)
  /** The middle 80% of outcomes (10th to 90th percentile) of the damage prevented: how much luck can move it. */
  range: [number, number];
  mix: Partial<Record<ThreatClass, number>>; // threats by class
  /** Expected share (0-1) of each class stopped: where the layout is strong and where it is not. */
  byClass: Partial<Record<ThreatClass, number>>;
}

/**
 * What-if for a briefing: plays the region's forecast waves against the current layout many times with fresh
 * random numbers (never the game's own stream) and averages the result. Uses the real engagement rules, so moving
 * or adding a system changes the estimate exactly as it would change the fight. Surprise waves are not included.
 */
export function previewDefense(s: SimState, region: RegionId, runs = 24, all = false): DefensePreview | null {
  const t = s.tactical;
  if (!t?.enabled) return null;
  // `all` counts the waves kept out of the forecast too: for a raid's author, who knows what is coming.
  const waves = t.waves.filter((w) => w.region === region && w.phaseIndex === s.phaseIndex && !w.resolved && (all || w.forecast));
  if (!waves.length) return null;
  const mix: Partial<Record<ThreatClass, number>> = {};
  for (const w of waves) for (const tr of w.tracks) if (!tr.decoy) mix[tr.cls] = (mix[tr.cls] ?? 0) + 1;
  let stopped = 0;
  let total = 0;
  let saved = 0;
  let potential = 0;
  const perRun: number[] = [];
  const seenBy: Partial<Record<ThreatClass, number>> = {};
  const stoppedBy: Partial<Record<ThreatClass, number>> = {};
  for (let k = 0; k < runs; k++) {
    let runSaved = 0;
    let runPotential = 0;
    const t2: TacticalState = {
      ...t,
      rng: (0x9e3779b9 + k * 2654435761 + s.hour * 97) >>> 0,
      deployments: t.deployments.map((d) => ({ ...d })),
      waves: waves.map((w) => ({ ...w, tracks: w.tracks.map((tr) => ({ ...tr, shots: 0, outcome: undefined, stoppedBy: undefined, stopAt: undefined, cueQ: undefined, band: undefined, rejected: undefined, depTarget: undefined, aim: undefined })) })),
      stats: emptyStats(),
    };
    const s2 = { ...s, tactical: t2, log: [] } as SimState;
    for (const w of t2.waves) {
      resolveWave(s2, t2, w);
      for (const tr of w.tracks) {
        if (tr.decoy) continue;
        const v = trackValue(t, tr);
        total++;
        seenBy[tr.cls] = (seenBy[tr.cls] ?? 0) + 1;
        if (tr.outcome === 'stopped') stoppedBy[tr.cls] = (stoppedBy[tr.cls] ?? 0) + 1;
        potential += v;
        runPotential += v;
        if (tr.outcome === 'stopped') { stopped++; saved += v; runSaved += v; }
      }
    }
    perRun.push(runPotential ? runSaved / runPotential : 0);
  }
  perRun.sort((a, b) => a - b);
  const q = (p: number) => perRun[Math.min(perRun.length - 1, Math.max(0, Math.round(p * (perRun.length - 1))))];
  return {
    waves: waves.length, threats: Math.round(total / runs), stopRate: total ? stopped / total : 0,
    prevented: potential ? saved / potential : 0, range: [q(0.1), q(0.9)], mix,
    byClass: Object.fromEntries(CLASSES.filter((c) => seenBy[c]).map((c) => [c, (stoppedBy[c] ?? 0) / seenBy[c]!])),
  };
}

/** A site the current phase's forecast waves are aimed at, with how much of that threat nothing deployed can reach. */
export interface ForecastTarget {
  site: Site;
  /** Expected damage aimed at the site (threat damage × site importance). */
  threat: number;
  /** The part of `threat` from threat classes no deployed system can engage at the site. */
  uncovered: number;
  classes: ThreatClass[];
}

/**
 * Where this phase's forecast waves are headed in a region, most threatened first. Briefings show it so that a
 * player defends the sites that will actually be attacked, not just the most valuable ones. Surprise waves are not
 * included, like the forecast itself.
 */
export function forecastTargets(s: SimState, region: RegionId): ForecastTarget[] {
  const t = s.tactical;
  if (!t?.enabled) return [];
  const by = new Map<string, ForecastTarget>();
  const cover = new Map<string, Record<ThreatClass, number>>();
  for (const w of t.waves) {
    if (w.region !== region || w.phaseIndex !== s.phaseIndex || w.resolved || !w.forecast) continue;
    for (const tr of w.tracks) {
      if (tr.decoy) continue;
      const site = t.sites.find((x) => x.id === tr.siteId);
      if (!site) continue;
      if (!cover.has(site.id)) cover.set(site.id, coverageAt(s, region, site.x, site.y));
      const v = TACTICAL_CONFIG.threatDamage[tr.cls] * site.importance;
      const e = by.get(site.id) ?? { site, threat: 0, uncovered: 0, classes: [] };
      e.threat += v;
      if (!(cover.get(site.id)![tr.cls] > 0)) e.uncovered += v;
      if (!e.classes.includes(tr.cls)) e.classes.push(tr.cls);
      by.set(site.id, e);
    }
  }
  return [...by.values()].sort((a, b) => b.threat - a.threat || b.site.importance - a.site.importance);
}

export { siteDamageShare, siteLoss, networkDamageShare } from './sites';

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
  // Ships on patrol wear faster.
  for (const d of t.deployments) {
    if (!d.patrol || d.transit) continue;
    const a = s.assets.find((z) => z.id === d.assetId);
    if (a && a.status !== 'maintenance') a.condition = clamp(a.condition - TACTICAL_CONFIG.patrol.wear * 0.1);
  }
  // Idle maintenance crews rebuild the damaged sites the player has sent them to, one at a time, in that order.
  const idle = Math.max(0, s.crews - s.crewsBusy);
  if (idle > 0 && t.repairFirst?.length) {
    const order = t.repairFirst;
    // Only sites the player has sent crews to: the first in the list that still needs work.
    const site = order.map((id) => t.sites.find((x) => x.id === id)).find((x) => x && x.integrity < 100);
    if (site) site.integrity = clamp(site.integrity + idle * TACTICAL_CONFIG.repairPerCrewHour);
    else if (order.length) t.repairFirst = undefined; // all done
  }
  for (const d of t.deployments) {
    if (d.reloadRemaining === undefined) continue;
    d.reloadRemaining -= 1;
    if (d.reloadRemaining <= 0) {
      d.reloadRemaining = undefined;
      const mag = EQUIPMENT_MAP.get(d.equipmentId)!.magazine;
      d.stock = d.reloadRounds === undefined ? mag : Math.min(mag, d.stock + d.reloadRounds);
      d.reloadRounds = undefined;
    }
  }
  for (const w of t.waves) {
    // Launch: outcome decided with the defenses as they stand. Impact: damage lands.
    if (!w.resolved && (w.launchAt ?? w.atHour) <= s.hour) resolveWave(s, t, w, true);
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
  return spec.roundCr ?? (equipmentCost(spec) * TACTICAL_CONFIG.resupplyRate) / spec.magazine;
}

/** Stockpile rules in force: the campaign at Officer or Commander. Null means unlimited reserves. */
export function stockpileRules(s: SimState) {
  if (s.settings.mode !== 'campaign') return null;
  const base = STOCKPILES[s.settings.level ?? 'officer'] ?? null;
  if (!base) return null;
  // The defense industry adds to what each unit brings, what is restocked and what can be held.
  const extra = TACTICAL_CONFIG.industry.magazines * Math.min(TACTICAL_CONFIG.industry.max, s.industry ?? 0);
  return { initial: base.initial + extra, restock: base.restock + extra, cap: base.cap + extra };
}

/** Rounds left in the national reserve for an equipment type (Infinity when reserves are unlimited). */
export function stockpileOf(s: SimState, equipmentId: string): number {
  if (!stockpileRules(s)) return Infinity;
  return s.tactical?.stockpile?.[equipmentId] ?? 0;
}

/** Rounds a resupply would bring now: what is missing, limited by the national reserve. */
export function resupplyRounds(s: SimState, d: Deployment): number {
  const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
  if (isUnlimited(spec) || spec.magazine <= 0) return 0;
  return Math.max(0, Math.min(spec.magazine - d.stock, stockpileOf(s, d.equipmentId)));
}

/** At each later phase start, the reserve of every fielded type is restocked (up to its cap). */
export function restockStockpiles(s: SimState) {
  const sp = stockpileRules(s);
  const t = s.tactical;
  if (!sp || !t) return;
  const units = new Map<string, number>();
  for (const d of t.deployments) units.set(d.equipmentId, (units.get(d.equipmentId) ?? 0) + 1);
  t.stockpile = t.stockpile ?? {};
  for (const [id, n] of units) {
    const spec = EQUIPMENT_MAP.get(id)!;
    if (!isEffector(spec) || isUnlimited(spec)) continue;
    const cap = Math.floor(spec.magazine * sp.cap * n);
    t.stockpile[id] = Math.min(cap, (t.stockpile[id] ?? 0) + Math.floor(spec.magazine * sp.restock * n));
  }
}

/** Credits to resupply: a share of the deployment cost, in proportion to the rounds brought. */
export function resupplyCost(d: Deployment, rounds?: number, s?: SimState): number {
  const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
  const free = s?.tactical?.freeResupply;
  if (free && free.region === d.region && free.phaseIndex === s!.phaseIndex) return 0;
  if (isUnlimited(spec) || spec.magazine <= 0) return 0;
  const n = rounds ?? spec.magazine - d.stock;
  if (n <= 0) return 0;
  return Math.max(TACTICAL_CONFIG.resupplyMinCost, Math.ceil(roundCostOf(s, d, spec) * n));
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

/** Callsigns for fielded units, handed out in order. */
const CALLSIGNS = ['Kestrel', 'Heron', 'Osprey', 'Lynx', 'Badger', 'Marten', 'Falcon', 'Otter', 'Raven', 'Viper', 'Bison', 'Curlew', 'Jackal', 'Pike', 'Harrier', 'Wolverine',
  'Gannet', 'Mantis', 'Ibex', 'Stoat', 'Condor', 'Adder', 'Tern', 'Bobcat', 'Shrike', 'Marlin', 'Wren', 'Caracal', 'Petrel', 'Hornet', 'Dingo', 'Swift', 'Moray', 'Plover', 'Coyote Two',
  'Egret', 'Mongoose', 'Skua', 'Puma', 'Lapwing'];

/** A unit's display name with its callsign: NASAMS 2 “Heron”. */
export function unitName(s: SimState, d: Deployment): string {
  const base = s.assets.find((a) => a.id === d.assetId)?.name ?? EQUIPMENT_MAP.get(d.equipmentId)?.name ?? 'Unit';
  return d.callsign ? `${base} “${d.callsign}”` : base;
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
  const d: Deployment = { id: `DEP-${n}`, equipmentId: spec.id, assetId, region, x, y, stock: spec.magazine, deployedAt: s.hour, callsign: CALLSIGNS[n % CALLSIGNS.length] };
  t.deployments.push(d);
  // Fielding a unit brings its share of the national reserve.
  const sp = stockpileRules(s);
  if (sp && isEffector(spec) && !isUnlimited(spec)) {
    t.stockpile = t.stockpile ?? {};
    t.stockpile[spec.id] = (t.stockpile[spec.id] ?? 0) + Math.floor(spec.magazine * sp.initial);
  }
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

// ── After-action: what would have helped ────────────────────────────────

export interface FixSuggestion {
  region: RegionId;
  leaked: number; // genuine threats that got through in the region
  mainClass: ThreatClass;
  reason: string; // the most common reason they got through
  equipmentId: string;
  near: string; // site the suggested system goes beside
  x: number; // where it would stand
  y: number;
  cost: number;
  stoppedMore: number; // extra threats it would have stopped, on average
  text: string;
}

const PLURAL: Record<ThreatClass, string> = { slowDrone: 'slow drones', fastDrone: 'fast drones', cruise: 'cruise missiles', rocket: 'rockets', ballistic: 'ballistic missiles', hypersonic: 'hypersonic gliders' };

/** A legal spot near a point, searching outwards (for placing a suggested system). */
export function spotNear(s: SimState, spec: EquipmentSpec, region: RegionId, x: number, y: number): [number, number] | null {
  for (let r = 0; r <= 120; r += 6) {
    for (let a = 0; a < 16; a++) {
      const p: [number, number] = [Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 16) * Math.PI * 2) * r)];
      if (!placementError(s, spec, region, p[0], p[1])) return p;
      if (r === 0) break;
    }
  }
  return null;
}

/**
 * Replays a region's resolved waves (fresh random numbers, several times) against its final layout plus an optional
 * extra system, and returns the average number of genuine threats stopped. Pure: the state is not changed.
 */
function replayRegion(s: SimState, region: RegionId, extra: { spec: EquipmentSpec; x: number; y: number } | null, runs = 6): number {
  const t = s.tactical!;
  const waves = t.waves.filter((w) => w.region === region && w.resolved);
  const extraAsset = extra ? {
    id: 'WHATIF', name: extra.spec.name, className: extra.spec.name, domain: extra.spec.domain, role: 'defense' as const, region,
    coverage: [region], condition: 100, capability: 0, status: 'operational' as const, hoursToService: 999, maintenanceRemaining: 0,
    upkeep: 0, pos: [0, 0] as [number, number], history: [],
  } : null;
  let stopped = 0;
  for (let k = 0; k < runs; k++) {
    // Full magazines: the question is where systems stand, not how well they were resupplied.
    const deployments: Deployment[] = t.deployments.filter((d) => d.region === region).map((d) => ({ ...d, stock: EQUIPMENT_MAP.get(d.equipmentId)!.magazine, transit: undefined, reloadRemaining: undefined }));
    if (extra) deployments.push({ id: 'WHATIF', equipmentId: extra.spec.id, assetId: 'WHATIF', region, x: extra.x, y: extra.y, stock: extra.spec.magazine, deployedAt: 0 });
    const t2: TacticalState = {
      ...t, rng: (0x7f4a7c15 + k * 2246822519) >>> 0, deployments, stats: emptyStats(), alerts: [],
      waves: waves.map((w) => ({ ...w, resolved: false, tracks: w.tracks.filter((x) => !x.decoy).map((tr) => ({ id: tr.id, cls: tr.cls, siteId: tr.siteId, from: tr.from, via: tr.via, depTarget: tr.depTarget, aim: tr.aim, decoy: false, shots: 0 })) })),
    };
    // Defended sites as they were before the waves hit, and the same weather and daylight at each launch.
    const s2 = { ...s, tactical: t2, log: [], assets: extraAsset ? [...s.assets, extraAsset] : s.assets } as SimState;
    for (const w of t2.waves) {
      const deps = t2.deployments.filter((d) => d.region === w.region);
      w.conditions = conditionsAt(s, w.region, w.launchAt ?? w.atHour);
      const load = new Map<string, number>();
      for (const tr of w.tracks) resolveTrack(s2, t2, w, tr, deps, load);
      stopped += w.tracks.filter((x) => x.outcome === 'stopped').length;
    }
  }
  return stopped / runs;
}

/**
 * For each region where threats got through, try a few affordable systems that can engage what leaked, placed
 * beside the most-hit site, by replaying that region's waves; suggest the best value. Up to `max` suggestions.
 */
export function suggestFixes(s: SimState, max = 3): FixSuggestion[] {
  const t = s.tactical;
  if (!t?.enabled) return [];
  const out: FixSuggestion[] = [];
  const sites = new Map(t.sites.map((x) => [x.id, x]));
  for (const region of REGION_IDS) {
    const leaked = t.waves.filter((w) => w.region === region && w.resolved).flatMap((w) => w.tracks.filter((x) => !x.decoy && x.outcome === 'leaked'));
    if (leaked.length < 2) continue;
    const byClass = new Map<ThreatClass, number>();
    for (const tr of leaked) byClass.set(tr.cls, (byClass.get(tr.cls) ?? 0) + 1);
    const mainClass = [...byClass].sort((a, b) => b[1] - a[1])[0][0];
    const reasons = new Map<string, number>();
    for (const tr of leaked) { const why = leakText(tr, t.deployments); reasons.set(why, (reasons.get(why) ?? 0) + 1); }
    const reason = [...reasons].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const hits = new Map<string, number>();
    for (const tr of leaked) hits.set(tr.siteId, (hits.get(tr.siteId) ?? 0) + 1);
    const site = sites.get([...hits].sort((a, b) => b[1] - a[1])[0][0])!;
    // The four cheapest ground or sea systems that can engage the main threat class.
    const candidates = EQUIPMENT.filter((e) => isEffector(e) && e.domain !== 'air' && canEngageClass(e, mainClass))
      .sort((a, b) => equipmentCost(a) - equipmentCost(b)).slice(0, 4);
    const base = replayRegion(s, region, null);
    let best: { spec: EquipmentSpec; gain: number; value: number; p: [number, number] } | null = null;
    for (const spec of candidates) {
      const p = spotNear(s, spec, region, site.x, site.y);
      if (!p) continue;
      const gain = replayRegion(s, region, { spec, x: p[0], y: p[1] }) - base;
      const value = gain / Math.max(1, equipmentCost(spec));
      if (gain >= 1 && (!best || value > best.value)) best = { spec, gain, value, p };
    }
    if (!best) continue;
    const n = Math.round(best.gain);
    out.push({
      region, leaked: leaked.length, mainClass, reason, equipmentId: best.spec.id, near: site.name, x: best.p[0], y: best.p[1], cost: equipmentCost(best.spec), stoppedMore: n,
      text: `${leaked.length} threats got through in ${s.regions[region].name}, mostly ${PLURAL[mainClass]}. ${reason ? `Typical reason: ${reason.charAt(0).toLowerCase()}${reason.slice(1).replace(/\.$/, '')}. ` : ''}`
        + `${/^[AEIOU]/i.test(best.spec.name) ? 'An' : 'A'} ${best.spec.name} beside ${site.name} (${equipmentCost(best.spec)} cr) would have stopped about ${n} more of them.`,
    });
  }
  return out.sort((a, b) => b.stoppedMore - a.stoppedMore).slice(0, max);
}
