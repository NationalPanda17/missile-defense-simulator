// Contextual windows: event investigation, asset inspection, briefings, start screen, help, tutorial, toasts.
import { Suspense, lazy, useRef, useState } from 'react';
import {
  COMMAND_LEVELS, COMMAND_LEVEL_IDS, LESSONS, advise, previewDefense, REGION_IDS, SIM_CONFIG, withLevel, type CommandLevel, TACTICAL_CONFIG, TEMPLATE_MAP, confidenceLabel, crewsFree, defaultSettings, deleteSave, importJSON, isActive, listSaves, loadGame,
  maintenanceCost, responseSuccessChance, SEVERITY_LABEL, canAfford, type EffectSpec, type Objective, type RegionId, type SimState, type Slot,
} from '../engine';
import { dispatch, store, useStoreVersion } from '../store/simStore';
import { Bar, Chip, ConfirmDelete, DOMAIN_COLOR, DOMAIN_LABEL, Modal, SEV_TONE, Sparkline, TONE_TEXT, statusColor, tone } from './components/ui';
import { useUI, type ViewId } from './uiState';
import { ServerSavesPanel, ServiceRecord } from './views/ServerPanels';
import { loadProgress, startLesson } from './training/progress';
import { SoundControl } from './audio/SoundControl';
import { AdviceList, useAdvice } from './Adjutant';
import { DisplayControl, DisplaySettings } from './a11y/DisplayControl';
import { CampaignScenarioPicker, loadChosenScenario, saveChosenScenario, type ChosenScenario } from './views/TacticalScenarioBuilder';

function effectText(f: EffectSpec): string {
  const v = Math.abs(f.value).toFixed(f.value % 1 ? 1 : 0);
  switch (f.kind) {
    case 'assetDecay': return `Affected asset condition −${v}/h`;
    case 'stabilityDrift': return `Regional stability −${v}/h`;
    case 'infraDrift': return `Infrastructure −${v}/h`;
    case 'personnelDrift': return `Personnel −${v}/h`;
    case 'creditsDrain': return `Credits −${v}/h`;
    case 'commsPenalty': return `Regional comms −${v}`;
    case 'awarenessPenalty': return `Regional awareness −${v}`;
    case 'domainPenalty': return `${DOMAIN_LABEL[f.domain!]} availability in region −${v}%`;
    case 'globalCommsPenalty': return `Global network health −${v}`;
    case 'maintenanceCostMult': return `Maintenance costs ×${f.value}`;
  }
}

export function EventModal({ s }: { s: SimState }) {
  const ui = useUI();
  const e = s.events.find((x) => x.id === ui.eventId);
  if (!e) return null;
  const t = TEMPLATE_MAP.get(e.templateId)!;
  const c = confidenceLabel(e.confidence);
  const active = isActive(e);
  const r = s.regions[e.region];
  const known = e.reportedAt <= s.hour;
  const parent = e.parentId ? s.events.find((x) => x.id === e.parentId) : undefined;
  const children = s.events.filter((x) => x.parentId === e.id);
  const asset = e.assetId ? s.assets.find((a) => a.id === e.assetId) : undefined;
  const left = e.deadline - s.hour;
  return (
    <Modal wide title={<span className="flex items-center gap-2">EVENT INVESTIGATION · {e.id}</span>} onClose={() => ui.openEvent(null)}>
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip t={SEV_TONE[e.severity]}>{e.conflicting ? `Severity ${SEVERITY_LABEL[e.reportedSeverity[0]]}–${SEVERITY_LABEL[e.reportedSeverity[1]]}` : SEVERITY_LABEL[e.severity]}</Chip>
              <Chip t={c.tone}>{c.label}</Chip>
              <Chip>{e.category}</Chip>
              {e.global && <Chip t="red">Global</Chip>}
              <Chip t={active ? 'amber' : e.status === 'resolved' ? 'green' : e.status === 'escalated' ? 'red' : 'dim'}>{e.status}</Chip>
            </div>
            <h2 className="mt-2 font-sans text-2xl font-semibold text-white">{e.title}</h2>
            <div className="text-ops-dim">{e.global ? 'All regions' : r.name} · Domains: {e.domains.map((d) => <span key={d} style={{ color: DOMAIN_COLOR[d] }} className="mr-1">{DOMAIN_LABEL[d]}</span>)}{asset && <> · Asset: <button className="text-ops-cyan hover:underline" onClick={() => ui.openAsset(asset.id)}>{asset.name}</button></>}</div>
          </div>
          <p className="leading-relaxed text-ops-text">{known ? e.narrative : 'Report not yet received by command.'}</p>

          <div className="rounded border border-ops-line p-3">
            <div className="label mb-2">Information quality</div>
            <div className="flex items-center gap-3">
              <div className="flex-1"><Bar value={e.confidence} /></div>
              <span className={`tabular-nums ${TONE_TEXT[c.tone]}`}>{Math.round(e.confidence)}%</span>
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-ops-dim">
              <li>Occurred T+{e.occurredAt}h · reported T+{e.reportedAt}h{e.reportedAt > e.occurredAt && <span className="text-ops-amber"> (delayed {e.reportedAt - e.occurredAt}h by poor regional comms)</span>}</li>
              <li>Regional awareness {Math.round(r.awareness)} · comms {Math.round(r.comms)} — {r.awareness > 70 ? 'strong corroborating coverage' : r.awareness > 45 ? 'partial coverage' : 'thin coverage; reports are less reliable here'}</li>
              {e.conflicting && <li className="text-ops-amber">Sources disagree on severity. Independent confirmation will resolve the conflict.</li>}
              {e.status === 'confirming' && <li className="text-ops-violet">Independent confirmation in progress: {Math.round(e.confirmProgress)}%</li>}
            </ul>
          </div>

          {e.effects.length > 0 && (
            <div className="rounded border border-ops-line p-3">
              <div className="label mb-1">Reported impact while active{!e.isGenuine && !active ? ' (did not materialize)' : ''}</div>
              <ul className="list-inside list-disc text-[11px]">{e.effects.map((f, i) => <li key={i}>{effectText(f)}</li>)}</ul>
              <div className="mt-2 text-[11px] text-ops-dim">If unresolved: {t.escalation.text}{t.escalation.spawns.length > 0 && ' May trigger follow-on events.'}</div>
            </div>
          )}

          {(parent || children.length > 0) && (
            <div className="rounded border border-ops-line p-3 text-[11px]">
              <div className="label mb-1">Event chain</div>
              {parent && <div>Caused by <button className="text-ops-cyan hover:underline" onClick={() => ui.openEvent(parent.id)}>{parent.id} {parent.title}</button></div>}
              {children.map((ch) => <div key={ch.id}>Triggered <button className="text-ops-cyan hover:underline" onClick={() => ui.openEvent(ch.id)}>{ch.id} {ch.title}</button> ({ch.status})</div>)}
            </div>
          )}
        </div>

        <div className="space-y-3">
          {active ? (
            <>
              <div className="flex items-center justify-between rounded border border-ops-line p-3">
                <div><div className="label">Decision window</div><div className={`font-sans text-xl font-semibold ${left <= 4 ? 'text-ops-red' : 'text-white'}`}>{e.status === 'responding' ? 'Response underway' : `${left}h remaining`}</div></div>
                {e.status === 'responding' && <div className="w-32"><div className="label mb-1">Progress {Math.round(e.progress)}%</div><Bar value={e.progress} color="#38d6f5" /></div>}
              </div>
              {e.status !== 'responding' && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn" disabled={e.status !== 'reported' || e.confidence >= 92 || s.credits < SIM_CONFIG.confirmCost}
                    data-coach="confirm" onClick={() => dispatch({ type: 'confirm', eventId: e.id })} title="Task an independent source to confirm or refute this report">
                    ◈ Task confirmation ({SIM_CONFIG.confirmCost} cr, ~{SIM_CONFIG.confirmHours}h)
                  </button>
                  <button data-coach="dismiss" className="btn btn-danger" onClick={() => { dispatch({ type: 'dismiss', eventId: e.id }); }} title="Close as unreliable. If it is genuine, it will keep developing unseen.">✕ Dismiss as unreliable</button>
                </div>
              )}
              <div className="label">Management responses</div>
              <div className="space-y-2">
                {t.responses.map((resp) => {
                  const p = responseSuccessChance(s, e, resp.id);
                  const err = resp.passive ? (e.monitored ? 'Already used' : null) : canAfford(s, resp.credits, resp.personnel, resp.crews);
                  const busy = e.status === 'responding';
                  return (
                    <div key={resp.id} className={`rounded border p-2.5 ${e.responseId === resp.id ? 'border-ops-cyan' : 'border-ops-line'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-white">{resp.label}</div>
                          <div className="text-[11px] text-ops-dim">{resp.description}</div>
                        </div>
                        <button data-coach={resp.passive ? 'monitor' : 'respond'} className={`btn shrink-0 ${resp.passive ? '' : 'btn-primary'}`} disabled={busy || !!err} title={err ?? undefined}
                          onClick={() => dispatch({ type: 'respond', eventId: e.id, responseId: resp.id })}>{resp.passive ? 'Monitor' : 'Execute'}</button>
                      </div>
                      {!resp.passive && (
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-ops-dim">
                          <span className={s.credits < resp.credits ? 'text-ops-red' : ''}>{resp.credits} cr</span>
                          <span className={s.personnel < resp.personnel ? 'text-ops-red' : ''}>{resp.personnel} personnel</span>
                          {resp.crews > 0 && <span className={crewsFree(s) < resp.crews ? 'text-ops-red' : ''}>{resp.crews} crew</span>}
                          <span>{resp.hours}h</span>
                          <span className={TONE_TEXT[tone(p * 100)]}>{Math.round(p * 100)}% success</span>
                          {resp.domainDependency && <span>depends on {DOMAIN_LABEL[resp.domainDependency]}</span>}
                          {resp.networkDependent && <span>depends on regional comms</span>}
                        </div>
                      )}
                      {err && !busy && <div className="mt-1 text-[10px] text-ops-red">{err}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="rounded border border-ops-line p-3">
              <div className="label mb-1">Outcome</div>
              <div className="text-white">{e.outcome ?? e.status}</div>
              {e.resolvedAt !== undefined && <div className="mt-1 text-[11px] text-ops-dim">Closed T+{e.resolvedAt}h · {e.spent} credits expended</div>}
              {(e.status === 'resolved' || e.status === 'escalated' || e.status === 'expired' || (e.status === 'dismissed' && !e.hiddenLive)) && (
                <div className="mt-1 text-[11px]">Ground truth: {e.isGenuine ? <span className="text-ops-amber">genuine event</span> : <span className="text-ops-green">spurious report</span>}</div>
              )}
            </div>
          )}
          <div className="rounded border border-ops-line p-3">
            <div className="label mb-1">Event log</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
              {e.log.map((l, i) => <li key={i}><span className="text-ops-dim">T+{l.t}h</span> {l.text}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function AssetModal({ s }: { s: SimState }) {
  const ui = useUI();
  const [dest, setDest] = useState<RegionId | ''>('');
  const a = s.assets.find((x) => x.id === ui.assetId);
  if (!a) return null;
  const cost = maintenanceCost(s, a.domain);
  const mobile = a.domain === 'air' || a.domain === 'sea';
  const events = s.events.filter((e) => e.assetId === a.id && isActive(e));
  return (
    <Modal title={`ASSET INSPECTION · ${a.id}`} onClose={() => ui.openAsset(null)}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-sans text-2xl font-semibold text-white">{a.name}</h2>
            <div className="text-ops-dim">{a.className} · <span style={{ color: DOMAIN_COLOR[a.domain] }}>{DOMAIN_LABEL[a.domain]}</span> · role: {a.role}</div>
          </div>
          <Chip t={a.status === 'operational' ? 'green' : a.status === 'degraded' ? 'amber' : a.status === 'offline' ? 'red' : 'dim'}>{a.status}</Chip>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><div className="label">Condition</div><div className="text-lg text-white" style={{ color: statusColor(a, s.hour) }}>{a.condition.toFixed(0)}%</div><Bar value={a.condition} height={4} /></div>
          <div><div className="label">Capability</div><div className="text-lg text-white">{a.capability}{s.modernization ? <span className="text-xs text-ops-green"> +{s.modernization}%</span> : null}</div></div>
          <div><div className="label">Service</div><div className={`text-lg ${a.hoursToService < 0 ? 'text-ops-red' : 'text-white'}`}>{a.status === 'maintenance' ? `${a.maintenanceRemaining}h left` : a.hoursToService < 0 ? `${-a.hoursToService}h overdue` : `${a.hoursToService}h`}</div></div>
          <div><div className="label">Upkeep</div><div className="text-lg text-white">{a.upkeep.toFixed(2)}<span className="text-xs text-ops-dim"> cr/h</span></div></div>
        </div>
        <div>
          <div className="label mb-1">Assignment</div>
          <div>{a.status === 'transit' ? `In transit to ${s.regions[a.transitTo!].name} (${a.maintenanceRemaining}h)` : s.regions[a.region].name}{a.domain === 'space' && <span className="text-ops-dim"> · coverage: {a.coverage.map((c) => s.regions[c].short).join(', ')}</span>}</div>
        </div>
        <div>
          <div className="label mb-1">Condition history (6h samples)</div>
          <Sparkline data={a.history} w={420} h={40} color={DOMAIN_COLOR[a.domain]} />
        </div>
        {events.length > 0 && (
          <div><div className="label mb-1">Linked events</div>{events.map((e) => <button key={e.id} className="mr-2 text-ops-amber hover:underline" onClick={() => { ui.openAsset(null); ui.openEvent(e.id); }}>{e.id} {e.title}</button>)}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-ops-line pt-3">
          {a.status === 'maintenance' ? (
            <button className="btn" onClick={() => dispatch({ type: 'cancelMaintenance', assetId: a.id })}>Cancel maintenance</button>
          ) : (
            <button data-coach="maintain" className="btn btn-primary" disabled={a.status === 'transit'} onClick={() => dispatch({ type: 'maintain', assetId: a.id })}>
              ⛭ Schedule maintenance ({cost} cr, {SIM_CONFIG.maintenanceHours[a.domain]}h, 1 crew)
            </button>
          )}
          {mobile && (
            <span className="flex items-center gap-1" data-coach="redeploy">
              <select className="input py-1" value={dest} onChange={(e) => setDest(e.target.value as RegionId)} aria-label="Redeploy destination">
                <option value="">Redeploy to…</option>
                {REGION_IDS.filter((r) => r !== a.region).map((r) => <option key={r} value={r}>{s.regions[r].name}</option>)}
              </select>
              <button className="btn" disabled={!dest || a.status === 'transit' || a.status === 'maintenance'} onClick={() => dest && dispatch({ type: 'redeploy', assetId: a.id, region: dest })}>
                Redeploy ({SIM_CONFIG.redeployCost[a.domain]} cr, {SIM_CONFIG.redeployHours[a.domain]}h)
              </button>
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** How to meet each kind of objective, shown under it in the briefing. */
const OBJECTIVE_HOW: Record<Objective['metric'], string> = {
  readiness: 'keep assets serviced (domain screens → open an asset → Schedule maintenance) and fix events that hurt a domain.',
  network: 'respond quickly to comms events and fund the Network Resilience Program (Communications or Logistics).',
  stability: 'resolve events before they escalate and stop threat waves reaching sites; unrest and damage lower stability.',
  infrastructure: 'defend sites from threat waves, and fund Harden or Recovery projects in Infrastructure.',
  maintenanceDone: 'on a domain screen (Space, Air, Sea or Ground) open an asset and press Schedule maintenance. Each finished cycle counts; it needs a free crew.',
  confirmations: 'open a low-confidence report and press Task confirmation. It counts when the result comes back.',
  escalationsMax: 'act on reports before their timer runs out: respond, or use Monitor Only once to buy time.',
  resolved: 'open a report, pick a response and execute it. It counts when the response succeeds.',
  falseDismissed: 'expose false reports: task a confirmation, or dismiss a report you are sure is false.',
  credits: 'keep this much in hand at the end of the phase; above the reserve level, idle money is reclaimed.',
};

const DeployPanel = lazy(() => import('./views/TacticalDeploy').then((m) => ({ default: m.DeployPanel })));

export function BriefingModal({ s }: { s: SimState }) {
  const phase = s.phases[s.phaseIndex];
  const degraded = s.assets.filter((a) => a.status !== 'operational' || a.hoursToService < 24);
  const activeEv = s.events.filter(isActive);
  const prevResults = s.objectiveResults.filter((r) => r.phase === phase.id - 1);
  const tactical = s.tactical?.enabled ? s.tactical : null;
  const [step, setStep] = useState<'brief' | 'deploy'>('brief');
  const [confirmBegin, setConfirmBegin] = useState(false);
  // Before the phase starts: forecast regions nothing can defend, and money that will otherwise sit idle.
  const beginIssues: string[] = s.settings.mode === 'training' ? [] : [
    ...advise(s).filter((a) => a.id.startsWith('undefended:')).map((a) => a.text),
    ...(s.credits > SIM_CONFIG.reserve.threshold * 1.5 ? [`${Math.round(s.credits)} credits are unspent. Reserves above ${SIM_CONFIG.reserve.threshold} shrink every hour.`] : []),
  ];
  // While the begin check is showing it already lists undefended regions; don't repeat them.
  const advice = useAdvice(s)
    .filter((a) => step === 'brief' || a.id.startsWith('undefended:') || a.id.startsWith('ammo:'))
    .filter((a) => !(confirmBegin && a.id.startsWith('undefended:')));
  return (
    <Modal wide tall={step === 'deploy'} title={`${s.settings.mode === 'training' ? 'TRAINING' : 'CAMPAIGN'} BRIEFING · PHASE ${phase.id} OF ${s.phases.length}`}
      footer={<>
        {tactical && step === 'brief' && <button className="btn px-4 py-2 text-[13px]" onClick={() => setStep('deploy')}>Deploy defenses ▶</button>}
        <button data-coach="begin" className="btn btn-primary px-6 py-2 text-[13px]" autoFocus onClick={() => {
          if (beginIssues.length && !confirmBegin) { setConfirmBegin(true); setStep('brief'); } else dispatch({ type: 'beginPhase' });
        }}>
          {confirmBegin ? 'Begin anyway ▶' : 'Assume command — begin phase ▶'}
        </button>
      </>}>
      {confirmBegin && step === 'brief' && beginIssues.length > 0 && (
        <div className="mb-3 rounded border border-ops-amber/60 bg-ops-amber/10 p-3 text-[12px]" role="alert">
          <div className="label mb-1 text-ops-amber">Before you begin</div>
          <ul className="list-disc space-y-0.5 pl-4 text-white">{beginIssues.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mt-1 text-[11px] text-ops-dim">Equipment can only be placed during a briefing. Once the phase starts, you can still raise alerts, resupply and move systems, but not add new ones.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {tactical && <button className="btn btn-primary" onClick={() => { setConfirmBegin(false); setStep('deploy'); }}>Deploy defenses</button>}
            <button className="btn" onClick={() => setConfirmBegin(false)}>Back to the briefing</button>
          </div>
        </div>
      )}
      {advice.length > 0 && (
        <div className="mb-3">
          <div className="label mb-1">Adjutant</div>
          <AdviceList s={s} items={advice} compact onDeploy={tactical ? () => setStep('deploy') : undefined} />
        </div>
      )}
      {tactical && (
        <div className="mb-4 flex gap-1" role="tablist" aria-label="Briefing steps">
          <button role="tab" aria-selected={step === 'brief'} className={`btn ${step === 'brief' ? 'btn-active' : ''}`} onClick={() => setStep('brief')}>1 · Briefing</button>
          <button data-coach="deploy-tab" role="tab" aria-selected={step === 'deploy'} className={`btn ${step === 'deploy' ? 'btn-active' : ''}`} onClick={() => setStep('deploy')}>
            2 · Deploy defenses <span className="text-ops-dim">{tactical.deployments.length}</span>
          </button>
        </div>
      )}
      {tactical && step === 'deploy' ? <Suspense fallback={<div className="p-6 text-center text-ops-dim">Loading…</div>}><DeployPanel s={s} /></Suspense> : (
      <div className="space-y-4">
        <div>
          <div className="label">{s.settings.name}</div>
          <h2 className="font-sans text-3xl font-bold tracking-wide text-white">{phase.name}</h2>
          <div className="text-ops-dim">Duration {phase.hours}h · starts T+{s.hour}h{phase.grant ? ` · funding release +${phase.grant} credits` : ''}</div>
        </div>
        {prevResults.length > 0 && (
          <div className="rounded border border-ops-line p-3">
            <div className="label mb-1">Previous phase evaluation</div>
            {prevResults.map((r) => <div key={r.objectiveId} className="text-[11px]"><span className={r.met ? 'text-ops-green' : 'text-ops-red'}>{r.met ? '✔ MET' : '✘ MISSED'}</span> {r.text} <span className="text-ops-dim">({Math.round(r.value)})</span></div>)}
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div><div className="label mb-1">Strategic situation</div><p className="leading-relaxed">{phase.situation}</p></div>
            {phase.objectives.length > 0 && <div><div className="label mb-1">Objectives</div>
              <ul className="space-y-1.5">{phase.objectives.map((o) => (
                <li key={o.id}>
                  <div className="flex justify-between gap-2"><span>▸ {o.text}</span>{o.reward > 0 && <span className="shrink-0 text-ops-green">+{o.reward} cr</span>}</div>
                  <div className="pl-3 text-[10px] leading-relaxed text-ops-dim">How: {OBJECTIVE_HOW[o.metric]}</div>
                </li>
              ))}</ul>
            </div>}
            <div><div className="label mb-1">Special conditions</div><div className="flex flex-wrap gap-1">{phase.special.map((x) => <Chip key={x} t="amber">{x}</Chip>)}</div></div>
            <div><div className="label mb-1">Current resources</div>
              <div className="grid grid-cols-4 gap-2 text-white">
                <div><div className="label">Credits</div>{Math.round(s.credits)}</div>
                <div><div className="label">Personnel</div>{Math.round(s.personnel)}</div>
                <div><div className="label">Crews</div>{s.crews}</div>
                <div><div className="label">Resilience</div>{Math.round(s.resilience)}</div>
              </div>
              {s.settings.mode !== 'training' && s.credits > SIM_CONFIG.reserve.threshold && (
                <p className="mt-1 text-[11px] text-ops-amber">
                  Unspent: {Math.round(s.credits - SIM_CONFIG.reserve.threshold)} above the {SIM_CONFIG.reserve.threshold} reserve. Excess reserves are reclaimed at {SIM_CONFIG.reserve.ratePerHour * 100}% an hour once the phase runs, so spend them on defenses, maintenance or investments.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div><div className="label mb-1">Regional conditions</div>
              <table className="table-ops w-full"><thead><tr><th>Region</th><th>Stab</th><th>Infra</th><th>Ready</th><th>Comms</th></tr></thead>
                <tbody>{REGION_IDS.map((id) => { const r = s.regions[id]; return (
                  <tr key={id}><td className="text-white">{r.name}</td>
                    {[r.stability, r.infrastructure, r.readiness, r.comms].map((v, i) => <td key={i} className={`tabular-nums ${TONE_TEXT[tone(v)]}`}>{Math.round(v)}</td>)}</tr>); })}
                </tbody></table>
            </div>
            <div><div className="label mb-1">Known infrastructure problems</div>
              <ul className="max-h-36 space-y-0.5 overflow-y-auto text-[11px]">
                {degraded.slice(0, 10).map((a) => <li key={a.id}><span className="text-white">{a.name}</span> <span className="text-ops-dim">— {a.status !== 'operational' ? a.status : a.hoursToService < 0 ? `service overdue by ${-a.hoursToService}h` : `service due in ${a.hoursToService}h`}, condition {Math.round(a.condition)}%</span></li>)}
                {activeEv.map((e) => <li key={e.id} className="text-ops-amber">{e.id} {e.title} ({s.regions[e.region].short}) still active</li>)}
                {!degraded.length && !activeEv.length && <li className="text-ops-dim">None reported.</li>}
              </ul>
            </div>
            {tactical && (
              <div className="rounded border border-ops-red/40 bg-ops-red/5 p-2 text-[11px]">
                <div className="label mb-1 text-ops-red">Threat forecast</div>
                Incoming attacks expected in {tactical.forecast.map((r) => s.regions[r].name).join(' and ')}.{' '}
                <button className="text-ops-cyan underline" onClick={() => setStep('deploy')}>Deploy defenses</button> before the phase begins.
                <ul className="mt-1 space-y-0.5">
                  {tactical.forecast.map((r) => {
                    const p = previewDefense(s, r, 12);
                    if (!p) return null;
                    const pct = Math.round(p.prevented * 100);
                    return (
                      <li key={r}>
                        ▸ {s.regions[r].name}: simulated with your current layout, about{' '}
                        <b className={pct >= 70 ? 'text-ops-green' : pct >= 40 ? 'text-ops-amber' : 'text-ops-red'}>{pct}%</b> of the expected damage would be prevented
                        {' '}<span className="text-ops-dim">(likely {Math.round(p.range[0] * 100)}–{Math.round(p.range[1] * 100)}%)</span>.
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </Modal>
  );
}

const WELCOME_KEY = 'mds.welcomed';
/** A first visit: no saves, no Academy progress and the welcome not dismissed. */
function isNewcomer(saveCount: number): boolean {
  try {
    if (localStorage.getItem(WELCOME_KEY)) return false;
  } catch { return false; }
  const p = loadProgress();
  return saveCount === 0 && p.done.length === 0 && !p.bestExam;
}
function markWelcomed() {
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ }
}

const LEVEL_KEY = 'mds.level';
function loadLevel(): CommandLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY) as CommandLevel | null;
    return v && COMMAND_LEVEL_IDS.includes(v) ? v : 'officer';
  } catch { return 'officer'; }
}

function LevelPicker({ value, onChange }: { value: CommandLevel; onChange: (l: CommandLevel) => void }) {
  return (
    <div className="mt-3 space-y-1">
      <div className="label" id="level-label">Difficulty</div>
      <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-labelledby="level-label">
        {COMMAND_LEVEL_IDS.map((l) => (
          <button key={l} role="radio" aria-checked={value === l} className={`btn min-w-0 px-0.5 text-[10px] tracking-normal ${value === l ? 'btn-active' : ''}`} onClick={() => onChange(l)}><span className="truncate">{COMMAND_LEVELS[l].label}</span></button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-ops-dim">{COMMAND_LEVELS[value].description}</p>
    </div>
  );
}

function AcademyProgressLine() {
  const p = loadProgress();
  const total = LESSONS.length - 1;
  const done = p.done.filter((id) => id !== 'exam').length;
  if (!done && !p.bestExam) return null;
  return (
    <div className="mt-2 text-[10px] text-ops-dim">
      {done}/{total} lessons done{p.bestExam?.passed ? <span className="text-ops-green"> · CERTIFIED</span> : ''}
    </div>
  );
}

export function StartScreen({ onSandbox }: { onSandbox: () => void }) {
  useStoreVersion();
  const ui = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const saves = listSaves();
  const [scenario, setScenario] = useState<ChosenScenario>(loadChosenScenario);
  const tacticalOn = TACTICAL_CONFIG.enabledInCampaign;
  const [level, setLevelState] = useState<CommandLevel>(loadLevel);
  const setLevel = (l: CommandLevel) => {
    setLevelState(l);
    try { localStorage.setItem(LEVEL_KEY, l); } catch { /* ignore */ }
  };
  const start = (mode: 'campaign' | 'crisis' | 'training') => {
    markWelcomed();
    if (mode !== 'campaign') return store.newGame(defaultSettings(mode));
    if (!tacticalOn) return store.newGame(withLevel(defaultSettings('campaign'), level));
    const base = defaultSettings('campaign');
    const std = scenario.tactical.preset === 'standard';
    store.newGame(withLevel({ ...base, name: std ? base.name : `${base.name} · ${scenario.name}`, tactical: scenario.tactical }, level));
  };
  const newcomer = isNewcomer(saves.length);
  const modes = [
    { id: 'campaign' as const, title: 'Campaign', desc: 'Four-phase global campaign: establish the network, weather regional instability, survive a global crisis and lead the recovery. 240 simulated hours.', cta: 'Begin campaign' },
    { id: 'crisis' as const, title: 'Crisis Mode', desc: 'Start inside a cascading blackout with thin resources, unreliable intelligence and simultaneous disruptions. 96 hours.', cta: 'Enter crisis' },
    { id: 'training' as const, title: 'Training Academy', desc: `${LESSONS.length - 1} guided lessons, from your first click to defending a region under attack, then a graded certification exercise. A coach tells you what to do and checks it off.`, cta: 'Open the Academy' },
  ];
  // New players see the Academy first.
  if (newcomer) modes.unshift(modes.splice(2, 1)[0]);
  return (
    <div className="relative flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-5xl space-y-6">
        <div className="-mb-3 flex justify-end gap-1 sm:absolute sm:right-3 sm:top-3 sm:mb-0"><DisplayControl /><SoundControl /></div>
        <div className="text-center">
          <div className="label tracking-[0.4em]">Global Integrated Defense Command</div>
          <h1 className="mt-2 break-words font-sans text-[clamp(1.25rem,8vw,2.25rem)] font-bold leading-tight tracking-[0.08em] text-white sm:text-5xl sm:tracking-[0.2em]">MISSILE DEFENSE SIMULATOR</h1>
          <p className="mx-auto mt-3 max-w-2xl text-ops-dim">Command a fictional four-domain defense network — Space, Air, Sea and Ground — across seven strategic regions. Manage readiness, communications, uncertain intelligence and scarce resources through a dynamic campaign.</p>
          <p className="mx-auto mt-2 max-w-2xl text-[12px] text-ops-cyan">You build the defense; the simulation fights it. Place systems in each briefing, then during the phase raise alerts, resupply, move systems and handle reports.</p>
        </div>
        {newcomer && (
          <div className="panel flex flex-wrap items-center justify-between gap-3 border-ops-cyan/60 p-4" role="region" aria-label="Welcome">
            <div className="min-w-0 max-w-xl">
              <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">New here?</div>
              <p className="mt-1 text-[12px] leading-relaxed">Start with Lesson 1, Command basics: five minutes, with a coach that shows you each control. The campaign makes much more sense after the first few lessons.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => { markWelcomed(); store.notify(); }}>I know the basics</button>
              <button className="btn btn-primary px-5 py-2" autoFocus onClick={() => { markWelcomed(); startLesson('basics'); ui.setView('global'); }}>Start Lesson 1 ▶</button>
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-4">
          {modes.map((m) => (
            <div key={m.id} className="panel flex flex-col p-4">
              <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">{m.title}</div>
              <p className="mt-2 flex-1 text-[11px] leading-relaxed text-ops-dim">{m.desc}</p>
              {m.id === 'campaign' && <LevelPicker value={level} onChange={setLevel} />}
              {m.id === 'campaign' && tacticalOn && (
                <CampaignScenarioPicker value={scenario} onChange={(c) => { setScenario(c); saveChosenScenario(c); }} />
              )}
              {m.id === 'training' && <AcademyProgressLine />}
              <button className="btn btn-primary mt-3" onClick={() => (m.id === 'training' ? ui.setAcademyOpen(true) : start(m.id))}>{m.cta}</button>
            </div>
          ))}
          <div className="panel flex flex-col p-4">
            <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">Sandbox</div>
            <p className="mt-2 flex-1 text-[11px] leading-relaxed text-ops-dim">Configure starting resources, regional conditions, domain readiness, event frequency and duration in the Scenario Editor.</p>
            <button className="btn btn-primary mt-3" onClick={onSandbox}>Open scenario editor</button>
          </div>
        </div>
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-sans text-sm font-semibold uppercase tracking-widest text-ops-cyan">Browser saves</div>
            <button className="btn" onClick={() => fileRef.current?.click()}>Import save file…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const st = importJSON(await f.text());
              if (st) store.load(st); else store.toast('err', 'Invalid save file.');
            }} />
          </div>
          {saves.length === 0 ? <div className="text-ops-dim">No saved operations in this browser.</div> : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {saves.map((m) => (
                  <div key={m.slot} className="flex items-stretch gap-1">
                    <button className="min-w-0 flex-1 rounded border border-ops-line p-2 text-left hover:border-ops-cyan/50" onClick={() => { const st = loadGame(m.slot as Slot); if (st) store.load(st); }}>
                      <div className="flex justify-between gap-2"><span className="truncate text-white">{m.slot === 'auto' ? 'Autosave' : m.slot.toUpperCase()} · {m.name}</span><span className="shrink-0 text-ops-dim">T+{m.hour}h</span></div>
                      <div className="text-[10px] text-ops-dim">{m.mode} · {m.phase} · {new Date(m.savedAt).toLocaleString()}</div>
                    </button>
                    <ConfirmDelete className="px-2" label={`Delete ${m.slot === 'auto' ? 'the autosave' : m.slot.toUpperCase()}`}
                      onConfirm={() => { deleteSave(m.slot as Slot); store.toast('info', `${m.slot === 'auto' ? 'Autosave' : m.slot.toUpperCase()} deleted.`); store.notify(); }} />
                  </div>
                ))}
              </div>
              {saves.length > 1 && (
                <div className="mt-2 flex justify-end">
                  <ConfirmDelete label="Delete all browser saves" text="Delete all saves" confirmText={`Delete all ${saves.length}?`}
                    onConfirm={() => { for (const m of saves) deleteSave(m.slot as Slot); store.toast('info', 'All browser saves deleted.'); store.notify(); }} />
                </div>
              )}
              <p className="mt-1 text-[10px] text-ops-dim">Deleting can’t be undone. Server saves and exported files are not affected.</p>
            </>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
          <ServerSavesPanel canSave={false} />
          <ServiceRecord limit={6} />
        </div>
        <p className="text-center text-[10px] text-ops-dim">The world, its countries, sites and scenarios are fictional, and no scenario recreates a real attack. The campaign's tactical layer uses real air defense systems with figures from official public statements, or made up where none exist.</p>
      </div>
    </div>
  );
}

export function HelpModal() {
  const ui = useUI();
  const keys: [string, string][] = [
    ['Space', 'Pause / resume'], ['1 – 4', 'Speed 1x / 2x / 4x / 8x'], ['T', 'Advance one turn (6h)'], ['G S A M D', 'Global · Space · Air · Maritime · Ground'], ['X', 'Tactical Theater (campaign)'],
    ['I C L F', 'Intelligence · Comms · Logistics · Infrastructure'], ['P E R', 'Campaign · Scenario editor · After-action review'],
    ['Ctrl/⌘ + S', 'Quick-save to slot 1'], ['B', 'Toggle bottom panel'], ['V', 'Sound on / off'], ['Esc', 'Close window / deselect region'], ['?', 'This help'],
  ];
  return (
    <Modal title="COMMAND REFERENCE" onClose={() => ui.setHelp(false)}>
      <div className="space-y-4">
        <table className="table-ops w-full"><tbody>{keys.map(([k, d]) => <tr key={k}><td className="w-36"><kbd className="rounded border border-ops-line px-1.5 text-ops-cyan">{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
        <div className="rounded border border-ops-line p-3">
          <div className="label mb-2">Display & accessibility</div>
          <DisplaySettings />
        </div>
        <div className="space-y-2 text-[11px] leading-relaxed text-ops-dim">
          <p><b className="text-white">How the network works.</b> Each domain's raw readiness comes from its assets' condition. Effective readiness is then reduced by weaknesses in the domains it depends on (e.g. Air and Maritime depend on Space relays) and by global network health. Regional awareness comes from sensor coverage and comms; it controls how reliable incoming reports are.</p>
          <p><b className="text-white">Events.</b> Each report has a confidence level and a decision window. Some reports are spurious. Task a confirmation when unsure, respond when confident, or dismiss — but dismissed genuine events keep developing out of sight. Unresolved events escalate, causing lasting damage and sometimes follow-on events.</p>
          <p><b className="text-white">Scoring</b> rewards sustained readiness, network reliability, stability, timely response, preserved infrastructure, efficient spending and good information discipline — not raw spending.</p>
        </div>
      </div>
    </Modal>
  );
}

const STEPS: { title: string; view: ViewId; text: string }[] = [
  { title: 'Welcome, Commander', view: 'global', text: 'This is the Global Operations center. The top bar shows simulation time, speed controls, global readiness, network health, credits and alert condition. The left rail switches command views; the right sidebar lists active events and alerts; the bottom panel holds the timeline and logs.' },
  { title: 'Time control', view: 'global', text: 'The simulation runs in real time. Use Pause (Space), speeds 1x–8x (keys 1–4), or switch to Turn mode and advance six hours at a time with +6h (T). Briefings pause the simulation automatically.' },
  { title: 'The global map', view: 'global', text: 'Scroll to zoom, drag to pan, click a region to open its regional dashboard. Use “Layers & Legend” to toggle Space, Air, Sea, Ground, infrastructure, communications links, sensor coverage, events and history, and to change the region overlay metric.' },
  { title: 'Four domains', view: 'space', text: 'Each domain has its own dashboard with asset inventory, readiness, maintenance and history. Domains depend on each other: Space relays support Air and Maritime; Ground control supports Space. Raw → effective readiness shows the dependency penalty.' },
  { title: 'Information quality', view: 'intel', text: 'Reports arrive with a confidence level: UNVERIFIED, POSSIBLE, PROBABLE or CONFIRMED. In this scenario a report from South America is spurious. Open it and Task confirmation to expose it rather than wasting a response.' },
  { title: 'Event response', view: 'global', text: 'Open the Sensor Calibration Drift event in Europe from the Active Events list. Compare responses by cost, duration and success chance, then Execute one. Monitor Only buys time once, but effects keep accumulating.' },
  { title: 'Resource management', view: 'logistics', text: 'Credits come from regional stability; upkeep is continuous. Crews limit simultaneous maintenance and crew-based responses. Schedule maintenance for overdue assets and consider long-term investments — they compound over a campaign.' },
  { title: 'Tactical defense', view: 'theater', text: 'In the campaign, each briefing forecasts the regions where threat waves will strike. Use the briefing’s Deploy defenses step to place real air defense systems on each region’s theater map, then watch waves play out here in the Tactical Theater (X). Keep systems maintained and resupplied: threat protection is 15% of the campaign score.' },
  { title: 'Communications resilience', view: 'comms', text: 'Network health feeds every domain. The Network Resilience Program permanently reduces the impact of communications disruptions. Watch the relay degradation event in Africa and respond before it spreads.' },
  { title: 'After-action review', view: 'aar', text: 'The AAR is available any time and is generated in full at scenario end: score breakdown, domain and regional performance, decisions, expenditures, unresolved issues and lessons learned. Complete the training objectives on the Campaign page to finish.' },
];

export function TutorialPanel() {
  const ui = useUI();
  const [i, setI] = useState(0);
  const st = STEPS[i];
  return (
    <div className="panel fadein fixed bottom-3 left-3 z-40 w-[min(380px,calc(100vw-1.5rem))] border-ops-cyan/40 bg-ops-panel">
      <div className="panel-title"><span>Training · {i + 1}/{STEPS.length}</span><button className="btn px-2" onClick={() => ui.setTutorial(false)} aria-label="Close guide">✕</button></div>
      <div className="space-y-2 p-3">
        <div className="font-sans text-lg font-semibold text-white">{st.title}</div>
        <p className="text-[11px] leading-relaxed">{st.text}</p>
        <div className="flex justify-between gap-2 pt-1">
          <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>◂ Back</button>
          <button className="btn" onClick={() => ui.setView(st.view)}>Show me</button>
          {i < STEPS.length - 1 ? <button className="btn btn-primary" onClick={() => { setI(i + 1); ui.setView(STEPS[i + 1].view); }}>Next ▸</button>
            : <button className="btn btn-primary" onClick={() => ui.setTutorial(false)}>Finish</button>}
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  useStoreVersion();
  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[60] flex w-72 flex-col gap-1.5" aria-live="polite">
      {store.toasts.map((t) => (
        <div key={t.id} className={`fadein rounded border px-3 py-2 text-[11px] shadow-lg backdrop-blur ${t.tone === 'err' ? 'border-ops-red/50 bg-ops-red/15 text-ops-red' : t.tone === 'ok' ? 'border-ops-green/40 bg-ops-green/10 text-ops-green' : 'border-ops-cyan/40 bg-ops-cyan/10 text-ops-cyan'}`}>{t.text}</div>
      ))}
    </div>
  );
}
