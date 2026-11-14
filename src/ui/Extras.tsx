// Extra ways to play and learn: the raid designer (write an attack for a friend, or for the computer to defend) and
// the practice range (one system, one threat, one engagement, dice shown).
import { useMemo, useState } from 'react';
import {
  EQUIPMENT, RAID_BUDGET, RAID_ID, REGION_IDS, REGION_DEFS, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, defaultSettings, isEffector, lessonSettings, practiceShot,
  proposeDefense, type RaidWave, type RegionId, type ThreatAxis, type ThreatClass,
} from '../engine';
import { dispatch, store } from '../store/simStore';
import { Modal } from './components/ui';
import { useUI } from './uiState';

const AXES: ThreatAxis[] = ['north', 'east', 'south', 'west'];
const regionName = (r: RegionId) => REGION_DEFS.find((d) => d.id === r)!.name;
type Raid = { region: RegionId; waves: RaidWave[] };
const blank = (): Raid => ({ region: 'EUR', waves: [{ atHour: 8, axis: 'north', tracks: { slowDrone: 8, fastDrone: 2 } }, { atHour: 16, axis: 'east', tracks: { cruise: 3, slowDrone: 4 } }] });
const pointsOf = (raid: Raid) => raid.waves.reduce((a, w) => a + THREAT_CLASSES.reduce((b, c) => b + (w.tracks[c] ?? 0) * TACTICAL_CONFIG.threatCost[c], 0), 0);
const countOf = (w: RaidWave) => THREAT_CLASSES.reduce((a, c) => a + (w.tracks[c] ?? 0), 0);

/** A raid as a short code to paste to someone else, and back again. */
const encode = (raid: Raid) => btoa(JSON.stringify(raid));
function decode(code: string): Raid | null {
  try {
    const x = JSON.parse(atob(code.trim())) as Raid;
    if (!REGION_IDS.includes(x.region) || !Array.isArray(x.waves) || !x.waves.length || x.waves.length > 3) return null;
    const waves = x.waves.map((w) => ({
      atHour: Math.max(4, Math.min(28, Math.round(Number(w.atHour) || 8))), axis: AXES.includes(w.axis) ? w.axis : 'north',
      tracks: Object.fromEntries(THREAT_CLASSES.map((c) => [c, Math.max(0, Math.min(30, Math.round(Number(w.tracks?.[c]) || 0)))]).filter(([, n]) => n)) as RaidWave['tracks'],
    }));
    const raid = { region: x.region, waves };
    return pointsOf(raid) <= RAID_BUDGET && waves.every((w) => countOf(w) > 0) ? raid : null;
  } catch { return null; }
}

/** Start a raid: for a defender to play, or for the computer to defend while the author watches. */
function startRaid(raid: Raid, attacker: boolean) {
  store.newGame({ ...lessonSettings(RAID_ID, { ...defaultSettings('training'), seed: Math.floor(Math.random() * 1e9) }), raid: { ...raid, attacker } });
  const s = store.state;
  if (!attacker || !s) return;
  for (const p of proposeDefense(s, raid.region, s.credits - 150)) dispatch({ type: 'deploy', equipmentId: p.equipmentId, region: raid.region, x: p.x, y: p.y });
  dispatch({ type: 'setAutoResupply', region: raid.region, on: true });
  dispatch({ type: 'beginPhase' });
}

export function RaidDesigner({ onClose }: { onClose: () => void }) {
  const ui = useUI();
  const [raid, setRaid] = useState<Raid>(blank);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const points = pointsOf(raid);
  const over = points > RAID_BUDGET;
  const empty = raid.waves.some((w) => countOf(w) === 0);
  const setWave = (i: number, w: RaidWave) => setRaid({ ...raid, waves: raid.waves.map((x, k) => (k === i ? w : x)) });
  const go = (attacker: boolean) => { startRaid(raid, attacker); ui.setView('theater'); onClose(); };
  return (
    <Modal wide title="RAID DESIGNER" onClose={onClose}
      footer={<>
        <span className={`mr-auto self-center text-[12px] ${over ? 'text-ops-red' : 'text-ops-dim'}`}>Attack points: <b className={over ? 'text-ops-red' : 'text-white'}>{points}</b> of {RAID_BUDGET}</span>
        <button className="btn px-4 py-2 text-[13px]" disabled={over || empty} title="The game builds a defense and you watch your raid go in" onClick={() => go(true)}>Attack the computer ▶</button>
        <button className="btn btn-primary px-4 py-2 text-[13px]" disabled={over || empty} title="Hand the keyboard to another player, who defends without seeing this screen" onClick={() => go(false)}>Hand to a defender ▶</button>
      </>}>
      <div className="space-y-3 text-[12px]">
        <p className="leading-relaxed text-ops-text">Write an attack of up to three waves on one region. Each threat costs attack points (what it costs the attacker in the game). Then either <b className="text-white">hand it to a defender</b>, who sees only the forecast, or <b className="text-white">attack the computer</b> and watch the game’s own defense try to stop it. A lower defense score means a better raid.</p>
        <label className="flex flex-wrap items-center gap-2">
          <span className="label">Target region</span>
          <select className="input py-1" value={raid.region} onChange={(e) => setRaid({ ...raid, region: e.target.value as RegionId })}>
            {REGION_IDS.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
          </select>
        </label>
        <div className="grid gap-2 lg:grid-cols-3">
          {raid.waves.map((w, i) => (
            <fieldset key={i} className="rounded border border-ops-line p-2">
              <legend className="label px-1">Wave {i + 1} · {countOf(w)} threats</legend>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">Arrives at hour
                  <input type="number" className="input w-16 py-0.5" min={4} max={28} value={w.atHour} onChange={(e) => setWave(i, { ...w, atHour: Math.max(4, Math.min(28, Number(e.target.value) || 4)) })} />
                </label>
                <label className="flex items-center gap-1">from the
                  <select className="input py-0.5" value={w.axis} onChange={(e) => setWave(i, { ...w, axis: e.target.value as ThreatAxis })}>{AXES.map((a) => <option key={a} value={a}>{a}</option>)}</select>
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {THREAT_CLASSES.map((c: ThreatClass) => (
                  <label key={c} className="flex items-center justify-between gap-1 text-[11px]">
                    <span>{THREAT_LABELS[c]} <span className="text-ops-dim">({TACTICAL_CONFIG.threatCost[c]})</span></span>
                    <input type="number" className="input w-14 py-0.5" min={0} max={30} value={w.tracks[c] ?? 0} aria-label={`${THREAT_LABELS[c]} in wave ${i + 1}`}
                      onChange={(e) => setWave(i, { ...w, tracks: { ...w.tracks, [c]: Math.max(0, Math.min(30, Math.round(Number(e.target.value) || 0))) } })} />
                  </label>
                ))}
              </div>
              {raid.waves.length > 1 && <button className="btn mt-2 px-2 py-0.5" onClick={() => setRaid({ ...raid, waves: raid.waves.filter((_, k) => k !== i) })}>Remove wave</button>}
            </fieldset>
          ))}
          {raid.waves.length < 3 && (
            <button className="btn self-start" onClick={() => setRaid({ ...raid, waves: [...raid.waves, { atHour: Math.min(28, (raid.waves[raid.waves.length - 1]?.atHour ?? 0) + 8), axis: 'south', tracks: { slowDrone: 4 } }] })}>＋ Add a wave</button>
          )}
        </div>
        <div className="rounded border border-ops-line p-2">
          <div className="label mb-1">Send it to someone else</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="btn" disabled={over || empty} onClick={async () => { try { await navigator.clipboard.writeText(encode(raid)); setNote('Raid code copied. Paste it to a friend.'); } catch { setCode(encode(raid)); setNote('Copy the code from the box.'); } }}>Copy raid code</button>
            <input className="input min-w-0 flex-1 py-1" placeholder="…or paste a raid code here" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Raid code" />
            <button className="btn" disabled={!code.trim()} onClick={() => { const r = decode(code); if (r) { setRaid(r); setNote('Raid loaded. Hand it to a defender, or look it over first.'); } else setNote('That is not a valid raid code.'); }}>Load code</button>
          </div>
          {note && <p className="mt-1 text-[11px] text-ops-cyan" role="status">{note}</p>}
        </div>
      </div>
    </Modal>
  );
}

const SHOOTERS = EQUIPMENT.filter(isEffector);
const SENSORS = EQUIPMENT.filter((e) => e.layer === 'detection' && !e.lure);

/** One engagement at a time, with every die shown. */
export function PracticeRange() {
  const [eq, setEq] = useState('nasams');
  const [cls, setCls] = useState<ThreatClass>('cruise');
  const [offset, setOffset] = useState(10);
  const [sensor, setSensor] = useState('');
  const [seed, setSeed] = useState(1);
  const [tally, setTally] = useState<{ key: string; shots: number; stops: number }>({ key: '', shots: 0, stops: 0 });
  const key = `${eq}|${cls}|${offset}|${sensor}`;
  const result = useMemo(() => practiceShot({ equipmentId: eq, cls, offsetKm: offset, sensorId: sensor || undefined, seed }), [eq, cls, offset, sensor, seed]);
  const fire = () => {
    const next = seed + 1;
    const r = practiceShot({ equipmentId: eq, cls, offsetKm: offset, sensorId: sensor || undefined, seed: next });
    setSeed(next);
    setTally((t) => (t.key === key ? { key, shots: t.shots + 1, stops: t.stops + (r.stopped ? 1 : 0) } : { key, shots: 1, stops: r.stopped ? 1 : 0 }));
  };
  return (
    <div className="rounded border border-ops-line p-3 text-[12px]">
      <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">Practice range</div>
      <p className="mt-1 leading-relaxed text-ops-dim">One system, one threat, flat empty ground. Fire as often as you like and read exactly why each shot hit or missed.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5"><span className="label">System</span>
          <select className="input py-1" value={eq} onChange={(e) => setEq(e.target.value)}>{SHOOTERS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="flex flex-col gap-0.5"><span className="label">Threat</span>
          <select className="input py-1" value={cls} onChange={(e) => setCls(e.target.value as ThreatClass)}>{THREAT_CLASSES.map((c) => <option key={c} value={c}>{THREAT_LABELS[c]}</option>)}</select></label>
        <label className="flex flex-col gap-0.5"><span className="label">Passes this close (km)</span>
          <input type="number" className="input w-24 py-1" min={0} max={300} value={offset} onChange={(e) => setOffset(Math.max(0, Math.min(300, Number(e.target.value) || 0)))} /></label>
        <label className="flex flex-col gap-0.5"><span className="label">Extra sensor beside it</span>
          <select className="input py-1" value={sensor} onChange={(e) => setSensor(e.target.value)}><option value="">None</option>{SENSORS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <button className="btn btn-primary px-4 py-1.5" onClick={fire}>Fire again ▶</button>
      </div>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5" aria-live="polite">
        {result.lines.map((l, i) => <li key={i} className={l.tone === 'good' ? 'text-ops-green' : l.tone === 'bad' ? 'text-ops-amber' : 'text-ops-text'}>{l.text}</li>)}
      </ol>
      {tally.key === key && tally.shots > 1 && <p className="mt-1 text-[11px] text-ops-dim">This setup so far: stopped {tally.stops} of {tally.shots} ({Math.round((tally.stops / tally.shots) * 100)}%).</p>}
    </div>
  );
}
