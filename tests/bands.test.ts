import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT, EQUIPMENT_MAP, RADAR_BANDS, RADAR_BAND_IDS, createInitialState, defaultSettings, equipmentCost, execute, placementError, sharpestBand,
  stockpileOf, withLevel, type RegionId, type SimState,
} from '../src/engine';

function landNear(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 0; r <= 200; r += 5) for (let a = 0; a < 16; a++) {
    const p = { x: Math.round(x + Math.cos((a / 16) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 16) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}

/** Plays a whole campaign with the same kit in every forecast region and returns the tactical totals. */
function campaign(seed: number, kit: string[]) {
  const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed }, 'officer'));
  let guard = 0;
  while (s.status !== 'complete' && guard++ < 3000) {
    if (s.status === 'briefing') {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        const sites = s.tactical!.sites.filter((x) => x.region === r).sort((a, b) => b.importance - a.importance);
        kit.forEach((id, i) => execute(s, { type: 'deploy', equipmentId: id, region: r, ...landNear(s, id, r, sites[i % sites.length].x, sites[i % sites.length].y) }));
      }
      execute(s, { type: 'beginPhase' });
    }
    execute(s, { type: 'advance', hours: 1 });
  }
  const decoys = s.tactical!.waves.flatMap((w) => w.tracks.filter((x) => x.decoy));
  return { stats: s.tactical!.stats, decoys, wasted: decoys.reduce((a, x) => a + x.shots, 0) };
}

describe('radar bands', () => {
  it('gives every radar a known band, ordered from long waves to short', () => {
    for (const e of EQUIPMENT) if (e.radar) expect(RADAR_BAND_IDS, e.id).toContain(e.radar.band);
    for (let i = 1; i < RADAR_BAND_IDS.length; i++) {
      const longer = RADAR_BANDS[RADAR_BAND_IDS[i - 1]];
      const shorter = RADAR_BANDS[RADAR_BAND_IDS[i]];
      expect(shorter.storm).toBeLessThan(longer.storm); // short waves lose more range in storms
      expect(shorter.sharp).toBeGreaterThan(longer.sharp); // and recognise more decoys
      expect(shorter.cue).toBeGreaterThanOrEqual(longer.cue); // and give a better track to others
    }
  });

  it('picks the sharpest band among systems', () => {
    const of = (...ids: string[]) => sharpestBand(ids.map((id) => EQUIPMENT_MAP.get(id)!));
    expect(of('e-2d', 'gm400')).toBe('L');
    expect(of('e-2d', 'sentinel', 'giraffe-4a')).toBe('X');
    expect(of('stinger', 'acoustic-net')).toBeNull();
  });

  it('lets sharp radars recognise decoys, saving rounds that long-wave radars waste', () => {
    let blurry = 0;
    let sharp = 0;
    let spottedSharp = 0;
    let spottedBlurry = 0;
    for (const seed of [3, 9, 21]) {
      const a = campaign(seed, ['e-2d', 'davids-sling', 'davids-sling']);
      const b = campaign(seed, ['e-2d', 'davids-sling', 'davids-sling', 'sentinel', 'sentinel', 'sentinel']);
      blurry += a.wasted;
      sharp += b.wasted;
      spottedBlurry += a.stats.decoysSpotted ?? 0;
      spottedSharp += b.stats.decoysSpotted ?? 0;
      for (const d of [...a.decoys, ...b.decoys]) if (d.rejected) expect(d.shots).toBe(0);
    }
    expect(spottedSharp).toBeGreaterThan(spottedBlurry);
    expect(sharp).toBeLessThan(blurry);
  });
});

describe('withdrawing a system', () => {
  it('is never a cheaper resupply and takes its stockpile share with it', () => {
    const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed: 4 }, 'officer'));
    const site = s.tactical!.sites.find((x) => x.region === 'EUR')!;
    execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'nasams', 'EUR', site.x, site.y) });
    const spec = EQUIPMENT_MAP.get('nasams')!;
    expect(stockpileOf(s, 'nasams')).toBe(spec.magazine);
    const d = s.tactical!.deployments[0];
    d.stock = 0; // fired everything
    const before = s.credits;
    expect(execute(s, { type: 'withdraw', deploymentId: d.id }).ok).toBe(true);
    // Half the price back, less a full magazine of rounds: nothing here.
    expect(s.credits - before).toBeLessThanOrEqual(equipmentCost(spec) * 0.5 - equipmentCost(spec) * 0.5);
    expect(stockpileOf(s, 'nasams')).toBe(0);
  });
});
