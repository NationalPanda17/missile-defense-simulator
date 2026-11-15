// Threat variants: each of the six threat classes comes in a few real-world types. Designations are public; the
// traits are game values, a best guess from public descriptions, not measured performance. A variant only adjusts its
// class (which still decides which systems can engage it, its altitude and its radar picture), so every class rule
// keeps working. Tracks without a variant (older saves, lessons, raids) behave as the class's baseline.
import { enemyStyleOf } from './config';
import { hash01 } from './weather';
import type { SimState, ThreatClass, Track } from './types';

export interface ThreatTraits {
  /** × sensor detection range (a smaller radar signature is seen later). */
  sig?: number;
  /** × speed (less time for each system to fire). */
  speed?: number;
  /** × the chance each shot stops it (manoeuvring, hard to hit). */
  evade?: number;
  /** × damage when it gets through. */
  damage?: number;
  /** Launched in a group: one pick becomes this many threats. */
  group?: number;
  /** Homes on the defender's radars rather than a site. */
  hunt?: boolean;
  /** Releases this many decoys on its way in. */
  decoys?: number;
  /** Chance it misses its target entirely when it gets through (unguided). */
  miss?: number;
}

export interface ThreatVariant {
  id: string;
  cls: ThreatClass;
  /** What it is, in words. */
  name: string;
  /** The real-world designation. */
  designation: string;
  /** First campaign phase (index) it appears in; baselines appear from the start. */
  from: number;
  /** Relative share within its class once it appears. */
  weight: number;
  traits: ThreatTraits;
  /** One line on what makes it different, and one on what beats it. */
  text: string;
  counter: string;
}

export const THREAT_VARIANTS: ThreatVariant[] = [
  {
    id: 'shahed-136', cls: 'slowDrone', name: 'Loitering munition', designation: 'Shahed-136', from: 0, weight: 6, traits: {},
    text: 'A slow, propeller-driven one-way attack drone. The standard slow drone.',
    counter: 'Guns, jammers and short-range missiles.',
  },
  {
    id: 'lancet', cls: 'slowDrone', name: 'Small loitering drone', designation: 'Lancet-3', from: 1, weight: 3, traits: { group: 3, damage: 0.4, sig: 0.7 },
    text: 'Small and hard to see. Comes in threes, each doing little damage alone.',
    counter: 'Guns with deep magazines. Costly missiles are wasted on them; set big interceptors to “Missiles only”.',
  },
  {
    id: 'harop', cls: 'slowDrone', name: 'Radar-hunting drone', designation: 'Harop', from: 1, weight: 2, traits: { hunt: true },
    text: 'Listens for radar emissions and dives on the radar instead of a city.',
    counter: 'Point defense beside your radars, passive sensors, or a radar switched to silent.',
  },
  {
    id: 'shahed-238', cls: 'fastDrone', name: 'Jet-powered attack drone', designation: 'Shahed-238', from: 0, weight: 1, traits: {},
    text: 'A jet-engined version of the loitering munition: much faster, same small warhead.',
    counter: 'Fast-reacting guns and short-range missiles.',
  },
  {
    id: 'kalibr', cls: 'cruise', name: 'Land-attack cruise missile', designation: '3M-14 Kalibr', from: 0, weight: 6, traits: {},
    text: 'Subsonic and low-flying, hugging the ground to stay under radar. The standard cruise missile.',
    counter: 'An airborne radar to see it early, and medium-range missiles.',
  },
  {
    id: 'kh-101', cls: 'cruise', name: 'Low-observable cruise missile', designation: 'Kh-101', from: 1, weight: 3, traits: { sig: 0.7 },
    text: 'Shaped to show a small radar signature: every sensor sees it at about 70% of the usual range.',
    counter: 'Overlapping sensors, sharp short-wave radars and an airborne radar.',
  },
  {
    id: 'brahmos', cls: 'cruise', name: 'Supersonic cruise missile', designation: 'BrahMos', from: 2, weight: 2, traits: { speed: 3.5, damage: 1.2 },
    text: 'Nearly three times the speed of sound: each system gets far less time to fire.',
    counter: 'Layered defense so several systems get a chance, and a raised alert for faster reactions.',
  },
  {
    id: 'fajr-5', cls: 'rocket', name: 'Heavy artillery rocket', designation: 'Fajr-5', from: 0, weight: 5, traits: {},
    text: 'A large-calibre rocket fired from a truck-mounted launcher. The standard rocket.',
    counter: 'Iron Dome and other short-range interceptors, or guns close to the site.',
  },
  {
    id: 'grad', cls: 'rocket', name: 'Unguided light rocket', designation: 'BM-21 Grad', from: 1, weight: 3, traits: { group: 2, damage: 0.8, miss: 0.35 },
    text: 'Cheap and fired in pairs, but unguided: about a third of those that get through land wide and do no harm.',
    counter: 'Cheap interceptors and guns; set costly systems to “Backup” so the cheap ones fire first.',
  },
  {
    id: 'tornado-s', cls: 'rocket', name: 'Guided long-range rocket', designation: '9M542 Tornado-S', from: 1, weight: 3, traits: { damage: 1.3 },
    text: 'Satellite-guided: fewer of them, but every one that gets through hits, and hits harder.',
    counter: 'Point defense close to the sites that matter.',
  },
  {
    id: 'scud-b', cls: 'ballistic', name: 'Short-range ballistic missile', designation: 'R-17 Scud-B', from: 0, weight: 5, traits: {},
    text: 'An older ballistic missile on a predictable arc. The standard ballistic missile.',
    counter: 'Upper-tier interceptors such as Patriot, THAAD or David’s Sling.',
  },
  {
    id: 'iskander', cls: 'ballistic', name: 'Quasi-ballistic missile with decoys', designation: '9M723 Iskander-M', from: 1, weight: 3, traits: { decoys: 1, evade: 0.9 },
    text: 'Flies a flattened, manoeuvring path and releases decoys on the way in.',
    counter: 'Sharp radars to sort out the decoys, and more than one interceptor in reach.',
  },
  {
    id: 'df-21', cls: 'ballistic', name: 'Manoeuvring re-entry vehicle', designation: 'DF-21 (MaRV)', from: 2, weight: 2, traits: { evade: 0.7, damage: 1.2 },
    text: 'Its warhead steers in the last seconds, so each interceptor hits less often.',
    counter: 'Two layers of upper-tier interceptors, so a miss gets a second chance.',
  },
  {
    id: 'df-17', cls: 'hypersonic', name: 'Hypersonic glide vehicle', designation: 'DF-17', from: 0, weight: 3, traits: {},
    text: 'Boosted high, then glides in at hypersonic speed and turns in flight. The standard hypersonic threat.',
    counter: 'Only the best upper-tier interceptors have a chance; layer them.',
  },
  {
    id: 'zircon', cls: 'hypersonic', name: 'Hypersonic cruise missile', designation: '3M22 Zircon', from: 3, weight: 2, traits: { sig: 0.8, damage: 1.1 },
    text: 'Air-breathing and flying lower than a glider, so radars pick it up later.',
    counter: 'Long-wave and airborne radars that see it early, and layered upper-tier interceptors.',
  },
];

export const VARIANT_MAP = new Map(THREAT_VARIANTS.map((v) => [v.id, v]));
export const variantsOf = (cls: ThreatClass) => THREAT_VARIANTS.filter((v) => v.cls === cls);
/** The variant a class defaults to (older saves, lessons and raids). */
export const baseVariant = (cls: ThreatClass) => variantsOf(cls).find((v) => v.from === 0)!;

/** A track's variant, or its class's baseline. */
export const variantOf = (tr: Pick<Track, 'cls' | 'variant'>) => (tr.variant && VARIANT_MAP.get(tr.variant)) || baseVariant(tr.cls);
export const traitsOf = (tr: Pick<Track, 'cls' | 'variant'>): ThreatTraits => variantOf(tr).traits;

/** "Low-observable cruise missile (Kh-101)". */
export const variantLabel = (v: ThreatVariant) => `${v.name} (${v.designation})`;
export const trackLabel = (tr: Pick<Track, 'cls' | 'variant'>) => variantLabel(variantOf(tr));

/**
 * The extra types this game brings in, one per later phase: phases 2, 3 and 4 of a campaign each add one (a phase
 * later on Recruit, so it meets two). Chosen from the seed, with the enemy commander's favourites likelier, so which
 * types appear changes from campaign to campaign. Sandbox and crisis (one long phase) get two from the start.
 */
export function introducedVariants(s: SimState): { id: string; phase: number }[] {
  const prefer = enemyStyleOf(s.settings).variants ?? {};
  const out: { id: string; phase: number }[] = [];
  const pickFrom = (maxFrom: number, salt: number) => {
    const pool = THREAT_VARIANTS.filter((v) => v.from > 0 && v.from <= maxFrom && !out.some((x) => x.id === v.id));
    const total = pool.reduce((a, v) => a + v.weight * (prefer[v.id] ?? 1), 0);
    let x = hash01(s.settings.seed, salt, 0x55) * total;
    for (const v of pool) { x -= v.weight * (prefer[v.id] ?? 1); if (x <= 0) return v; }
    return pool[pool.length - 1];
  };
  if (s.settings.mode !== 'campaign') {
    for (const k of [1, 2]) { const v = pickFrom(2, k); if (v) out.push({ id: v.id, phase: 0 }); }
    return out;
  }
  const delay = s.settings.level === 'recruit' ? 1 : 0;
  for (let k = 1; k <= 3; k++) {
    if (k + delay > 3) break;
    const v = pickFrom(k, k);
    if (v) out.push({ id: v.id, phase: k + delay });
  }
  return out;
}

/** The first phase a variant appears in for this game (Infinity if this game never uses it). */
export function variantFrom(s: SimState, v: ThreatVariant): number {
  if (v.from === 0) return 0;
  return introducedVariants(s).find((x) => x.id === v.id)?.phase ?? Infinity;
}

/** The variants that can appear now, for a class. */
export function variantsNow(s: SimState, cls: ThreatClass): ThreatVariant[] {
  const intro = introducedVariants(s);
  return variantsOf(cls).filter((v) => v.from === 0 || intro.some((x) => x.id === v.id && x.phase <= s.phaseIndex));
}

/**
 * Pick a variant for a new track from the seed (never the game's random stream, so everything else plays as
 * before). `prefer` multiplies some variants' weights: the enemy commander's taste and the adapting enemy's choice.
 */
export function pickVariant(s: SimState, cls: ThreatClass, salt: number[], prefer: Record<string, number> = {}): ThreatVariant {
  const options = variantsNow(s, cls);
  const total = options.reduce((a, v) => a + v.weight * (prefer[v.id] ?? 1), 0);
  let x = hash01(s.settings.seed, ...salt, 0x7a) * total;
  for (const v of options) {
    x -= v.weight * (prefer[v.id] ?? 1);
    if (x <= 0) return v;
  }
  return options[options.length - 1];
}
