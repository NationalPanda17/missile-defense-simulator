// Orbits and space missions. Satellites keep fictional callsigns; their orbits follow public orbital physics
// (altitudes, periods, where each regime can see), simplified for the game. Coverage is computed from the orbit at
// each sim hour instead of being a fixed list, and each satellite flies a mission that feeds the missile fight.
// Old saves have satellites with no orbit: they keep their fixed coverage and fly no mission.
import { clamp } from './rng';
import { availability, isLive } from './metrics';
import { hash01 } from './weather';
import type { Asset, Orbit, OrbitRegime, RegionId, SimState, SpaceMission } from './types';
import { REGION_IDS } from './types';

/** Public figures for each regime, and how the game uses them. */
export const REGIMES: Record<OrbitRegime, { name: string; altitude: string; periodH: number; text: string }> = {
  LEO: { name: 'Low Earth orbit', altitude: '500–2,000 km', periodH: 1.58, text: 'Close and fast: a pass over a region lasts minutes, a few times a day. Sharp imaging and tracking, but gaps between passes, and the easiest orbit to attack.' },
  SSO: { name: 'Sun-synchronous orbit', altitude: '~700 km', periodH: 1.65, text: 'A near-polar low orbit that passes over each place at the same local time every day. Used for imaging.' },
  MEO: { name: 'Medium Earth orbit', altitude: '~20,200 km', periodH: 11.97, text: 'Navigation constellations: enough satellites that every region always sees several.' },
  GEO: { name: 'Geostationary orbit', altitude: '35,786 km', periodH: 23.93, text: 'Turns with the Earth, so it hangs over one longitude and sees about a third of the globe, but little beyond about 70° latitude.' },
  HEO: { name: 'Highly elliptical (Molniya) orbit', altitude: '~500 to ~40,000 km', periodH: 11.97, text: 'Slow at its high point over the far north, where it hangs for about 8 of every 12 hours: it covers the polar region that GEO cannot.' },
};

export const MISSIONS: Record<SpaceMission, { name: string; text: string }> = {
  warning: { name: 'Missile warning', text: 'Infrared sensors see the launch flash of ballistic and hypersonic missiles: crews react faster, and the first track comes from space. Cannot see drones or cruise missiles.' },
  tracking: { name: 'Tracking layer', text: 'A low constellation that follows ballistic missiles and hypersonic gliders through flight, so interceptors fire on a good track even where ground radars lose them.' },
  nav: { name: 'Navigation and timing', text: 'Precise position and time for every launcher and interceptor: a small accuracy boost across the network.' },
  relay: { name: 'Communications relay', text: 'Carries command traffic to the regions it covers: part of each region’s communications.' },
  imaging: { name: 'Imaging', text: 'A pass over a region photographs the launch areas: a wave launched within 12 hours of a pass is known in advance, so radars that can tell decoys apart do so 30% more often (and Commander intel is more reliable).' },
};

/** What each mission does to the fight, in game numbers. */
export const SPACE = {
  /** Missile warning: reaction time × this against ballistic and hypersonic threats, and the track quality an unseen one gets. */
  warningReaction: 0.75,
  warningTrack: 0.6,
  /** Tracking layer: track quality on ballistic missiles and gliders (× constellation health). */
  trackingQuality: 0.85,
  /** Navigation: + this share to every shot's chance (× constellation health). */
  navBonus: 0.05,
  /** Imaging: × (1 + this) on each radar's chance of recognising a decoy in a wave whose launch area was imaged. Commander intel error × imagingIntel. */
  imagingDiscrim: 0.3,
  imagingWindowH: 12,
  imagingIntel: 0.5,
  /** Footprints (great-circle degrees from the point below the satellite) within which a region's centre is covered. */
  footprint: { GEO: 72, HEO: 75, LEO: 18, SSO: 18 } as Record<string, number>,
  /** GEO repositioning: degrees of longitude per hour of drift (sped up for the game) and the propellant it costs. */
  drift: { degPerHour: 10, fuelBase: 4, fuelPerDeg: 0.1 },
  /** Propellant for an avoidance or evasion manoeuvre. */
  burn: { dodge: 8, evade: 12 },
  /** A debris cloud after an anti-satellite strike: hours it lasts, and × the chance of a conjunction for low satellites. */
  debris: { hours: 96, conjunction: 4 },
  /** Outlook: hours ahead it looks, the fewest uncovered hours worth a warning, and how close to the mission floor counts as fading. */
  outlookH: 48,
  gapMinH: 4,
  fadeMargin: 8,
};

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Great-circle angle between two lon/lat points, in degrees. */
export function arcDeg(a: [number, number], b: [number, number]): number {
  const [l1, p1] = a.map(rad);
  const [l2, p2] = b.map(rad);
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l1 - l2);
  return deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

/** Where a satellite is, as the lon/lat directly below it, at sim hour t (fractional). Null for constellations. */
export function subPoint(o: Orbit, t: number): [number, number] | null {
  switch (o.regime) {
    case 'GEO':
      if (!o.drift) return [wrap(o.lon!), 0];
      {
        // Drifting: glides from its old slot to the new one over the drift (continuous in time, for smooth display).
        const k = o.drift.at !== undefined ? (t - o.drift.at) / o.drift.hours : (o.drift.hours - o.drift.left) / o.drift.hours;
        return [wrap(o.drift.fromLon + (o.drift.toLon - o.drift.fromLon) * Math.max(0, Math.min(1, k))), 0];
      }
    case 'HEO': {
      // 12-hour Molniya orbit: apogee over 63°N, where it lingers; a quick perigee pass in the south. Its two
      // apogees each day are half a world apart.
      const rev = t / REGIMES.HEO.periodH + (o.phase ?? 0);
      const f = rev - Math.floor(rev);
      // It slows near apogee, so it spends about two thirds of each orbit high over the north.
      const lat = f < 0.85 ? 63 * Math.sin((Math.PI * f) / 0.85) ** 0.4 : -63 * Math.sin((Math.PI * (f - 0.85)) / 0.15);
      const lon = (o.lon ?? 0) + (Math.floor(rev) % 2 ? 180 : 0) + (f - 0.42) * 30;
      return [wrap(lon), lat];
    }
    case 'LEO':
    case 'SSO': {
      const T = REGIMES[o.regime].periodH;
      const u = 2 * Math.PI * ((o.phase ?? 0) + t / T);
      const i = rad(o.incl ?? (o.regime === 'SSO' ? 98 : 53));
      const lat = deg(Math.asin(Math.sin(i) * Math.sin(u)));
      const lon = (o.raan ?? 0) + deg(Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u))) - 15.04 * t;
      return [wrap(lon), lat];
    }
    default:
      return null;
  }
}

const regionCenter = (s: SimState, r: RegionId) => s.regions[r].center;

/** The regions a satellite can see at an instant. */
export function inViewAt(s: SimState, o: Orbit, t: number): RegionId[] {
  if (o.destroyed) return [];
  if (o.regime === 'MEO' || (o.size && o.regime === 'LEO')) return [...REGION_IDS]; // constellations cover everything
  if (o.drift) return [];
  const p = subPoint(o, t);
  if (!p) return [];
  if (o.regime === 'HEO' && p[1] < 40) return []; // only useful near apogee
  const reach = SPACE.footprint[o.regime];
  return REGION_IDS.filter((r) => {
    const c = regionCenter(s, r);
    if (o.regime === 'GEO' && Math.abs(c[1]) > 70) return false; // too low on the horizon at high latitude
    return arcDeg(p, c) <= reach;
  });
}

/** Regions seen at any moment during an hour (sampled every 10 minutes): passes are short. */
export function inViewDuring(s: SimState, o: Orbit, hour: number): RegionId[] {
  const seen = new Set<RegionId>();
  const samples = o.regime === 'LEO' || o.regime === 'SSO' ? 6 : 1;
  for (let k = 0; k < samples; k++) for (const r of inViewAt(s, o, hour + k / samples)) seen.add(r);
  return [...seen];
}

/** Hours (from `from`) until the next pass over a region, within a day; null if none. */
export function nextPass(s: SimState, o: Orbit, region: RegionId, from: number): number | null {
  for (let h = 0; h <= 24; h++) if (inViewDuring(s, o, from + h).includes(region)) return h;
  return null;
}

/** A satellite flying its mission right now: has an orbit, is on station, is not jammed, and is working. */
export function missionUp(s: SimState, a: Asset): boolean {
  const o = a.orbit;
  if (!o || o.destroyed || o.drift) return false;
  if (jammed(s, a)) return false;
  return availability(s, a) > 0.3;
}

/** Uplink jamming in progress against this satellite (a live, genuine jamming report that is not yet fixed). */
export function jammed(s: SimState, a: Asset): boolean {
  return s.events.some((e) => e.templateId === 'sat_jam' && e.assetId === a.id && e.isGenuine && isLive(e));
}

export const sats = (s: SimState) => s.assets.filter((a) => a.domain === 'space' && a.orbit);

/** What space gives a region at an hour: who warns, tracks, and imaged it, and how good navigation is. */
export interface SpaceSupport { warning?: Asset; tracking?: Asset; trackingHealth: number; nav: number; imaging?: Asset }

export function spaceSupport(s: SimState, region: RegionId, hour: number): SpaceSupport {
  const out: SpaceSupport = { trackingHealth: 0, nav: 0 };
  for (const a of sats(s)) {
    if (!missionUp(s, a)) continue;
    const o = a.orbit!;
    const health = Math.min(1, availability(s, a));
    switch (o.mission) {
      case 'warning':
        if (!out.warning && inViewDuring(s, o, Math.floor(hour)).includes(region)) out.warning = a;
        break;
      case 'tracking':
        if (health > out.trackingHealth) { out.trackingHealth = health; out.tracking = a; }
        break;
      case 'nav':
        out.nav = Math.max(out.nav, health);
        break;
      case 'imaging':
        if (!out.imaging) {
          for (let h = Math.floor(hour) - SPACE.imagingWindowH; h <= Math.floor(hour); h++) {
            if (inViewDuring(s, o, h).includes(region)) { out.imaging = a; break; }
          }
        }
        break;
    }
  }
  return out;
}

/** Space support for a wave, worked out once per wave (previews and replays reuse it). */
const supportCache = new WeakMap<object, SpaceSupport>();
export function waveSupport(s: SimState, w: { region: RegionId; atHour: number; launchAt?: number }): SpaceSupport {
  let v = supportCache.get(w);
  if (!v) { v = spaceSupport(s, w.region, w.launchAt ?? w.atHour); supportCache.set(w, v); }
  return v;
}

/** Credit a satellite with a contribution to the fight (the debrief shows it; the Commander enemy goes after the top one). */
export function creditSat(s: SimState, a: Asset | undefined) {
  if (!a) return;
  const sp = (s.space ??= {});
  (sp.credit ??= {})[a.id] = (sp.credit[a.id] ?? 0) + 1;
}

/** Each hour: move satellites, recompute coverage, finish drifts, and run the enemy's anti-satellite strikes. */
export function tickSpace(s: SimState) {
  for (const a of sats(s)) {
    const o = a.orbit!;
    if (o.drift) {
      o.drift.left -= 1;
      if (o.drift.left <= 0) {
        o.lon = wrap(o.drift.toLon);
        o.drift = undefined;
        s.log.push({ t: s.hour, level: 'success', text: `${a.name} has arrived on station over ${lonText(o.lon)}.` });
      }
    }
    // Low satellites fight atmospheric drag: a solar storm puffs the atmosphere up and costs them propellant.
    if ((o.regime === 'LEO' || o.regime === 'SSO') && s.events.some((e) => e.templateId === 'solar_surge' && e.status !== 'resolved' && s.hour < e.deadline)) {
      o.fuel = clamp(o.fuel - 0.2);
    }
    const p = subPoint(o, s.hour);
    if (p) a.pos = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    // Coverage for the network numbers: what it sees now; low satellites count a region they passed in the last 12h.
    if (o.regime === 'LEO' || o.regime === 'SSO') {
      const seen = new Set<RegionId>();
      for (let h = s.hour - 11; h <= s.hour; h++) for (const r of inViewDuring(s, o, h)) seen.add(r);
      a.coverage = o.destroyed ? [] : REGION_IDS.filter((r) => seen.has(r));
    } else a.coverage = inViewAt(s, o, s.hour);
    if (o.destroyed) a.status = 'offline';
  }
  antiSatellite(s);
}

export const lonText = (lon: number) => `${Math.abs(Math.round(lon))}°${lon < 0 ? 'W' : 'E'}`;

/** Start a GEO satellite drifting to a new longitude. Returns an error, or null. */
export function repositionError(_s: SimState, a: Asset, toLon: number): string | null {
  const o = a.orbit;
  if (!o || o.regime !== 'GEO') return 'Only geostationary satellites can move to a new slot.';
  if (o.destroyed) return 'Destroyed.';
  if (o.drift) return 'Already drifting.';
  const d = Math.abs(wrap(toLon - o.lon!));
  if (d < 5) return 'Already there.';
  if (o.fuel < driftFuel(d)) return `Not enough propellant (needs ${Math.ceil(driftFuel(d))}%).`;
  return null;
}
export const driftFuel = (degrees: number) => SPACE.drift.fuelBase + degrees * SPACE.drift.fuelPerDeg;
export const driftHours = (degrees: number) => Math.max(2, Math.ceil(degrees / SPACE.drift.degPerHour));

export function reposition(s: SimState, a: Asset, toLon: number) {
  const o = a.orbit!;
  const d = wrap(toLon - o.lon!); // the short way round
  o.fuel = clamp(o.fuel - driftFuel(Math.abs(d)));
  o.drift = { fromLon: o.lon!, toLon: o.lon! + d, left: driftHours(Math.abs(d)), hours: driftHours(Math.abs(d)), at: s.hour };
}

// ── Launches ───────────────────────────────────────────────────────────

/** Put a new satellite in orbit (a completed launch project). */
export function launchSatellite(s: SimState, kind: 'warning' | 'relay' | 'imaging' | 'tracking', region?: RegionId): Asset | null {
  if (kind === 'tracking') {
    const tracer = s.assets.find((a) => a.orbit?.mission === 'tracking');
    if (tracer) {
      tracer.orbit!.destroyed = false;
      tracer.orbit!.size = Math.min(36, (tracer.orbit!.size ?? 24) + 8);
      tracer.condition = clamp(tracer.condition + 30);
      if (tracer.status === 'offline') tracer.status = 'operational';
      return tracer;
    }
  }
  const polar = region === 'POL';
  const base = kind === 'imaging' ? 'ARGUS' : kind === 'tracking' ? 'TRACER' : polar ? 'AURORA' : kind === 'warning' ? 'VIGIL' : 'LODESTAR';
  const n = s.assets.filter((a) => a.name.startsWith(base)).length + 1;
  const name = kind === 'relay' && !polar ? `${base}-${String.fromCharCode(64 + n)}` : `${base}-${n}`;
  const center = region ? s.regions[region].center : [0, 0];
  const orbit: Orbit = kind === 'imaging'
    ? { regime: 'SSO', mission: 'imaging', incl: 98, raan: Math.round(hash01(s.settings.seed, s.hour, 0x5a) * 360) - 180, phase: hash01(s.settings.seed, s.hour, 0x5b), fuel: 100 }
    : kind === 'tracking'
      ? { regime: 'LEO', mission: 'tracking', fuel: 100, size: 8 }
      : polar
        ? { regime: 'HEO', mission: kind, lon: -40, phase: (s.assets.filter((a) => a.orbit?.regime === 'HEO').length * 0.5) % 1, fuel: 100 }
        : { regime: 'GEO', mission: kind, lon: Math.round(center[0]), fuel: 100 };
  const label = SAT_CLASS[`${orbit.regime}:${orbit.mission}`] ?? 'Satellite';
  const a: Asset = {
    id: `SAT-${s.nextId++}`, name, className: label, domain: 'space', role: kind === 'relay' ? 'comms' : 'sensor', region: region ?? 'POL',
    coverage: [], condition: 100, capability: kind === 'imaging' ? 10 : kind === 'tracking' ? 12 : kind === 'relay' ? 30 : 26,
    status: 'operational', hoursToService: 220, maintenanceRemaining: 0, upkeep: 0.6, pos: [center[0], 0], history: [100], orbit,
  };
  s.assets.push(a);
  return a;
}

/** Class names by regime and mission: fictional satellites, described by the public real-world class they resemble. */
export const SAT_CLASS: Record<string, string> = {
  'GEO:warning': 'Missile-warning satellite (GEO, SBIRS-class)',
  'HEO:warning': 'Polar missile-warning satellite (HEO, SBIRS HEO-class)',
  'GEO:relay': 'Relay satellite (GEO, WGS-class)',
  'HEO:relay': 'Polar relay satellite (HEO, EPS-class)',
  'MEO:nav': 'Navigation constellation (MEO, GPS-class)',
  'LEO:tracking': 'Tracking-layer constellation (LEO, PWSA-class)',
  'SSO:imaging': 'Imaging satellite (SSO, WorldView-class)',
};

// ── The enemy's anti-satellite strikes (campaign; never on Recruit) ──────────────

export const ASAT = {
  /** First phase (index) strikes can happen, and how many at most in a campaign, by difficulty. */
  officer: { from: 2, max: 1, chance: 0.5 },
  commander: { from: 1, max: 2, chance: 0.8 },
  /** Damage to a constellation (one of its satellites lost) rather than a single satellite. */
  constellationHit: 30,
};

/** The hours this campaign's strikes happen, decided from the seed when each phase starts. */
function antiSatellite(s: SimState) {
  if (s.settings.mode !== 'campaign' || s.status !== 'running') return;
  const rule = s.settings.level === 'commander' ? ASAT.commander : s.settings.level === 'officer' || !s.settings.level ? ASAT.officer : null;
  if (!rule) return; // Recruit: no attacks on satellites
  const sp = (s.space ??= {});
  const done = sp.strikes?.length ?? 0;
  if (done >= rule.max || s.phaseIndex < rule.from) return;
  if (sp.strikes?.some((x) => x.phase === s.phaseIndex)) return;
  const phase = s.phases[s.phaseIndex];
  if (!phase) return;
  // One roll per phase decides whether, and at which hour, a strike comes.
  if (hash01(s.settings.seed, s.phaseIndex, 0xa5) >= rule.chance) { if (s.hour === s.phaseStartHour) sp.strikes = [...(sp.strikes ?? []), { phase: s.phaseIndex, hour: -1 }]; return; }
  const at = s.phaseStartHour + 8 + Math.floor(hash01(s.settings.seed, s.phaseIndex, 0xa6) * Math.max(1, phase.hours - 16));
  if (s.hour !== at) return;
  const low = sats(s).filter((a) => (a.orbit!.regime === 'LEO' || a.orbit!.regime === 'SSO') && !a.orbit!.destroyed);
  if (!low.length) { sp.strikes = [...(sp.strikes ?? []), { phase: s.phaseIndex, hour: s.hour }]; return; }
  // Commander: it goes after the low satellite that helped the defense most. Otherwise, any of them.
  const credit = sp.credit ?? {};
  const target = s.settings.level === 'commander'
    ? [...low].sort((a, b) => (credit[b.id] ?? 0) - (credit[a.id] ?? 0))[0]
    : low[Math.floor(hash01(s.settings.seed, s.phaseIndex, 0xa7) * low.length)];
  const o = target.orbit!;
  if (o.size) {
    o.size = Math.max(0, o.size - 1);
    target.condition = clamp(target.condition - ASAT.constellationHit);
  } else {
    o.destroyed = true;
    target.condition = 0;
    target.status = 'offline';
  }
  sp.strikes = [...(sp.strikes ?? []), { phase: s.phaseIndex, hour: s.hour, target: target.id, why: s.settings.level === 'commander' && (credit[target.id] ?? 0) > 0 ? credit[target.id] : undefined }];
  sp.debrisUntil = s.hour + SPACE.debris.hours;
  s.log.push({ t: s.hour, level: 'crit', text: o.size !== undefined
    ? `ANTI-SATELLITE STRIKE: a missile destroyed one satellite of ${target.name}. The constellation is down to ${o.size}, and the debris cloud raises collision risk in low orbit for ${SPACE.debris.hours}h.`
    : `ANTI-SATELLITE STRIKE: ${target.name} was destroyed by a missile launched from the ground. Its debris cloud raises collision risk in low orbit for ${SPACE.debris.hours}h. Launch a replacement from Logistics.` });
}

/** Is low orbit full of fresh debris? */
export const debrisCloud = (s: SimState) => (s.space?.debrisUntil ?? -1) > s.hour;

// ── Space outlook: what the player can see coming in orbit, for the briefing, Space Ops and the advisor ──────────

/** Missions that feed the missile fight directly (relay and navigation are covered by the network numbers). */
const FIGHT_MISSIONS: SpaceMission[] = ['warning', 'tracking', 'imaging'];

/** A satellite whose mission is lost, or about to be. */
export interface SatWatch {
  asset: Asset;
  mission: SpaceMission;
  /** down: not flying its mission now; fading: still flying it, but one more knock takes it off. */
  state: 'down' | 'fading';
  why: 'worn' | 'jammed' | 'servicing' | 'drifting';
  /** Forecast regions it gives missile warning to (warning satellites only). */
  regions: RegionId[];
}

/** A forecast region with hours of no missile warning in the window ahead, and the quickest fix. */
export interface WarningGap {
  region: RegionId;
  /** Hours in the window with no warning satellite flying its mission over the region. */
  hours: number;
  window: number;
  /** First uncovered hour (absolute). */
  from: number;
  fix:
    | { kind: 'move'; asset: Asset; lon: number; hours: number; fuel: number }
    | { kind: 'launch'; region: RegionId }
    | { kind: 'launching' }
    | { kind: 'service'; asset: Asset };
}

export interface SpaceOutlook {
  watch: SatWatch[];
  gaps: WarningGap[];
  /** Hours ahead the outlook looks at. */
  window: number;
}

/** Condition below which a degraded satellite no longer flies its mission (availability under 0.3). */
export function missionFloor(s: SimState): number {
  return (0.3 / (0.75 * (1 + s.modernization / 100))) * 100;
}

/** Forecast regions for the current phase (what the briefing tells the player to expect). */
function forecastRegions(s: SimState): RegionId[] {
  return s.tactical?.enabled ? [...s.tactical.forecast] : [];
}

/** Does a warning satellite cover a region at an hour, if it were flying its mission? */
const warnsOver = (s: SimState, o: Orbit, r: RegionId, h: number) => inViewDuring(s, o, h).includes(r);

const outlookCache = new WeakMap<SimState, { key: string; v: SpaceOutlook }>();

/**
 * What is about to go wrong in orbit for the regions the player expects attacks in. Uses only what the player knows:
 * the forecast, satellite health and orbits (never the hidden wave times). Empty outside campaigns with orbits.
 */
export function spaceOutlook(s: SimState): SpaceOutlook {
  const window = Math.max(1, Math.min(SPACE.outlookH, (s.phaseStartHour + (s.phases[s.phaseIndex]?.hours ?? 0)) - s.hour || SPACE.outlookH));
  const satKey = sats(s).map((a) => `${Math.round(a.condition)}${a.status[0]}${a.orbit!.destroyed ? 'x' : ''}${a.orbit!.lon ?? ''}`).join(',');
  const key = `${s.hour}:${s.phaseIndex}:${s.status}:${s.commands.length}:${s.events.length}:${s.projects.length}:${s.tactical?.forecast.join('')}:${satKey}`;
  const hit = outlookCache.get(s);
  if (hit && hit.key === key) return hit.v;
  const out: SpaceOutlook = { watch: [], gaps: [], window };
  const regions = forecastRegions(s);
  const all = sats(s);
  if (!regions.length || !all.length || s.status === 'complete') { outlookCache.set(s, { key, v: out }); return out; }
  const start = s.status === 'briefing' ? s.phaseStartHour : s.hour;
  const floor = missionFloor(s);

  // Satellites whose mission is lost or about to be.
  for (const a of all) {
    const o = a.orbit!;
    if (o.destroyed || !FIGHT_MISSIONS.includes(o.mission)) continue;
    const served = o.mission === 'warning' ? regions.filter((r) => Array.from({ length: window }, (_, h) => warnsOver(s, o, r, start + h)).some(Boolean)) : [];
    if (o.mission === 'warning' && !served.length && !o.drift) continue; // it warns no one we expect to be attacked
    const why: SatWatch['why'] | null = a.status === 'maintenance' ? 'servicing' : o.drift ? 'drifting' : jammed(s, a) ? 'jammed' : null;
    if (why) { if (why !== 'drifting') out.watch.push({ asset: a, mission: o.mission, state: 'down', why, regions: served }); continue; }
    if (!missionUp(s, a)) out.watch.push({ asset: a, mission: o.mission, state: 'down', why: 'worn', regions: served });
    else if (a.condition < floor + SPACE.fadeMargin) out.watch.push({ asset: a, mission: o.mission, state: 'fading', why: 'worn', regions: served });
  }

  // Forecast regions left without missile warning for part of the window.
  const up = all.filter((a) => a.orbit!.mission === 'warning' && missionUp(s, a));
  for (const r of regions) {
    const blind = Array.from({ length: window }, (_, h) => start + h).filter((h) => !up.some((a) => warnsOver(s, a.orbit!, r, h)));
    if (blind.length < SPACE.gapMinH) continue;
    let fix: WarningGap['fix'];
    // A worn or jammed warning satellite that normally covers it: getting it back is the fix.
    const lost = out.watch.find((w) => w.mission === 'warning' && w.state === 'down' && w.regions.includes(r));
    if (lost) fix = { kind: 'service', asset: lost.asset };
    else if (s.projects.some((p) => p.investmentId === 'launch_warning' && p.region === r)) fix = { kind: 'launching' };
    else {
      // A geostationary warning satellite that could drift over without uncovering another forecast region.
      const lon = Math.round(s.regions[r].center[0]);
      const moves = up
        .filter((a) => a.orbit!.regime === 'GEO' && !repositionError(s, a, lon))
        .map((a) => {
          const there: Orbit = { ...a.orbit!, lon, drift: undefined };
          const d = Math.abs(wrap(lon - a.orbit!.lon!));
          return { a, there, d };
        })
        .filter(({ a, there }) => inViewAt(s, there, start).includes(r)
          && regions.every((x) => x === r || !inViewAt(s, a.orbit!, start).includes(x) || inViewAt(s, there, start).includes(x)
            || up.some((b) => b !== a && inViewAt(s, b.orbit!, start).includes(x))))
        .sort((p, q) => p.d - q.d);
      fix = moves.length ? { kind: 'move', asset: moves[0].a, lon, hours: driftHours(moves[0].d), fuel: Math.ceil(driftFuel(moves[0].d)) } : { kind: 'launch', region: r };
    }
    out.gaps.push({ region: r, hours: blind.length, window, from: blind[0], fix });
  }
  outlookCache.set(s, { key, v: out });
  return out;
}
