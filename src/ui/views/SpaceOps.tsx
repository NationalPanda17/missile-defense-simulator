// Space operations: where every satellite is, what it covers, and what you can do with it (move a GEO slot, launch).
import { useState } from 'react';
import {
  MISSIONS, REGIMES, REGION_IDS, SPACE, availability, debrisCloud, driftFuel, driftHours, inViewAt, jammed, lonText, missionUp,
  nextPass, repositionError, sats, spaceSupport, subPoint, type Asset, type RegionId, type SimState, type SpaceMission,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { Bar, Chip, Panel } from '../components/ui';
import { useUI } from '../uiState';

export const MISSION_COLOR: Record<SpaceMission, string> = { warning: '#f2545b', tracking: '#f5a623', nav: '#8b9cff', relay: '#38d6f5', imaging: '#4ade80' };

const W = 720;
const H = 360;
const px = (p: [number, number]): [number, number] => [((p[0] + 180) / 360) * W, ((90 - p[1]) / 180) * H];

/** Points of a small circle of `radius` degrees round a lon/lat centre, for drawing a footprint. */
function circle(c: [number, number], radius: number): [number, number][] {
  const out: [number, number][] = [];
  const [lon0, lat0] = c.map((d) => (d * Math.PI) / 180);
  const r = (radius * Math.PI) / 180;
  for (let k = 0; k <= 72; k++) {
    const b = (k / 72) * 2 * Math.PI;
    const lat = Math.asin(Math.sin(lat0) * Math.cos(r) + Math.cos(lat0) * Math.sin(r) * Math.cos(b));
    const lon = lon0 + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(lat0), Math.cos(r) - Math.sin(lat0) * Math.sin(lat));
    out.push([((((lon * 180) / Math.PI + 540) % 360) - 180), (lat * 180) / Math.PI]);
  }
  return out;
}

/** A polyline over the flat map, broken where it wraps round the date line. */
function path(points: [number, number][]): string {
  let d = '';
  let prev: [number, number] | null = null;
  for (const p of points) {
    const [x, y] = px(p);
    d += `${prev && Math.abs(p[0] - prev[0]) < 180 ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    prev = p;
  }
  return d;
}

function OrbitMap({ s, focus, setFocus }: { s: SimState; focus: string | null; setFocus: (id: string | null) => void }) {
  const list = sats(s);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-ops-line bg-[#06101c]" role="img" aria-label="Orbit map: where each satellite is now and what it can see">
      {[-60, -30, 0, 30, 60].map((lat) => <line key={lat} x1={0} x2={W} y1={px([0, lat])[1]} y2={px([0, lat])[1]} stroke="#16263a" strokeDasharray={lat === 0 ? '' : '2 4'} />)}
      {[-120, -60, 0, 60, 120].map((lon) => <line key={lon} y1={0} y2={H} x1={px([lon, 0])[0]} x2={px([lon, 0])[0]} stroke="#16263a" strokeDasharray="2 4" />)}
      <text x={4} y={px([0, 70])[1] - 3} fontSize={9} fill="#3d5470">70°N: above this GEO cannot see</text>
      <line x1={0} x2={W} y1={px([0, 70])[1]} y2={px([0, 70])[1]} stroke="#3d5470" strokeDasharray="1 3" />
      {REGION_IDS.map((r) => {
        const [x, y] = px(s.regions[r].center);
        const sup = spaceSupport(s, r, s.hour);
        return (
          <g key={r}>
            <circle cx={x} cy={y} r={4} fill={sup.warning ? '#f2545b' : '#3d5470'} />
            <text x={x + 6} y={y + 3} fontSize={10} fill="#a9bdd6">{s.regions[r].short}</text>
          </g>
        );
      })}
      {list.map((a) => {
        const o = a.orbit!;
        const color = MISSION_COLOR[o.mission];
        const p = subPoint(o, s.hour);
        const dim = !missionUp(s, a);
        const on = focus === a.id;
        if (!p) return null;
        // Footprint now, and where it is heading (ground track over the next hours) for orbits that move.
        const reach = SPACE.footprint[o.regime];
        const showFoot = on && reach && !o.destroyed && !o.drift && (o.regime !== 'HEO' || p[1] >= 40);
        const ahead = o.regime === 'LEO' || o.regime === 'SSO' ? (on ? 3 : 1) : o.regime === 'HEO' ? (on ? 12 : 0) : 0;
        const track: [number, number][] = [];
        for (let k = 0; k <= ahead * 12; k++) { const q = subPoint(o, s.hour + k / 12); if (q) track.push(q); }
        const [x, y] = px(p);
        return (
          <g key={a.id} opacity={dim ? 0.35 : 1} onClick={() => setFocus(on ? null : a.id)} style={{ cursor: 'pointer' }}>
            {showFoot && <path d={path(circle(p, reach))} fill={color} fillOpacity={0.06} stroke={color} strokeOpacity={0.9} strokeWidth={1.5} />}
            {track.length > 1 && <path d={path(track)} fill="none" stroke={color} strokeOpacity={on ? 0.8 : 0.35} strokeDasharray="3 3" />}
            {o.drift && (() => { const [tx] = px([o.drift.toLon, 0]); return <line x1={x} y1={y} x2={tx} y2={y} stroke={color} strokeDasharray="4 2" markerEnd="" />; })()}
            {o.destroyed
              ? <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fill="#f2545b">✕</text>
              : <rect x={x - 4} y={y - 4} width={8} height={8} transform={`rotate(45 ${x} ${y})`} fill={color} stroke={on ? '#fff' : 'none'} />}
            <text x={x + 7} y={y - 6} fontSize={9} fill={on ? '#fff' : color}>{a.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Status({ s, a }: { s: SimState; a: Asset }) {
  const o = a.orbit!;
  if (o.destroyed) return <Chip t="red">destroyed</Chip>;
  if (o.drift) return <Chip t="amber" title={`Arrives over ${lonText(o.drift.toLon)}`}>drifting {o.drift.left}h</Chip>;
  if (jammed(s, a)) return <Chip t="red">jammed</Chip>;
  if (availability(s, a) <= 0.3) return <Chip t="red">down</Chip>;
  return <Chip t="green">on mission</Chip>;
}

/** Where it is or when it is next useful, in words. */
function where(s: SimState, a: Asset): string {
  const o = a.orbit!;
  if (o.destroyed) return '—';
  if (o.regime === 'GEO') return o.drift ? `drifting ${lonText(o.drift.fromLon)} → ${lonText(o.drift.toLon)}` : `over ${lonText(o.lon!)}`;
  if (o.regime === 'MEO' || o.size) return `${o.size ?? 24} satellites, global`;
  const now = inViewAt(s, o, s.hour);
  if (o.regime === 'HEO') return now.length ? `at apogee: ${now.map((r) => s.regions[r].short).join(' ')}` : 'swinging through the south';
  return now.length ? `over ${now.map((r) => s.regions[r].short).join(' ')} now` : 'between passes';
}

function MoveSlot({ s, a }: { s: SimState; a: Asset }) {
  const [to, setTo] = useState<RegionId | ''>('');
  const o = a.orbit!;
  const targets = REGION_IDS.filter((r) => r !== 'POL');
  const lon = to ? Math.round(s.regions[to].center[0]) : null;
  const d = lon === null ? 0 : Math.abs(((lon - o.lon! + 540) % 360) - 180);
  const err = lon === null ? 'Choose a region' : repositionError(s, a, lon);
  return (
    <span className="flex items-center gap-1">
      <select className="input py-0 text-[10px]" value={to} onChange={(e) => setTo(e.target.value as RegionId)} aria-label={`Move ${a.name} over a region`}>
        <option value="">Move over…</option>
        {targets.map((r) => <option key={r} value={r}>{s.regions[r].short} ({lonText(Math.round(s.regions[r].center[0]))})</option>)}
      </select>
      <button className="btn px-1.5 py-0 text-[10px]" disabled={!!err} title={err ?? `${driftHours(d)}h off station, ${Math.ceil(driftFuel(d))}% propellant`}
        onClick={() => lon !== null && dispatch({ type: 'moveSat', assetId: a.id, lon })}>
        {lon === null || err === 'Already there.' ? 'Move' : `Move (${driftHours(d)}h, ${Math.ceil(driftFuel(d))}%)`}
      </button>
    </span>
  );
}

export function SpaceOps({ s }: { s: SimState }) {
  const ui = useUI();
  const [focus, setFocus] = useState<string | null>(null);
  const list = sats(s);
  if (!list.length) {
    return (
      <Panel className="xl:col-span-3" title="Orbits">
        <p className="text-ops-dim">This save is from before satellites had real orbits: they keep their fixed coverage. Start a new scenario to fly them in orbit.</p>
      </Panel>
    );
  }
  const strikes = (s.space?.strikes ?? []).filter((x) => x.target);
  return (
    <>
      <Panel className="min-w-0 xl:col-span-2" title="Orbit Map" right={<span className="text-ops-dim">Click a satellite for its footprint and track</span>}>
        <OrbitMap s={s} focus={focus} setFocus={setFocus} />
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          {(Object.keys(MISSION_COLOR) as SpaceMission[]).map((m) => <span key={m}><span className="mr-1 inline-block h-2 w-2 rotate-45" style={{ background: MISSION_COLOR[m] }} />{MISSIONS[m].name}</span>)}
          <span className="text-ops-dim">Click a satellite for what it can see (its footprint) and where it goes next. Red dot: a region with missile warning now.</span>
        </div>
        {debrisCloud(s) && <p className="mt-1 text-[11px] text-ops-red">Debris cloud in low orbit until T+{s.space!.debrisUntil}h: close approaches are about {SPACE.debris.conjunction}× as likely for low satellites.</p>}
      </Panel>

      <Panel className="min-w-0" title="Coverage by Region" bodyClass="p-0 overflow-x-auto">
        <table className="table-ops w-full text-[10px]">
          <thead><tr><th>Region</th><th title={MISSIONS.warning.text}>Warning</th><th title={MISSIONS.imaging.text}>Imaging</th><th title={MISSIONS.relay.text}>Relay</th></tr></thead>
          <tbody>
            {REGION_IDS.map((r) => {
              const sup = spaceSupport(s, r, s.hour);
              const imagers = list.filter((a) => a.orbit!.mission === 'imaging' && missionUp(s, a));
              const next = imagers.map((a) => nextPass(s, a.orbit!, r, s.hour)).filter((h): h is number => h !== null).sort((x, y) => x - y)[0];
              const relays = list.filter((a) => a.orbit!.mission === 'relay' && missionUp(s, a) && inViewAt(s, a.orbit!, s.hour).includes(r)).length;
              return (
                <tr key={r}>
                  <td className="whitespace-nowrap">{s.regions[r].short}</td>
                  <td className={sup.warning ? 'text-ops-green' : 'text-ops-red'}>{sup.warning ? sup.warning.name : 'none'}</td>
                  <td className={sup.imaging ? 'text-ops-green' : 'text-ops-dim'}>{sup.imaging ? 'imaged' : !imagers.length ? 'no imager working' : next === undefined ? 'none' : `pass in ${next}h`}</td>
                  <td className={relays ? '' : 'text-ops-amber'}>{relays}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="p-2 text-[10px] text-ops-dim">
          Tracking layer and navigation cover every region. Imaged: a pass in the last {SPACE.imagingWindowH}h, so a wave launched now is known in advance.
        </p>
      </Panel>

      <Panel className="min-w-0 xl:col-span-3" title="Satellites" bodyClass="p-0 overflow-x-auto" right={<button className="btn px-1.5 py-0 text-[10px]" onClick={() => ui.setView('logistics')}>Launch satellites (Logistics) ›</button>}>
        <table className="table-ops w-full min-w-[720px] text-[11px]">
          <thead><tr><th>Satellite</th><th>Orbit</th><th>Mission</th><th>Where</th><th>Status</th><th className="w-28">Propellant</th><th /></tr></thead>
          <tbody>
            {list.map((a) => {
              const o = a.orbit!;
              return (
                <tr key={a.id} className={focus === a.id ? 'bg-ops-cyan/5' : ''}>
                  <td className="whitespace-nowrap"><button className="text-white hover:text-ops-cyan" title={a.className} onClick={() => setFocus(a.id)}>{a.name}</button></td>
                  <td title={`${REGIMES[o.regime].name}, ${REGIMES[o.regime].altitude}: ${REGIMES[o.regime].text}`}>{o.regime}</td>
                  <td title={MISSIONS[o.mission].text}><span style={{ color: MISSION_COLOR[o.mission] }}>{MISSIONS[o.mission].name}</span></td>
                  <td className="text-ops-dim">{where(s, a)}</td>
                  <td><Status s={s} a={a} /></td>
                  <td><Bar value={o.fuel} showValue height={5} color={o.fuel < 15 ? '#f2545b' : undefined} /></td>
                  <td className="text-right">{o.regime === 'GEO' && !o.destroyed && <MoveSlot s={s} a={a} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="p-2 text-[10px] text-ops-dim">
          Propellant cannot be refilled in orbit: every move and every dodge spends some, and a satellite with none left cannot dodge debris or an approaching inspector.
          Moving a geostationary satellite takes it off station while it drifts.
          {strikes.length > 0 && <span className="text-ops-red"> Lost to anti-satellite strikes: {strikes.map((x) => s.assets.find((a) => a.id === x.target)?.name).join(', ')}.</span>}
        </p>
      </Panel>
    </>
  );
}

/** For the wave breakdown: what space did for one wave, in a line. */
export function spaceLine(s: SimState, w: { space?: { warned?: string; tracked?: string; imaged?: string; nav?: number } }): string | null {
  const sp = w.space;
  if (!sp || !(sp.warned || sp.tracked || sp.imaged)) return null;
  const name = (id: string) => s.assets.find((a) => a.id === id)?.name ?? 'a satellite';
  const parts: string[] = [];
  if (sp.warned) parts.push(`launch warning from ${name(sp.warned)} (crews reacted faster to the ballistic and hypersonic threats)`);
  if (sp.tracked) parts.push(`${name(sp.tracked)} tracked the high-flying threats from orbit`);
  if (sp.imaged) parts.push(`${name(sp.imaged)} had imaged the launch area (decoys easier to tell apart)`);
  return `Space: ${parts.join('; ')}.`;
}

