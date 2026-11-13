// Top bar, left navigation, right sidebar and bottom panel.
import { useState } from 'react';
import { SoundControl } from './audio/SoundControl';
import { DisplayControl } from './a11y/DisplayControl';
import { AdjutantSection } from './Adjutant';
import { DOMAINS, SIM_CONFIG, isActive, formatObjective, objectiveProgress, objectiveValue, reserveDrain, type Domain, isKnown, confidenceLabel, incomingWaves, type LogLevel, type SimState } from '../engine';
import { dispatch, store, useSimTime } from '../store/simStore';
import { Bar, Chip, OBJECTIVE_LOOK, DOMAIN_COLOR, DOMAIN_LABEL, SEV_TONE, Tabs, TONE_TEXT, simClock, tone } from './components/ui';
import { useUI, type ViewId } from './uiState';
import { ServerStatusChip } from './views/ServerPanels';

const ALERT_TONE = { NORMAL: 'green', ELEVATED: 'cyan', HIGH: 'amber', SEVERE: 'red' } as const;

/** Sim clock that runs continuously (minutes tick by) instead of jumping an hour at a time. */
function SimClock({ s }: { s: SimState }) {
  const t = useSimTime();
  const clock = simClock(s.startDate, t);
  return <div className="tabular-nums text-white">{clock.date} <span className="text-ops-cyan">{clock.time}</span> <span className="text-ops-dim">T+{s.hour}h</span></div>;
}

/** Thin bar showing how far through the phase we are, moving continuously. */
function PhaseProgress({ s }: { s: SimState }) {
  const t = useSimTime();
  const phase = s.phases[s.phaseIndex];
  const pct = s.status === 'running' ? Math.min(100, ((t - s.phaseStartHour) / phase.hours) * 100) : s.status === 'complete' ? 100 : 0;
  return <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-ops-line/70"><div className="h-full bg-ops-cyan/70" style={{ width: `${pct}%` }} /></div>;
}

/** Picking a speed also resumes a paused clock (outside turn mode): choosing a speed means "run at this speed". */
let warned8 = false;
export function chooseSpeed(s: SimState, sp: 1 | 2 | 4 | 8) {
  if (sp === 8 && !warned8 && s.speed !== 8) {
    warned8 = true;
    const p = store.autoPause();
    store.toast('info', p && (p.launch || p.deadline)
      ? '8× is fast: a day passes in seconds. Auto-pause will stop for launches and decisions.'
      : '8× is fast: a day passes in seconds, and reports and launches can pass unnoticed. Turn on auto-pause under Aa.');
  }
  dispatch({ type: 'setSpeed', speed: sp });
  if (s.status === 'running' && s.paused && !s.turnBased) dispatch({ type: 'setPaused', paused: false });
}

export function TopBar({ s }: { s: SimState }) {
  const ui = useUI();
  const m = s.metrics;
  const phase = s.phases[s.phaseIndex];
  const phaseHour = s.hour - s.phaseStartHour;
  const running = s.status === 'running';
  return (
    <header className="relative z-40 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ops-line bg-ops-panel/90 px-2 py-1.5 backdrop-blur sm:gap-x-4 sm:gap-y-2 sm:px-3 sm:py-2">
      <div className="flex items-center gap-2">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <circle cx="13" cy="13" r="11" fill="none" stroke="#38d6f5" strokeOpacity=".5" />
          <circle cx="13" cy="13" r="6" fill="none" stroke="#38d6f5" strokeOpacity=".35" />
          <g className="radar-sweep" style={{ transformOrigin: '13px 13px' }}><path d="M13,13 L24,13 A11,11 0 0,0 21,5 Z" fill="#38d6f5" fillOpacity=".5" /></g>
        </svg>
        <div className="leading-none">
          <div className="font-sans text-[15px] font-bold tracking-[0.18em] text-white">MISSILE DEFENSE SIMULATOR</div>
          <div className="hidden text-[10px] tracking-widest text-ops-dim sm:block">GLOBAL INTEGRATED DEFENSE · v0.1</div>
        </div>
      </div>
      <div className="hidden min-w-0 leading-tight xl:block">
        <div className="label">Campaign</div>
        <div className="max-w-[220px] truncate text-white">{s.settings.name}</div>
      </div>
      <div className="leading-tight">
        <div className="label">Sim time</div>
        <SimClock s={s} />
      </div>
      <div className="hidden leading-tight md:block">
        <div className="label">Phase {phase.id}/{s.phases.length}</div>
        <div className="text-white">{phase.name} <span className="text-ops-dim">{Math.min(phaseHour, phase.hours)}/{phase.hours}h</span></div>
        <PhaseProgress s={s} />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Simulation controls">
        <button data-coach="pause" className={`btn w-20 ${running && !s.paused && !s.turnBased ? '' : 'btn-primary'}`} disabled={!running || s.turnBased}
          onClick={() => dispatch({ type: 'setPaused', paused: !s.paused })} title="Pause / resume (Space)">
          {s.paused || s.turnBased ? '▶ Resume' : '❚❚ Pause'}
        </button>
        {([1, 2, 4, 8] as const).map((sp, i) => (
          <button key={sp} data-coach="speed" className={`btn px-2 ${s.speed === sp ? 'btn-active' : ''}`} onClick={() => chooseSpeed(s, sp)} title={`Speed ${sp}x (${i + 1})`} disabled={s.turnBased}>{sp}x</button>
        ))}
        <button data-coach="turn" role="switch" aria-checked={s.turnBased} className={`btn ${s.turnBased ? 'btn-active' : ''}`} onClick={() => dispatch({ type: 'setTurnBased', on: !s.turnBased })}
          title={s.turnBased ? 'Turn mode is on: the clock only moves when you advance a turn. Click to switch back to real time.' : 'Turn mode: stop the clock and advance it 6 hours at a time when you are ready.'}>
          Turn mode{s.turnBased ? ': on' : ''}
        </button>
        {store.viewHold && s.paused && <span className="max-w-[9rem] text-[10px] leading-tight text-ops-amber" title="The clock stops while you plan and restarts when you go back to an operations view. Press Resume to keep it running here.">Clock held while you plan</span>}
        {s.turnBased && (
          <button data-coach="advance" className="btn btn-primary" disabled={!running} onClick={() => dispatch({ type: 'advance', hours: SIM_CONFIG.turnHours })} title="Advance one turn: 6 hours (T)">Next turn +{SIM_CONFIG.turnHours}h ⏭</button>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-4">
        {/* Phones: the essentials only (time controls, credits, alert); the rest is on the Global Operations screen. */}
        <span className="hidden sm:contents">
          <TopMetric label="Readiness" v={m.globalReadiness} />
          <TopMetric label="Network" v={m.network} />
        </span>
        <div className="leading-tight">
          <div className="label">Credits</div>
          <div className={`whitespace-nowrap tabular-nums ${s.credits < 150 ? 'text-ops-red' : 'text-white'}`}>
            {Math.round(s.credits)}
            {reserveDrain(s) >= 1 && (
              <span className="ml-1 text-[10px] text-ops-amber" title={`Unspent: credits above ${SIM_CONFIG.reserve.threshold} are reclaimed at ${SIM_CONFIG.reserve.ratePerHour * 100}% an hour. Spend them on defenses, maintenance or investments.`}>
                unspent −{Math.round(reserveDrain(s))}/h
              </span>
            )}
          </div>
        </div>
        <div className="leading-tight">
          <div className="label">Alert</div>
          <Chip t={ALERT_TONE[m.alert]}><span className={m.alert === 'SEVERE' ? 'blink' : ''}>{m.alert}</span></Chip>
        </div>
        <span className="hidden sm:contents"><ServerStatusChip /></span>
        <DisplayControl />
        <SoundControl />
        <button className="btn" onClick={() => ui.setHelp(true)} title="Help & shortcuts (?)">?</button>
        <button className="btn hidden sm:inline-flex" onClick={() => ui.setTutorial(!ui.tutorial)} title="Training guide">Guide</button>
      </div>
    </header>
  );
}

function TopMetric({ label, v }: { label: string; v: number }) {
  return (
    <div className="w-20 leading-tight">
      <div className="label flex justify-between"><span>{label}</span><span className={TONE_TEXT[tone(v)]}>{Math.round(v)}%</span></div>
      <Bar value={v} height={4} />
    </div>
  );
}

export const NAV: { id: ViewId; label: string; icon: string; key: string; group?: string }[] = [
  { id: 'global', label: 'Global Operations', icon: '◎', key: 'G', group: 'Command' },
  { id: 'theater', label: 'Tactical Theater', icon: '◇', key: 'X' },
  { id: 'space', label: 'Space Command', icon: '⊟', key: 'S', group: 'Domains' },
  { id: 'air', label: 'Air Command', icon: '▲', key: 'A' },
  { id: 'sea', label: 'Maritime Command', icon: '⏢', key: 'M' },
  { id: 'ground', label: 'Ground Command', icon: '■', key: 'D' },
  { id: 'intel', label: 'Intelligence', icon: '◈', key: 'I', group: 'Staff' },
  { id: 'comms', label: 'Communications', icon: '⌁', key: 'C' },
  { id: 'logistics', label: 'Logistics', icon: '⛭', key: 'L' },
  { id: 'infra', label: 'Infrastructure', icon: '▦', key: 'F' },
  { id: 'campaign', label: 'Campaign Management', icon: '⚑', key: 'P', group: 'Scenario' },
  { id: 'editor', label: 'Scenario Editor', icon: '✎', key: 'E' },
  { id: 'aar', label: 'After-Action Review', icon: '▤', key: 'R' },
];

/** Assets in a domain due for service within 12h (or overdue) and not already in maintenance. */
export const dueCount = (s: SimState, d: Domain) =>
  s.assets.filter((a) => a.domain === d && a.role !== 'defense' && a.hoursToService < 12 && a.status !== 'maintenance' && a.status !== 'transit').length;

/** The current phase's objectives with live progress, so a miss is never a surprise. */
function ObjectivesSection({ s }: { s: SimState }) {
  const phase = s.phases[s.phaseIndex];
  if (!phase?.objectives.length || s.status === 'complete') return null;
  const left = s.status === 'running' ? phase.hours - (s.hour - s.phaseStartHour) : phase.hours;
  return (
    <Section title="Objectives" count={phase.objectives.filter((o) => objectiveProgress(s, o) !== 'done').length}>
      <ul className="space-y-1.5 text-[11px]">
        {phase.objectives.map((o) => {
          const v = objectiveValue(s, o.metric);
          const st = objectiveProgress(s, o);
          const pct = o.metric === 'escalationsMax' ? (v > o.target ? 100 : 100 - (v / Math.max(1, o.target)) * 100) : Math.min(100, (v / Math.max(1, o.target)) * 100);
          const look = OBJECTIVE_LOOK[st];
          return (
            <li key={o.id} title={look.title}>
              <div className="flex justify-between gap-2">
                <span className={look.cls}>{look.icon} {o.text}</span>
                <span className="shrink-0 tabular-nums text-ops-dim">{formatObjective(o.metric, v)}/{formatObjective(o.metric, o.target)}</span>
              </div>
              <Bar value={pct} height={3} color={look.bar} />
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-[10px] text-ops-dim">{left}h left in this phase. ◐ on track = measured when the phase ends.</div>
    </Section>
  );
}

export function LeftNav({ s }: { s: SimState }) {
  const ui = useUI();
  const domainStat = (id: ViewId) => (DOMAINS as string[]).includes(id) ? s.metrics.domainEffective[id as keyof typeof s.metrics.domainEffective] : null;
  const activeCount = s.events.filter((e) => isActive(e) && isKnown(s, e)).length;
  const inbound = incomingWaves(s).length;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-ops-line bg-ops-panel/70 p-1.5 lg:w-56 lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:border-b-0 lg:border-r lg:p-2" aria-label="Main navigation">
      {NAV.filter((n) => n.id !== 'theater' || s.tactical?.enabled).map((n) => {
        const v = domainStat(n.id);
        const act = ui.view === n.id;
        return (
          <div key={n.id} className="contents">
            {n.group && <div className="label mt-2 hidden px-2 pb-1 lg:block">{n.group}</div>}
            <button data-coach={`nav-${n.id}`} onClick={() => ui.setView(n.id)} aria-current={act ? 'page' : undefined}
              className={`group flex shrink-0 items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] uppercase tracking-wider transition-colors ${act ? 'border-ops-cyan/50 bg-ops-cyan/10 text-white' : 'border-transparent text-ops-text/80 hover:border-ops-line hover:bg-ops-panel2 hover:text-white'}`}>
              <span className="w-4 text-center text-ops-cyan" style={v !== null ? { color: DOMAIN_COLOR[n.id as keyof typeof DOMAIN_COLOR] } : undefined}>{n.icon}</span>
              <span className="flex-1 whitespace-nowrap">{n.label}</span>
              {v !== null && <span className={`hidden tabular-nums lg:inline ${TONE_TEXT[tone(v)]}`}>{Math.round(v)}</span>}
              {v !== null && dueCount(s, n.id as Domain) > 0 && (
                <span className="rounded bg-ops-amber/20 px-1 text-ops-amber" title={`${dueCount(s, n.id as Domain)} asset(s) due or overdue for maintenance`}>⛭{dueCount(s, n.id as Domain)}</span>
              )}
              {n.id === 'intel' && activeCount > 0 && <span className="hidden rounded bg-ops-red/20 px-1 text-ops-red lg:inline">{activeCount}</span>}
              {n.id === 'theater' && inbound > 0 && <span className="blink rounded bg-ops-red/20 px-1 text-ops-red">{inbound}</span>}
              <kbd className="hidden text-[9px] text-ops-dim opacity-0 group-hover:opacity-100 lg:inline">{n.key}</kbd>
            </button>
          </div>
        );
      })}
      <div className="mt-auto hidden space-y-1 border-t border-ops-line px-1 pt-2 text-[10px] text-ops-dim lg:block">
        <div className="flex justify-between"><span>Personnel</span><span className="text-white">{Math.round(s.personnel)}/{s.personnelMax}</span></div>
        <div className="flex justify-between"><span>Crews free</span><span className="text-white">{s.crews - s.crewsBusy}/{s.crews}</span></div>
        <div className="flex justify-between"><span>Resilience</span><span className="text-white">{Math.round(s.resilience)}</span></div>
        <div className="flex justify-between"><span>Mode</span><span className="uppercase text-white">{s.settings.mode}</span></div>
      </div>
    </nav>
  );
}

function Section({ title, count, children, defaultOpen = true, coach }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; coach?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-ops-line" data-coach={coach}>
      <button className="flex w-full items-center justify-between px-3 py-2 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-ops-cyan hover:bg-ops-panel2" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}{count !== undefined && <span className="ml-1.5 text-ops-dim">({count})</span>}</span><span className="text-ops-dim">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function RightSidebar({ s }: { s: SimState }) {
  const ui = useUI();
  const active = s.events
    .filter((e) => isActive(e) && isKnown(s, e))
    .sort((a, b) => b.severity - a.severity || a.deadline - b.deadline);
  const intel = s.log.filter((l) => l.level === 'intel').slice(-6).reverse();
  const warnings = s.assets.filter((a) => a.status === 'offline' || a.hoursToService < 0);
  const regionAlerts = Object.values(s.regions).filter((r) => r.stability < 55 || r.comms < 50 || r.awareness < 45);
  return (
    <aside className="flex flex-col overflow-y-auto border-t border-ops-line bg-ops-panel/70 lg:w-80 lg:border-l lg:border-t-0" aria-label="Situation sidebar">
      <AdjutantSection s={s} />
      <ObjectivesSection s={s} />
      <Section title="Active Events" count={active.length} coach="events">
        {active.length === 0 && <div className="text-ops-dim">No active events. Network nominal.</div>}
        <ul className="space-y-1.5">
          {active.map((e) => {
            const c = confidenceLabel(e.confidence);
            const left = e.deadline - s.hour;
            return (
              <li key={e.id}>
                <button onClick={() => ui.openEvent(e.id)} className="w-full rounded border border-ops-line bg-ops-bg/50 p-2 text-left transition-colors hover:border-ops-cyan/50">
                  <div className="flex items-center gap-1.5">
                    <Chip t={SEV_TONE[e.severity]}>{e.conflicting ? `S${e.reportedSeverity[0]}–${e.reportedSeverity[1]}` : `S${e.severity}`}</Chip>
                    <span className="truncate font-semibold text-white">{e.title}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-ops-dim">
                    <span>{e.id} · {e.global ? 'GLOBAL' : s.regions[e.region].short}</span>
                    <span className={TONE_TEXT[c.tone]}>{c.label} {Math.round(e.confidence)}%</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span className={e.status === 'responding' ? 'text-ops-cyan' : e.status === 'confirming' ? 'text-ops-violet' : 'text-ops-amber'}>
                      {e.status === 'responding' ? `RESPONDING ${Math.round(e.progress)}%` : e.status === 'confirming' ? `CONFIRMING ${Math.round(e.confirmProgress)}%` : 'AWAITING DECISION'}
                    </span>
                    {e.status !== 'responding' && <span className={left <= 4 ? 'blink text-ops-red' : 'text-ops-dim'}>{left}h left</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Domain Performance">
        <div className="space-y-1.5">
          {DOMAINS.map((d) => (
            <div key={d}>
              <div className="flex justify-between text-[10px]"><span style={{ color: DOMAIN_COLOR[d] }}>{DOMAIN_LABEL[d].toUpperCase()}</span>
                <span className="text-ops-dim">raw {Math.round(s.metrics.domainRaw[d])} → <span className={TONE_TEXT[tone(s.metrics.domainEffective[d])]}>{Math.round(s.metrics.domainEffective[d])}</span></span></div>
              <Bar value={s.metrics.domainEffective[d]} height={4} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Regional Alerts" count={regionAlerts.length}>
        {regionAlerts.length === 0 && <div className="text-ops-dim">All regions within tolerances.</div>}
        {regionAlerts.map((r) => (
          <button key={r.id} onClick={() => { ui.setView('global'); ui.setRegion(r.id); }} className="mb-1 flex w-full justify-between rounded px-1 py-0.5 text-left hover:bg-ops-panel2">
            <span className="text-white">{r.name}</span>
            <span className="text-[10px]">
              {r.stability < 55 && <span className="ml-1 text-ops-amber">STAB {Math.round(r.stability)}</span>}
              {r.comms < 50 && <span className="ml-1 text-ops-red">COMMS {Math.round(r.comms)}</span>}
              {r.awareness < 45 && <span className="ml-1 text-ops-amber">AWR {Math.round(r.awareness)}</span>}
            </span>
          </button>
        ))}
      </Section>
      <Section title="System Warnings" count={warnings.length} defaultOpen={warnings.length > 0}>
        {warnings.length === 0 && <div className="text-ops-dim">No system warnings.</div>}
        {warnings.slice(0, 10).map((a) => (
          <button key={a.id} onClick={() => ui.openAsset(a.id)} className="mb-1 flex w-full justify-between rounded px-1 py-0.5 text-left hover:bg-ops-panel2">
            <span className="truncate text-white">{a.name}</span>
            <span className={`text-[10px] ${a.status === 'offline' ? 'text-ops-red' : 'text-ops-amber'}`}>{a.status === 'offline' ? 'OFFLINE' : `SERVICE OVERDUE ${-a.hoursToService}h`}</span>
          </button>
        ))}
      </Section>
      <Section title="Intelligence Reports" count={intel.length} defaultOpen={false}>
        {intel.length === 0 && <div className="text-ops-dim">No intelligence traffic.</div>}
        {intel.map((l, i) => (
          <button key={i} className="mb-1 block w-full text-left text-[11px] hover:text-white" onClick={() => l.eventId && ui.openEvent(l.eventId)}>
            <span className="text-ops-dim">T+{l.t}h</span> <span className="text-ops-violet">{l.text}</span>
          </button>
        ))}
      </Section>
      <Section title="Command Notifications" defaultOpen={false}>
        {s.log.filter((l) => l.level === 'success').slice(-6).reverse().map((l, i) => (
          <div key={i} className="mb-1 text-[11px]"><span className="text-ops-dim">T+{l.t}h</span> <span className="text-ops-green">{l.text}</span></div>
        ))}
      </Section>
    </aside>
  );
}

const LEVEL_COLOR: Record<LogLevel, string> = { info: 'text-ops-text', warn: 'text-ops-amber', crit: 'text-ops-red', success: 'text-ops-green', intel: 'text-ops-violet' };
type BottomTab = 'timeline' | 'commands' | 'log' | 'progress';

export function BottomPanel({ s }: { s: SimState }) {
  const ui = useUI();
  const [tab, setTab] = useState<BottomTab>('timeline');
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  if (!ui.bottomOpen) {
    return (
      <div className="flex items-center justify-between border-t border-ops-line bg-ops-panel/80 px-3 py-1">
        <span className="truncate text-[11px] text-ops-dim">{s.log.at(-1) ? `T+${s.log.at(-1)!.t}h ${s.log.at(-1)!.text}` : 'Awaiting traffic.'}</span>
        <button className="btn" onClick={() => ui.setBottomOpen(true)}>▴ Timeline & Logs</button>
      </div>
    );
  }
  return (
    <div className="flex h-[min(13rem,28vh)] min-h-[8rem] flex-col border-t border-ops-line bg-ops-panel/80">
      <div className="flex items-center gap-2 border-b border-ops-line px-2 py-1">
        <Tabs<BottomTab> value={tab} onChange={setTab} tabs={[
          { id: 'timeline', label: 'Event Timeline' }, { id: 'commands', label: 'Command History' },
          { id: 'log', label: 'Simulation Log' }, { id: 'progress', label: 'Scenario Progression' },
        ]} />
        {tab === 'log' && (
          <select className="input py-0.5 text-[11px]" value={filter} onChange={(e) => setFilter(e.target.value as LogLevel | 'all')} aria-label="Filter log">
            <option value="all">All</option><option value="crit">Critical</option><option value="warn">Warnings</option>
            <option value="intel">Intelligence</option><option value="success">Success</option><option value="info">Info</option>
          </select>
        )}
        <div className="ml-auto flex gap-1">
          <button className="btn" onClick={() => ui.setView('aar')}>▤ AAR</button>
          <button className="btn" onClick={() => ui.setBottomOpen(false)} aria-label="Collapse panel">▾</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {tab === 'timeline' && <EventTimeline s={s} />}
        {tab === 'commands' && (
          <table className="table-ops w-full">
            <tbody>
              {[...s.commands].reverse().filter((c) => c.category !== 'control').map((c, i) => (
                <tr key={i}><td className="w-16 text-ops-dim">T+{c.t}h</td><td className="w-24 uppercase text-ops-cyan">{c.kind}</td><td>{c.text}</td><td className="w-20 text-right tabular-nums">{c.credits ? `-${c.credits} cr` : ''}</td></tr>
              ))}
              {s.commands.filter((c) => c.category !== 'control').length === 0 && <tr><td className="text-ops-dim">No commands issued yet.</td></tr>}
            </tbody>
          </table>
        )}
        {tab === 'log' && (
          <ul className="space-y-0.5">
            {[...s.log].reverse().filter((l) => filter === 'all' || l.level === filter).slice(0, 200).map((l, i) => (
              <li key={i} className={`cursor-default ${LEVEL_COLOR[l.level]} ${l.eventId ? 'cursor-pointer hover:underline' : ''}`} onClick={() => l.eventId && ui.openEvent(l.eventId)}>
                <span className="mr-2 text-ops-dim">T+{l.t}h</span>{l.text}
              </li>
            ))}
          </ul>
        )}
        {tab === 'progress' && <Progression s={s} />}
      </div>
    </div>
  );
}

/** Whole-hour grid lines on a fixed step, so they slide with the window instead of being re-spaced every hour. */
function gridHours(start: number, end: number): number[] {
  const step = [6, 12, 24].find((x) => (end - start) / x <= 9) ?? 24;
  const out: number[] = [];
  for (let h = Math.ceil(start / step) * step; h <= end; h += step) out.push(h);
  return out;
}

function EventTimeline({ s }: { s: SimState }) {
  const ui = useUI();
  const now = useSimTime(); // continuous, so the window, the now-line and open bars flow instead of stepping
  const span = Math.max(48, now + 6);
  const start = Math.max(0, now - 96);
  const evs = s.events.filter((e) => isKnown(s, e) && (e.resolvedAt ?? s.hour) >= start).slice(-40);
  const x = (h: number) => `${((h - start) / (span - start)) * 100}%`;
  const color = (e: (typeof evs)[number]) =>
    e.status === 'resolved' ? '#34d399' : e.status === 'escalated' ? '#f2545b' : e.status === 'expired' || e.status === 'dismissed' ? '#7088a8' : e.status === 'responding' ? '#38d6f5' : '#f5b13d';
  if (!evs.length) return <div className="text-ops-dim">No events yet. The timeline fills as reports arrive.</div>;
  return (
    <div className="relative min-w-[600px]" style={{ height: evs.length * 14 + 18 }}>
      {gridHours(start, span).map((h) => (
        <div key={h} className="absolute top-0 h-full border-l border-ops-line/60 text-[9px] text-ops-dim" style={{ left: x(h) }}><span className="ml-0.5">T+{h}</span></div>
      ))}
      <div className="absolute top-0 h-full border-l border-ops-cyan" style={{ left: x(now) }} />
      {evs.map((e, i) => {
        const end = e.resolvedAt ?? Math.max(now, e.reportedAt + 1);
        return (
          <button key={e.id} onClick={() => ui.openEvent(e.id)} title={`${e.id} ${e.title} — ${e.status}`}
            className="absolute flex h-[11px] items-center overflow-hidden whitespace-nowrap rounded-sm px-1 text-[9px] text-black hover:brightness-125"
            style={{ top: 14 + i * 14, left: x(Math.max(start, e.reportedAt)), width: `max(4px, calc(${x(end)} - ${x(Math.max(start, e.reportedAt))}))`, background: color(e) }}>
            {e.id} {e.title}
          </button>
        );
      })}
    </div>
  );
}

function Progression({ s }: { s: SimState }) {
  let acc = 0;
  const total = s.phases.reduce((a, p) => a + p.hours, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-6 overflow-hidden rounded border border-ops-line">
        {s.phases.map((p, i) => {
          const startH = acc;
          acc += p.hours;
          const done = i < s.phaseIndex || s.status === 'complete';
          const cur = i === s.phaseIndex && s.status !== 'complete';
          const prog = cur ? Math.min(1, (s.hour - s.phaseStartHour) / p.hours) : done ? 1 : 0;
          return (
            <div key={p.id} className="relative border-r border-ops-line last:border-r-0" style={{ width: `${(p.hours / total) * 100}%` }} title={`${p.name} (T+${startH}–${acc}h)`}>
              <div className="absolute inset-y-0 left-0 bg-ops-cyan/25" style={{ width: `${prog * 100}%` }} />
              <div className={`relative truncate px-2 py-1 text-[10px] ${cur ? 'text-white' : 'text-ops-dim'}`}>P{p.id} {p.name}</div>
            </div>
          );
        })}
      </div>
      <div className="grid gap-1 md:grid-cols-2">
        {s.objectiveResults.map((r) => (
          <div key={r.objectiveId} className="text-[11px]"><span className={r.met ? 'text-ops-green' : 'text-ops-red'}>{r.met ? '✔' : '✘'}</span> P{r.phase} {r.text}</div>
        ))}
        {!s.objectiveResults.length && <div className="text-ops-dim">Objective results appear at the end of each phase. Current objectives are on the Campaign Management page.</div>}
      </div>
      <button className="btn" onClick={() => store.toast('info', `Difficulty factor ${s.difficulty.toFixed(2)} — adapts to your performance every 12h.`)}>Director status</button>
    </div>
  );
}
