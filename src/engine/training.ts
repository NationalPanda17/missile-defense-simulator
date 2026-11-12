// Training Academy: a curriculum of short guided lessons and a graded certification exercise.
//
// Each lesson is an ordinary training-mode scenario (its own seed, scripted events and, for the tactical lessons,
// scripted threat waves) plus a list of steps. A step either waits for the player to do something, checked by a pure
// predicate over the simulation state and what the UI is showing, or is a short read / quiz the player moves past.
// Keeping the checks here, free of UI code, lets the tests prove every lesson can be completed.
import { computeScore, protectionScore } from './scoring';
import { regionProtection } from './tactical';
import { EQUIPMENT_MAP, isEffector } from './equipment';
import type { PhaseConfig, RegionId, ScenarioSettings, SimState, ThreatAxis, ThreatClass } from './types';

/** What a step's check can see: the simulation, what the UI is showing, and where the step began. */
export interface StepContext {
  s: SimState;
  view: string;
  region: RegionId | null;
  eventId: string | null;
  assetId: string | null;
  /** Command-log length and sim hour when the step began, so a step only counts what was done after it opened. */
  since: { cmd: number; hour: number };
}

export interface Quiz {
  question: string;
  options: string[];
  answer: number; // index into options
  explain: string; // shown after any answer
}

export interface LessonStep {
  id: string;
  title: string;
  text: string;
  /** Why this matters in the real job, shown under the instruction. */
  why?: string;
  /** Extra help the player can reveal if stuck. */
  hint?: string;
  /** The view "Show me" opens. */
  view?: string;
  /** The step waits for time to pass (a confirmation, a repair, a wave): the coach doesn't pause the clock for it. */
  wait?: boolean;
  /**
   * Must be done after the step opens. Other steps also count work done earlier, so a player who runs ahead is not
   * asked to repeat it.
   */
  fresh?: boolean;
  /**
   * Controls to spotlight while the step is open, by their `data-coach` name in the UI. The first name with anything
   * visible on screen wins, so a list can say "the button in the dialog, or else the thing that opens the dialog".
   */
  target?: string[];
  /**
   * Done when this returns true. Steps without a check or quiz are read and moved past with Next; the coach pauses the
   * clock while one is open so nothing happens while the player reads.
   */
  check?: (c: StepContext) => boolean;
  /** A question built from the current state; the step is done when it is answered correctly. */
  quiz?: (s: SimState) => Quiz;
}

/** A threat wave written into a tactical lesson. Hours are from the start of the lesson's phase. */
export interface ScriptedWave {
  region: RegionId;
  atHour: number;
  axis: ThreatAxis;
  tracks: Partial<Record<ThreatClass, number>>;
  /** Shown in the briefing forecast (false = a surprise attack). */
  forecast: boolean;
}

export interface TrainingLesson {
  id: string;
  title: string;
  summary: string;
  minutes: number; // rough real-time length
  skills: string[];
  /** Lessons that should be done first (advisory: every lesson can be started any time). */
  after?: string[];
  settings: Partial<ScenarioSettings>;
  phase: Pick<PhaseConfig, 'name' | 'situation' | 'scripted'> & Partial<PhaseConfig>;
  waves?: ScriptedWave[];
  steps: LessonStep[];
  /** The graded final exercise. */
  exam?: boolean;
  /** A practice drill: a short scored challenge with stars, played after (or instead of) the course. */
  drill?: DrillSpec;
}

export interface DrillSpec {
  goal: string;
  /** 0-100, live while the drill runs and final when it ends. */
  score: (s: SimState) => number;
  /** Scores needed for one, two and three stars. */
  stars: [number, number, number];
}

export const starsFor = (d: DrillSpec, score: number) => d.stars.filter((x) => score >= x).length;

// ── Check helpers ───────────────────────────────────────────────────────

/** Commands of a kind recorded since the step opened. */
const cmdsSince = (c: StepContext, kind: string, text?: string) =>
  c.s.commands.slice(c.since.cmd).filter((x) => x.kind === kind && (!text || x.text.includes(text)));
const did = (c: StepContext, kind: string, text?: string) => cmdsSince(c, kind, text).length > 0;
const running = (c: StepContext) => c.s.status !== 'briefing';
const DOMAIN_VIEWS = ['space', 'air', 'sea', 'ground'];
const deployedIn = (s: SimState, region: RegionId, pred: (spec: NonNullable<ReturnType<typeof EQUIPMENT_MAP.get>>) => boolean) =>
  (s.tactical?.deployments ?? []).some((d) => d.region === region && pred(EQUIPMENT_MAP.get(d.equipmentId)!));
const wavesDone = (s: SimState) => !!s.tactical?.waves.length && s.tactical.waves.every((w) => w.resolved && w.applied !== false);

const regionName = (s: SimState, r: RegionId) => s.regions[r].name;

/** Shuffle-free option list with the right answer at a fixed, state-derived position (stable across renders). */
function quizFrom(question: string, right: string, wrong: string[], explain: string, salt: number): Quiz {
  const options = [...wrong];
  const answer = Math.abs(salt) % (wrong.length + 1);
  options.splice(answer, 0, right);
  return { question, options, answer, explain };
}

// ── The curriculum ───────────────────────────────────────────────────────

const QUIET: Partial<PhaseConfig> = { eventRate: 0, maxSeverity: 2, delayedInfo: false, conflicting: false, chains: false };

export const LESSONS: TrainingLesson[] = [
  {
    id: 'basics', title: 'Command basics', minutes: 5,
    summary: 'Take command, control time, and find your way around the screen.',
    skills: ['Starting a phase', 'Pause and speed', 'Turn mode', 'Opening a region'],
    settings: { durationHours: 240, seed: 1101 },
    phase: { ...QUIET, name: 'Orientation', scripted: [{ atHour: 10, templateId: 'sensor_drift', region: 'EUR' }],
      situation: 'A quiet watch. Use it to learn the controls. Nothing here can go badly wrong.' },
    steps: [
      { id: 'welcome', title: 'Welcome, Commander', view: 'global',
        text: 'This is a command center for a fictional defense network that spans four domains (Space, Air, Sea and Ground) across seven regions. Every lesson gives you a small task, then waits until you have done it. The coach (this panel) ticks off each step for you.',
        why: 'Every later lesson assumes you can move around the screen quickly, so it is worth five minutes now.' },
      { id: 'begin', target: ['begin'], title: 'Take command',
        text: 'Each scenario opens with a briefing. Read it, then press “Assume command — begin phase” at the bottom of the briefing window.',
        hint: 'The briefing is the large window in the middle of the screen. The button is bottom right.',
        check: running },
      { id: 'pause', target: ['pause'], title: 'Pause the clock', view: 'global',
        text: 'Time is now running. Press the Pause button in the top bar, or the Space bar on your keyboard.',
        why: 'Pausing is free and always allowed. Experienced commanders pause whenever something new arrives, decide, then resume.',
        check: (c) => did(c, 'control', 'paused') },
      { id: 'speed', target: ['speed'], title: 'Change speed',
        text: 'Pick 4x or 8x in the top bar (keys 3 and 4) so quiet periods pass quickly.',
        hint: 'The speed buttons sit next to the Pause button and read 1x 2x 4x 8x.',
        check: (c) => c.s.speed >= 4 },
      { id: 'turns', target: ['turn'], title: 'Switch to turn mode',
        text: 'Prefer to play step by step? Turn on Turn mode in the top bar. The clock stops and moves only when you advance it.',
        check: (c) => c.s.turnBased },
      { id: 'advance', fresh: true, target: ['advance'], title: 'Advance one turn',
        text: 'Press Next turn +6h in the top bar (or the T key) to move the clock forward six hours.',
        check: (c) => c.s.hour >= c.since.hour + 6 },
      { id: 'region', target: ['map'], title: 'Open a region', view: 'global',
        text: 'Click any region on the world map to open its dashboard: readiness, communications, awareness and stability for that area.',
        hint: 'Regions are the coloured shapes on the map in Global Operations (key G).',
        check: (c) => c.region !== null },
      { id: 'realtime', target: ['turn'], title: 'Back to real time',
        text: 'Turn Turn mode off again. You can switch between the two at any time; the lessons that follow work with either.',
        check: (c) => !c.s.turnBased },
      { id: 'done', title: 'Basics complete',
        text: 'You can start a phase, pause, change speed, play in turns and inspect a region. Press ? at any time for the full list of keyboard shortcuts.' },
    ],
  },
  {
    id: 'situation', title: 'Reading the situation', minutes: 7, after: ['basics'],
    summary: 'Understand readiness, domain dependencies and the staff views before you act.',
    skills: ['Raw vs effective readiness', 'Domain dependencies', 'Staff views', 'The event log'],
    settings: { durationHours: 240, seed: 1202, domainCondition: { space: 58 } },
    phase: { ...QUIET, name: 'Situation Awareness', scripted: [{ atHour: 4, templateId: 'relay_degradation', region: 'AFR' }],
      situation: 'Several orbital relays are overdue for service. Learn to spot weaknesses before they turn into incidents.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase from the briefing.', check: running },
      { id: 'space', target: ['nav-space'], title: 'Open the Space domain', view: 'space',
        text: 'Open the Space dashboard from the left menu (key S). It lists every orbital asset with its condition and service clock.',
        check: (c) => c.view === 'space' },
      { id: 'rawEff', title: 'Raw and effective readiness',
        text: 'Each domain shows two readiness numbers. Raw readiness comes from the condition of its own assets. Effective readiness is lower when a domain it depends on is weak: Air and Sea rely on Space relays, and Space relies on Ground control.',
        why: 'Fixing the right domain first can lift several others at once.' },
      { id: 'quizDep', title: 'Check your understanding',
        quiz: (s) => quizFrom('Space is in poor shape in this scenario. Which domains does that drag down?',
          'Air and Sea', ['Ground only', 'None: domains are independent', 'Only Space itself'],
          'Air and Sea depend on Space relays for communications and navigation, so a weak Space domain lowers their effective readiness.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'air', target: ['nav-air'], title: 'See the knock-on effect', view: 'air',
        text: 'Open the Air dashboard (key A) and compare its raw and effective readiness.',
        check: (c) => c.view === 'air' },
      { id: 'intel', target: ['nav-intel'], title: 'Intelligence', view: 'intel',
        text: 'Open Intelligence (key I). This is where reports land, with their confidence level. You will use it a lot in the next lesson.',
        check: (c) => c.view === 'intel' },
      { id: 'comms', target: ['nav-comms'], title: 'Communications', view: 'comms',
        text: 'Open Communications (key C). Network health feeds every domain. Watch for the relay problem that appears in Africa.',
        check: (c) => c.view === 'comms' },
      { id: 'logistics', target: ['nav-logistics'], title: 'Logistics', view: 'logistics',
        text: 'Open Logistics (key L): credits, personnel, maintenance crews and long-term investments.',
        check: (c) => c.view === 'logistics' },
      { id: 'quizWeak', title: 'Spot the weakest region',
        quiz: (s) => {
          const ids = Object.keys(s.regions) as RegionId[];
          const sorted = [...ids].sort((a, b) => s.regions[a].readiness - s.regions[b].readiness);
          return quizFrom('Using the world map or regional dashboards, which of these regions has the lowest readiness right now?',
            regionName(s, sorted[0]), [sorted[3], sorted[5], sorted[6]].map((r) => regionName(s, r)),
            `${regionName(s, sorted[0])} is at ${Math.round(s.regions[sorted[0]].readiness)}%. Set the map overlay to Readiness under Layers & Legend to see it at a glance.`, s.hour + 3);
        },
        view: 'global', text: 'Look before you answer.' },
      { id: 'log', title: 'The log',
        text: 'The bottom panel holds the timeline and the event log. Every report, order and result is written there with its time. Press B to show or hide it.' },
      { id: 'done', title: 'Situation awareness complete',
        text: 'You know where to look for readiness, dependencies, reports, the network and resources. Next: deciding whether a report is real.' },
    ],
  },
  {
    id: 'information', title: 'Information quality', minutes: 8, after: ['situation'],
    summary: 'Confirm uncertain reports, expose false ones, and act on the real ones.',
    skills: ['Confidence levels', 'Tasking confirmation', 'Dismissing false reports', 'Acting on confirmed reports'],
    settings: { durationHours: 240, seed: 1303 },
    phase: { ...QUIET, name: 'Fog of Information',
      scripted: [{ atHour: 1, templateId: 'false_contact', region: 'SAM' }, { atHour: 2, templateId: 'sensor_drift', region: 'EUR' }, { atHour: 6, templateId: 'false_contact', region: 'IPA' }],
      situation: 'Reports are arriving from several regions. Not all of them are true.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase.', check: running },
      { id: 'levels', title: 'Confidence levels', view: 'intel',
        text: 'Every report carries a confidence: UNVERIFIED, POSSIBLE, PROBABLE or CONFIRMED. Low confidence does not mean false, and high confidence does not mean certain.',
        why: 'Real commanders lose more to acting on bad information, or ignoring good information, than to slow decisions.' },
      { id: 'open', target: ['events'], title: 'Open a report',
        text: 'Wait for the first report (the South America contact), then click it in the Active Events list on the right, or in Intelligence.',
        hint: 'If nothing is listed yet, unpause or advance an hour.',
        check: (c) => c.eventId !== null },
      { id: 'confirm', target: ['confirm', 'events'], title: 'Task a confirmation',
        text: 'In the report window, press “Task confirmation”. An independent source checks the report for a small fee and a few hours.',
        check: (c) => did(c, 'confirm') },
      { id: 'result', wait: true, title: 'Wait for the result',
        text: 'Let time run until the confirmation finishes. A false report closes itself; a real one becomes CONFIRMED.',
        check: (c) => c.s.counters.confirmations >= 1 },
      { id: 'dismiss', target: ['dismiss', 'events'], title: 'Dismiss a false report',
        text: 'Another dubious contact will come in from Indo-Pacific. This time, judge it yourself and press Dismiss. Notice it has low confidence and nothing else in that region backs it up.',
        hint: 'Open the Indo-Pacific report and use Dismiss. If you dismiss a real event by mistake it keeps developing out of sight, so be sure.',
        check: (c) => c.s.counters.falseDismissed >= 2 || did(c, 'dismiss') },
      { id: 'respond', target: ['respond', 'events'], title: 'Act on a real report',
        text: 'The Europe sensor drift is genuine. Open it and execute one of its responses.',
        check: (c) => c.s.counters.responsesTotal >= 1 },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('Why not simply dismiss every low-confidence report?',
          'A dismissed report that was real keeps developing out of sight, and costs score',
          ['Dismissing costs a lot of credits', 'Dismissed reports come back with higher confidence', 'You can only dismiss three reports per phase'],
          'Dismissing is free, but a real event you dismiss carries on and often escalates. Confirm when unsure and the stakes are high.', s.settings.seed + 1),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Information quality complete',
        text: 'Confirm when unsure, dismiss when you have good reason, act when confident. Next: choosing the right response.' },
    ],
  },
  {
    id: 'events', title: 'Event response', minutes: 10, after: ['information'],
    summary: 'Compare responses, buy time with monitoring, and resolve events before they escalate.',
    skills: ['Comparing responses', 'Success chance', 'Monitor only', 'Decision windows'],
    settings: { durationHours: 240, seed: 1404 },
    phase: { ...QUIET, name: 'Incident Desk',
      scripted: [{ atHour: 1, templateId: 'relay_degradation', region: 'AFR' }, { atHour: 2, templateId: 'storm', region: 'IPA' }, { atHour: 4, templateId: 'power_fault', region: 'NAM' }],
      situation: 'Three genuine incidents in quick succession. Each has a decision window before it escalates.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase.', check: running },
      { id: 'open', target: ['events'], title: 'Open an incident',
        text: 'Open the Africa relay degradation from the Active Events list.',
        check: (c) => c.eventId !== null },
      { id: 'compare', title: 'Compare the options',
        text: 'Each response shows its cost, time, crews needed and chance of success. Some depend on another domain (the orbital reroute needs a healthy Space domain) or on regional communications.',
        why: 'The cheapest option is not always the best value: a failed response wastes the money and the time.' },
      { id: 'monitor', target: ['monitor', 'events'], title: 'Buy time once',
        text: 'Pick an incident you are not ready to fix yet and choose “Monitor Only”. Its window gets longer, but its effects keep building. You can do this once per event.',
        check: (c) => did(c, 'monitor') },
      { id: 'respond', target: ['respond', 'events'], title: 'Order two responses',
        text: 'Execute a response on two different incidents. Watch crews: each crew can work on one job at a time.',
        hint: 'If you run out of crews, choose responses that need 0 crews or wait for one to finish.',
        check: (c) => c.s.counters.responsesTotal >= 2 },
      { id: 'resolve', wait: true, title: 'See them through',
        text: 'Let time run until two incidents are resolved. If a response fails, order another before the window closes.',
        check: (c) => c.s.counters.resolved >= 2 },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('What happens when an event’s decision window runs out?',
          'It escalates: lasting damage and sometimes a follow-on event',
          ['It disappears with no effect', 'It resolves itself for free', 'The scenario ends'],
          'Escalations hurt stability and infrastructure and count against your score, so watch the timers in the Active Events list.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Event response complete',
        text: 'You can weigh responses, use monitoring sparingly and close incidents in time. Next: keeping the hardware healthy.' },
    ],
  },
  {
    id: 'maintenance', title: 'Maintenance & assets', minutes: 8, after: ['events'],
    summary: 'Service assets before they fail and move aircraft and ships where they are needed.',
    skills: ['Service clocks', 'Scheduling maintenance', 'Crews', 'Redeploying assets'],
    settings: { durationHours: 240, seed: 1505, domainCondition: { air: 60, sea: 64 } },
    phase: { ...QUIET, name: 'Readiness Review', scripted: [{ atHour: 12, templateId: 'airframe', region: 'EUR' }],
      situation: 'Air and maritime units are worn and several are due for service. Plan maintenance so the network never thins out too far.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase.', check: running },
      { id: 'domain', target: ['nav-air', 'nav-sea'], title: 'Open a domain', view: 'air',
        text: 'Open the Air dashboard (key A). Look at each asset’s condition and its service clock; negative numbers mean service is overdue.',
        check: (c) => DOMAIN_VIEWS.includes(c.view) },
      { id: 'asset', target: ['asset'], title: 'Inspect an asset',
        text: 'Click an asset in the list to open its details.',
        check: (c) => c.assetId !== null },
      { id: 'maintain', target: ['maintain', 'asset'], title: 'Schedule maintenance',
        text: 'Pick a worn asset and schedule maintenance. It leaves service for a while, costs credits and needs one crew.',
        why: 'An asset that is never serviced loses condition faster and eventually fails, which costs far more than a planned service.',
        check: (c) => did(c, 'maintain', 'scheduled') },
      { id: 'finish', wait: true, title: 'Complete a maintenance cycle',
        text: 'Let time run until the maintenance finishes and the asset is back in service.',
        check: (c) => c.s.counters.maintenanceDone >= 1 },
      { id: 'redeploy', target: ['redeploy', 'asset', 'nav-air'], title: 'Redeploy an aircraft or ship',
        text: 'Open an Air or Sea asset and redeploy it to another region. It is out of action while in transit, so move units before they are needed, not after.',
        hint: 'Only air and maritime assets can be redeployed. The Redeploy control is in the asset window.',
        check: (c) => did(c, 'redeploy') },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('You have one free crew and three overdue assets. What is the best approach?',
          'Service the one that matters most now, and queue the others as crews free up',
          ['Ignore them until they fail', 'Redeploy all three to another region', 'Dismiss their service warnings'],
          'Crews are the bottleneck. Prioritise by what each asset supports, and consider the Expand Maintenance Crews investment for long scenarios.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Maintenance complete', text: 'Healthy assets are the foundation of readiness. Next: spending for the long term.' },
    ],
  },
  {
    id: 'resources', title: 'Resources & investment', minutes: 7, after: ['maintenance'],
    summary: 'Understand income and upkeep, and make investments that pay off over a campaign.',
    skills: ['Income from stability', 'Upkeep', 'Long-term projects'],
    settings: { durationHours: 240, seed: 1606, startCredits: 1800 },
    phase: { ...QUIET, name: 'Budget Planning', scripted: [{ atHour: 8, templateId: 'parts_shortage', region: 'MDE' }],
      situation: 'A calm period and a healthy budget: the right moment to invest.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase.', check: running },
      { id: 'logistics', target: ['nav-logistics'], title: 'Open Logistics', view: 'logistics',
        text: 'Open Logistics (key L). Credits come in every hour from stable regions and go out on upkeep for every asset.',
        check: (c) => c.view === 'logistics' },
      { id: 'quizIncome', title: 'Check your understanding',
        quiz: (s) => quizFrom('Where does your hourly income come from?',
          'Regional stability: stable regions fund the network', ['A fixed grant that never changes', 'Selling equipment', 'Dismissing reports'],
          'Unrest and damage in a region cut its contribution. Protecting stability protects your budget.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'invest', target: ['invest', 'nav-logistics'], title: 'Start an investment',
        text: 'Choose a long-term investment in Logistics or Infrastructure (for example Network Resilience Program or Expand Maintenance Crews) and start it.',
        why: 'Investments take time but keep paying off. Early in a campaign they are worth the most.',
        check: (c) => did(c, 'invest') },
      { id: 'progress', wait: true, title: 'Watch it build',
        text: 'Let time run until your project is at least a quarter complete. Projects keep going while you handle other work.',
        check: (c) => c.s.projects.some((p) => p.progress >= 25) || (c.s.projects.length === 0 && c.s.commands.some((x) => x.kind === 'invest')) },
      { id: 'reserve', target: ['respond', 'events'], title: 'Keep a reserve',
        text: 'Spending everything leaves you unable to answer the next incident. Respond to the parts shortage in the Middle East while keeping at least 300 credits in hand.',
        check: (c) => c.s.counters.responsesTotal >= 1 && c.s.credits >= 300 },
      { id: 'done', title: 'Resources complete', text: 'Income, upkeep, investment and reserves: the budget side of command. Next: the tactical layer.' },
    ],
  },
  {
    id: 'tactical1', title: 'Tactical I: placing defenses', minutes: 10, after: ['resources'],
    summary: 'Use the forecast, place sensors and interceptors, and protect a region from an incoming wave.',
    skills: ['Threat forecast', 'Sensors vs effectors', 'Coverage and protection', 'Watching a wave'],
    settings: { durationHours: 48, seed: 1707, startCredits: 3000 },
    phase: { ...QUIET, name: 'Theater Defense', scripted: [],
      situation: 'Intelligence expects a drone and cruise missile attack on Europe in the first hours of the phase. You have the budget to defend it.' },
    waves: [{ region: 'EUR', atHour: 8, axis: 'north', tracks: { slowDrone: 6, fastDrone: 2, cruise: 2 }, forecast: true }],
    steps: [
      { id: 'forecast', target: ['deploy-tab'], title: 'Read the forecast',
        text: 'The briefing’s Threat forecast names the regions expected to be attacked: here, Europe. Press “Deploy defenses” in the briefing.',
        why: 'Defenses can only be placed during a briefing, so the forecast is your planning window.' },
      { id: 'sensor', target: ['layer-detection', 'deploy-tab'], title: 'Place a sensor in Europe',
        text: 'Choose Europe, pick a detection system (a radar such as Giraffe 4A or Sentinel) and click the map to place it. Sensors don’t shoot, but systems they cue engage at full quality.',
        hint: 'In the deploy panel, select the region first, then the system, then click a spot on the land.',
        check: (c) => deployedIn(c.s, 'EUR', (sp) => sp.layer === 'detection') },
      { id: 'effector', target: ['deploy-map', 'deploy-tab'], title: 'Place an interceptor',
        text: 'Now place a system that actually engages threats, close to a city or other site. Short-range systems are cheap but must sit close; NASAMS or IRIS-T SLM reach further.',
        check: (c) => deployedIn(c.s, 'EUR', (sp) => isEffector(sp)) },
      { id: 'protect', target: ['deploy-map', 'deploy-tab'], title: 'Protect the region',
        text: 'Keep placing systems until Europe shows as PROTECTED: at least 70% of its site value inside some coverage.',
        hint: 'The coverage rings on the map show what each system reaches. Cover the cities and the command post first; they are worth the most.',
        check: (c) => regionProtection(c.s, 'EUR').level === 'protected' },
      { id: 'begin', target: ['begin'], title: 'Begin the phase', text: 'Assume command and start the phase.', check: running },
      { id: 'theater', target: ['nav-theater'], title: 'Open the Tactical Theater', view: 'theater',
        text: 'Open the Tactical Theater (key X) and choose Europe. When the wave launches you’ll see each threat fly in from the map edge towards its target.',
        check: (c) => c.view === 'theater' },
      { id: 'watch', wait: true, title: 'Watch the wave',
        text: 'Let time run until the wave has arrived. Green crosses are interceptions; red bursts are hits on a site.',
        check: (c) => wavesDone(c.s) },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('Why can a long-range radar miss a low-flying drone or cruise missile?',
          'They fly below the radar horizon and hills can block line of sight',
          ['Drones are invisible to all radar', 'Radars only work at night', 'Long-range radars are switched off in training'],
          'Surface radars see low fliers only close in. Put a radar on high ground, or use airborne early warning (E-7, E-2D, GlobalEye) to see over the horizon.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Tactical I complete',
        text: 'Forecast, sensors, effectors and coverage. Next: managing defenses while attacks are under way.' },
    ],
  },
  {
    id: 'tactical2', title: 'Tactical II: orders under fire', minutes: 12, after: ['tactical1'],
    summary: 'Raise alerts, resupply magazines and move systems while waves are inbound, including a surprise attack.',
    skills: ['Raising alerts', 'Resupply', 'Emergency redeploy', 'Surprise attacks'],
    settings: { durationHours: 48, seed: 1808, startCredits: 3200 },
    phase: { ...QUIET, name: 'Sustained Attack', scripted: [],
      situation: 'Two regions are forecast to be hit more than once. Expect at least one attack the forecast did not predict.' },
    waves: [
      { region: 'EUR', atHour: 6, axis: 'east', tracks: { slowDrone: 6, fastDrone: 3, cruise: 2 }, forecast: true },
      { region: 'MDE', atHour: 12, axis: 'south', tracks: { slowDrone: 4, rocket: 4, cruise: 2 }, forecast: true },
      { region: 'EUR', atHour: 20, axis: 'north', tracks: { slowDrone: 5, fastDrone: 4, cruise: 3 }, forecast: true },
      { region: 'AFR', atHour: 30, axis: 'west', tracks: { slowDrone: 6, fastDrone: 2 }, forecast: false },
    ],
    steps: [
      { id: 'deploy', target: ['region-MDE', 'deploy-tab'], title: 'Defend both forecast regions',
        text: 'In the briefing, deploy defenses so that Europe and the Middle East each have at least one system that can engage threats.',
        hint: 'Use “Deploy defenses”. Rockets need a system that can engage them, such as Iron Dome or NASAMS.',
        check: (c) => deployedIn(c.s, 'EUR', isEffector) && deployedIn(c.s, 'MDE', isEffector) },
      { id: 'begin', target: ['begin'], title: 'Begin the phase', text: 'Assume command.', check: running },
      { id: 'incoming', target: ['nav-theater'], title: 'Watch the warning',
        text: 'Incoming waves appear in the Tactical Theater and on the world map a few hours before they arrive. Better regional awareness gives earlier warning.', view: 'theater' },
      { id: 'alert', target: ['alert', 'nav-theater'], title: 'Raise an alert',
        text: 'When a wave is about to hit a region, raise an alert there from the Tactical Theater. For eight hours its systems react faster and see better, at a cost and with extra wear.',
        why: 'Alerts are most valuable in the hours just before an attack; raised too early they burn money and wear out equipment.',
        check: (c) => did(c, 'alert') },
      { id: 'resupply', target: ['resupply', 'nav-theater'], title: 'Resupply a magazine',
        text: 'After the first wave, select a system that fired and order a resupply. It reloads over a few hours. Systems with an empty magazine can’t engage.',
        hint: 'Open a deployed system in the Tactical Theater. Its rounds bar drops as it fires.',
        check: (c) => did(c, 'resupply') },
      { id: 'surprise', target: ['emergency', 'nav-theater'], title: 'Answer the surprise',
        text: 'An attack the forecast did not predict is building against Africa. Use Emergency redeploy to move a system there. It is out of action while it moves, so act early.',
        hint: 'Select a deployed system in the Tactical Theater, choose Emergency redeploy, pick Africa and click a spot near its sites.',
        check: (c) => did(c, 'redeploy', 'Emergency') },
      { id: 'ride', wait: true, title: 'Ride it out',
        text: 'Let time run until all four waves have arrived.',
        check: (c) => wavesDone(c.s) },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('A wave includes decoys. What do they do?',
          'They look like real threats and draw interceptor shots, but cause no damage',
          ['They double the damage of real threats', 'They disable your radars', 'Nothing: they are ignored automatically'],
          'Good sensors help tell decoys apart. Firing expensive interceptors at decoys drains magazines and counts against efficiency.', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Tactical II complete', text: 'Alerts, resupply and redeployment keep a defense working through a long attack. Next: reading your results.' },
    ],
  },
  {
    id: 'debrief', title: 'Debrief & scoring', minutes: 5, after: ['tactical2'],
    summary: 'Finish a short scenario and learn to read the after-action review.',
    skills: ['Scenario end', 'After-action review', 'What the score rewards'],
    settings: { durationHours: 18, seed: 1909 },
    phase: { ...QUIET, name: 'Short Watch', scripted: [{ atHour: 2, templateId: 'sensor_drift', region: 'NAM' }, { atHour: 5, templateId: 'false_contact', region: 'POL' }],
      situation: 'A short watch to completion. Handle what comes in, then review how you did.' },
    steps: [
      { id: 'begin', target: ['begin'], title: 'Take command', text: 'Begin the phase.', check: running },
      { id: 'finish', wait: true, target: ['speed'], title: 'Run to the end',
        text: 'Handle the two reports however you judge best, then let the clock run until the scenario completes (speed 8x helps).',
        check: (c) => c.s.status === 'complete' },
      { id: 'aar', target: ['nav-aar'], title: 'Open the after-action review', view: 'aar',
        text: 'Open the After-Action Review (key R): score breakdown, regional and domain performance, every decision you made and lessons learned.',
        check: (c) => c.view === 'aar' },
      { id: 'quiz', title: 'Check your understanding',
        quiz: (s) => quizFrom('Which of these does the score reward?',
          'Sustained readiness, timely responses and efficient spending',
          ['Spending as many credits as possible', 'Dismissing every report quickly', 'Keeping the clock paused'],
          'The score weights readiness, network health, stability, response time, infrastructure, efficiency and information discipline (plus threat protection when the tactical layer is on).', s.settings.seed),
        text: 'Pick one answer.' },
      { id: 'done', title: 'Debrief complete', text: 'You have finished the course. Take the certification exercise to put it all together.' },
    ],
  },
  {
    id: 'exam', title: 'Certification exercise', minutes: 25, exam: true, after: ['debrief'],
    summary: 'A graded three-day scenario using everything above, with threat waves and uncertain reports. Pass five of six standards to certify.',
    skills: ['Everything'],
    settings: { durationHours: 72, seed: 2026, startCredits: 2600, falseReportRate: 0.25 },
    phase: { name: 'Certification', eventRate: 0.06, maxSeverity: 3, delayedInfo: true, conflicting: true, chains: true,
      categories: ['sensor', 'comms', 'aircraft', 'maritime', 'ground', 'weather', 'logistics'],
      scripted: [
        { atHour: 2, templateId: 'false_contact', region: 'NAM' },
        { atHour: 5, templateId: 'relay_degradation', region: 'EUR' },
        { atHour: 14, templateId: 'storm', region: 'IPA' },
        { atHour: 30, templateId: 'false_contact', region: 'AFR' },
        { atHour: 40, templateId: 'power_fault', region: 'MDE' },
      ],
      situation: 'Three days of mixed pressure: genuine and false reports, worn assets, and threat waves against two forecast regions and one that is not. You are graded at the end.' },
    waves: [
      { region: 'EUR', atHour: 10, axis: 'east', tracks: { slowDrone: 6, fastDrone: 3, cruise: 2 }, forecast: true },
      { region: 'MDE', atHour: 28, axis: 'south', tracks: { slowDrone: 4, rocket: 4, cruise: 2, ballistic: 1 }, forecast: true },
      { region: 'EUR', atHour: 46, axis: 'north', tracks: { slowDrone: 5, fastDrone: 3, cruise: 3 }, forecast: true },
      { region: 'SAM', atHour: 60, axis: 'west', tracks: { slowDrone: 5, fastDrone: 2, cruise: 1 }, forecast: false },
    ],
    steps: [
      { id: 'brief', target: ['deploy-tab'], title: 'Plan your defense',
        text: 'Read the briefing and the six standards in this panel. Deploy defenses for the forecast regions, keeping enough credits for incidents.' },
      { id: 'begin', target: ['begin'], title: 'Begin the exercise', text: 'Assume command when ready.', check: running },
      { id: 'finish', wait: true, title: 'Complete the exercise',
        text: 'Run the full 72 hours. The standards update live below. There are no hints from here: this is your test.',
        check: (c) => c.s.status === 'complete' },
      { id: 'result', title: 'Your result', view: 'aar',
        text: 'Your grade is shown below. Open the After-Action Review to see what went well and what to work on.' },
    ],
  },
];

// ── Practice drills ──────────────────────────────────────────────────────

const drillSteps = (goal: string, setup: string): LessonStep[] => [
  { id: 'brief', title: 'Your objective', text: `${goal} ${setup}` },
  { id: 'begin', target: ['begin'], title: 'Begin', text: 'Assume command when ready. Your score updates live below.', check: running },
  { id: 'finish', wait: true, title: 'Play it out', text: 'Play until the drill ends. Use any speed you like.', check: (c) => c.s.status === 'complete' },
  { id: 'result', title: 'Result', text: 'Your score and stars are below. Try again to beat your best.' },
];

/** Threat damage prevented, 0-100; 0 until the first threat has arrived. */
const defenseScore = (s: SimState) => (s.tactical?.stats.tracks ? clampScore(protectionScore(s) ?? 0) : 0);

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const clampScore = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

/** Share of the drill's reports handled well: real ones resolved, false ones exposed or dismissed without spending. */
function triageScore(s: SimState): number {
  const known = s.events.filter((e) => e.reportedAt <= s.hour);
  if (!known.length) return 0;
  const good = known.filter((e) => (e.isGenuine ? e.status === 'resolved' : (e.status === 'dismissed' || e.status === 'expired') && !e.responseId)).length;
  return clampScore((good / known.length) * 100 - s.counters.escalations * 10 - s.counters.genuineDismissed * 15);
}

export const DRILLS: TrainingLesson[] = [
  {
    id: 'drill-swarm', title: 'Drone swarm', minutes: 8, skills: ['Counter-drone', 'Magazines', 'Resupply'],
    summary: 'Three growing swarms hit Europe from different directions on a tight budget. Stop as much of the damage as you can.',
    settings: { durationHours: 32, seed: 3101, startCredits: 900 },
    phase: { ...QUIET, name: 'Drone Swarm', scripted: [], situation: 'Three drone swarms are expected against Europe, eight hours apart. You have 900 credits.' },
    waves: [
      { region: 'EUR', atHour: 8, axis: 'east', tracks: { slowDrone: 16, fastDrone: 6 }, forecast: true },
      { region: 'EUR', atHour: 16, axis: 'north', tracks: { slowDrone: 18, fastDrone: 8, cruise: 2 }, forecast: true },
      { region: 'EUR', atHour: 24, axis: 'south', tracks: { slowDrone: 20, fastDrone: 12, cruise: 3 }, forecast: true },
    ],
    drill: { goal: 'Prevent as much threat damage in Europe as possible.', score: defenseScore, stars: [75, 90, 98] },
    steps: drillSteps('Prevent as much threat damage in Europe as possible.', 'Cheap counter-drone systems go further than big interceptors here, and magazines run dry: resupply between waves.'),
  },
  {
    id: 'drill-triage', title: 'Report triage', minutes: 10, skills: ['Confirmation', 'Dismissal', 'Response'],
    summary: 'Eight reports in quick succession, some false. Resolve the real ones and expose the false ones without wasting money.',
    settings: { durationHours: 48, seed: 3202, startCredits: 1400 },
    phase: { ...QUIET, name: 'Report Triage', situation: 'A busy watch: eight reports arrive over the first day. Not all of them are real.',
      scripted: [
        { atHour: 1, templateId: 'sensor_drift', region: 'EUR' }, { atHour: 2, templateId: 'false_contact', region: 'SAM' },
        { atHour: 4, templateId: 'relay_degradation', region: 'AFR' }, { atHour: 6, templateId: 'false_contact', region: 'IPA' },
        { atHour: 9, templateId: 'storm', region: 'IPA' }, { atHour: 12, templateId: 'power_fault', region: 'NAM' },
        { atHour: 15, templateId: 'false_contact', region: 'MDE' }, { atHour: 18, templateId: 'airframe', region: 'EUR' },
      ] },
    drill: { goal: 'Handle every report correctly.', score: triageScore, stars: [60, 80, 95] },
    steps: drillSteps('Handle every report correctly.', 'Real reports should end resolved; false ones exposed by confirmation or dismissed, with no response spent on them. Escalations and dismissing a real report cost points.'),
  },
  {
    id: 'drill-budget', title: 'Thin budget', minutes: 12, skills: ['Prioritising', 'Maintenance', 'Reserves'],
    summary: 'Three days with 700 credits and worn equipment. Keep global readiness as high as you can.',
    settings: { durationHours: 72, seed: 3303, startCredits: 700, domainCondition: { air: 64, sea: 66, space: 70 } },
    phase: { ...QUIET, name: 'Thin Budget', eventRate: 0.07, maxSeverity: 3, categories: ['sensor', 'comms', 'aircraft', 'maritime', 'ground', 'weather', 'logistics'],
      scripted: [{ atHour: 6, templateId: 'parts_shortage', region: 'EUR' }],
      situation: 'Money is short and equipment is worn. Every credit has to count.' },
    drill: {
      goal: 'Keep average global readiness high.',
      score: (s) => clampScore(avg(s.history.map((h) => h.readiness)) - s.counters.escalations * 3),
      stars: [52, 58, 64],
    },
    steps: drillSteps('Keep average global readiness high.', 'Your score is the average readiness over the drill, minus 3 per escalation. Maintenance on the right assets pays off; keep a reserve for incidents.'),
  },
  {
    id: 'drill-higharc', title: 'High arc', minutes: 8, skills: ['Upper-tier defense', 'Placement'],
    summary: 'Ballistic missiles and rockets against the Middle East. Only the right systems can reach them.',
    settings: { durationHours: 30, seed: 3404, startCredits: 2800 },
    phase: { ...QUIET, name: 'High Arc', scripted: [], situation: 'Ballistic missile and rocket salvos are expected against the Middle East.' },
    waves: [
      { region: 'MDE', atHour: 8, axis: 'south', tracks: { ballistic: 3, rocket: 6 }, forecast: true },
      { region: 'MDE', atHour: 18, axis: 'east', tracks: { ballistic: 5, rocket: 6, cruise: 2 }, forecast: true },
    ],
    drill: { goal: 'Prevent as much threat damage in the Middle East as possible.', score: defenseScore, stars: [40, 60, 80] },
    steps: drillSteps('Prevent as much threat damage in the Middle East as possible.', 'Check each system’s altitude ceiling: ballistic missiles fly far above most short-range systems.'),
  },
  {
    id: 'drill-surprise', title: 'Surprise attack', minutes: 10, skills: ['Emergency redeploy', 'Alerts', 'Reading warnings'],
    summary: 'The forecast says Europe. Not every wave will agree. Watch the warnings and move fast.',
    settings: { durationHours: 40, seed: 3505, startCredits: 2600 },
    phase: { ...QUIET, name: 'Surprise Attack', scripted: [], situation: 'Intelligence expects attacks on Europe. Be ready to move.' },
    waves: [
      { region: 'EUR', atHour: 8, axis: 'east', tracks: { slowDrone: 6, cruise: 3 }, forecast: true },
      { region: 'AFR', atHour: 20, axis: 'north', tracks: { slowDrone: 8, fastDrone: 3 }, forecast: false },
      { region: 'SAM', atHour: 34, axis: 'west', tracks: { slowDrone: 6, cruise: 3 }, forecast: false },
    ],
    drill: { goal: 'Prevent as much threat damage as possible, wherever it lands.', score: defenseScore, stars: [30, 50, 70] },
    steps: drillSteps('Prevent as much threat damage as possible, wherever it lands.', 'Two waves will strike outside the forecast. Warnings appear a few hours ahead: emergency-redeploy systems in time.'),
  },
];

export const LESSON_MAP = new Map([...LESSONS, ...DRILLS].map((l) => [l.id, l]));
export const lessonOf = (s: SimState | null | undefined): TrainingLesson | undefined =>
  s?.settings.mode === 'training' && s.settings.lesson ? LESSON_MAP.get(s.settings.lesson) : undefined;

/** Phase config for a lesson (training mode). */
export function lessonPhase(lesson: TrainingLesson, settings: ScenarioSettings): PhaseConfig {
  return {
    id: 1, hours: settings.durationHours, eventRate: 0, falseRate: settings.falseReportRate,
    maxSeverity: 2, delayedInfo: false, conflicting: false, chains: false,
    categories: ['sensor', 'aircraft', 'ground', 'weather', 'comms'],
    grant: 0, special: ['Training Academy', lesson.drill ? 'Practice drill' : lesson.exam ? 'Graded' : 'Guided'],
    objectives: [],
    ...lesson.phase,
  };
}

/** Scenario settings for a lesson. */
export function lessonSettings(id: string, base: ScenarioSettings): ScenarioSettings {
  const l = LESSON_MAP.get(id);
  if (!l) throw new Error(`Unknown lesson ${id}`);
  return { ...base, ...l.settings, mode: 'training', lesson: id, name: `Training · ${l.title}` };
}

// ── Certification grading ────────────────────────────────────────────────

export interface Standard { id: string; text: string; value: string; met: boolean }

/** Reports the exam expects the player to act on (confirm, dismiss, respond or monitor) for the discipline standard. */
export const EXAM_MIN_HANDLED = 4;

/** Distinct reports the player acted on. Doing nothing must not count as good information discipline. */
export function reportsHandled(s: SimState): number {
  return new Set(s.commands.filter((x) => x.eventId && ['confirm', 'dismiss', 'respond', 'monitor'].includes(x.kind)).map((x) => x.eventId)).size;
}

/** The six standards of the certification exercise, evaluated on the current state (final once complete). */
export function examStandards(s: SimState): Standard[] {
  const c = s.counters;
  const score = computeScore(s);
  const tac = s.tactical?.stats;
  const stopRate = tac && tac.tracks > 0 ? tac.stopped / tac.tracks : null;
  const handled = reportsHandled(s);
  const avgResp = c.responseTimes.length ? c.responseTimes.reduce((a, b) => a + b, 0) / c.responseTimes.length : null;
  return [
    { id: 'score', text: 'Overall score of 60 or more', value: `${Math.round(score.total)}`, met: score.total >= 60 },
    { id: 'readiness', text: 'Global readiness at 60% or more', value: `${Math.round(s.metrics.globalReadiness)}%`, met: s.metrics.globalReadiness >= 60 },
    { id: 'escalations', text: 'No more than 2 escalations', value: `${c.escalations}`, met: c.escalations <= 2 },
    {
      id: 'discipline', text: `Handle at least ${EXAM_MIN_HANDLED} reports, dismiss no genuine one and waste at most 1 response on a false one`,
      value: `${handled} handled · ${c.genuineDismissed} dismissed · ${c.falseResponded} wasted`,
      met: handled >= EXAM_MIN_HANDLED && c.genuineDismissed === 0 && c.falseResponded <= 1,
    },
    { id: 'response', text: 'Average response within 6 hours of a report', value: avgResp === null ? '—' : `${avgResp.toFixed(1)}h`, met: avgResp !== null && avgResp <= 6 },
    { id: 'defense', text: 'Stop at least 60% of incoming threats', value: stopRate === null ? '—' : `${Math.round(stopRate * 100)}%`, met: stopRate !== null && stopRate >= 0.6 },
  ];
}

export const EXAM_PASS = 5;

export function examResult(s: SimState): { met: number; total: number; passed: boolean; score: number; grade: string } {
  const st = examStandards(s);
  const met = st.filter((x) => x.met).length;
  const sc = computeScore(s);
  return { met, total: st.length, passed: met >= EXAM_PASS, score: Math.round(sc.total), grade: sc.grade };
}
