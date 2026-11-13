// Commander only: the enemy learns from what happened in earlier phases and adapts its next one. It never sees the
// player's current choices, only what it could have observed in past fighting, so there is always a phase to answer.
// Decided from the scenario seed and past results (never the game's random streams), so replays stay identical.
import { EQUIPMENT_MAP } from './equipment';
import { isUnlimited, regionProtection } from './tactical';
import { hash01 } from './weather';
import { REGION_IDS, type EnemyPlan, type RegionId, type SimState, type ThreatAxis, type ThreatClass, type ThreatWave } from './types';

export const ADAPTATION = {
  /** How far the enemy shifts its weapon mix toward what got through (×0.6 to ×1.4 per threat type). */
  mixShift: 0.4,
  /** Extra forecast weight for a region it saw thinly defended, and the weight taken from a fortress. */
  thinBonus: 20,
  strongPenalty: 8,
  /** Chance a wave into a region uses the approach that worked best there before. */
  axisPreference: 0.7,
  /** Decoy multiplier when the defense wasted many rounds on decoys. */
  decoyBoost: 1.5,
  /** Share of all rounds fired at decoys that counts as "many". */
  decoyWaste: 0.15,
  /** Chance the briefing's intel line gets the enemy's plan wrong. */
  intelError: 0.3,
};

const CLASSES: ThreatClass[] = ['slowDrone', 'fastDrone', 'cruise', 'rocket', 'ballistic'];
const PLURAL: Record<ThreatClass, string> = { slowDrone: 'slow drones', fastDrone: 'fast drones', cruise: 'cruise missiles', rocket: 'rockets', ballistic: 'ballistic missiles' };

export const adaptiveEnemy = (s: SimState) => s.settings.mode === 'campaign' && s.settings.level === 'commander' && !!s.tactical?.enabled;

/** The plan for the current phase, worked out once when its briefing opens. */
export function enemyPlan(s: SimState): EnemyPlan | undefined {
  const t = s.tactical;
  if (!t || !adaptiveEnemy(s) || s.phaseIndex === 0) return undefined;
  const known = t.enemy?.find((p) => p.phaseIndex === s.phaseIndex);
  if (known) return known;
  const past = t.waves.filter((w) => w.resolved && w.phaseIndex < s.phaseIndex);
  if (!past.length) return undefined;
  const plan = learn(s, past);
  t.enemy = [...(t.enemy ?? []), plan];
  return plan;
}

function learn(s: SimState, past: ThreatWave[]): EnemyPlan {
  const seed = s.settings.seed;
  const recent = (w: ThreatWave) => (w.phaseIndex === s.phaseIndex - 1 ? 1 : 0.5); // the last phase counts most
  const learned: string[] = [];

  // 1. Weapon mix: more of what got through, less of what was stopped.
  const seen: Record<string, number> = {}, leaked: Record<string, number> = {};
  for (const w of past) for (const tr of w.tracks) {
    if (tr.decoy) continue;
    seen[tr.cls] = (seen[tr.cls] ?? 0) + recent(w);
    if (tr.outcome === 'leaked') leaked[tr.cls] = (leaked[tr.cls] ?? 0) + recent(w);
  }
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  const avg = total ? Object.values(leaked).reduce((a, b) => a + b, 0) / total : 0;
  const mix = Object.fromEntries(CLASSES.map((c) => {
    if ((seen[c] ?? 0) < 3) return [c, 1];
    const rate = (leaked[c] ?? 0) / seen[c];
    return [c, Math.min(1 + ADAPTATION.mixShift, Math.max(1 - ADAPTATION.mixShift, 1 + (rate - avg) * 2))];
  })) as Record<ThreatClass, number>;
  const favored = [...CLASSES].sort((a, b) => mix[b] - mix[a])[0];
  const dropped = [...CLASSES].sort((a, b) => mix[a] - mix[b])[0];
  if (mix[favored] > 1.1) learned.push(`${cap(PLURAL[favored])} got through your defenses, so it sent more of them.`);
  if (mix[dropped] < 0.9) learned.push(`Your defenses stopped its ${PLURAL[dropped]}, so it used fewer.`);

  // 2. Targets: thin regions draw attacks, fortresses fewer (but still some probing).
  const target: Partial<Record<RegionId, number>> = {};
  for (const r of REGION_IDS) {
    const level = regionProtection(s, r).level;
    if (level === 'exposed' || level === 'thin') target[r] = ADAPTATION.thinBonus * (level === 'exposed' ? 1 : 0.6);
    else if (level === 'protected') target[r] = -ADAPTATION.strongPenalty;
  }
  // Regions it actually fought in and found weak count for more than ones it only scouted.
  for (const r of REGION_IDS) {
    const ws = past.filter((w) => w.region === r && w.phaseIndex === s.phaseIndex - 1);
    const real = ws.flatMap((w) => w.tracks.filter((x) => !x.decoy));
    if (real.length >= 3 && real.filter((x) => x.outcome === 'leaked').length / real.length >= 0.5) target[r] = (target[r] ?? 0) + 20;
  }
  const weakest = REGION_IDS.filter((r) => (target[r] ?? 0) > 0).sort((a, b) => (target[b] ?? 0) - (target[a] ?? 0))[0];
  const thin = REGION_IDS.filter((r) => (target[r] ?? 0) > 0);
  if (thin.length >= 5) learned.push('Most regions were lightly defended, so it kept up the pressure everywhere, hardest on the ones it had already hit.');
  else if (weakest) learned.push(`It saw ${s.regions[weakest].name} was lightly defended and pressed there.`);

  // 3. Approach: the direction that got through best, per region.
  const axis: Partial<Record<RegionId, ThreatAxis>> = {};
  for (const r of REGION_IDS) {
    const score = new Map<ThreatAxis, number>();
    for (const w of past.filter((x) => x.region === r)) {
      const real = w.tracks.filter((x) => !x.decoy);
      if (!real.length) continue;
      score.set(w.axis, (score.get(w.axis) ?? 0) + recent(w) * real.filter((x) => x.outcome === 'leaked').length / real.length);
    }
    const best = [...score].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0.3) axis[r] = best[0];
  }

  // 4. Saturation: a region that stopped nearly everything but has magazines running low gets a quick second strike.
  let doubleTap: RegionId | undefined;
  let lowest = 1;
  for (const r of REGION_IDS) {
    const real = past.filter((w) => w.region === r && w.phaseIndex === s.phaseIndex - 1).flatMap((w) => w.tracks.filter((x) => !x.decoy));
    if (real.length < 3 || real.filter((x) => x.outcome === 'stopped').length / real.length < 0.8) continue;
    const mags = s.tactical!.deployments.filter((d) => d.region === r).map((d) => EQUIPMENT_MAP.get(d.equipmentId)!).filter((sp) => sp && !isUnlimited(sp));
    if (!mags.length) continue;
    const share = s.tactical!.deployments.filter((d) => d.region === r).reduce((a, d) => {
      const sp = EQUIPMENT_MAP.get(d.equipmentId);
      return sp && !isUnlimited(sp) ? a + d.stock / sp.magazine : a;
    }, 0) / mags.length;
    if (share < 0.5 && share < lowest) { lowest = share; doubleTap = r; }
  }
  if (doubleTap) learned.push(`${s.regions[doubleTap].name} stopped its attacks but ran its magazines low, so it planned two waves back to back there.`);

  // 5. Decoys: if the defense fired a lot at decoys, send more.
  const last = past.filter((w) => w.phaseIndex === s.phaseIndex - 1);
  const shots = last.flatMap((w) => w.tracks).reduce((a, x) => a + x.shots, 0);
  const wasted = last.flatMap((w) => w.tracks.filter((x) => x.decoy)).reduce((a, x) => a + x.shots, 0);
  const decoys = shots > 0 && wasted / shots >= ADAPTATION.decoyWaste ? ADAPTATION.decoyBoost : 1;
  if (decoys > 1) learned.push(`About ${Math.round((wasted / shots) * 100)}% of your rounds went at decoys, so it brought more of them.`);

  if (!learned.length) learned.push('It found no clear weakness and kept its approach.');

  // The intel line: right most of the time, wrong about the weapon or the place sometimes.
  const wrong = hash01(seed, s.phaseIndex, 0x1e) < ADAPTATION.intelError;
  const shifted = mix[favored] > 1.05;
  // With no change in weapons to report, intel can only be wrong about the place.
  const which = shifted && hash01(seed, s.phaseIndex, 0x1f) < 0.5 ? 'weapon' : 'place';
  let cls: ThreatClass = favored;
  let place = weakest ?? REGION_IDS[Math.floor(hash01(seed, s.phaseIndex, 0x21) * REGION_IDS.length)];
  const truth = wrong && which === 'weapon' ? `It actually sent more ${PLURAL[favored]}.` : wrong ? `Its main target was actually ${s.regions[place].name}.` : undefined;
  if (wrong && which === 'weapon') {
    const others = CLASSES.filter((c) => c !== cls);
    cls = others[Math.floor(hash01(seed, s.phaseIndex, 0x22) * others.length)];
  } else if (wrong) {
    const others = REGION_IDS.filter((r) => r !== place);
    place = others[Math.floor(hash01(seed, s.phaseIndex, 0x23) * others.length)];
  }
  const dir = axis[place];
  const what = shifted || (wrong && which === 'weapon') ? `more ${PLURAL[cls]}` : 'a similar mix of threats';
  const text = `Analysts expect ${what}${dir ? `, mostly from the ${dir}` : ''}, with ${s.regions[place].name} the likeliest target.`;

  return { phaseIndex: s.phaseIndex, mix, target, axis, doubleTap, decoys, learned, intel: { text, accurate: !wrong, ...(truth ? { actual: truth } : {}) } };
}

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
