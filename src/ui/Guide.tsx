// The field guide: everything a new player needs, in plain language, with the numbers read from the game's own rules
// so the guide can never drift from what the simulation does. Opened with ? from anywhere, including the start screen.
import { useState, type ReactNode } from 'react';
import {
  THREAT_VARIANTS, type ThreatVariant, COMMAND_LEVELS, COMMAND_LEVEL_IDS, DOCTRINES, ENEMY_STYLES, ENEMY_STYLE_IDS, EQUIPMENT, INVESTMENTS, JAMMING, MEDALS, THEME_UNLOCKS, LAYER_LABELS, PASSIVE_SENSOR, PROTECTION_SCORE_WEIGHT, RADAR_BANDS, RADAR_BAND_IDS, SIM_CONFIG,
  STOCKPILES, STORIES, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, WEATHER, channelsOf, equipmentCost, isEffector, isUnlimited, type DefenseLayer, type EquipmentSpec, type FireDoctrine, type RadarBand, type ThreatClass,
} from '../engine';
import { Modal } from './components/ui';
import { DisplaySettings } from './a11y/DisplayControl';
import { LAYER_COLOR } from './views/theater/icons';
import { useUI } from './uiState';

export type GuideTab = 'start' | 'first' | 'threats' | 'defenses' | 'equipment' | 'bands' | 'phase' | 'network' | 'score' | 'glossary' | 'keys';

const TABS: { id: GuideTab; label: string }[] = [
  { id: 'start', label: 'Start here' },
  { id: 'first', label: 'Your first phase' },
  { id: 'threats', label: 'Threats' },
  { id: 'defenses', label: 'Defenses' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'bands', label: 'Radar bands' },
  { id: 'phase', label: 'During a phase' },
  { id: 'network', label: 'Network & reports' },
  { id: 'score', label: 'Scoring' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'keys', label: 'Keys & display' },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const H = ({ children }: { children: ReactNode }) => <h3 className="mt-4 font-sans text-[15px] font-semibold text-white first:mt-0">{children}</h3>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-1.5 text-[12px] leading-relaxed text-ops-text">{children}</p>;
const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-white">{children}</b>;
const Tip = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 rounded border border-ops-cyan/40 bg-ops-cyan/5 px-2.5 py-1.5 text-[12px] leading-relaxed text-ops-text"><span className="label mr-1.5 text-ops-cyan">Tip</span>{children}</p>
);
const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-ops-text">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
);
const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-[12px] leading-relaxed text-ops-text">{items.map((x, i) => <li key={i}>{x}</li>)}</ol>
);

/** A 0-1 rating as a short bar with its percentage. */
export function Meter({ value, good = true }: { value: number; good?: boolean }) {
  const col = !good ? '#7088a8' : value >= 0.7 ? '#34d399' : value >= 0.4 ? '#f5b13d' : '#f2545b';
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span className="inline-block h-1.5 w-12 overflow-hidden rounded-sm bg-ops-line/70"><span className="block h-full" style={{ width: `${Math.max(3, value * 100)}%`, background: col }} /></span>
      <span className="tabular-nums">{pct(value)}</span>
    </span>
  );
}

// ── Threats ──────────────────────────────────────────────────────────────

const THREAT_ABBR: Record<ThreatClass, string> = { slowDrone: 'SD', fastDrone: 'FD', cruise: 'CM', rocket: 'RK', ballistic: 'BM', hypersonic: 'HG' };
const THREAT_WHAT: Record<ThreatClass, { what: string; stop: string }> = {
  slowDrone: {
    what: 'A small propeller aircraft with a warhead. Slow and cheap, so they come in swarms. Flies low.',
    stop: 'Guns (Skynex, Gepard), Coyote, jammers and microwave weapons, placed on the site itself. Don’t waste big missiles on them.',
  },
  fastDrone: {
    what: 'A jet-powered drone. Three times as fast, so short-range weapons get less time to react. Flies low.',
    stop: 'The better guns and short-range missiles (Skynex, Coyote, NASAMS, IRIS-T SLM, CAMM).',
  },
  cruise: {
    what: 'A guided missile that hugs the ground to stay under radar, and may turn mid-flight. Does heavy damage.',
    stop: 'Short and medium-range missile systems (NASAMS, IRIS-T SLM, CAMM, Barak MX) close to the target, or cued by an aircraft radar.',
  },
  rocket: {
    what: 'An unguided rocket on a short, high arc. In the air for seconds, so only very quick systems catch it.',
    stop: 'Iron Dome, David’s Sling or Iron Beam near the sites being shelled.',
  },
  ballistic: {
    what: 'A large missile that climbs high above the atmosphere and falls on its target at enormous speed. The most damaging threat.',
    stop: 'Only systems with a high ceiling: Patriot PAC-3, SAMP/T, David’s Sling, Arrow, THAAD and the Aegis ships.',
  },
  hypersonic: {
    what: 'A glider released at the edge of space that skims the upper atmosphere at enormous speed and always swerves on the way in. Rare, appears late in a campaign, and does the most damage of all.',
    stop: 'Very little: THAAD, the Aegis SM-6 destroyer, Patriot PAC-3, SAMP/T and Arrow 2 each have a modest chance. Layer two of them over what you cannot afford to lose.',
  },
};

/** A threat type's traits in game terms, e.g. "seen at 60% range · 3 at a time". */
function traitLine(v: ThreatVariant): string {
  const x = v.traits;
  const out: string[] = [];
  if (x.sig) out.push(`seen at ${pct(x.sig)} of normal range`);
  if (x.speed) out.push(`${x.speed}× speed`);
  if (x.evade) out.push(`each shot ${pct(1 - x.evade)} less likely to stop it`);
  if (x.group) out.push(`${x.group} at a time`);
  if (x.damage) out.push(`${pct(x.damage)} damage`);
  if (x.decoys) out.push(`${x.decoys} decoys each`);
  if (x.miss) out.push(`${pct(x.miss)} land wide`);
  if (x.hunt) out.push('targets radars');
  return out.join(' · ');
}

function Threats() {
  const C = TACTICAL_CONFIG;
  return (
    <>
      <H>The six kinds of threat</H>
      <P>Every attack is a <B>wave</B>: a group of threats that arrives together from one side of the map, each aimed at one of your sites. There are six kinds, and no single weapon is good against all of them. The two-letter codes appear throughout the game.</P>
      <div className="mt-2 overflow-x-auto">
        <table className="table-ops w-full text-[11px]">
          <thead><tr><th>Threat</th><th>What it is</th><th>What stops it</th><th>Flies at</th><th>Damage</th></tr></thead>
          <tbody>
            {THREAT_CLASSES.map((c) => (
              <tr key={c} className="align-top">
                <td className="whitespace-nowrap text-white"><span className="mr-1 rounded-sm border border-ops-line px-1 text-ops-cyan">{THREAT_ABBR[c]}</span>{THREAT_LABELS[c]}</td>
                <td>{THREAT_WHAT[c].what}</td>
                <td>{THREAT_WHAT[c].stop}</td>
                <td className="whitespace-nowrap">{C.lowAltitude.classes.includes(c) ? <span className="text-ops-amber">low</span> : <span>high ({C.threatAltitudeKm[c]} km)</span>}</td>
                <td className="tabular-nums">{C.threatDamage[c]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <H>Threat types</H>
      <P>Each kind comes in a few real-world types. A type keeps its kind’s rules (which systems can engage it, how high it flies) and changes one or two things. The standard type of each kind appears from the start. Each later phase of a campaign brings in one more type (a phase later on Recruit), shown in that phase’s briefing; which ones you meet changes from campaign to campaign, and enemy commanders bring in their favourites more often. On Commander the enemy also switches to harder types of whatever you stop well. The designations are real; how each behaves here is a game value.</P>
      <div className="mt-2 overflow-x-auto">
        <table className="table-ops w-full text-[11px]">
          <thead><tr><th>Type</th><th>Earliest</th><th>What is different</th><th>What beats it</th></tr></thead>
          <tbody>
            {THREAT_VARIANTS.map((v) => (
              <tr key={v.id} className="align-top">
                <td className="text-white"><span className="mr-1 rounded-sm border border-ops-line px-1 text-ops-cyan">{THREAT_ABBR[v.cls]}</span>{v.name}<div className="text-[10px] text-ops-dim">{v.designation}</div></td>
                <td className="whitespace-nowrap">{v.from === 0 ? 'start' : `phase ${v.from + 1}`}</td>
                <td>{v.text}{traitLine(v) && <div className="text-[10px] text-ops-dim">{traitLine(v)}</div>}</td>
                <td>{v.counter}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P><B>Damage</B> is how much integrity (out of 100) a site loses when that threat gets through. Damage carries over from phase to phase until you rebuild it (Logistics → Rebuild Damaged Sites), and until then it costs you:</P>
      <List items={[
        <><B>Income.</B> A region whose sites are wrecked pays less in: up to {pct(C.consequences.incomeMax)} of your income can be lost this way.</>,
        <><B>Readiness and stability</B> across the network fall with the total damage, and a damaged region becomes a likelier target.</>,
        <><B>Power stations</B> hit: the region’s readiness drops (by up to {pct(C.consequences.power)}).</>,
        <><B>Signal hub</B> hit: the region’s communications drop (up to {pct(C.consequences.comms)}), so reports arrive late and interceptors are guided worse.</>,
        <><B>Command post</B> hit: the region’s awareness drops (up to {pct(C.consequences.command)}), so warnings come later and more decoys get through.</>,
      ]} />
      <P>This is why defending matters: a region you leave open does not just lose points, it weakens everything else you are trying to do.</P>
      <H>Low fliers and the radar horizon</H>
      <P>Drones and cruise missiles fly <B>low</B>. The ground curves away and hills get in the way, so a radar on the ground cannot see a low flier until it is close: about <B>{C.lowAltitude.horizonKm} km</B>, or {C.lowAltitude.horizonKm * C.lowAltitude.massifHorizonMult} km from a radar placed on a mountain. This is the <B>radar horizon</B>. It applies to weapons too: a missile system with a 300 km range still only engages low fliers within {C.lowAltitude.horizonKm} km of itself. Rockets and ballistic missiles fly high, so the horizon does not hide them.</P>
      <P>Two things beat the horizon: put the system <B>close to the site</B> it protects, or deploy an <B>aircraft radar</B> (E-2D, E-7, GlobalEye), which looks down from above. While it tracks a low flier, ground systems can engage it out to {C.lowAltitude.cuedHorizonMult} times the horizon ({C.lowAltitude.horizonKm * C.lowAltitude.cuedHorizonMult} km), though on a shared track (see <B>Radar bands</B>).</P>
      <H>Attacks on your own radars</H>
      <P>From the second phase, some missiles in a wave ignore your sites and fly straight at one of your radars: a working radar gives its position away. A hit knocks {C.strikes.damage} points off that system’s condition, which can put it out of action until it has been through maintenance. Aircraft and passive sensors cannot be targeted. Keep a gun or short-range system beside the radars you rely on, and send damaged systems for maintenance (Ground or Sea screens) before the next raid.</P>
      <H>How raids are put together</H>
      <List items={[
        <><B>Two sides at once.</B> From the second phase some waves split and come from two directions. The map shows a red arrow for each.</>,
        <><B>Timed raids.</B> Sometimes the drones go in first and the missiles arrive an hour behind them, when magazines are low. If a wave was all drones, check your rounds before you relax.</>,
        <><B>Escalation.</B> The enemy judges how the war is going. If your defense has stopped {pct(C.escalation.high)} or more of what was sent, it brings heavier weapons: more ballistic and cruise missiles, and gliders. If it is getting through easily, it keeps to cheap drones. The briefing tells you which.</>,
      ]} />
      <H>Decoys</H>
      <P>Some of the dots in a wave are <B>decoys</B>: cheap fakes that do no damage but look real enough to draw fire and empty your magazines. A sharp radar can tell them apart (see <B>Radar bands</B>). Better regional awareness also means fewer of them.</P>
    </>
  );
}

// ── Defenses ─────────────────────────────────────────────────────────────

const LAYER_WHAT: Record<DefenseLayer, string> = {
  detection: 'Radars and other sensors. They shoot nothing, but everything else fights better when a sensor is watching. Aircraft radars see over the horizon.',
  pointDefense: 'Guns, shoulder-fired missiles, jammers and microwave weapons with a reach of a few kilometres. Cheap, ideal against drones, and they must sit on the site they protect.',
  directedEnergy: 'Lasers. Never run out of shots, but short-ranged.',
  shortMedium: 'Missile batteries reaching 25 to 70 km. The backbone of a defense: good against drones and cruise missiles, a few can catch rockets.',
  long: 'Big missile systems reaching 60 to 300 km and high enough for ballistic missiles. Expensive to buy and to reload.',
  upper: 'Specialists that hit ballistic missiles at the edge of space. Useless against anything else.',
};

function Defenses() {
  const layers = Object.keys(LAYER_LABELS) as DefenseLayer[];
  const C = TACTICAL_CONFIG;
  return (
    <>
      <H>Sensors and shooters</H>
      <P>Everything you can deploy is either a <B>sensor</B> (it finds threats) or a <B>shooter</B> (it destroys them). Many shooters carry their own radar. You place them; the simulation decides each engagement using the rules on this page.</P>
      <H>The six layers</H>
      <P>The catalog groups systems into layers, from sensors and close-in guns out to the upper tier. A good defense has more than one layer over each important site, so a threat that slips past one meets another.</P>
      <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed">
        {layers.map((l) => (
          <li key={l} className="flex gap-2">
            <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rotate-45" style={{ background: LAYER_COLOR[l] }} />
            <span><B>{LAYER_LABELS[l]}</B> <span className="text-ops-dim">({EQUIPMENT.filter((e) => e.layer === l).length} systems)</span>. {LAYER_WHAT[l]}</span>
          </li>
        ))}
      </ul>
      <H>Reading a catalog card</H>
      <List items={[
        <><B>Range</B> (or <B>Detects</B> for a sensor): how far it reaches. The solid ring on the map.</>,
        <><B>Ceiling</B>: how high it can hit. Ballistic missiles are engaged at {C.threatAltitudeKm.ballistic} km and rockets at {C.threatAltitudeKm.rocket} km; a system with a lower ceiling cannot touch them at all.</>,
        <><B>Rounds</B>: shots before it must be resupplied. ∞ means it never runs out (lasers, jammers, microwave).</>,
        <><B>Per round</B>: what each shot costs to replace. Gun rounds cost almost nothing; a long-range interceptor costs more than the drone it might be fired at. Compare it with the threat: stopping a cheap drone with a 10-credit missile is a bad trade.</>,
        <><B>Radar</B>: the band of its own radar and how far that radar sees. “No radar” means it is aimed by eye or by heat-seeker: it needs another sensor nearby to warn it, and shoots worse at night.</>,
        <><B>Low-level ≤{C.lowAltitude.horizonKm} km</B>: a reminder that against low fliers this system only reaches the radar horizon, not its full range. The dotted ring on the map.</>,
        <><B>The six bars</B> (SD FD CM RK BM HG): the chance one shot stops each kind of threat. No bar means it cannot engage that kind. Each system fires up to {C.maxShotsPerSystem} shots at a threat if there is time.</>,
      ]} />
      <H>What decides whether a threat is stopped</H>
      <Steps items={[
        <><B>Can anything reach it?</B> The threat’s path must pass through a shooter’s range (the radar horizon for low fliers), the shooter must be able to hit that kind of threat and reach its altitude, and it must have rounds left.</>,
        <><B>Was it seen?</B> If a sensor tracked it, shooters react at normal speed and full accuracy. If nothing saw it, they react twice as slowly and hit less than half as often.</>,
        <><B>Was there time?</B> Fast threats cross a short-range system’s reach in seconds. If its reaction time is longer than that, it never fires.</>,
        <><B>Did the shot hit?</B> Each shot rolls against the kill chance on the card, reduced if the system is worn, if regional communications are poor, or if it is firing on another sensor’s rough track.</>,
      ]} />
      <P>After every wave the debrief lists each threat, who shot at it and, for anything that got through, the reason in plain words.</P>
      <H>Fire orders: your one decision in the fight</H>
      <P>Each shooter follows standing <B>fire orders</B>, which you can change at any time from the deploy screen or the Tactical Theater (it costs nothing and takes effect at the next wave):</P>
      <List items={(Object.keys(DOCTRINES) as FireDoctrine[]).map((k) => <><B>{DOCTRINES[k].label}.</B> {DOCTRINES[k].text}</>)} />
      <P>By default the longest-ranged system fires first, which means your most expensive missiles are spent on whatever arrives first, often drones and decoys. Setting big systems to <B>Missiles only</B> or <B>Backup</B>, with guns underneath them for the drones, makes a limited stockpile last.</P>
      <H>Too many at once</H>
      <P>A system can only handle so many threats in one wave: a gun crew a few, a missile battery a dozen, a destroyer thirty (the “Handles” figure on each card). Decoys count. Past that it is <B>saturated</B> and the rest fly by, however many rounds it has left. One big battery does not stop a big swarm; several smaller ones, or a jammer or microwave weapon (which have no limit), do.</P>
      <H>Hand-offs between layers</H>
      <P>When an outer system fires at a threat and misses, the next layer to engage it already has a track and knows where the first shot went: its chance to hit is {Math.round(C.handoff * 100)}% better. The debrief and the replay mark these hand-offs. It is one more reason to put a second layer behind the first.</P>
      <H>More orders for a unit</H>
      <List items={[
        <><B>Radar silent.</B> Switch a radar off and missiles that hunt radars cannot find it, but it sees nothing while it is off. A shooter with a silent radar can still fire on another sensor’s track, at that sensor’s track quality.</>,
        <><B>Shoot and scoot</B> (ground shooters). After firing in a wave the unit moves a few kilometres. It is out of action for {C.scoot.hours} hours, and anything aimed at where it stood misses.</>,
        <><B>Patrol</B> (ships). The ship steams up to {C.patrol.km} km toward each wave before it arrives, staying at sea. It wears faster.</>,
        <><B>Interceptors.</B> Five systems can be loaded with a cheaper or a more capable mix of missiles, chosen in a briefing: NASAMS, Patriot, Barak MX, the Aegis destroyer and the Type 45. The Equipment tab lists each load.</>,
      ]} />
      <P>A <B>decoy emitter</B> (in the Detection layer) is a cheap transmitter that looks like a radar. Missiles hunting your radars mostly go for it instead.</P>
      <H>Service records</H>
      <P>Every unit has a callsign and keeps count of the threats it has stopped. At {C.veteran[1].kills} it becomes a <B>Veteran</B> and reacts {Math.round((1 - C.veteran[1].reaction) * 100)}% faster; at {C.veteran[0].kills} it is <B>Elite</B>: {Math.round((1 - C.veteran[0].reaction) * 100)}% faster and a little more accurate. Withdrawing a unit loses its record, so think twice before selling a veteran crew.</P>
      <H>Terrain</H>
      <P>Ships go on water, everything else on land. Mountains block a ground radar’s view of low fliers behind them, but a radar <B>on</B> a mountain sees twice as far over the horizon.</P>
      <List items={[
        <><B>Valleys</B> (dashed green lines running in from a map edge). After the first phase, low fliers coming from that side often follow the valley in. While they are in it, only ground systems within {C.valley.widthKm} km of the valley’s line can see or engage them. Put something in the valley’s mouth, or use an aircraft radar.</>,
        <><B>Cities.</B> Guns, lasers and microwave weapons need a clear line of fire. Placed within {C.urban.km} km of a city’s centre, among the buildings, they lose {Math.round((1 - C.urban.reach) * 100)}% of their reach. Place them on the city’s edge. Missile systems are not affected.</>,
      ]} />
      <Tip>For your first defense: one medium-range battery (IRIS-T SLM or NASAMS) next to the most-threatened city, a gun system (Skynex) on the next site, and a cheap sensor facing the attack. The deploy screen’s first-deployment guide walks you through exactly this.</Tip>
    </>
  );
}

// ── Equipment encyclopedia ───────────────────────────────────────────────

/** What a system is good and bad at, read from its own figures. */
function prosCons(e: EquipmentSpec): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];
  const C = TACTICAL_CONFIG;
  if (e.lure) return { pros: ['Draws most of the missiles that hunt radars onto itself', 'Costs almost nothing'], cons: ['Sees and shoots nothing', 'A hit still has to be repaired'] };
  if (!isEffector(e)) {
    if (e.domain === 'air') pros.push('Looks down from above: the radar horizon does not hide low fliers from it', 'Cannot be targeted by missiles that hunt radars');
    if (e.rangeKm >= 400) pros.push('Sees a very long way');
    if (!e.radar) pros.push('Passive: cannot be hunted or jammed', 'Very cheap'), cons.push('Detects drones only', 'Very short range');
    if (e.radar && RADAR_BANDS[e.radar.band].storm >= 0.9) pros.push('Keeps almost all its range in a storm');
    if (e.radar && RADAR_BANDS[e.radar.band].sharp >= 0.8) pros.push('Sharp enough to recognise most decoys');
    if (e.radar && RADAR_BANDS[e.radar.band].storm <= 0.5) cons.push('A storm more than halves its range');
    if (e.radar && RADAR_BANDS[e.radar.band].sharp <= 0.15) cons.push('Cannot tell decoys from real threats');
    if (e.radar && e.domain !== 'air') cons.push(`Sees low fliers only within the radar horizon (${C.lowAltitude.horizonKm} km)`);
    cons.push('Shoots nothing itself');
    return { pros, cons };
  }
  const best = [...THREAT_CLASSES].filter((c) => e.killRate[c] >= 0.75);
  const none = THREAT_CLASSES.filter((c) => e.killRate[c] <= 0 || e.altitudeKm < C.threatAltitudeKm[c]);
  if (best.length) pros.push(`Strong against ${best.map((c) => THREAT_LABELS[c].toLowerCase() + 's').join(', ')}`);
  if (isUnlimited(e)) pros.push('Never runs out of shots');
  if ((e.roundCr ?? 99) <= 0.2) pros.push('Rounds cost almost nothing');
  if (e.rangeKm >= 100) pros.push('Covers a wide area against high fliers');
  if (e.reactionSec <= 4) pros.push('Reacts very quickly');
  if (Number.isFinite(channelsOf(e)) && channelsOf(e) >= 6) pros.push('Handles many threats at once');
  if (e.loadouts) pros.push('Can be loaded with a cheaper or a more capable mix of interceptors');
  if (none.length) cons.push(`Cannot engage ${none.map((c) => THREAT_LABELS[c].toLowerCase() + 's').join(', ')}`);
  if (e.rangeKm <= 6) cons.push('Reaches only a few kilometres: it must stand at the site it protects');
  if (!e.radar) cons.push('No radar of its own: needs another sensor nearby, and is less accurate at night if aimed by eye or heat-seeker');
  if ((e.roundCr ?? 0) >= 8) cons.push('Very expensive rounds: wasteful against drones and decoys');
  if (e.magazine <= 8 && !isUnlimited(e)) cons.push('Small magazine');
  if (channelsOf(e) <= 1) cons.push('Engages one threat at a time: easily saturated');
  if (e.domain === 'sea') cons.push('Must be placed at sea');
  return { pros, cons };
}

function Equipment() {
  const [open, setOpen] = useState<string | null>(null);
  const layers = Object.keys(LAYER_LABELS) as DefenseLayer[];
  return (
    <>
      <H>Every system in the catalog</H>
      <P>Range, ceiling and radar band follow official public statements by the manufacturer or a government, listed under each entry, where such statements exist. Chances to stop a threat, reaction times, prices, round prices and the number of threats handled at once are the game’s own values, chosen for play. Nothing here comes from classified or leaked material.</P>
      {layers.map((l) => (
        <section key={l}>
          <H><span className="mr-1.5 inline-block h-2.5 w-2.5 rotate-45" style={{ background: LAYER_COLOR[l] }} />{LAYER_LABELS[l]}</H>
          <ul className="mt-1 space-y-1">
            {EQUIPMENT.filter((e) => e.layer === l).map((e) => {
              const isOpen = open === e.id;
              const { pros, cons } = prosCons(e);
              return (
                <li key={e.id} className="rounded border border-ops-line">
                  <button className="flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left hover:bg-ops-cyan/5" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}>
                    <span><span className="font-sans text-[13px] font-semibold text-white">{e.name}</span> <span className="text-[10px] text-ops-dim">{e.origin}{e.generic ? ' · a kind of equipment, not a named product' : ''}</span></span>
                    <span className="shrink-0 text-[11px] text-ops-green">{equipmentCost(e)} cr {isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && (
                    <div className="space-y-1.5 border-t border-ops-line px-2 py-2 text-[12px] leading-relaxed">
                      <p>{e.description}</p>
                      <p className="text-ops-dim">
                        {e.lure ? 'Range: none. ' : `${isEffector(e) ? 'Range' : 'Detects to'} ${e.rangeKm} km. `}
                        {isEffector(e) && `Ceiling ${e.altitudeKm} km. ${isUnlimited(e) ? 'Unlimited shots. ' : `${e.magazine} rounds${e.roundCr !== undefined ? ` at ${e.roundCr} cr each` : ''}. `}Reacts in ${e.reactionSec} s. Handles ${Number.isFinite(channelsOf(e)) ? `${channelsOf(e) * TACTICAL_CONFIG.saturationPasses} threats a wave` : 'any number of threats'}. `}
                        {e.radar ? `Radar: ${e.radar.name}, ${e.radar.band}-band, sees ${e.radar.rangeKm} km.` : e.lure ? '' : 'No radar.'}
                      </p>
                      {isEffector(e) && (
                        <p className="text-ops-dim">Chance one shot stops: {THREAT_CLASSES.filter((c) => e.killRate[c] > 0).map((c) => `${THREAT_LABELS[c].toLowerCase()} ${pct(e.killRate[c])}`).join(' · ') || 'nothing'}.</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div><div className="label text-ops-green">Good at</div><ul className="list-disc pl-4">{pros.map((x) => <li key={x}>{x}</li>)}{!pros.length && <li className="text-ops-dim">No particular strength: a generalist.</li>}</ul></div>
                        <div><div className="label text-ops-amber">Watch out</div><ul className="list-disc pl-4">{cons.map((x) => <li key={x}>{x}</li>)}{!cons.length && <li className="text-ops-dim">Nothing in particular.</li>}</ul></div>
                      </div>
                      {e.loadouts && (
                        <div><div className="label">Interceptor loads (chosen in a briefing)</div>
                          <ul className="list-disc pl-4"><li><B>Standard mix.</B> The figures above.</li>{e.loadouts.map((x) => <li key={x.id}><B>{x.label}.</B> {x.text}</li>)}</ul>
                        </div>
                      )}
                      <div>
                        <div className="label">Official sources</div>
                        {e.sources.length ? (
                          <ul className="list-disc pl-4 text-[11px]">
                            {e.sources.map((src) => <li key={src.name}>{src.url ? <a className="text-ops-cyan underline" href={src.url} target="_blank" rel="noreferrer noopener">{src.name}</a> : src.name}</li>)}
                          </ul>
                        ) : <p className="text-[11px] text-ops-dim">{e.generic ? 'A generic kind of equipment: every figure is the game’s own.' : 'No official figures were used: every figure is the game’s own.'}</p>}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

// ── Radar bands ──────────────────────────────────────────────────────────

const BAND_USERS = (b: RadarBand) => EQUIPMENT.filter((e) => e.radar?.band === b).map((e) => e.name.replace(/\s*\(.*\)$/, ''));

function Bands() {
  return (
    <>
      <H>What a radar band is</H>
      <P>A radar sends out radio waves and listens for the echo. The <B>band</B> is the length of those waves, and it is the single most important thing about a radar, because it forces a trade-off that no engineering gets around:</P>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-ops-line p-2.5 text-[12px] leading-relaxed">
          <div className="font-sans font-semibold text-white">Long waves see far</div>
          Long waves (UHF, L) pass through rain and cloud almost untouched and carry a long way. But the picture is blurry: like trying to feel the shape of a coin with a boxing glove.
        </div>
        <div className="rounded border border-ops-line p-2.5 text-[12px] leading-relaxed">
          <div className="font-sans font-semibold text-white">Short waves see sharp</div>
          Short waves (X, Ku) draw a crisp picture, fine enough to tell a decoy from a real missile and to steer an interceptor onto it. But heavy rain soaks them up, so a storm cuts their range hard.
        </div>
      </div>
      <P>S and C sit in between. That is all you need to remember: <B>long waves see far, short waves see sharp.</B></P>
      <H>What the band changes in the game</H>
      <Steps items={[
        <><B>Storms.</B> A storm shortens every radar’s range, by an amount set by its band. A UHF radar loses nothing; an X-band radar keeps less than half. If all your radars in a region are short-wave, a storm can leave you blind exactly when a raid arrives.</>,
        <><B>Decoys.</B> When a radar tracks a decoy, its band sets the chance it recognises the fake. Recognised decoys are ignored and cost you nothing. Decoys seen only by long-wave radars get shot at, which empties magazines and lowers your efficiency score.</>,
        <><B>Shared tracks.</B> A shooter is most accurate when its own radar sees the target. When it cannot (it has no radar, or the threat is over its horizon or past its radar’s range) it shoots on another sensor’s track, and its accuracy is multiplied by that sensor’s band rating. A sharp X or C-band track is as good as its own; a UHF track from a distant aircraft is only a rough pointer.</>,
      ]} />
      <div className="mt-3 overflow-x-auto">
        <table className="table-ops w-full text-[11px]">
          <thead><tr><th>Band</th><th>Wave</th><th>Range kept in a storm</th><th>Spots decoys</th><th>Track for other shooters</th><th>Who uses it</th></tr></thead>
          <tbody>
            {RADAR_BAND_IDS.map((b) => {
              const r = RADAR_BANDS[b];
              return (
                <tr key={b} className="align-top">
                  <td className="whitespace-nowrap text-white"><B>{b}</B> <span className="text-ops-dim">{r.nick}</span></td>
                  <td className="whitespace-nowrap">{r.wave}</td>
                  <td className="whitespace-nowrap"><Meter value={r.storm} /></td>
                  <td className="whitespace-nowrap"><Meter value={r.sharp} /></td>
                  <td className="whitespace-nowrap"><Meter value={r.cue} /></td>
                  <td className="text-ops-dim">{BAND_USERS(b).join(', ')}</td>
                </tr>
              );
            })}
            <tr className="align-top">
              <td className="whitespace-nowrap text-white"><B>Passive</B> <span className="text-ops-dim">no radar</span></td>
              <td>listens</td>
              <td><Meter value={PASSIVE_SENSOR.storm} /></td>
              <td><Meter value={PASSIVE_SENSOR.sharp} /></td>
              <td><Meter value={PASSIVE_SENSOR.cue} /></td>
              <td className="text-ops-dim">Acoustic sensor network, Passive RF detector (drones only)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <H>How to use this</H>
      <List items={[
        <><B>Mix your bands.</B> Pair a long-wave radar for early warning in any weather with a short-wave radar near what matters. The deploy screen’s “Radar picture” line shows which bands a region has and warns when a forecast storm will blind them.</>,
        <><B>Check the storm forecast.</B> Each region’s forecast check lists the storms expected this phase. Indo-Pacific and the Polar Regions are the stormiest; the Middle East the driest.</>,
        <><B>Put a sharp radar where decoys will come.</B> A Sentinel (X-band) is one of the cheapest systems in the catalog. One beside a busy site stops your expensive interceptors being thrown at fakes. This matters most when interceptor stockpiles are limited.</>,
        <><B>Don’t lean on a far-off aircraft alone.</B> An E-2D lets a battery shoot at low fliers beyond its own horizon, but on a blurry UHF track those shots land about {pct(RADAR_BANDS.UHF.cue)} as often. Batteries close enough to see the threat themselves shoot at full accuracy.</>,
        <><B>On Commander, expect jamming.</B> From the second phase the enemy jams whichever band most of your radars use: those radars see {pct(JAMMING.range)} as far and recognise {pct(JAMMING.sharp)} as many decoys for the whole phase. The briefing’s enemy intel names the band, and the Radar picture line shows how many of your radars it hits. A defense spread over two or three bands shrugs it off.</>,
      ]} />
      <P>After a wave, the debrief shows the band that tracked each threat, how many decoys were recognised, and says so when a shot missed on a rough shared track.</P>
    </>
  );
}

// ── The other pages ──────────────────────────────────────────────────────

function Start() {
  return (
    <>
      <H>The game in one minute</H>
      <P>You command a fictional defense network across seven regions of the world. Each region has eight <B>sites</B> (cities, a port, power stations, a command post) that an unseen enemy attacks with drones and missiles. You have two jobs:</P>
      <List items={[
        <><B>Build the defense.</B> Before each phase you buy air defense systems and place them on a map of each threatened region. When an attack comes, the simulation fights it for you with what you placed. You never aim or fire anything yourself.</>,
        <><B>Keep the network running.</B> Between attacks, reports of problems arrive (a failing radar, a storm, unrest). You decide which are real, fix them before they get worse, keep equipment serviced, and spend a limited budget.</>,
      ]} />
      <P>A campaign has four <B>phases</B>. Each begins with a <B>briefing</B> (time is stopped: read the forecast, place defenses) and then runs for two or three simulated days while attacks and reports come in. Damage and worn equipment carry over from phase to phase. At the end you get a score and a grade.</P>
      <H>You cannot lose by going slowly</H>
      <P>Pausing is free and always allowed (Space). The game also pauses itself when an attack is detected or a report is about to get worse. Nothing ever requires quick reflexes.</P>
      <H>Where to begin</H>
      <List items={[
        <>New to all of this: open the <B>Training Academy</B> from the start screen. Lesson 1 takes five minutes and a coach points at every control.</>,
        <>Want to try the fighting first: play a <B>Quick Battle</B> from the start screen. One region, three waves, five minutes, and no reports or maintenance to think about.</>,
        <>Want to see why a shot hits or misses: the <B>Practice range</B> at the top of the Training Academy fires one system at one threat and shows the dice.</>,
        <>Want it done for you the first time: on the deploy screen, <B>Propose a defense</B> has the adjutant lay out a complete defense for a region, which you can accept, change or ignore.</>,
        <>Want the whole game: start a <B>Campaign</B> on <B>Recruit</B> and read <B>Your first phase</B> on the next tab.</>,
        <>Stuck on a word: the <B>Glossary</B> tab explains every term and abbreviation the game uses.</>,
      ]} />
      <H>Ways to play</H>
      <List items={[
        <><B>Campaign.</B> Four phases across seven regions. Choose an open campaign or a written one: {Object.values(STORIES).map((x) => x.name).join(' or ')}.</>,
        <><B>Quick Battle.</B> One region, three waves.</>,
        <><B>Endless Defense.</B> One region, a bigger wave every time, a briefing between each. Your score is the waves survived; the game’s own adjutant usually lasts about 18.</>,
        <><B>Raid Designer.</B> Play the attacker: write a raid on the map it will be fought on, rehearse it, then send it against the computer’s defense or hand it to a friend (by passing the keyboard or sending a code). See “Writing a raid” below.</>,
        <><B>Crisis</B> and <B>Sandbox.</B> Network management without, or with, the fighting.</>,
      ]} />
      <H>Writing a raid</H>
      <P>In the Raid Designer you are the attacker. You have a number of <B>attack points</B> set by the size of the fight ({Object.values(TACTICAL_CONFIG.raid.sizes).map((z) => z.points).join(', ')}); the defender gets credits to match. A raid is up to {TACTICAL_CONFIG.raid.maxWaves} waves on one region. The defender’s score is the share of your raid’s damage they prevented, so a lower score is a better raid.</P>
      <List items={[
        <><B>Threats.</B> Each costs what it costs an attacker in the game: drones and rockets are cheap, ballistic missiles and gliders are dear. Many cheap threats empty magazines; a few dear ones need defenses the defender may not have bought.</>,
        <><B>When.</B> The timeline shows the night and the storms of the day the raid is fought. In the dark, weapons aimed by eye hit less often. In a storm, short-wave radars see less far. Waves an hour apart arrive while launchers are still reloading.</>,
        <><B>From where.</B> A wave comes from one side, or half from a second side (+{TACTICAL_CONFIG.raid.secondAxis} points), which splits the defender’s fire.</>,
        <><B>At what.</B> A wave spreads over every site by its value, or goes for one site. One site is easier to overwhelm, but the rest of the region is untouched.</>,
        <><B>Route.</B> Straight in is free. Turning in flight (+{TACTICAL_CONFIG.raid.turn}) brings drones and cruise missiles in from an angle the defender did not cover. Along the valleys (+{TACTICAL_CONFIG.raid.valley}) hides them from radars that are not in the valley, where the map has one.</>,
        <><B>Hunt the radars</B> (+{TACTICAL_CONFIG.raid.hunt}). Some of the wave’s missiles go for the defender’s radars instead of the sites. A blinded defense stops less of the next wave.</>,
        <><B>Decoys</B> ({TACTICAL_CONFIG.raid.decoy} point each). False tracks that draw fire. A defender with a sharp radar (C, X or Ku band) ignores most of them.</>,
        <><B>Keep a wave out of the forecast</B> (+{Math.round(TACTICAL_CONFIG.raid.hidden * 100)}% of its threats). The defender places a defense from the forecast, and this wave is not in it: they learn of it only from the launch warning a few hours ahead. At least one wave must be forecast.</>,
        <><B>Jam a radar band</B> (+{TACTICAL_CONFIG.raid.jam}). Every radar on that band sees {Math.round(JAMMING.range * 100)}% as far all battle and spots fewer decoys. The defender is told which band, so it works best against a defense that has no time or credits to change radars.</>,
        <><B>Hold a reserve.</B> Points you hold back (up to half) buy one more wave during the battle, written after you have seen what got through. It arrives outside the forecast. In a battle at one keyboard the defender pauses and hands the keyboard over when you want to send it; if the raid is played from a code, the game writes the wave for you from what got through best.</>,
        <><B>Rehearse.</B> Flies the raid many times against the computer’s defense without starting a battle, and shows which threats it stops least. Change the raid and try again.</>,
      ]} />
      <P><B>Playing with a friend.</B> “Hand to a defender” starts the battle on their briefing: pass the keyboard. Or copy the raid code and send it; they paste it and press “Defend this code”, so they never see what is in it. Their debrief has a button that copies the result to send back. A raid code carries its own map and weather, so both players fight on the same ground.</P>
      <P><B>A match.</B> After a battle at one keyboard, the debrief offers “Swap sides”: the defender writes the reply raid, of the same size, and the first attacker defends it. The debrief keeps the score of every round, and whoever has the higher average defense score is ahead. “End the match” clears it.</P>
      <P><B>Defending a raid.</B> The forecast check shows only the waves the author did not pay to hide. Keep credits back for resupply, cover more than one side, and do not rely on a single radar band.</P>
      <H>How to do well</H>
      <List items={[
        'Defend the regions the briefing forecasts, starting with the sites it says the attack is aimed at.',
        'Match weapons to threats: guns for drones, missile batteries for cruise missiles, high-ceiling systems for ballistic missiles.',
        'Keep systems close to what they protect. Low-flying threats can only be engaged from nearby.',
        'After each attack, resupply the systems that fired.',
        'Don’t ignore reports. An unanswered report gets worse and stays worse.',
        'Spend your money. Credits above the reserve level are slowly taken back.',
      ]} />
    </>
  );
}

function First() {
  const C = TACTICAL_CONFIG;
  return (
    <>
      <H>The briefing</H>
      <Steps items={[
        <>Read the <B>Threat forecast</B> (red box). It names the two regions that will be attacked this phase. Every forecast region is hit at least once.</>,
        <>Press <B>Deploy defenses</B>. Pick a forecast region (red dot on its tab). The red arrow at the map edge shows where the attack will come from.</>,
        <>Open the <B>Forecast check</B> line above the map. It lists the threats expected, the sites they are aimed at, and the weather.</>,
        <>Pick a system from the catalog on the right, then click the map to place it. Start beside the site marked “Start here”. The ring shows its reach; the dotted ring shows its shorter reach against low fliers.</>,
        <>Watch the Forecast check update. It replays the expected attack against your layout and tells you roughly how much damage you would prevent. Aim for 70% or more in each forecast region, and keep a few hundred credits for the phase.</>,
        <>Changed your mind? <B>Undo</B> takes back the last system you placed for a full refund, as long as the phase has not begun.</>,
        <>Press <B>Assume command — begin phase</B>. You cannot buy new systems until the next briefing, though you can move the ones you have.</>,
      ]} />
      <H>While the phase runs</H>
      <Steps items={[
        <>Speed up quiet stretches with 4x or 8x. The game pauses itself when something needs you.</>,
        <>When a <B>launch warning</B> appears, open the <B>Tactical Theater</B> (key X). Press <B>Raise alert</B> for the region under attack: for {C.alert.hours} hours its systems react faster and see better.</>,
        <>Watch the wave fly in. Green crosses are interceptions; red bursts are hits.</>,
        <>Afterwards, press <B>Resupply</B> on each system that fired. An empty system defends nothing.</>,
        <>When a <B>report</B> appears under Active reports, click it. If its confidence is low, press <B>Task confirmation</B> to find out whether it is real. If it is real, pick a response and press <B>Execute</B>.</>,
        <>Check the <B>Objectives</B> in the sidebar. Meeting them pays credits and adds to your score.</>,
      ]} />
      <H>When the phase ends</H>
      <P>The next briefing opens with a front page from <B>The Meridian Dispatch</B> reporting how the phase went, what was damaged and whether you met your objectives. If the review found one system that would have helped most, it appears as an amber ring on the next deploy map. Open the <B>After-Action Review</B> (key R) at any time to see every wave, why each threat was stopped or got through, and what one extra system would have changed.</P>
      <P>In the Tactical Theater, press <B>Narrated replay</B> to watch a wave again with a caption for each key moment, and <B>click any threat on the map</B> to read what happened to it and why.</P>
      <Tip>If a wave went badly, the review’s “Systems that did not fire” list is the fastest way to learn. “Out of range” means move it closer; “below the radar horizon” means move it closer or add an aircraft radar; “magazine empty” means resupply sooner.</Tip>
    </>
  );
}

function Phase() {
  const C = TACTICAL_CONFIG;
  const R = C.emergencyRedeploy;
  return (
    <>
      <H>Orders you can give during a phase</H>
      <List items={[
        <><B>Raise alert</B> (Tactical Theater). For {C.alert.hours} hours every system in the region reacts {Math.round((1 - C.alert.reactionMult) * 100)}% faster and unseen threats are handled far better. It costs credits and wears equipment, so raise it when a launch warning appears, not before.</>,
        <><B>Auto-resupply.</B> Tick “Auto-resupply here” in a region’s theater and its systems reorder rounds by themselves once they are down to half a magazine, as long as you keep 100 credits in hand and the stockpile holds out.</>,
        <><B>Resupply.</B> Refills a system’s magazine over a few hours. It costs credits in proportion to the rounds brought, and needs logistics capacity of at least {C.minLogisticsForResupply}.</>,
        <><B>Redeploy.</B> Moves a system to a new spot or another region. It is out of action while it travels: {R.sameRegionHours} hours within a region; to another region {R.otherRegionHours.air} hours for aircraft, {R.otherRegionHours.ground} for ground systems and {R.otherRegionHours.sea} for ships. Use it when a warning appears for a region you did not defend.</>,
        <><B>Fire orders.</B> Tell a shooter to engage everything, to hold its rounds for missiles, or to act as backup. See <B>Defenses</B>.</>,
        <><B>Maintenance.</B> Deployed systems wear like all equipment. Service them from the Ground, Air or Sea screens before they fail.</>,
      ]} />
      <P>You cannot buy new systems during a phase. That is what briefings are for.</P>
      <H>Warnings and surprise attacks</H>
      <P>A launch warning appears {C.warningHours.base} to {C.warningHours.base + C.warningHours.atFullAwareness} hours before a wave launches; regions with better awareness warn earlier. Most waves hit forecast regions, but some strike elsewhere. A cheap system or two in an unforecast region, or a ready redeploy, limits the damage.</P>
      <H>Interceptor stockpiles</H>
      <P>On Officer and Commander, resupply draws on a <B>national stockpile</B> for each weapon type. Every unit you field adds {STOCKPILES.officer!.initial === 1 ? 'one magazine' : `${STOCKPILES.officer!.initial} magazines`} to its type’s stockpile on Officer ({STOCKPILES.commander!.initial === 0.5 ? 'half a magazine' : `${STOCKPILES.commander!.initial} magazines`} on Commander), and it is topped up at each new phase. When it is empty, that type cannot be resupplied until the next phase, so don’t let costly interceptors fire at drones and decoys that guns could handle. Recruit has unlimited stockpiles.</P>
      <H>Weather and night</H>
      <List items={[
        <><B>Storms</B> shorten radar range according to the radar’s band (see <B>Radar bands</B>): from no loss for UHF down to {pct(RADAR_BANDS.Ku.storm)} of normal range for Ku. Passive sensors keep {pct(PASSIVE_SENSOR.storm)}. The deploy screen lists the storms expected in each region.</>,
        <><B>Night</B> runs from {WEATHER.night[0]}:00 to 0{WEATHER.night[1]}:00 local time. Weapons aimed by eye or heat-seeker (Stinger, Avenger, ZU-23-2) hit {Math.round((1 - WEATHER.nightKill) * 100)}% less often in the dark. About {pct(WEATHER.nightRaids)} of raids are timed for night.</>,
      ]} />
      <H>Repair crews</H>
      <P>Maintenance crews with nothing else to do will rebuild damaged sites, but only the ones you send them to. In the Tactical Theater, the Damaged sites panel lists what is broken: press <B>Send crews</B>, and reorder the queue with <B>Move to first</B>. Crews busy with maintenance or responses repair nothing, so when crews are short you are choosing what gets rebuilt first.</P>
      <H>Reinforcements and the campaign path</H>
      <P>Before each phase after the first, one region can be reinforced: its sites are repaired by {C.reinforce.integrity} points, its stability rises, and resupply there is free for that phase. You are offered the forecast regions and the worst-hit region outside the forecast. The briefing shows the path your choices have traced.</P>
      <H>Defense industry</H>
      <P>The Defense Industry Expansion investment (three levels) adds a quarter of a magazine per unit to every interceptor stockpile and cuts round prices by {Math.round(C.industry.price * 100)}% a level.</P>
      <H>Research</H>
      <P>The Logistics screen offers four research programmes. Each is paid for once, takes a day or two, and then lasts for the rest of the scenario:</P>
      <List items={INVESTMENTS.filter((i) => i.once).map((i) => <><B>{i.label.replace('Research: ', '')}</B> ({i.credits} credits, {i.hours} hours). {i.description}</>)} />
      <H>Money</H>
      <P>Credits arrive every hour, more when regions are stable. Each asset costs a little upkeep. Credits above {SIM_CONFIG.reserve.threshold} are taken back at {SIM_CONFIG.reserve.ratePerHour * 100}% of the excess per hour, so a large unspent balance is wasted: put it into defenses, maintenance or long-term investments (Logistics screen).</P>
    </>
  );
}

function Network() {
  return (
    <>
      <H>Domains and readiness</H>
      <P>Your network has four <B>domains</B>: Space (satellites), Air (aircraft), Sea (ships) and Ground (radars, command posts). Each has a <B>readiness</B> percentage that comes from the condition of its equipment. Domains lean on each other: Air and Sea need Space for communications, and Space needs Ground control. So each domain shows two numbers: <B>raw</B> readiness (its own equipment) and <B>effective</B> readiness (after weakness elsewhere is counted). Fixing the domain others depend on lifts them all.</P>
      <H>Maintenance</H>
      <P>Equipment wears out. Each asset has a service clock; once it is overdue it wears {SIM_CONFIG.overdueDecayMult} times as fast. Open a domain screen, click an asset and press <B>Schedule maintenance</B>. It needs credits, a free crew and a few hours out of service. You have a limited number of crews, so service the most worn assets first.</P>
      <H>Reports</H>
      <P>Problems reach you as <B>reports</B>, listed under Active reports. Each has:</P>
      <List items={[
        <><B>Confidence</B>: how likely it is to be real. Some reports are false.</>,
        <><B>Severity</B> (S1 minor to S4 critical): how much harm it does while it lasts.</>,
        <><B>A decision window</B>: the hours left before it <B>escalates</B>, causing lasting damage and sometimes a follow-on problem.</>,
      ]} />
      <P>For each report you can:</P>
      <List items={[
        <><B>Task confirmation</B> ({SIM_CONFIG.confirmCost} credits, about {SIM_CONFIG.confirmHours} hours): an independent check. Usually a false report is exposed and closes, and a real one is confirmed. But it can come back <B>inconclusive</B> (about one time in eight where your awareness is good, far more often where it is poor): confidence moves a little toward the truth and you must decide whether to pay and wait again, or act on what you know. With a short decision window there may not be time for a second try.</>,
        <><B>Execute a response</B>: each option shows its cost, time and chance of success. A failed response wastes the money; you can try another.</>,
        <><B>Monitor</B>: buys extra time once, while the harm continues.</>,
        <><B>Dismiss</B>: free, and right for a false report. But a real problem you dismiss keeps doing harm out of sight and still escalates.</>,
      ]} />
      <H>Awareness and communications</H>
      <P>Each region has an <B>awareness</B> score (how well your sensors cover it) and a <B>comms</B> score. Good awareness means more reliable reports, earlier launch warnings and fewer decoys. Good comms means reports arrive on time and interceptors are guided better. <B>Network health</B> is the worldwide average of communications, and feeds every domain.</P>
      <H>Investments</H>
      <P>The Logistics and Infrastructure screens offer long-term projects: more maintenance crews, a tougher network, rebuilding damaged sites. They take a day or more to finish, so the earlier in a campaign you start them, the more they return.</P>
    </>
  );
}

function Score() {
  return (
    <>
      <H>What the score rewards</H>
      <P>Your score runs from 0 to 100 and becomes a grade: S (90+), A (80+), B (70+), C (60+), D (50+) or F. In a campaign, <B>{pct(PROTECTION_SCORE_WEIGHT)} of it is threat protection</B>: the share of incoming damage your defenses prevented, counting important sites more. The rest is how well you ran the network:</P>
      <List items={[
        <><B>Readiness, network health and stability</B>, averaged over the whole campaign, not just the end.</>,
        <><B>Response</B>: real problems resolved before they escalated, and how quickly.</>,
        <><B>Infrastructure</B> kept intact.</>,
        <><B>Efficiency</B>: money not wasted on false reports, failed responses or shooting at decoys.</>,
        <><B>Information</B>: false reports exposed, real ones not dismissed.</>,
        <><B>Recovery</B>: how well readiness came back after its lowest point.</>,
      ]} />
      <P>Meeting objectives adds up to {SIM_CONFIG.objectiveBonus} points, shared equally between all of a scenario’s objectives, and most pay credits at once. Objectives that say “average … over the whole phase” count every hour, so a bad stretch can be made up; ones that say “end the phase with” are measured at the last hour.</P>
      <H>Difficulty</H>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed">
        {COMMAND_LEVEL_IDS.map((l) => <li key={l}><B>{COMMAND_LEVELS[l].label}.</B> {COMMAND_LEVELS[l].description}</li>)}
      </ul>
      <H>Your opponent</H>
      <P>In a campaign you choose who you fight. Each commander plays by the same rules with a different emphasis, and the briefing reminds you how to answer him:</P>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed">
        {ENEMY_STYLE_IDS.map((id) => <li key={id}><B>{ENEMY_STYLES[id].name}, {ENEMY_STYLES[id].title}.</B> {ENEMY_STYLES[id].text} <span className="text-ops-dim">Answer: {ENEMY_STYLES[id].counter}</span></li>)}
      </ul>
      <H>Medals</H>
      <P>Finished games earn medals, shown on the start screen. There are {MEDALS.length}. They also unlock theater map themes in the display menu (Aa): {THEME_UNLOCKS.filter((t) => t.medals > 0).map((t) => `“${t.name}” at ${t.medals} medals`).join(', ')}.</P>
      <H>The After-Action Review</H>
      <P>Open it at any time (key R). It breaks the score into its parts, lists every wave with the fate of each threat, compares what you spent on interceptors with what the attacker spent, and suggests the one system that would have helped most in each region.</P>
    </>
  );
}

export const GLOSSARY: [string, string][] = [
  ['Backlog', 'Assets whose scheduled service is overdue. They wear out faster until serviced.'],
  ['Comms', 'A region’s communications. Poor comms delay reports and make interceptors less accurate.'],
  ['Information quality', 'How far you can trust what you are told: a blend of awareness, communications and report confidence.'],
  ['Infrastructure', 'The state of a region’s roads, power and facilities. It supports readiness and is worn down by events and attacks.'],
  ['Sensor availability', 'The share of your surveillance sensors that are working.'],
  ['AAR', 'After-Action Review: the report on how you did, available any time with the R key.'],
  ['Adjutant', 'Your assistant. It lists the most useful things to do next in the sidebar and in briefings.'],
  ['Airborne early warning', 'A radar carried by an aircraft (E-2D, E-7, GlobalEye). It looks down from above, so the radar horizon does not hide low fliers from it.'],
  ['Alert (Raise alert)', 'A short period of heightened readiness in one region: faster reactions and better detection, at a cost. Not the same as the “Alert” level in the top bar, which just summarises how much is going wrong.'],
  ['Asset', 'One piece of equipment in your network: a satellite, an aircraft, a ship, a radar site, or a deployed defense system.'],
  ['Awareness', 'How well your sensors cover a region. Higher means more reliable reports, earlier warnings and fewer decoys.'],
  ['Axis', 'The side of the map an attack comes from: north, south, east or west.'],
  ['Band', 'The wavelength a radar uses. See the Radar bands tab.'],
  ['BM, CM, FD, HG, RK, SD', 'Ballistic missile, cruise missile, fast drone, hypersonic glider, rocket, slow drone.'],
  ['Ceiling', 'The greatest height a weapon can hit.'],
  ['Confidence', 'How likely a report is to be real: UNVERIFIED, POSSIBLE, PROBABLE or VERY LIKELY. Only a confirmation you tasked makes it CONFIRMED.'],
  ['cr', 'Credits, the game’s money.'],
  ['Crew', 'A maintenance team. Each can do one job at a time.'],
  ['Cue', 'When one sensor tells a shooter where to look. How good the cue is depends on the sensor’s radar band.'],
  ['Decoy emitter', 'A cheap fake radar of your own, placed to be shot at instead of the real ones.'],
  ['Decoy / false track', 'A fake threat that does no damage but can draw fire.'],
  ['Domain', 'One of the four parts of the network: Space, Air, Sea and Ground.'],
  ['Effector / shooter / interceptor', 'Anything that destroys threats: guns, missiles, lasers, jammers.'],
  ['Escalation', 'What happens when a report is left until its time runs out: lasting damage, and sometimes a new problem.'],
  ['Elite / Veteran', 'Ranks a unit earns by stopping threats: it reacts faster.'],
  ['Escalation', 'The enemy bringing heavier weapons because your defense has held.'],
  ['Fire orders', 'A shooter’s standing instructions: engage everything, missiles only, or backup.'],
  ['Forecast', 'The briefing’s prediction of which regions will be attacked this phase.'],
  ['Hypersonic glider (HG)', 'The rarest and most damaging threat: very fast, swerves in flight, and only a few systems can touch it.'],
  ['Integrity', 'A site’s health, from 100 (untouched) to 0 (destroyed).'],
  ['Jamming', 'On Commander, the enemy blinds one radar band for a phase: the band most of your radars use.'],
  ['Hand-off', 'A later layer stopping a threat an earlier one fired at and missed.'],
  ['Layer', 'A family of defenses grouped by reach, from close-in guns to the upper tier.'],
  ['Magazine / rounds', 'The shots a system holds before it needs resupply.'],
  ['Network health', 'The state of communications worldwide. Every domain depends on it.'],
  ['Phase', 'One chapter of a campaign: a briefing followed by two or three simulated days.'],
  ['Quick Battle', 'A five-minute game: one region, three waves, a fixed budget, nothing else to manage.'],
  ['Saturated', 'A system already engaging as many threats as it can handle in one wave.'],
  ['Shoot and scoot', 'Orders for a ground unit to move a short way after firing, so it cannot be hit where it stood.'],
  ['Radar horizon', 'The distance beyond which a ground radar cannot see low-flying threats, because the ground and hills are in the way.'],
  ['Raw / effective readiness', 'Raw is a domain’s own equipment condition. Effective is what is left after weakness in the domains it depends on.'],
  ['Readiness', 'How fit for use your equipment is, as a percentage.'],
  ['Site', 'A place the enemy attacks and you defend: a city, port, power station, signal hub or command post.'],
  ['Site coverage', 'The share of a region’s sites that lie within reach of some shooter. It measures geometry only; the forecast check predicts the actual outcome.'],
  ['Stockpile', 'The national reserve of rounds for one weapon type, which resupply draws on (Officer and Commander).'],
  ['Stability', 'How calm a region is. Stable regions pay more income.'],
  ['T+12h', 'Twelve hours after the campaign began. All times in the game are counted this way.'],
  ['Theater', 'The map of one region, 600 by 400 km, where you place defenses.'],
  ['Track', 'One object on the radar picture: a real threat or a decoy.'],
  ['Upper tier', 'Defenses that hit ballistic missiles very high up, at or beyond the edge of the atmosphere.'],
  ['Wave', 'One attack: a group of threats arriving together.'],
];

function Glossary() {
  const sorted = [...GLOSSARY].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12px] leading-relaxed sm:grid-cols-[11rem_1fr]">
      {sorted.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold text-white">{k}</dt>
          <dd className="mb-1 text-ops-text sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const KEYS: [string, string][] = [
  ['Space', 'Pause / resume'], ['1 – 4', 'Speed 1x / 2x / 4x / 8x'], ['T', `Advance ${SIM_CONFIG.turnHours} hours`], ['G S A M D', 'Global · Space · Air · Sea · Ground'], ['X', 'Tactical Theater'],
  ['I C L F', 'Intelligence · Communications · Logistics · Infrastructure'], ['P E R', 'Campaign · Scenario editor · After-Action Review'],
  ['N', 'Jump to whatever needs you most'], ['Ctrl/⌘ + S', 'Quick-save to slot 1'], ['B', 'Show or hide the bottom panel'], ['V', 'Sound on / off'], ['Esc', 'Close a window / deselect a region'], ['?', 'This guide'],
];

function Keys() {
  return (
    <div className="space-y-4">
      <table className="table-ops w-full"><tbody>{KEYS.map(([k, d]) => <tr key={k}><td className="w-36"><kbd className="rounded border border-ops-line px-1.5 text-ops-cyan">{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
      <p className="text-[11px] text-ops-dim">Shortcuts are off while a window such as a briefing or a report is open. The deploy screen can be worked entirely from the keyboard: Tab to a system in the catalog and press Enter, move the cursor on the map with the arrow keys (Shift for bigger steps), Enter to place. [ and ] change region, U undoes the last placement, Tab reaches placed systems, M moves the selected one and Delete takes it back. The ½x speed button slows the game for watching a wave closely.</p>
      <div className="rounded border border-ops-line p-3">
        <div className="label mb-2">Display & accessibility</div>
        <DisplaySettings />
      </div>
    </div>
  );
}

/** Each section of the guide, by tab. Exported so tests can render every page. */
export const PAGES: Record<GuideTab, () => JSX.Element> = {
  start: Start, first: First, threats: Threats, defenses: Defenses, equipment: Equipment, bands: Bands, phase: Phase, network: Network, score: Score, glossary: Glossary, keys: Keys,
};

export function GuideModal() {
  const ui = useUI();
  const tab: GuideTab = ui.help && ui.help in PAGES ? (ui.help as GuideTab) : 'start';
  const Page = PAGES[tab];
  const i = TABS.findIndex((t) => t.id === tab);
  return (
    <Modal wide tall title="FIELD GUIDE · HOW TO PLAY" onClose={() => ui.setHelp(false)}
      footer={<>
        {i > 0 && <button className="btn" onClick={() => ui.setHelp(TABS[i - 1].id)}>◂ {TABS[i - 1].label}</button>}
        {i < TABS.length - 1 && <button className="btn btn-primary" onClick={() => ui.setHelp(TABS[i + 1].id)}>{TABS[i + 1].label} ▸</button>}
      </>}>
      <div className="grid gap-4 md:grid-cols-[11rem_1fr]">
        <nav className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-0 md:flex-col md:self-start md:overflow-visible md:pb-0" role="tablist" aria-label="Guide sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === tab} className={`btn shrink-0 justify-start whitespace-nowrap ${t.id === tab ? 'btn-active' : ''}`} onClick={() => ui.setHelp(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="min-w-0 max-w-3xl" role="tabpanel" key={tab}><Page /></div>
      </div>
    </Modal>
  );
}
