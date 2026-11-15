// The Raid Designer's rules: what a player-written raid may contain, what each choice costs the attacker, and how a
// raid travels between players as a code. Pure, and strict about what it accepts: a code is text from someone else.
import { TACTICAL_CONFIG } from './config';
import { RADAR_BANDS, THREAT_CLASSES, type RadarBand } from './equipment';
import { REGION_IDS, type Raid, type RaidSize, type RaidWave, type SimState, type ThreatAxis, type ThreatClass } from './types';

const R = TACTICAL_CONFIG.raid;
export const RAID_AXES: ThreatAxis[] = ['north', 'east', 'south', 'west'];
export const RAID_SIZES = Object.keys(R.sizes) as RaidSize[];
export const RAID_BANDS = Object.keys(RADAR_BANDS) as RadarBand[];
export const RAID_ROUTES = ['direct', 'turn', 'valley'] as const;

export const raidPoints = (raid: Pick<Raid, 'size'>) => R.sizes[raid.size ?? 'standard'].points;
export const raidThreats = (w: RaidWave) => THREAT_CLASSES.reduce((a, c) => a + (w.tracks[c] ?? 0), 0);

/** What one wave costs: its threats, and the options bought for it. */
export function waveCost(w: RaidWave): { threats: number; options: number; total: number } {
  const threats = THREAT_CLASSES.reduce((a, c) => a + (w.tracks[c] ?? 0) * TACTICAL_CONFIG.threatCost[c], 0);
  const options = (w.axis2 ? R.secondAxis : 0) + (w.route === 'turn' ? R.turn : w.route === 'valley' ? R.valley : 0) + (w.hunt ? R.hunt : 0)
    + (w.decoys ?? 0) * R.decoy + (w.hidden ? Math.ceil(threats * R.hidden) : 0);
  return { threats, options, total: threats + options };
}

export const raidCost = (raid: Raid) => raid.waves.reduce((a, w) => a + waveCost(w).total, 0) + (raid.jam ? R.jam : 0) + (raid.reserve ?? 0);
/** The most that may be held in reserve for a raid of this size. */
export const maxReserve = (raid: Pick<Raid, 'size'>) => Math.floor(raidPoints(raid) * R.maxReserveShare);

/** Why a raid cannot be sent yet, in plain words; empty when it is ready. */
export function raidProblems(raid: Raid): string[] {
  const out: string[] = [];
  const cost = raidCost(raid);
  if (cost > raidPoints(raid)) out.push(`It costs ${cost} attack points and you have ${raidPoints(raid)}.`);
  raid.waves.forEach((w, i) => { if (raidThreats(w) === 0) out.push(`Wave ${i + 1} has no threats in it.`); });
  if (raid.waves.length && raid.waves.every((w) => w.hidden)) out.push('At least one wave must appear in the defender’s forecast.');
  return out;
}

const int = (x: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(x));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const text = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '') || undefined;

/**
 * A raid made safe to play from anything at all (a pasted code, an old save): every number clamped, every choice
 * checked against the list it comes from, everything unknown dropped. Null when it is not a raid or breaks the rules.
 */
export function cleanRaid(x: unknown): Raid | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!REGION_IDS.includes(o.region as never) || !Array.isArray(o.waves) || !o.waves.length || o.waves.length > R.maxWaves) return null;
  const waves: RaidWave[] = (o.waves as Record<string, unknown>[]).map((w) => {
    const tr = (w?.tracks ?? {}) as Record<string, unknown>;
    const axis = RAID_AXES.includes(w?.axis as never) ? (w.axis as ThreatAxis) : 'north';
    const out: RaidWave = {
      atHour: int(w?.atHour, R.hours[0], R.hours[1], 8), axis,
      tracks: Object.fromEntries(THREAT_CLASSES.map((c) => [c, int(tr[c], 0, R.maxPerClass, 0)]).filter(([, n]) => n)) as RaidWave['tracks'],
    };
    if (RAID_AXES.includes(w?.axis2 as never) && w.axis2 !== axis) out.axis2 = w.axis2 as ThreatAxis;
    if (typeof w?.target === 'string' && /^[A-Z]{3}-S\d{1,2}$/.test(w.target) && w.target.startsWith(`${o.region}-`)) out.target = w.target;
    if (w?.hunt === true) out.hunt = true;
    if (w?.route === 'turn' || w?.route === 'valley') out.route = w.route;
    const decoys = int(w?.decoys, 0, R.maxDecoys, 0);
    if (decoys) out.decoys = decoys;
    if (w?.hidden === true) out.hidden = true;
    return out;
  });
  const raid: Raid = { region: o.region as Raid['region'], waves };
  if (RAID_SIZES.includes(o.size as never) && o.size !== 'standard') raid.size = o.size as RaidSize;
  if (RAID_BANDS.includes(o.jam as never)) raid.jam = o.jam as string;
  if (o.seed !== undefined) raid.seed = int(o.seed, 0, 999_999_999, 0);
  const reserve = int(o.reserve, 0, maxReserve(raid), 0);
  if (reserve) raid.reserve = reserve;
  const name = text(o.name, 40);
  const note = text(o.note, 140);
  if (name) raid.name = name;
  if (note) raid.note = note;
  return raidProblems(raid).length ? null : raid;
}

/** A raid as a code to paste to someone else. */
export function encodeRaid(raid: Raid): string {
  const { attacker: _attacker, byCode: _byCode, defender: _defender, ...rest } = raid;
  const bytes = new TextEncoder().encode(JSON.stringify(rest));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The raid in a pasted code, or null if it is not one. */
export function decodeRaid(code: string): Raid | null {
  try {
    const bin = atob(code.trim());
    return cleanRaid(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))));
  } catch { return null; }
}

export interface RaidReport {
  spent: number; // attack points the raid cost
  sent: number; // genuine threats
  through: number; // of those, how many got through
  damage: number; // site integrity destroyed
  radarsHit: number; // defending systems struck
  defenderSpent: number; // credits of interceptor rounds fired
  waves: { sent: number; through: number; damage: number; hidden: boolean; done: boolean }[];
}

/** The battle from the attacker's side: what the raid cost and what it bought. */
export function raidReport(s: SimState): RaidReport | null {
  const raid = s.settings.raid;
  const t = s.tactical;
  if (!raid || !t) return null;
  const waves = t.waves.filter((w) => w.phaseIndex === 0).map((w) => {
    const real = w.tracks.filter((x) => !x.decoy);
    return {
      sent: real.length, through: real.filter((x) => x.outcome === 'leaked').length,
      damage: real.reduce((a, x) => a + (x.depTarget ? 0 : x.damage ?? 0), 0), hidden: !w.forecast, done: !!w.applied,
      hits: real.filter((x) => x.depTarget && x.outcome === 'leaked').length, cost: w.tracks.reduce((a, x) => a + (x.cost ?? 0), 0),
    };
  });
  return {
    spent: raidCost(raid), sent: waves.reduce((a, w) => a + w.sent, 0), through: waves.reduce((a, w) => a + w.through, 0),
    damage: Math.round(waves.reduce((a, w) => a + w.damage, 0)), radarsHit: waves.reduce((a, w) => a + w.hits, 0),
    defenderSpent: Math.round(waves.reduce((a, w) => a + w.cost, 0)),
    waves: waves.map(({ sent, through, damage, hidden, done }) => ({ sent, through, damage: Math.round(damage), hidden, done })),
  };
}

// ── The reserve: one more wave, written after seeing how the others did ──────────────────────

/** A reserve wave is plain: threats, a side and, if wanted, one site. */
export type ReserveWave = Pick<RaidWave, 'axis' | 'tracks' | 'target'>;

/** Hours from sending a reserve wave to its arrival: an hour to launch, then its slowest threat's flight. */
export const reserveLead = (w: Pick<RaidWave, 'tracks'>) =>
  1 + Math.ceil(Math.max(0, ...THREAT_CLASSES.filter((c) => w.tracks[c]).map((c) => TACTICAL_CONFIG.flightHours[c])));

/** Where the reserve stands: how many points, and whether it can be sent now (and if not, why). */
export function reserveStatus(s: SimState): { points: number; ready: boolean; why: string } | null {
  const raid = s.settings.raid;
  const t = s.tactical;
  if (!raid?.reserve || !t) return null;
  const points = raid.reserve;
  if (t.reserveSpent) return { points, ready: false, why: 'The reserve has been sent.' };
  if (s.status !== 'running') return { points, ready: false, why: s.status === 'complete' ? 'The battle is over; the reserve was never sent.' : 'The reserve can be sent once the battle is under way.' };
  if (!t.waves.some((w) => w.applied)) return { points, ready: false, why: 'The reserve can be sent once the first wave has landed.' };
  const end = s.phaseStartHour + s.phases[s.phaseIndex].hours;
  if (s.hour + 2 > end - 1) return { points, ready: false, why: 'Too late: a reserve wave could not arrive before the battle ends.' };
  return { points, ready: true, why: '' };
}

/** Why a reserve wave cannot be sent, or null if it can. */
export function reserveProblem(s: SimState, w: ReserveWave): string | null {
  const st = reserveStatus(s);
  if (!st) return 'This raid has no reserve.';
  if (!st.ready) return st.why;
  const cost = waveCost({ atHour: 0, ...w }).threats;
  if (!raidThreats({ atHour: 0, ...w })) return 'The reserve wave has no threats in it.';
  if (cost > st.points) return `That costs ${cost} attack points and the reserve is ${st.points}.`;
  if (THREAT_CLASSES.some((c) => (w.tracks[c] ?? 0) > R.maxPerClass)) return `No more than ${R.maxPerClass} of one kind of threat in a wave.`;
  if (s.hour + reserveLead(w) > s.phaseStartHour + s.phases[s.phaseIndex].hours - 1) return 'Too late for those threats to arrive before the battle ends: send faster ones.';
  return null;
}

/**
 * The reserve wave the game writes for an author who is not at the keyboard (a raid played from a code): more of
 * whatever got through best for its cost, from the side that did best, with any change spent on drones.
 */
export function autoReserveWave(s: SimState): ReserveWave | null {
  const raid = s.settings.raid;
  const t = s.tactical;
  if (!raid?.reserve || !t) return null;
  const done = t.waves.filter((w) => w.applied);
  const sent: Partial<Record<ThreatClass, number>> = {};
  const through: Partial<Record<ThreatClass, number>> = {};
  for (const w of done) for (const tr of w.tracks) {
    if (tr.decoy) continue;
    sent[tr.cls] = (sent[tr.cls] ?? 0) + 1;
    if (tr.outcome === 'leaked') through[tr.cls] = (through[tr.cls] ?? 0) + 1;
  }
  const end = s.phaseStartHour + s.phases[s.phaseIndex].hours - 1;
  const inTime = (c: ThreatClass) => s.hour + reserveLead({ tracks: { [c]: 1 } }) <= end;
  // Damage bought per point, on the evidence so far (a threat never sent is assumed to get through half the time).
  const worth = (c: ThreatClass) => ((sent[c] ? (through[c] ?? 0) / sent[c]! : 0.5) + 0.05) * TACTICAL_CONFIG.threatDamage[c] / TACTICAL_CONFIG.threatCost[c];
  const order = THREAT_CLASSES.filter(inTime).sort((a, b) => worth(b) - worth(a));
  if (!order.length) return null;
  const tracks: Partial<Record<ThreatClass, number>> = {};
  let left = raid.reserve;
  for (const c of order) {
    const n = Math.min(R.maxPerClass, Math.floor(left / TACTICAL_CONFIG.threatCost[c]));
    if (n > 0) { tracks[c] = n; left -= n * TACTICAL_CONFIG.threatCost[c]; }
  }
  if (!THREAT_CLASSES.some((c) => tracks[c])) return null;
  const best = [...done].sort((a, b) => {
    const rate = (w: typeof a) => { const real = w.tracks.filter((x) => !x.decoy); return real.length ? real.filter((x) => x.outcome === 'leaked').length / real.length : 0; };
    return rate(b) - rate(a);
  })[0];
  return { axis: best?.axis ?? raid.waves[0].axis, tracks };
}
