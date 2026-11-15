import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_MAP, RAID_ID, TACTICAL_CONFIG, cleanRaid, computerDefense, createInitialState, decodeRaid, defaultSettings, encodeRaid, execute, jammedBand,
  autoReserveWave, exportJSON, importJSON, maxReserve, previewDefense, proposeDefense, reserveProblem, reserveStatus, raidCost, raidPoints, raidProblems, raidReport, raidSettings, rehearseRaid, advance, waveCost, type Raid, type SimState,
} from '../src/engine';

const base = (over: Partial<Raid> = {}): Raid => ({ region: 'EUR', seed: 4242, waves: [{ atHour: 8, axis: 'north', tracks: { slowDrone: 8, cruise: 4 } }], ...over });
const start = (raid: Raid): SimState => createInitialState(raidSettings(raid, defaultSettings('training')));
const run = (s: SimState) => { execute(s, { type: 'beginPhase' }); for (let i = 0; i < 400 && s.status === 'running'; i++) advance(s, 1); return s; };

describe('raid designer rules', () => {
  it('prices threats and every option, and refuses a raid over its points', () => {
    const R = TACTICAL_CONFIG.raid;
    const plain = waveCost(base().waves[0]);
    expect(plain.total).toBe(8 * 2 + 4 * 30);
    const w = waveCost({ ...base().waves[0], axis2: 'east', route: 'turn', hunt: true, decoys: 5, hidden: true });
    expect(w.options).toBe(R.secondAxis + R.turn + R.hunt + 5 * R.decoy + Math.ceil(plain.threats * R.hidden));
    expect(raidCost(base({ jam: 'X' }))).toBe(plain.total + R.jam);
    expect(raidPoints(base({ size: 'major' }))).toBeGreaterThan(raidPoints(base()));
    expect(raidProblems(base())).toEqual([]);
    expect(raidProblems(base({ waves: [{ atHour: 8, axis: 'north', tracks: { hypersonic: 6 } }] })).length).toBe(1);
    expect(raidProblems(base({ waves: [{ ...base().waves[0], hidden: true }] }))[0]).toContain('forecast');
  });

  it('round-trips a raid through a code and cleans anything untrusted out of one', () => {
    const raid = base({ size: 'major', jam: 'S', name: 'Opération Ñandú', note: 'Good luck ☂', waves: [{ atHour: 9, axis: 'west', axis2: 'south', tracks: { cruise: 3 }, target: 'EUR-S2', route: 'valley', hunt: true, decoys: 4 }] });
    expect(decodeRaid(encodeRaid({ ...raid, attacker: true }))).toEqual(raid);
    expect(decodeRaid('not a code')).toBeNull();
    const dirty = cleanRaid({
      region: 'EUR', size: 'huge', jam: 'Q', seed: -5, name: 'x'.repeat(200), note: 'a\nb', extra: { evil: true },
      waves: [{ atHour: 999, axis: 'up', axis2: 'north', tracks: { slowDrone: 1e9, nuke: 4 }, target: 'AFR-S1', route: 'teleport', decoys: 500, hidden: 'yes', hunt: 1 }],
    })!;
    expect(dirty).toEqual({ region: 'EUR', seed: 0, name: 'x'.repeat(40), note: 'a b', waves: [{ atHour: 28, axis: 'north', tracks: { slowDrone: 30 }, decoys: 20 }] });
    expect(cleanRaid({ region: 'EUR', waves: Array.from({ length: 6 }, () => base().waves[0]) })).toBeNull();
    expect(cleanRaid({ region: 'XXX', waves: base().waves })).toBeNull();
    // Codes written before the options existed still load.
    expect(decodeRaid(btoa(JSON.stringify({ region: 'AFR', waves: [{ atHour: 8, axis: 'north', tracks: { slowDrone: 8 } }] })))).not.toBeNull();
  });
});

describe('raid options in the fight', () => {
  it('aims a wave at one site, splits it between two sides and bends its route', () => {
    const s0 = start(base());
    const site = s0.tactical!.sites.filter((x) => x.region === 'EUR')[2];
    const s = start(base({ waves: [{ atHour: 8, axis: 'north', axis2: 'south', route: 'turn', target: site.id, tracks: { slowDrone: 8, cruise: 4, ballistic: 1 } }] }));
    const w = s.tactical!.waves[0];
    expect(w.tracks.every((x) => x.siteId === site.id)).toBe(true);
    expect(w.axis2).toBe('south');
    expect(w.tracks.filter((x) => x.from[1] === 0).length).toBeGreaterThan(0);
    expect(w.tracks.filter((x) => x.from[1] === TACTICAL_CONFIG.theaterKm.height).length).toBeGreaterThan(0);
    expect(w.tracks.filter((x) => x.cls !== 'ballistic').every((x) => !!x.via)).toBe(true);
    expect(w.tracks.find((x) => x.cls === 'ballistic')!.via).toBeUndefined();
    // The same seed gives the author and the defender the same map.
    expect(start(base()).tactical!.sites).toEqual(s0.tactical!.sites);
  });

  it('follows a valley when the region has one on that side', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = start(base({ seed }));
      const v = s.tactical!.terrain?.EUR.valleys?.[0];
      if (!v) continue;
      const s2 = start(base({ seed, waves: [{ atHour: 8, axis: v.side, route: 'valley', tracks: { slowDrone: 6, ballistic: 1 } }] }));
      const tr = s2.tactical!.waves[0].tracks;
      expect(tr.filter((x) => x.cls === 'slowDrone').every((x) => x.valley)).toBe(true);
      expect(tr.find((x) => x.cls === 'ballistic')!.valley).toBeUndefined();
      return;
    }
    throw new Error('no seed with a valley');
  });

  it('sends exactly the decoys bought, and none when none were', () => {
    const none = run(start(base()));
    expect(none.tactical!.waves[0].tracks.filter((x) => x.decoy).length).toBe(0);
    const some = run(start(base({ waves: [{ ...base().waves[0], decoys: 7 }] })));
    expect(some.tactical!.waves[0].tracks.filter((x) => x.decoy).length).toBe(7);
  });

  it('keeps a hidden wave out of the forecast and the defender’s estimate, but not the author’s', () => {
    const raid = base({ waves: [base().waves[0], { atHour: 14, axis: 'south', tracks: { cruise: 5 }, hidden: true }] });
    const s = start(raid);
    expect(s.tactical!.forecast).toEqual(['EUR']);
    expect(s.tactical!.waves.map((w) => w.forecast)).toEqual([true, false]);
    expect(previewDefense(s, 'EUR')!.waves).toBe(1);
    expect(previewDefense(s, 'EUR', 8, true)!.waves).toBe(2);
    expect(s.phases[0].situation).not.toContain('cruise');
  });

  it('jams the chosen band and tells the defender', () => {
    const s = start(base({ jam: 'X', name: 'Night Owl', note: 'See you at dawn' }));
    expect(jammedBand(s)).toBe('X');
    expect(s.phases[0].situation).toContain('Night Owl');
    expect(s.phases[0].situation).toContain('See you at dawn');
    expect(s.phases[0].situation).toContain('X-band');
    expect(jammedBand(start(base()))).toBeUndefined();
  });

  it('sends missiles after the defender’s radars when the author pays for it', () => {
    const raid = base({ waves: [{ atHour: 8, axis: 'north', hunt: true, tracks: { cruise: 12 } }] });
    const s = start(raid);
    for (const p of computerDefense(s, 'EUR')) execute(s, { type: 'deploy', equipmentId: p.equipmentId, region: 'EUR', x: p.x, y: p.y });
    expect(s.tactical!.deployments.some((d) => !!EQUIPMENT_MAP.get(d.equipmentId)!.radar)).toBe(true);
    run(s);
    expect(s.tactical!.waves[0].tracks.some((x) => !!x.depTarget)).toBe(true);
    const plain = start(base({ waves: [{ atHour: 8, axis: 'north', tracks: { cruise: 12 } }] }));
    for (const p of computerDefense(plain, 'EUR')) execute(plain, { type: 'deploy', equipmentId: p.equipmentId, region: 'EUR', x: p.x, y: p.y });
    run(plain);
    expect(plain.tactical!.waves[0].tracks.some((x) => !!x.depTarget)).toBe(false);
  });

  it('gives the defender credits to match the raid’s size', () => {
    expect(start(base({ size: 'skirmish' })).credits).toBeLessThan(start(base()).credits);
    expect(start(base({ size: 'major' })).credits).toBeGreaterThan(start(base()).credits);
    expect(start(base()).settings.lesson).toBe(RAID_ID);
  });

  it('rehearses a raid against the computer without starting a battle, the same every time', () => {
    const raid = base({ waves: [{ atHour: 8, axis: 'north', tracks: { slowDrone: 10, cruise: 4 } }, { atHour: 14, axis: 'east', tracks: { ballistic: 2 }, hidden: true }] });
    const a = rehearseRaid(raid, 12)!;
    expect(a.systems).toBeGreaterThanOrEqual(3);
    expect(a.preview.waves).toBe(2);
    expect(a.preview.prevented).toBeGreaterThan(0.2);
    expect(rehearseRaid(raid, 12)).toEqual(a);
    // An undefended run is worse for the defender than the rehearsal says the computer manages.
    const undefended = previewDefense(start(raid), 'EUR', 12, true)!;
    expect(undefended.prevented).toBeLessThan(a.preview.prevented);
  });

  it('reports the battle from the attacker’s side', () => {
    const raid = base({ waves: [{ atHour: 8, axis: 'north', tracks: { slowDrone: 10, cruise: 4 } }, { atHour: 14, axis: 'east', tracks: { rocket: 12 }, hidden: true }] });
    const s = run(start(raid));
    const r = raidReport(s)!;
    expect(r.spent).toBe(raidCost(raid));
    expect(r.sent).toBe(26);
    expect(r.through).toBe(26); // nothing was defending
    expect(r.damage).toBeGreaterThan(0);
    expect(r.waves.map((w) => w.hidden)).toEqual([false, true]);
    expect(r.waves.every((w) => w.done)).toBe(true);
    expect(raidReport(createInitialState(defaultSettings('campaign')))).toBeNull();
  });

  it('holds points in reserve and spends them on one more wave once the first has landed', () => {
    const raid = base({ reserve: 120 });
    expect(raidCost(raid)).toBe(raidCost(base()) + 120);
    expect(cleanRaid({ ...raid, reserve: 9999 })!.reserve).toBe(maxReserve(raid));
    const s = start(raid);
    expect(reserveStatus(s)!.ready).toBe(false);
    execute(s, { type: 'beginPhase' });
    expect(execute(s, { type: 'commitReserve', wave: { axis: 'south', tracks: { cruise: 4 } } }).ok).toBe(false); // nothing has landed
    while (!s.tactical!.waves[0].applied) advance(s, 1);
    expect(reserveStatus(s)!.ready).toBe(true);
    expect(reserveProblem(s, { axis: 'south', tracks: { cruise: 5 } })).toContain('120'); // 150 points
    expect(reserveProblem(s, { axis: 'south', tracks: {} })).toContain('no threats');
    const hour = s.hour;
    expect(execute(s, { type: 'commitReserve', wave: { axis: 'south', tracks: { cruise: 4 } } }).ok).toBe(true);
    const w = s.tactical!.waves[1];
    expect(w.forecast).toBe(false);
    expect(w.atHour).toBeGreaterThan(hour);
    expect(w.tracks.filter((x) => x.cls === 'cruise').length).toBe(4);
    expect(execute(s, { type: 'commitReserve', wave: { axis: 'south', tracks: { cruise: 1 } } }).ok).toBe(false); // only once
    while (s.status === 'running') advance(s, 1);
    expect(w.applied).toBe(true);
    expect(raidReport(s)!.sent).toBe(16);
    expect(start(base()).tactical && reserveStatus(start(base()))).toBeNull();
  });

  it('commits the reserve for an author who is not there, with more of what got through', () => {
    const s = start({ ...base({ reserve: 100 }), byCode: true });
    execute(s, { type: 'beginPhase' });
    while (!s.tactical!.waves[0].applied) advance(s, 1);
    // It went the hour the written wave landed: nothing was defending, so the game sent more of the best value.
    expect(s.tactical!.reserveSpent).toBe(true);
    expect(s.tactical!.waves.length).toBe(2);
    const extra = s.tactical!.waves[1];
    expect(extra.forecast).toBe(false);
    expect(extra.tracks.length).toBeGreaterThan(0);
    expect(extra.tracks.reduce((a, x) => a + TACTICAL_CONFIG.threatCost[x.cls], 0)).toBeLessThanOrEqual(100);
    expect(autoReserveWave(start(base()))).toBeNull();
    // A raid handed over at the keyboard waits for its author instead.
    const hand = start(base({ reserve: 100 }));
    execute(hand, { type: 'beginPhase' });
    while (hand.status === 'running') advance(hand, 1);
    expect(hand.tactical!.waves.length).toBe(1);
  });

  it('packs the save of a raid being defended so the raid cannot be read from it, and loads it back', () => {
    const s = start(base({ name: 'Secret Plan', waves: [base().waves[0], { atHour: 14, axis: 'south', tracks: { hypersonic: 2 }, hidden: true }] }));
    const text = exportJSON(s);
    expect(text).not.toContain('hypersonic');
    expect(text).not.toContain('"hidden"');
    const back = importJSON(text)!;
    expect(back.settings.raid).toEqual(s.settings.raid);
    expect(back.tactical!.waves.length).toBe(2);
    // The author's own battle, and every other kind of save, stay plain.
    expect(exportJSON(start({ ...base(), attacker: true }))).toContain('"raid"');
    expect(exportJSON(createInitialState(defaultSettings('campaign')))).toContain('"state"');
  });

  it('the computer buys an upper-tier battery for gliders and rocket defense for rockets', () => {
    const gliders = start(base({ waves: [{ atHour: 8, axis: 'north', tracks: { hypersonic: 5 } }] }));
    expect(proposeDefense(gliders, 'EUR', gliders.credits - 150).some((p) => p.equipmentId === 'thaad')).toBe(true);
    expect(rehearseRaid(base({ waves: [{ atHour: 8, axis: 'north', tracks: { hypersonic: 5 } }] }), 20)!.preview.prevented).toBeGreaterThan(0.45);
    const rockets = start(base({ waves: [{ atHour: 8, axis: 'north', tracks: { rocket: 30 } }] }));
    expect(proposeDefense(rockets, 'EUR', rockets.credits - 150).filter((p) => p.equipmentId === 'iron-dome').length).toBeGreaterThanOrEqual(2);
    expect(rehearseRaid(base({ waves: [{ atHour: 8, axis: 'north', tracks: { rocket: 30 } }] }), 20)!.preview.prevented).toBeGreaterThan(0.45);
  });
});
