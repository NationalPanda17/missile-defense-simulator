// Contextual windows: event investigation, asset inspection, briefings, start screen, help, tutorial, toasts.
import { useRef, useState } from 'react';
import {
  REGION_IDS, SIM_CONFIG, TEMPLATE_MAP, confidenceLabel, crewsFree, defaultSettings, importJSON, isActive, listSaves, loadGame,
  maintenanceCost, responseSuccessChance, SEVERITY_LABEL, canAfford, type EffectSpec, type RegionId, type SimState, type Slot,
} from '../engine';
import { dispatch, store, useStoreVersion } from '../store/simStore';
import { Bar, Chip, DOMAIN_COLOR, DOMAIN_LABEL, Modal, SEV_TONE, Sparkline, TONE_TEXT, tone } from './components/ui';
import { useUI, type ViewId } from './uiState';
import { statusColor } from './map/GlobalMap';
import { ServerSavesPanel, ServiceRecord } from './views/ServerPanels';

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
                    onClick={() => dispatch({ type: 'confirm', eventId: e.id })} title="Task an independent source to confirm or refute this report">
                    ◈ Task confirmation ({SIM_CONFIG.confirmCost} cr, ~{SIM_CONFIG.confirmHours}h)
                  </button>
                  <button className="btn btn-danger" onClick={() => { dispatch({ type: 'dismiss', eventId: e.id }); }} title="Close as unreliable. If it is genuine, it will keep developing unseen.">✕ Dismiss as unreliable</button>
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
                        <button className={`btn shrink-0 ${resp.passive ? '' : 'btn-primary'}`} disabled={busy || !!err} title={err ?? undefined}
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
            <button className="btn btn-primary" disabled={a.status === 'transit'} onClick={() => dispatch({ type: 'maintain', assetId: a.id })}>
              ⛭ Schedule maintenance ({cost} cr, {SIM_CONFIG.maintenanceHours[a.domain]}h, 1 crew)
            </button>
          )}
          {mobile && (
            <span className="flex items-center gap-1">
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

export function BriefingModal({ s }: { s: SimState }) {
  const phase = s.phases[s.phaseIndex];
  const degraded = s.assets.filter((a) => a.status !== 'operational' || a.hoursToService < 24);
  const activeEv = s.events.filter(isActive);
  const prevResults = s.objectiveResults.filter((r) => r.phase === phase.id - 1);
  return (
    <Modal wide title={`CAMPAIGN BRIEFING · PHASE ${phase.id} OF ${s.phases.length}`}
      footer={<button className="btn btn-primary px-6 py-2 text-[13px]" autoFocus onClick={() => dispatch({ type: 'beginPhase' })}>Assume command — begin phase ▶</button>}>
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
            <div><div className="label mb-1">Objectives</div>
              <ul className="space-y-1">{phase.objectives.map((o) => <li key={o.id} className="flex justify-between gap-2"><span>▸ {o.text}</span>{o.reward > 0 && <span className="shrink-0 text-ops-green">+{o.reward} cr</span>}</li>)}</ul>
            </div>
            <div><div className="label mb-1">Special conditions</div><div className="flex flex-wrap gap-1">{phase.special.map((x) => <Chip key={x} t="amber">{x}</Chip>)}</div></div>
            <div><div className="label mb-1">Current resources</div>
              <div className="grid grid-cols-4 gap-2 text-white">
                <div><div className="label">Credits</div>{Math.round(s.credits)}</div>
                <div><div className="label">Personnel</div>{Math.round(s.personnel)}</div>
                <div><div className="label">Crews</div>{s.crews}</div>
                <div><div className="label">Resilience</div>{Math.round(s.resilience)}</div>
              </div>
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
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function StartScreen({ onSandbox }: { onSandbox: () => void }) {
  useStoreVersion();
  const fileRef = useRef<HTMLInputElement>(null);
  const saves = listSaves();
  const modes = [
    { id: 'campaign' as const, title: 'Campaign', desc: 'Four-phase global campaign: establish the network, weather regional instability, survive a global crisis and lead the recovery. 240 simulated hours.', cta: 'Begin campaign' },
    { id: 'crisis' as const, title: 'Crisis Mode', desc: 'Start inside a cascading blackout with thin resources, unreliable intelligence and simultaneous disruptions. 96 hours.', cta: 'Enter crisis' },
    { id: 'training' as const, title: 'Training', desc: 'Guided familiarization with the command interface, information quality, events and resources. Slow and forgiving.', cta: 'Start training' },
  ];
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center">
          <div className="label tracking-[0.4em]">Global Integrated Defense Command</div>
          <h1 className="mt-2 font-sans text-4xl font-bold tracking-[0.2em] text-white sm:text-5xl">MISSILE DEFENSE SIMULATOR</h1>
          <p className="mx-auto mt-3 max-w-2xl text-ops-dim">Command a fictional four-domain defense network — Space, Air, Sea and Ground — across seven strategic regions. Manage readiness, communications, uncertain intelligence and scarce resources through a dynamic campaign.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {modes.map((m) => (
            <div key={m.id} className="panel flex flex-col p-4">
              <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">{m.title}</div>
              <p className="mt-2 flex-1 text-[11px] leading-relaxed text-ops-dim">{m.desc}</p>
              <button className="btn btn-primary mt-3" onClick={() => store.newGame(defaultSettings(m.id))}>{m.cta}</button>
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
            <div className="grid gap-2 sm:grid-cols-2">
              {saves.map((m) => (
                <button key={m.slot} className="rounded border border-ops-line p-2 text-left hover:border-ops-cyan/50" onClick={() => { const st = loadGame(m.slot as Slot); if (st) store.load(st); }}>
                  <div className="flex justify-between"><span className="text-white">{m.slot === 'auto' ? 'Autosave' : m.slot.toUpperCase()} · {m.name}</span><span className="text-ops-dim">T+{m.hour}h</span></div>
                  <div className="text-[10px] text-ops-dim">{m.mode} · {m.phase} · {new Date(m.savedAt).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
          <ServerSavesPanel canSave={false} />
          <ServiceRecord limit={6} />
        </div>
        <p className="text-center text-[10px] text-ops-dim">All countries, equipment, names and figures are fictional. Mechanics are abstract strategic management — not a model of real systems.</p>
      </div>
    </div>
  );
}

export function HelpModal() {
  const ui = useUI();
  const keys: [string, string][] = [
    ['Space', 'Pause / resume'], ['1 – 4', 'Speed 1x / 2x / 4x / 8x'], ['T', 'Advance one turn (6h)'], ['G S A M D', 'Global · Space · Air · Maritime · Ground'],
    ['I C L F', 'Intelligence · Comms · Logistics · Infrastructure'], ['P E R', 'Campaign · Scenario editor · After-action review'],
    ['Ctrl/⌘ + S', 'Quick-save to slot 1'], ['B', 'Toggle bottom panel'], ['Esc', 'Close window / deselect region'], ['?', 'This help'],
  ];
  return (
    <Modal title="COMMAND REFERENCE" onClose={() => ui.setHelp(false)}>
      <div className="space-y-4">
        <table className="table-ops w-full"><tbody>{keys.map(([k, d]) => <tr key={k}><td className="w-36"><kbd className="rounded border border-ops-line px-1.5 text-ops-cyan">{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
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
