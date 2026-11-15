// The Raid Designer: play the attacker. A raid is written on the map it will be fought on, with the night and the
// storms of that day in view, priced in attack points, rehearsed against the computer, then sent at the computer or
// handed to another player (on this keyboard, or as a code).
import { useEffect, useMemo, useState } from 'react';
import {
  JAMMING, RADAR_BANDS, RAID_AXES, RAID_BANDS, RAID_SIZES, REGION_DEFS, REGION_IDS, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, cleanRaid, computerDefense,
  createInitialState, decodeRaid, defaultSettings, encodeRaid, isNight, localHour, raidCost, raidPoints, raidProblems, raidReport, raidSettings, raidThreats,
  autoReserveWave, maxReserve, rehearseRaid, reserveLead, reserveProblem, reserveStatus, stormWindows, waveCost, type DefensePreview, type Raid, type RaidWave, type RegionId,
  type ReserveWave, type SimState, type ThreatAxis, type ThreatClass,
} from '../engine';
import { dispatch, store } from '../store/simStore';
import { Modal } from './components/ui';
import { useUI } from './uiState';
import { TerrainLayer } from './views/theater/terrain';

const R = TACTICAL_CONFIG.raid;
const { width: W, height: H } = TACTICAL_CONFIG.theaterKm;
const HOURS = 34; // the length of a raid battle (see RAID in training.ts)
const WAVE_COLORS = ['#f2545b', '#f5b13d', '#a78bfa', '#38d6f5', '#34d399'];
const regionName = (r: RegionId) => REGION_DEFS.find((d) => d.id === r)!.name;
const newSeed = () => Math.floor(Math.random() * 1e9);
const SIZE_LABEL = { skirmish: 'Skirmish', standard: 'Standard', major: 'Major' } as const;
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

const blank = (): Raid => ({
  region: 'EUR', seed: newSeed(),
  waves: [
    { atHour: 8, axis: 'north', tracks: { slowDrone: 8, fastDrone: 2 }, decoys: 4 },
    { atHour: 9, axis: 'east', tracks: { cruise: 3, slowDrone: 4 } },
  ],
});

const DRAFT_KEY = 'mds-raid-draft';
function loadDraft(): Raid {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const raid = raw ? cleanRaid(JSON.parse(raw)) : null;
    if (raid) return { ...raid, seed: raid.seed ?? newSeed() };
  } catch { /* no saved draft, or storage is unavailable */ }
  return blank();
}

// ── A match: two players at one keyboard take turns attacking, and the better defender wins ───────────────

interface Match { rounds: { id: string; defender: 1 | 2; score: number }[] }
const MATCH_KEY = 'mds-raid-match';
function loadMatch(): Match {
  try {
    const m = JSON.parse(localStorage.getItem(MATCH_KEY) ?? 'null') as Match | null;
    if (m && Array.isArray(m.rounds)) return { rounds: m.rounds.filter((r) => (r.defender === 1 || r.defender === 2) && Number.isFinite(r.score)).slice(-20) };
  } catch { /* none saved */ }
  return { rounds: [] };
}
const saveMatch = (m: Match) => { try { localStorage.setItem(MATCH_KEY, JSON.stringify(m)); } catch { /* storage unavailable */ } };
const matchAverage = (m: Match, p: 1 | 2) => { const xs = m.rounds.filter((r) => r.defender === p); return xs.length ? xs.reduce((a, r) => a + r.score, 0) / xs.length : null; };

function MatchScore({ match }: { match: Match }) {
  if (!match.rounds.length) return null;
  const a = matchAverage(match, 1);
  const b = matchAverage(match, 2);
  const lead = a !== null && b !== null && a !== b ? (a > b ? 1 : 2) : null;
  const side = (p: 1 | 2, avg: number | null) => (
    <span>Player {p} defended {match.rounds.filter((r) => r.defender === p).map((r) => r.score).join(', ') || 'nothing yet'}{avg !== null && <> (average <b className="text-white">{Math.round(avg)}</b>)</>}</span>
  );
  return (
    <p className="rounded border border-ops-line px-2 py-1 text-[11px] leading-snug text-ops-dim" role="status">
      <b className="text-ops-text">Match so far:</b> {side(1, a)} · {side(2, b)}.{' '}
      {lead ? <b className="text-ops-green">Player {lead} leads.</b> : a !== null && b !== null ? 'Level.' : 'The higher average defense score wins once both have defended.'}
    </p>
  );
}

/**
 * Start the battle. `how`: 'watch' puts the computer's defense in place while the author watches; 'hand' starts it
 * on the briefing of a defender at this keyboard; 'code' is a raid pasted from someone who is not here.
 */
function startRaid(raid: Raid, how: 'watch' | 'hand' | 'code', defender?: 1 | 2) {
  const { attacker: _a, byCode: _b, defender: _d, ...rest } = raid;
  store.newGame(raidSettings({ ...rest, ...(how === 'watch' ? { attacker: true } : how === 'code' ? { byCode: true } : { defender: defender ?? 2 }) }, defaultSettings('training')));
  const s = store.state;
  if (how !== 'watch' || !s) return;
  store.batch(
    [...computerDefense(s, raid.region).map((p) => ({ type: 'deploy' as const, equipmentId: p.equipmentId, region: raid.region, x: p.x, y: p.y })), { type: 'setAutoResupply' as const, region: raid.region, on: true }],
    (n) => `The computer placed ${n - 1} systems. Your raid is on its way.`,
  );
  dispatch({ type: 'beginPhase' });
}

/** The edge a wave enters from, as a point to draw its arrow from. */
const edge = (axis: ThreatAxis): [number, number] => ({ north: [W / 2, 16], south: [W / 2, H - 16], west: [16, H / 2], east: [W - 16, H / 2] } as const)[axis] as [number, number];

/** When a wave's fight is decided: its slowest threat launches this long before it arrives. */
const leadOf = (w: RaidWave) => Math.max(0, ...THREAT_CLASSES.filter((c) => w.tracks[c]).map((c) => TACTICAL_CONFIG.flightHours[c]));

function Opt({ on, onChange, label, cost, children, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; cost: string; children: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-2 rounded border px-2 py-1.5 ${on ? 'border-ops-cyan/60 bg-ops-cyan/5' : 'border-ops-line'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-0.5" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex justify-between gap-2"><b className="text-white">{label}</b><span className="shrink-0 text-ops-amber">{cost}</span></span>
        <span className="block text-[11px] leading-snug text-ops-dim">{children}</span>
      </span>
    </label>
  );
}

function RaidMap({ s, raid, sel, onSite }: { s: SimState; raid: Raid; sel: number; onSite: (id: string) => void }) {
  const t = s.tactical!;
  const sites = t.sites.filter((x) => x.region === raid.region);
  const terrain = t.terrain?.[raid.region];
  const spread = sites.reduce((a, x) => a + x.importance, 0) || 1;
  const cx = sites.reduce((a, x) => a + x.x * x.importance, 0) / spread;
  const cy = sites.reduce((a, x) => a + x.y * x.importance, 0) / spread;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-ops-line bg-[#0d1712]" role="img" aria-label={`Map of ${regionName(raid.region)}: ${sites.length} sites. Choose a wave’s target from the list beside the map.`}>
      <TerrainLayer terrain={terrain} sites={sites} w={W} h={H} />
      {raid.waves.map((w, i) => {
        const site = sites.find((x) => x.id === w.target);
        const to: [number, number] = site ? [site.x, site.y] : [cx, cy];
        const color = WAVE_COLORS[i];
        return [w.axis, ...(w.axis2 ? [w.axis2] : [])].map((a) => {
          const from = edge(a);
          const valley = w.route === 'valley' ? terrain?.valleys?.find((v) => v.side === a) : undefined;
          const mid: [number, number] | null = valley ? [valley.b[0], valley.b[1]] : w.route === 'turn' ? [(from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.25, (from[1] + to[1]) / 2 - (to[0] - from[0]) * 0.25] : null;
          const start = valley ? valley.a : from;
          const d = mid ? `M${start[0]},${start[1]} L${mid[0]},${mid[1]} L${to[0]},${to[1]}` : `M${start[0]},${start[1]} L${to[0]},${to[1]}`;
          return (
            <g key={`${i}${a}`} opacity={i === sel ? 1 : 0.45} pointerEvents="none">
              <path d={d} fill="none" stroke={color} strokeWidth={i === sel ? 3 : 2} strokeDasharray={w.hidden ? '3 6' : site ? undefined : '10 6'} markerEnd={`url(#raid-arrow-${i})`} />
              <circle cx={start[0]} cy={start[1]} r={11} fill="#0b1220" stroke={color} strokeWidth={2} />
              <text x={start[0]} y={start[1] + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={color}>{i + 1}</text>
            </g>
          );
        });
      })}
      <defs>
        {WAVE_COLORS.map((c, i) => <marker key={i} id={`raid-arrow-${i}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={5} markerHeight={5} orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>)}
      </defs>
      {sites.map((x) => {
        const aimed = raid.waves.map((w, i) => (w.target === x.id ? i : -1)).filter((i) => i >= 0);
        return (
          <g key={x.id} className="cursor-pointer" onClick={() => onSite(x.id)}>
            <title>{`${x.name}: value ${x.importance}. Click to aim wave ${sel + 1} here (click again to spread it out).`}</title>
            <circle cx={x.x} cy={x.y} r={6 + x.importance * 2.5} fill="#0b1220" stroke={aimed.length ? WAVE_COLORS[aimed[0]] : '#cbd5e1'} strokeWidth={aimed.includes(sel) ? 3.5 : 1.5} />
            <text x={x.x} y={x.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">{x.importance}</text>
            <text x={x.x} y={x.y + 22 + x.importance * 2.5} textAnchor="middle" fontSize={11} fill="#cbd5e1" stroke="#0b1220" strokeWidth={3} paintOrder="stroke">{x.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The battle's hours: night and storms shaded, each wave on its arrival time. */
function Timeline({ s, raid, sel, onPick }: { s: SimState; raid: Raid; sel: number; onPick: (i: number) => void }) {
  const x = (h: number) => (h / HOURS) * 100;
  const nights: [number, number][] = [];
  for (let h = 0; h < HOURS; h++) {
    if (!isNight(s, raid.region, h)) continue;
    const last = nights[nights.length - 1];
    if (last && last[1] === h) last[1] = h + 1; else nights.push([h, h + 1]);
  }
  const storms = stormWindows(s, raid.region, 0, HOURS);
  return (
    <div>
      <div className="relative h-9 overflow-hidden rounded border border-ops-line bg-[#122033]" role="img"
        aria-label={`Timeline of the battle. Night: ${nights.map(([a, b]) => `hours ${a} to ${b}`).join(', ') || 'none'}. Storms: ${storms.map(([a, b]) => `hours ${a} to ${b}`).join(', ') || 'none'}.`}>
        {nights.map(([a, b]) => <div key={`n${a}`} className="absolute inset-y-0 bg-black/60" style={{ left: `${x(a)}%`, width: `${x(b - a)}%` }} />)}
        {storms.map(([a, b]) => <div key={`s${a}`} className="absolute inset-x-0 bottom-0 h-2 bg-ops-cyan/70" style={{ left: `${x(a)}%`, width: `${x(Math.min(b, HOURS) - a)}%` }} />)}
        <div className="absolute inset-y-0 border-l border-dashed border-ops-dim" style={{ left: `${x(R.hours[0])}%` }} />
        <div className="absolute inset-y-0 border-l border-dashed border-ops-dim" style={{ left: `${x(R.hours[1])}%` }} />
        {raid.waves.map((w, i) => (
          <button key={i} onClick={() => onPick(i)} aria-label={`Wave ${i + 1}, arrives at hour ${w.atHour}`}
            className={`absolute top-0.5 -ml-2.5 h-5 w-5 rounded-full text-[11px] font-bold text-black ${i === sel ? 'ring-2 ring-white' : ''}`} style={{ left: `${x(w.atHour)}%`, background: WAVE_COLORS[i] }}>{i + 1}</button>
        ))}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-ops-dim">
        <span>Hour 0</span>
        <span><span className="mr-1 inline-block h-2 w-3 bg-black/80 align-middle" />night</span>
        <span><span className="mr-1 inline-block h-2 w-3 bg-ops-cyan/70 align-middle" />storm</span>
        <span>dashed lines: earliest and latest arrival</span>
        <span className="ml-auto">Hour {HOURS}</span>
      </div>
    </div>
  );
}

function WaveEditor({ s, raid, i, set }: { s: SimState; raid: Raid; i: number; set: (w: RaidWave) => void }) {
  const w = raid.waves[i];
  const t = s.tactical!;
  const sites = t.sites.filter((x) => x.region === raid.region);
  const valleys = t.terrain?.[raid.region]?.valleys ?? [];
  const valleyHere = [w.axis, ...(w.axis2 ? [w.axis2] : [])].some((a) => valleys.some((v) => v.side === a));
  const cost = waveCost(w);
  const decided = w.atHour - leadOf(w);
  const night = isNight(s, raid.region, decided);
  const storm = stormWindows(s, raid.region, decided, decided + 0.5).length > 0;
  const num = (c: ThreatClass, n: number) => set({ ...w, tracks: { ...w.tracks, [c]: Math.max(0, Math.min(R.maxPerClass, Math.round(n) || 0)) } });
  return (
    <div className="space-y-2">
      <div className="rounded border border-ops-line p-2">
        <label className="flex flex-wrap items-center gap-2">
          <span className="label">Arrives at hour</span>
          <input type="range" className="min-w-0 flex-1" min={R.hours[0]} max={R.hours[1]} value={w.atHour} onChange={(e) => set({ ...w, atHour: Number(e.target.value) })} aria-label={`Wave ${i + 1} arrival hour`} />
          <b className="w-8 text-right text-white">{w.atHour}</b>
        </label>
        <p className="mt-1 text-[11px] leading-snug text-ops-dim">
          {hhmm(localHour(s, raid.region, w.atHour))} local. The fight is decided when the wave launches, around {hhmm(localHour(s, raid.region, decided))}:{' '}
          <b className={night ? 'text-ops-green' : 'text-ops-text'}>{night ? 'dark, so weapons aimed by eye hit less often' : 'daylight'}</b>,{' '}
          <b className={storm ? 'text-ops-green' : 'text-ops-text'}>{storm ? 'in a storm, so the defender’s short-wave radars see less far' : 'clear skies'}</b>.
          {' '}Waves an hour apart catch launchers still reloading.
        </p>
      </div>

      <div className="rounded border border-ops-line p-2">
        <div className="label mb-1">Threats in this wave · {raidThreats(w)} · {cost.threats} points</div>
        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2 md:grid-cols-1">
          {THREAT_CLASSES.map((c) => (
            <div key={c} className="flex items-center justify-between gap-1 text-[11px]">
              <span className="min-w-0 truncate">{THREAT_LABELS[c]} <span className="text-ops-dim">({TACTICAL_CONFIG.threatCost[c]})</span></span>
              <span className="flex shrink-0 items-center gap-0.5">
                <button className="btn px-1.5 py-0" onClick={() => num(c, (w.tracks[c] ?? 0) - 1)} aria-label={`One fewer ${THREAT_LABELS[c]}`}>−</button>
                <input type="number" className="input w-12 px-1 py-0.5 text-center" min={0} max={R.maxPerClass} value={w.tracks[c] ?? 0} aria-label={`${THREAT_LABELS[c]} in wave ${i + 1}`} onChange={(e) => num(c, Number(e.target.value))} />
                <button className="btn px-1.5 py-0" onClick={() => num(c, (w.tracks[c] ?? 0) + 1)} aria-label={`One more ${THREAT_LABELS[c]}`}>＋</button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-ops-line p-2">
        <div className="label mb-1">Where it comes from and where it goes</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1">From the
            <select className="input py-0.5" value={w.axis} onChange={(e) => set({ ...w, axis: e.target.value as ThreatAxis, axis2: w.axis2 === e.target.value ? undefined : w.axis2 })}>{RAID_AXES.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </label>
          <label className="flex items-center gap-1">and half from the
            <select className="input py-0.5" value={w.axis2 ?? ''} onChange={(e) => set({ ...w, axis2: (e.target.value || undefined) as ThreatAxis | undefined })}>
              <option value="">nowhere else</option>
              {RAID_AXES.filter((a) => a !== w.axis).map((a) => <option key={a} value={a}>{a} (+{R.secondAxis})</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Aimed at
            <select className="input max-w-[11rem] py-0.5" value={w.target ?? ''} onChange={(e) => set({ ...w, target: e.target.value || undefined })}>
              <option value="">every site, by its value</option>
              {sites.map((x) => <option key={x.id} value={x.id}>{x.name} (value {x.importance})</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ops-dim">Two sides at once splits the defender’s fire. Aiming everything at one site overwhelms whatever stands beside it, but leaves the rest of the region untouched. You can also click a site on the map.</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Route">
          {([['direct', 'Straight in', 'free'], ['turn', 'Turn in flight', `+${R.turn}`], ['valley', 'Along the valleys', `+${R.valley}`]] as const).map(([id, label, price]) => (
            <button key={id} role="radio" aria-checked={(w.route ?? 'direct') === id} disabled={id === 'valley' && !valleyHere}
              title={id === 'valley' && !valleyHere ? 'No valley opens onto the side this wave comes from' : undefined}
              className={`btn px-2 py-0.5 ${(w.route ?? 'direct') === id ? 'btn-active' : ''}`} onClick={() => set({ ...w, route: id === 'direct' ? undefined : id })}>{label} <span className="text-ops-amber">{price}</span></button>
          ))}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ops-dim">
          Turning: drones and cruise missiles bend round to arrive from an angle the defender did not cover. Valleys: drones and cruise missiles fly low between the hills, hidden from radars that are not in the valley.
          {' '}{valleys.length ? `This map has a valley opening to the ${valleys.map((v) => v.side).join(' and the ')}.` : 'This map has no valleys.'} Rockets and ballistic missiles always fly straight.
        </p>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <Opt on={!!w.hunt} onChange={(v) => set({ ...w, hunt: v || undefined })} label="Hunt the radars" cost={`+${R.hunt}`}>
          {`About ${Math.round(R.huntShare * 100)}% of this wave’s missiles and fast drones go for the defender’s radars instead of the sites. A radar that is hit is out of the fight for the waves behind it.`}
        </Opt>
        <Opt on={!!w.hidden} onChange={(v) => set({ ...w, hidden: v || undefined })} label="Keep it out of the forecast" cost={`+${Math.ceil(cost.threats * R.hidden)}`}>
          {`The defender places a defense from a forecast, and this wave will not be in it. They learn of it only from the launch warning, a few hours ahead. Costs ${Math.round(R.hidden * 100)}% of the wave’s threats; at least one wave must be forecast.`}
        </Opt>
      </div>
      <label className="flex flex-wrap items-center gap-2 rounded border border-ops-line px-2 py-1.5">
        <b className="text-white">Decoys</b>
        <input type="number" className="input w-14 py-0.5 text-center" min={0} max={R.maxDecoys} value={w.decoys ?? 0} onChange={(e) => set({ ...w, decoys: Math.max(0, Math.min(R.maxDecoys, Math.round(Number(e.target.value)) || 0)) || undefined })} aria-label={`Decoys in wave ${i + 1}`} />
        <span className="text-ops-amber">{R.decoy} point each</span>
        <span className="min-w-0 flex-1 basis-48 text-[11px] leading-snug text-ops-dim">False tracks that look like drones. They do no damage, but a defender without a sharp radar wastes interceptors on them.</span>
      </label>
    </div>
  );
}

function Rehearsal({ result, stale }: { result: { preview: DefensePreview; systems: number }; stale: boolean }) {
  const p = result.preview;
  return (
    <div className={`rounded border border-ops-line p-2 text-[11px] leading-snug ${stale ? 'opacity-50' : ''}`} role="status">
      <b className="text-white">Rehearsal{stale ? ' (before your last change)' : ''}:</b> the computer builds {result.systems} systems from the forecast and prevents about{' '}
      <b className="text-white">{pct(p.prevented)}</b> of the damage this raid could do (usually {pct(p.range[0])} to {pct(p.range[1])}). {p.prevented >= 0.6 ? 'It holds. Look for what it stops least.' : p.prevented >= 0.35 ? 'A good share gets through.' : 'This raid breaks it.'}
      <div className="mt-1 flex flex-wrap gap-x-3">
        {Object.entries(p.byClass).map(([c, v]) => <span key={c}>{THREAT_LABELS[c as ThreatClass]}: <b className={v >= 0.6 ? 'text-ops-amber' : 'text-ops-green'}>{pct(v)} stopped</b></span>)}
      </div>
    </div>
  );
}

export function RaidDesigner({ onClose, reply }: { onClose: () => void; reply?: { attacker: 1 | 2; size: Raid['size'] } }) {
  const ui = useUI();
  // A reply in a match starts from a clean sheet of the same size: the last raid was the other player's.
  const [raid, setRaidState] = useState<Raid>(() => (reply ? { ...blank(), size: reply.size } : loadDraft()));
  const match = useMemo(loadMatch, []);
  const [sel, setSel] = useState(0);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [rehearsal, setRehearsal] = useState<{ key: string; result: { preview: DefensePreview; systems: number } } | null>(null);
  const setRaid = (r: Raid) => setRaidState(r);
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(raid)); } catch { /* storage unavailable */ } }, [raid]);
  // The map, sites, night and storms of the day the raid is written for: the same ones the defender will get.
  const world = useMemo(() => createInitialState(raidSettings({ region: raid.region, seed: raid.seed, waves: [] }, defaultSettings('training'))), [raid.region, raid.seed]);
  const cost = raidCost(raid);
  const points = raidPoints(raid);
  const problems = raidProblems(raid);
  const ready = problems.length === 0;
  const i = Math.min(sel, raid.waves.length - 1);
  const key = JSON.stringify(raid);
  const setWave = (k: number, w: RaidWave) => setRaid({ ...raid, waves: raid.waves.map((x, j) => (j === k ? w : x)) });
  /** A new map or region has different sites, so aimed waves go back to spreading out. */
  const remap = (patch: Partial<Raid>) => setRaid({ ...raid, ...patch, waves: raid.waves.map(({ target: _t, ...w }) => (w.route === 'valley' ? { ...w, route: undefined } : w)) });
  const go = (how: 'watch' | 'hand') => {
    // Handing a raid over from the start screen opens a new match; a reply carries the match on.
    if (how === 'hand' && !reply) saveMatch({ rounds: [] });
    startRaid(raid, how, reply ? (reply.attacker === 1 ? 2 : 1) : 2);
    ui.setView('theater');
    onClose();
  };
  const size = R.sizes[raid.size ?? 'standard'];
  return (
    <Modal wide tall title={reply ? `RAID DESIGNER · PLAYER ${reply.attacker} ATTACKS` : 'RAID DESIGNER · YOU ARE THE ATTACKER'} onClose={onClose}
      footer={<>
        <span className={`mr-auto self-center text-[12px] ${ready ? 'text-ops-dim' : 'text-ops-red'}`} role="status">
          Attack points: <b className={cost > points ? 'text-ops-red' : 'text-white'}>{cost}</b> of {points}{problems[0] ? ` · ${problems[0]}` : ` · ${points - cost} left`}
        </span>
        <button className="btn px-4 py-2 text-[13px]" disabled={!ready} title="The computer builds a defense from the forecast and you watch your raid go in" onClick={() => go('watch')}>Attack the computer ▶</button>
        <button className="btn btn-primary px-4 py-2 text-[13px]" disabled={!ready} title="Starts the battle on the defender’s briefing. Hand over the keyboard first: nothing of your raid is shown except its forecast." onClick={() => go('hand')}>{reply ? `Hand to Player ${reply.attacker === 1 ? 2 : 1} ▶` : 'Hand to a defender ▶'}</button>
      </>}>
      <div className="space-y-3 text-[12px]">
        <p className="leading-relaxed text-ops-text">
          Write an attack on one region and try to get it through. Everything costs <b className="text-white">attack points</b>: the threats themselves, and each trick you add to a wave.
          The defender gets credits to match and sees only a forecast. Their <b className="text-white">defense score</b> is the share of your raid’s damage they prevented, so <b className="text-white">lower is better for you</b>.
        </p>
        {reply && <MatchScore match={match} />}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5"><span className="label">Raid name</span>
            <input className="input w-44 py-1" maxLength={40} placeholder="optional" value={raid.name ?? ''} onChange={(e) => setRaid({ ...raid, name: e.target.value || undefined })} /></label>
          <label className="flex flex-col gap-0.5"><span className="label">Target region</span>
            <select className="input py-1" value={raid.region} onChange={(e) => remap({ region: e.target.value as RegionId })}>{REGION_IDS.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}</select></label>
          <label className="flex flex-col gap-0.5"><span className="label">Size of the fight</span>
            <select className="input py-1" value={raid.size ?? 'standard'} onChange={(e) => setRaid({ ...raid, size: e.target.value === 'standard' ? undefined : e.target.value as Raid['size'] })}>
              {RAID_SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z]}: {R.sizes[z].points} points</option>)}
            </select></label>
          <label className="flex flex-col gap-0.5"><span className="label">Jam a radar band (+{R.jam})</span>
            <select className="input py-1" value={raid.jam ?? ''} onChange={(e) => setRaid({ ...raid, jam: e.target.value || undefined })}>
              <option value="">No jamming</option>
              {RAID_BANDS.map((b) => <option key={b} value={b}>{b}-band ({RADAR_BANDS[b].nick})</option>)}
            </select></label>
          <label className="flex flex-col gap-0.5"><span className="label">Hold in reserve</span>
            <input type="number" className="input w-24 py-1" min={0} max={maxReserve(raid)} step={10} value={raid.reserve ?? 0} aria-label="Attack points held in reserve"
              onChange={(e) => setRaid({ ...raid, reserve: Math.max(0, Math.min(maxReserve(raid), Math.round(Number(e.target.value)) || 0)) || undefined })} /></label>
          <button className="btn py-1" title="A different day: the sites, the valleys, the night and the storms all change" onClick={() => remap({ seed: newSeed() })}>New map and weather ↻</button>
        </div>
        <p className="text-[11px] leading-snug text-ops-dim">
          The defender starts with <b className="text-ops-text">{size.credits} credits</b>. Jamming cuts every radar on that band to {Math.round(JAMMING.range * 100)}% of its range for the whole battle and makes it worse at telling decoys from real threats; the defender is warned which band.
          {' '}<b className="text-ops-text">Reserve:</b> points you hold back (up to {maxReserve(raid)}) buy one more wave during the battle, written after you have seen how the others did. If the raid is played from a code, the game writes that wave for you from what got through.
          {raid.jam ? ` ${raid.jam}-band: ${RADAR_BANDS[raid.jam as keyof typeof RADAR_BANDS].summary}` : ' Sharp bands (C, X, Ku) are the ones that guide shots and spot decoys.'}
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <RaidMap s={world} raid={raid} sel={i} onSite={(id) => setWave(i, { ...raid.waves[i], target: raid.waves[i].target === id ? undefined : id })} />
            <p className="text-[11px] leading-snug text-ops-dim">The number in each site is its value: damage there counts that many times over. Numbered arrows are your waves (dotted: kept out of the forecast; long dashes: spread over every site).</p>
            <Timeline s={world} raid={raid} sel={i} onPick={setSel} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" disabled={!ready} onClick={() => { const result = rehearseRaid(raid); if (result) setRehearsal({ key, result }); }}>Rehearse against the computer</button>
              <span className="text-[11px] text-ops-dim">Flies the raid 30 times against the computer’s defense. Costs nothing; change the raid and try again.</span>
            </div>
            {rehearsal && <Rehearsal result={rehearsal.result} stale={rehearsal.key !== key} />}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Waves">
              {raid.waves.map((w, k) => (
                <button key={k} role="tab" aria-selected={k === i} className={`btn px-2 py-1 ${k === i ? 'btn-active' : ''}`} onClick={() => setSel(k)}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: WAVE_COLORS[k] }} />Wave {k + 1} <span className="text-ops-dim">· h{w.atHour} · {waveCost(w).total}</span>
                </button>
              ))}
              {raid.waves.length < R.maxWaves && (
                <button className="btn px-2 py-1" onClick={() => { setRaid({ ...raid, waves: [...raid.waves, { atHour: Math.min(R.hours[1], raid.waves[raid.waves.length - 1].atHour + 1), axis: 'south', tracks: { slowDrone: 4 } }] }); setSel(raid.waves.length); }}>＋ Add a wave</button>
              )}
              {raid.waves.length > 1 && <button className="btn ml-auto px-2 py-1" onClick={() => { setRaid({ ...raid, waves: raid.waves.filter((_, k) => k !== i) }); setSel(Math.max(0, i - 1)); }}>Remove wave {i + 1}</button>}
            </div>
            <WaveEditor s={world} raid={raid} i={i} set={(w) => setWave(i, w)} />
          </div>
        </div>

        <div className="rounded border border-ops-line p-2">
          <div className="label mb-1">Send it to someone else</div>
          <label className="mb-1.5 flex flex-wrap items-center gap-2">A message for the defender
            <input className="input min-w-0 flex-1 py-1" maxLength={140} placeholder="optional, shown in their briefing" value={raid.note ?? ''} onChange={(e) => setRaid({ ...raid, note: e.target.value || undefined })} />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="btn" disabled={!ready} onClick={async () => { const c = encodeRaid(raid); try { await navigator.clipboard.writeText(c); setNote('Raid code copied. Send it to a friend: they paste it here and press “Hand to a defender”. Ask them to send back the result from their debrief.'); } catch { setCode(c); setNote('Copy the code from the box.'); } }}>Copy raid code</button>
            <input className="input min-w-0 flex-1 py-1" placeholder="…or paste a raid code here" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Raid code" />
            <button className="btn" disabled={!code.trim()} title="Start defending the raid in the code without seeing what is in it" onClick={() => { const r = decodeRaid(code); if (r) { startRaid({ ...r, seed: r.seed ?? newSeed() }, 'code'); ui.setView('theater'); onClose(); } else setNote('That is not a valid raid code.'); }}>Defend this code ▶</button>
            <button className="btn" disabled={!code.trim()} title="Open the raid in the designer to read or change it" onClick={() => { const r = decodeRaid(code); if (r) { setRaid({ ...r, seed: r.seed ?? newSeed() }); setSel(0); setNote('Raid loaded into the designer.'); } else setNote('That is not a valid raid code.'); }}>Open it here</button>
            <button className="btn" onClick={() => { setRaid(blank()); setSel(0); setRehearsal(null); setNote('Started a fresh raid.'); }}>Start over</button>
          </div>
          {note && <p className="mt-1 text-[11px] text-ops-cyan" role="status">{note}</p>}
        </div>
      </div>
    </Modal>
  );
}

/** The attacker's reserve during a battle: where it stands, and the sheet to write the extra wave on. */
export function ReservePanel({ s }: { s: SimState }) {
  const [open, setOpen] = useState(false);
  const st = reserveStatus(s);
  const raid = s.settings.raid;
  if (!st || !raid || raid.byCode) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-[11px] ${st.ready ? 'border-ops-amber/70 bg-ops-amber/10' : 'border-ops-line'}`} role="status">
      <b className="text-ops-amber">ATTACKER’S RESERVE · {st.points} points</b>
      <span className="min-w-0 flex-1 basis-48 text-ops-dim">
        {st.ready ? (raid.attacker ? 'Your earlier waves have shown what gets through. Write one more.' : 'Defender: when the attacker wants to send it, pause and hand them the keyboard. It will arrive outside the forecast.') : st.why}
      </span>
      {st.ready && <button className="btn btn-primary px-2 py-0.5" onClick={() => { dispatch({ type: 'setPaused', paused: true }); setOpen(true); }}>Commit the reserve…</button>}
      {open && <ReserveSheet s={s} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ReserveSheet({ s, onClose }: { s: SimState; onClose: () => void }) {
  const raid = s.settings.raid!;
  const t = s.tactical!;
  const points = raid.reserve ?? 0;
  const [w, setW] = useState<ReserveWave>(() => autoReserveWave(s) ?? { axis: raid.waves[0].axis, tracks: {} });
  const sites = t.sites.filter((x) => x.region === raid.region && x.integrity > 0);
  const done = t.waves.filter((x) => x.applied);
  const cost = waveCost({ atHour: 0, ...w }).threats;
  const problem = reserveProblem(s, w);
  const num = (c: ThreatClass, n: number) => setW({ ...w, tracks: { ...w.tracks, [c]: Math.max(0, Math.min(R.maxPerClass, Math.round(n) || 0)) } });
  const tally = THREAT_CLASSES.map((c) => {
    const real = done.flatMap((x) => x.tracks).filter((x) => !x.decoy && x.cls === c);
    return { c, sent: real.length, through: real.filter((x) => x.outcome === 'leaked').length };
  }).filter((x) => x.sent);
  return (
    <Modal title="COMMIT THE RESERVE · ATTACKER ONLY" onClose={onClose}
      footer={<>
        <span className={`mr-auto self-center text-[12px] ${problem ? 'text-ops-red' : 'text-ops-dim'}`} role="status">{cost} of {points} points{problem ? ` · ${problem}` : ` · arrives in about ${reserveLead(w)} hours`}</span>
        <button className="btn px-3 py-1.5" onClick={onClose}>Not yet</button>
        <button className="btn btn-primary px-3 py-1.5" disabled={!!problem} onClick={() => { if (dispatch({ type: 'commitReserve', wave: w }).ok) onClose(); }}>Send it ▶</button>
      </>}>
      <div className="space-y-2 text-[12px]">
        <p className="leading-relaxed text-ops-text">One more wave, bought with the points you held back. It is not in the defender’s forecast; they get only the launch warning. It can be sent once, and points left over are lost. The game is paused.</p>
        <div className="rounded border border-ops-line p-2">
          <div className="label mb-1">What your raid has done so far</div>
          {tally.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
              {tally.map((x) => <span key={x.c}>{THREAT_LABELS[x.c]}: <b className={x.through / x.sent >= 0.4 ? 'text-ops-green' : 'text-ops-amber'}>{x.through} of {x.sent} got through</b></span>)}
            </div>
          ) : <p className="text-[11px] text-ops-dim">Nothing has landed yet.</p>}
        </div>
        <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {THREAT_CLASSES.map((c) => (
            <div key={c} className="flex items-center justify-between gap-1 text-[11px]">
              <span className="min-w-0 truncate">{THREAT_LABELS[c]} <span className="text-ops-dim">({TACTICAL_CONFIG.threatCost[c]})</span></span>
              <span className="flex shrink-0 items-center gap-0.5">
                <button className="btn px-1.5 py-0" onClick={() => num(c, (w.tracks[c] ?? 0) - 1)} aria-label={`One fewer ${THREAT_LABELS[c]}`}>−</button>
                <input type="number" className="input w-12 px-1 py-0.5 text-center" min={0} max={R.maxPerClass} value={w.tracks[c] ?? 0} aria-label={`${THREAT_LABELS[c]} in the reserve wave`} onChange={(e) => num(c, Number(e.target.value))} />
                <button className="btn px-1.5 py-0" onClick={() => num(c, (w.tracks[c] ?? 0) + 1)} aria-label={`One more ${THREAT_LABELS[c]}`}>＋</button>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="flex items-center gap-1">From the
            <select className="input py-0.5" value={w.axis} onChange={(e) => setW({ ...w, axis: e.target.value as ThreatAxis })}>{RAID_AXES.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <label className="flex items-center gap-1">Aimed at
            <select className="input max-w-[12rem] py-0.5" value={w.target ?? ''} onChange={(e) => setW({ ...w, target: e.target.value || undefined })}>
              <option value="">every site, by its value</option>
              {sites.map((x) => <option key={x.id} value={x.id}>{x.name} (value {x.importance}, {Math.round(x.integrity)}% standing)</option>)}
            </select></label>
          <button className="btn px-2 py-0.5" title="More of whatever got through best for its cost, from the side that did best" onClick={() => { const a = autoReserveWave(s); if (a) setW(a); }}>Let the game choose</button>
        </div>
      </div>
    </Modal>
  );
}

/** The debrief of a raid battle from the attacker's side, with a line to send back to whoever wrote the raid. */
export function RaidDebrief({ s, score }: { s: SimState; score: number }) {
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState(false);
  const [match, setMatch] = useState<Match>(loadMatch);
  const r = raidReport(s);
  const raid = s.settings.raid;
  const final = s.status === 'complete';
  const defender = raid?.defender;
  const id = s.campaignId ?? '';
  // A finished round of a match is written down once.
  useEffect(() => {
    if (!final || !defender || !id) return;
    const m = loadMatch();
    if (m.rounds.some((x) => x.id === id)) return;
    const next = { rounds: [...m.rounds, { id, defender, score }] };
    saveMatch(next);
    setMatch(next);
  }, [final, defender, id, score]);
  if (!r || !raid) return null;
  const done = r.waves.every((w) => w.done);
  const line = `${raid.name ? `Raid “${raid.name}”` : 'Your raid'} on ${regionName(raid.region)}: defense score ${score} of 100. ${r.through} of ${r.sent} threats got through for ${r.damage} damage${r.radarsHit ? `, and ${r.radarsHit} defending system${r.radarsHit === 1 ? ' was' : 's were'} hit` : ''}. The raid cost ${r.spent} attack points; the defender fired ${r.defenderSpent} credits of interceptors.`;
  return (
    <div className="space-y-2 text-[12px]">
      <p className="leading-relaxed text-ops-text">
        {raid.attacker ? 'You wrote this raid and the computer defended it.' : defender ? `Player ${defender === 1 ? 2 : 1} wrote this raid and Player ${defender} defended it.` : 'Another commander wrote this raid.'} It cost <b className="text-white">{r.spent} attack points</b>.{' '}
        <b className="text-white">{r.through} of {r.sent}</b> threats got through and did <b className="text-white">{r.damage}</b> damage{r.spent ? <> ({(r.damage / r.spent * 100).toFixed(1)} per 100 points)</> : null}.
        The defender fired <b className="text-white">{r.defenderSpent} credits</b> of interceptors. For the attacker, a lower defense score is a better raid.
      </p>
      <table className="w-full text-left text-[11px]">
        <thead className="text-ops-dim"><tr><th className="py-0.5 font-normal">Wave</th><th className="font-normal">Sent</th><th className="font-normal">Got through</th><th className="font-normal">Damage</th><th className="font-normal">In the forecast</th></tr></thead>
        <tbody>
          {r.waves.map((w, i) => (
            <tr key={i} className="border-t border-ops-line"><td className="py-0.5">Wave {i + 1}</td><td>{w.sent}</td><td>{w.done ? w.through : 'not yet arrived'}</td><td>{w.done ? w.damage : '—'}</td><td>{w.hidden ? 'No: a surprise' : 'Yes'}</td></tr>
          ))}
        </tbody>
      </table>
      {final && defender && (
        <div className="space-y-1.5 rounded border border-ops-cyan/40 p-2">
          <MatchScore match={match} />
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={() => setReply(true)}>Swap sides: Player {defender} writes the reply ▶</button>
            <span className="min-w-0 flex-1 basis-48 text-[11px] text-ops-dim">Player {defender} now attacks and Player {defender === 1 ? 2 : 1} defends, with a raid of the same size. The better average defense score wins.</span>
            <button className="btn" onClick={() => { saveMatch({ rounds: [] }); setMatch({ rounds: [] }); }}>End the match</button>
          </div>
          {reply && <RaidDesigner reply={{ attacker: defender, size: raid.size }} onClose={() => setReply(false)} />}
        </div>
      )}
      {done && raid.byCode && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(line); setCopied(true); } catch { setCopied(false); } }}>Copy the result for the author</button>
          <span className="min-w-0 flex-1 basis-64 text-[11px] text-ops-dim">{copied ? 'Copied. Paste it to whoever sent you the raid.' : line}</span>
        </div>
      )}
    </div>
  );
}
