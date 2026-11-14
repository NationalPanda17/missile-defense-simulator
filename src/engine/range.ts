// The practice range: one system, one threat, one engagement, with every die shown. A throwaway scenario is built
// for the shot, so nothing here touches a real game.
import { EQUIPMENT_MAP, THREAT_LABELS, isEffector, sensorTraits } from './equipment';
import { addDeployment, engageRange, isLowFlying, reasonText, resolveTrack, spotNear } from './tactical';
import { lessonSettings } from './training';
import { TACTICAL_CONFIG } from './config';
import { createInitialState, defaultSettings } from './world';
import type { ThreatClass, ThreatWave, Track } from './types';

export interface RangeOptions {
  equipmentId: string;
  cls: ThreatClass;
  /** How far (km) from the system the threat's path passes at its closest. */
  offsetKm: number;
  /** A separate radar beside the system to track for it: a radar's equipment id, or none. */
  sensorId?: string;
  alert?: boolean;
  /** Changes the dice. */
  seed: number;
}

export interface RangeResult {
  stopped: boolean;
  lines: { tone: 'info' | 'good' | 'bad'; text: string }[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Fire one engagement on the range and explain it step by step. */
export function practiceShot(o: RangeOptions): RangeResult {
  const spec = EQUIPMENT_MAP.get(o.equipmentId);
  const lines: RangeResult['lines'] = [];
  if (!spec || !isEffector(spec)) return { stopped: false, lines: [{ tone: 'bad', text: 'Pick a system that can shoot.' }] };
  const s = createInitialState({ ...lessonSettings('tactical1', defaultSettings('training')), seed: 9000 });
  const t = s.tactical!;
  t.waves = [];
  t.deployments = [];
  t.recordRolls = true;
  t.rng = (o.seed * 2654435761 + 17) >>> 0;
  const region = 'EUR';
  const terrain = t.terrain?.[region];
  if (terrain) { terrain.massifs = []; terrain.valleys = []; terrain.cities = []; } // a flat, empty range
  const { width, height } = TACTICAL_CONFIG.theaterKm;
  const home = spotNear(s, spec, region, width / 2, height / 2) ?? [width / 2, height / 2];
  s.status = 'briefing';
  const d = addDeployment(s, spec, region, home[0], home[1], 0);
  const sensor = o.sensorId ? EQUIPMENT_MAP.get(o.sensorId) : undefined;
  if (sensor) {
    const sp = spotNear(s, sensor, region, home[0] + 2, home[1] + 2) ?? [home[0] + 2, home[1] + 2];
    addDeployment(s, sensor, region, sp[0], sp[1], 0);
  }
  s.status = 'running';
  if (o.alert) t.alerts = [{ region, until: s.hour + 8 }];
  // The threat flies west to east, passing `offsetKm` north of the system.
  const y = Math.max(5, Math.min(height - 5, home[1] - o.offsetKm));
  const tr: Track = { id: 'RANGE-1', cls: o.cls, siteId: t.sites.find((x) => x.region === region)!.id, from: [0, y], aim: [width, y], decoy: false, shots: 0 };
  const w: ThreatWave = { id: 'RANGE', region, phaseIndex: 0, atHour: s.hour + 1, launchAt: s.hour, axis: 'west', forecast: true, tracks: [tr], resolved: false };
  resolveTrack(s, t, w, tr, t.deployments.filter((x) => x.region === region), new Map());

  const name = THREAT_LABELS[o.cls].toLowerCase();
  lines.push({ tone: 'info', text: `A ${name} crosses the range ${o.offsetKm} km from ${spec.name}${isLowFlying(o.cls) ? ', flying low' : `, at ${TACTICAL_CONFIG.threatAltitudeKm[o.cls]} km up`}.` });
  const why = (tr.why ?? []).find((x) => Array.isArray(x) && x[0] === d.id) as [string, string] | undefined;
  if (spec.altitudeKm < TACTICAL_CONFIG.threatAltitudeKm[o.cls]) {
    lines.push({ tone: 'bad', text: `Ceiling: ${spec.name} reaches ${spec.altitudeKm} km, and this threat is engaged at ${TACTICAL_CONFIG.threatAltitudeKm[o.cls]} km. It cannot touch it.` });
  } else if (spec.killRate[o.cls] <= 0) {
    lines.push({ tone: 'bad', text: `${spec.name} cannot engage ${name}s at all.` });
  } else {
    const reach = engageRange(terrain, d, spec);
    const lowReach = isLowFlying(o.cls) ? Math.min(reach, TACTICAL_CONFIG.lowAltitude.horizonKm) : reach;
    lines.push({
      tone: o.offsetKm <= lowReach ? 'good' : 'bad',
      text: isLowFlying(o.cls) && reach > lowReach
        ? `Reach: its range is ${reach} km, but against a low flier only the radar horizon counts, ${lowReach} km. The path passes ${o.offsetKm} km away: ${o.offsetKm <= lowReach ? 'inside' : 'outside'}.`
        : `Reach: its range is ${Math.round(reach * 10) / 10} km and the path passes ${o.offsetKm} km away: ${o.offsetKm <= reach ? 'inside' : 'outside'}.`,
    });
    lines.push({
      tone: tr.detected ? 'good' : 'bad',
      text: tr.detected
        ? `Seen: tracked by ${tr.band === 'passive' ? 'a passive sensor' : `${tr.band}-band radar`}${sensor && !spec.radar ? ` (${sensor.name}, whose track is worth ${pct(sensorTraits(sensor).cue)} of a system’s own)` : ''}. It reacts at normal speed.`
        : `Not seen: ${spec.radar ? 'its radar never picked the threat up' : `${spec.name} has no radar and nothing else was watching`}. It reacts twice as slowly and hits less than half as often.`,
    });
  }
  for (const roll of tr.rolls ?? []) {
    lines.push({ tone: 'info', text: `Time: the threat is in reach for about ${roll.window + roll.reaction} seconds; ${spec.name} needs ${roll.reaction} to react.` });
    break;
  }
  (tr.rolls ?? []).forEach((roll, i) => {
    const hit = roll.roll < roll.need;
    lines.push({ tone: hit ? 'good' : 'bad', text: `Shot ${i + 1}: needs ${Math.round(roll.need * 100)} or less on a 100-sided die (base ${pct(spec.killRate[o.cls])}${roll.quality < 1 ? `, track quality ${pct(roll.quality)}` : ''}${roll.need < spec.killRate[o.cls] * roll.quality - 0.005 ? ', less for the region’s awareness and communications' : ''}). Rolled ${Math.max(1, Math.ceil(roll.roll * 100))}: ${hit ? 'hit' : 'miss'}.` });
  });
  if (!tr.rolls?.length && why && !lines.some((l) => l.tone === 'bad' && /Ceiling|cannot engage/.test(l.text))) {
    lines.push({ tone: 'bad', text: `It never fired: ${reasonText(why[1], o.cls)}.` });
  }
  const stopped = tr.outcome === 'stopped';
  lines.push({ tone: stopped ? 'good' : 'bad', text: stopped ? 'Result: stopped.' : 'Result: it got through.' });
  return { stopped, lines };
}
