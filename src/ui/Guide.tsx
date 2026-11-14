// The field guide: everything a new player needs, in plain language, with the numbers read from the game's own rules
// so the guide can never drift from what the simulation does. Opened with ? from anywhere, including the start screen.
import type { ReactNode } from 'react';
import {
  COMMAND_LEVELS, COMMAND_LEVEL_IDS, EQUIPMENT, LAYER_LABELS, PASSIVE_SENSOR, PROTECTION_SCORE_WEIGHT, RADAR_BANDS, RADAR_BAND_IDS, SIM_CONFIG,
  STOCKPILES, TACTICAL_CONFIG, THREAT_CLASSES, THREAT_LABELS, WEATHER, type DefenseLayer, type RadarBand, type ThreatClass,
} from '../engine';
import { Modal } from './components/ui';
import { DisplaySettings } from './a11y/DisplayControl';
import { LAYER_COLOR } from './views/theater/icons';
import { useUI } from './uiState';

export type GuideTab = 'start' | 'first' | 'threats' | 'defenses' | 'bands' | 'phase' | 'network' | 'score' | 'glossary' | 'keys';

const TABS: { id: GuideTab; label: string }[] = [
  { id: 'start', label: 'Start here' },
  { id: 'first', label: 'Your first phase' },
  { id: 'threats', label: 'Threats' },
  { id: 'defenses', label: 'Defenses' },
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

const THREAT_ABBR: Record<ThreatClass, string> = { slowDrone: 'SD', fastDrone: 'FD', cruise: 'CM', rocket: 'RK', ballistic: 'BM' };
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
};

function Threats() {
  const C = TACTICAL_CONFIG;
  return (
    <>
      <H>The five kinds of threat</H>
      <P>Every attack is a <B>wave</B>: a group of threats that arrives together from one side of the map, each aimed at one of your sites. There are five kinds, and no single weapon is good against all of them. The two-letter codes appear throughout the game.</P>
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
      <P><B>Damage</B> is how much integrity (out of 100) a site loses when that threat gets through. Damaged sites drag down the region’s stability and infrastructure, cut your income, and make the region a likelier target next phase. Damage carries over until you rebuild it.</P>
      <H>Low fliers and the radar horizon</H>
      <P>Drones and cruise missiles fly <B>low</B>. The ground curves away and hills get in the way, so a radar on the ground cannot see a low flier until it is close: about <B>{C.lowAltitude.horizonKm} km</B>, or {C.lowAltitude.horizonKm * C.lowAltitude.massifHorizonMult} km from a radar placed on a mountain. This is the <B>radar horizon</B>. It applies to weapons too: a missile system with a 300 km range still only engages low fliers within {C.lowAltitude.horizonKm} km of itself. Rockets and ballistic missiles fly high, so the horizon does not hide them.</P>
      <P>Two things beat the horizon: put the system <B>close to the site</B> it protects, or deploy an <B>aircraft radar</B> (E-2D, E-7, GlobalEye), which looks down from above and lets ground systems shoot at low fliers out to their full range.</P>
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
        <><B>Radar</B>: the band of its own radar and how far that radar sees. “No radar” means it is aimed by eye or by heat-seeker: it needs another sensor nearby to warn it, and shoots worse at night.</>,
        <><B>Low-level ≤{C.lowAltitude.horizonKm} km</B>: a reminder that against low fliers this system only reaches the radar horizon, not its full range. The dotted ring on the map.</>,
        <><B>The five bars</B> (SD FD CM RK BM): the chance one shot stops each kind of threat. No bar means it cannot engage that kind. Each system fires up to {C.maxShotsPerSystem} shots at a threat if there is time.</>,
      ]} />
      <H>What decides whether a threat is stopped</H>
      <Steps items={[
        <><B>Can anything reach it?</B> The threat’s path must pass through a shooter’s range (the radar horizon for low fliers), the shooter must be able to hit that kind of threat and reach its altitude, and it must have rounds left.</>,
        <><B>Was it seen?</B> If a sensor tracked it, shooters react at normal speed and full accuracy. If nothing saw it, they react twice as slowly and hit less than half as often.</>,
        <><B>Was there time?</B> Fast threats cross a short-range system’s reach in seconds. If its reaction time is longer than that, it never fires.</>,
        <><B>Did the shot hit?</B> Each shot rolls against the kill chance on the card, reduced if the system is worn, if regional communications are poor, or if it is firing on another sensor’s rough track.</>,
      ]} />
      <P>After every wave the debrief lists each threat, who shot at it and, for anything that got through, the reason in plain words.</P>
      <H>Terrain</H>
      <P>Ships go on water, everything else on land. Mountains block a ground radar’s view of low fliers behind them, but a radar <B>on</B> a mountain sees twice as far over the horizon.</P>
      <Tip>For your first defense: one medium-range battery (IRIS-T SLM or NASAMS) next to the most-threatened city, a gun system (Skynex) on the next site, and a cheap sensor facing the attack. The deploy screen’s first-deployment guide walks you through exactly this.</Tip>
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
        <><B>Don’t lean on a far-off aircraft alone.</B> An E-2D lets a distant battery shoot at low fliers over its horizon, but on a blurry UHF track those shots land about {pct(RADAR_BANDS.UHF.cue)} as often. Batteries close enough to see the threat themselves shoot at full accuracy.</>,
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
        <>Want to jump in: start a <B>Campaign</B> on <B>Recruit</B> and read <B>Your first phase</B> on the next tab.</>,
        <>Stuck on a word: the <B>Glossary</B> tab explains every term and abbreviation the game uses.</>,
      ]} />
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
      <P>The next briefing opens with what was damaged and whether you met your objectives. Open the <B>After-Action Review</B> (key R) at any time to see every wave, why each threat was stopped or got through, and what one extra system would have changed.</P>
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
        <><B>Resupply.</B> Refills a system’s magazine over a few hours. It costs credits in proportion to the rounds brought, and needs logistics capacity of at least {C.minLogisticsForResupply}.</>,
        <><B>Redeploy.</B> Moves a system to a new spot or another region. It is out of action while it travels: {R.sameRegionHours} hours within a region; to another region {R.otherRegionHours.air} hours for aircraft, {R.otherRegionHours.ground} for ground systems and {R.otherRegionHours.sea} for ships. Use it when a warning appears for a region you did not defend.</>,
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
        <><B>Task confirmation</B> ({SIM_CONFIG.confirmCost} credits, about {SIM_CONFIG.confirmHours} hours): an independent check. A false report is exposed and closes; a real one is confirmed. Worth it whenever confidence is low and there is time.</>,
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
      <P>Each objective you meet adds a point (up to 8) and most pay credits at once.</P>
      <H>Difficulty</H>
      <ul className="mt-1.5 space-y-1 text-[12px] leading-relaxed">
        {COMMAND_LEVEL_IDS.map((l) => <li key={l}><B>{COMMAND_LEVELS[l].label}.</B> {COMMAND_LEVELS[l].description}</li>)}
      </ul>
      <H>The After-Action Review</H>
      <P>Open it at any time (key R). It breaks the score into its parts, lists every wave with the fate of each threat, compares what you spent on interceptors with what the attacker spent, and suggests the one system that would have helped most in each region.</P>
    </>
  );
}

const GLOSSARY: [string, string][] = [
  ['AAR', 'After-Action Review: the report on how you did, available any time with the R key.'],
  ['Adjutant', 'Your assistant. It lists the most useful things to do next in the sidebar and in briefings.'],
  ['Airborne early warning', 'A radar carried by an aircraft (E-2D, E-7, GlobalEye). It looks down from above, so the radar horizon does not hide low fliers from it.'],
  ['Alert (Raise alert)', 'A short period of heightened readiness in one region: faster reactions and better detection, at a cost. Not the same as the “Alert” level in the top bar, which just summarises how much is going wrong.'],
  ['Asset', 'One piece of equipment in your network: a satellite, an aircraft, a ship, a radar site, or a deployed defense system.'],
  ['Awareness', 'How well your sensors cover a region. Higher means more reliable reports, earlier warnings and fewer decoys.'],
  ['Axis', 'The side of the map an attack comes from: north, south, east or west.'],
  ['Band', 'The wavelength a radar uses. See the Radar bands tab.'],
  ['BM, CM, FD, RK, SD', 'Ballistic missile, cruise missile, fast drone, rocket, slow drone.'],
  ['Ceiling', 'The greatest height a weapon can hit.'],
  ['Confidence', 'How likely a report is to be real. A very high confidence is labelled CONFIRMED, but only a confirmation you tasked is certain.'],
  ['cr', 'Credits, the game’s money.'],
  ['Crew', 'A maintenance team. Each can do one job at a time.'],
  ['Cue', 'When one sensor tells a shooter where to look. How good the cue is depends on the sensor’s radar band.'],
  ['Decoy / false track', 'A fake threat that does no damage but can draw fire.'],
  ['Domain', 'One of the four parts of the network: Space, Air, Sea and Ground.'],
  ['Effector / shooter / interceptor', 'Anything that destroys threats: guns, missiles, lasers, jammers.'],
  ['Escalation', 'What happens when a report is left until its time runs out: lasting damage, and sometimes a new problem.'],
  ['Forecast', 'The briefing’s prediction of which regions will be attacked this phase.'],
  ['Integrity', 'A site’s health, from 100 (untouched) to 0 (destroyed).'],
  ['Layer', 'A family of defenses grouped by reach, from close-in guns to the upper tier.'],
  ['Magazine / rounds', 'The shots a system holds before it needs resupply.'],
  ['Network health', 'The state of communications worldwide. Every domain depends on it.'],
  ['Phase', 'One chapter of a campaign: a briefing followed by two or three simulated days.'],
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
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-[12px] leading-relaxed sm:grid-cols-[11rem_1fr]">
      {GLOSSARY.map(([k, v]) => (
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
  ['Ctrl/⌘ + S', 'Quick-save to slot 1'], ['B', 'Show or hide the bottom panel'], ['V', 'Sound on / off'], ['Esc', 'Close a window / deselect a region'], ['?', 'This guide'],
];

function Keys() {
  return (
    <div className="space-y-4">
      <table className="table-ops w-full"><tbody>{KEYS.map(([k, d]) => <tr key={k}><td className="w-36"><kbd className="rounded border border-ops-line px-1.5 text-ops-cyan">{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
      <p className="text-[11px] text-ops-dim">Shortcuts are off while a window such as a briefing or a report is open. On the deploy map you can also Tab to the map, move with the arrow keys and press Enter to place.</p>
      <div className="rounded border border-ops-line p-3">
        <div className="label mb-2">Display & accessibility</div>
        <DisplaySettings />
      </div>
    </div>
  );
}

const PAGES: Record<GuideTab, () => JSX.Element> = {
  start: Start, first: First, threats: Threats, defenses: Defenses, bands: Bands, phase: Phase, network: Network, score: Score, glossary: Glossary, keys: Keys,
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
