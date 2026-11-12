import { useState } from 'react';
import {
  DOMAINS, INVESTMENTS, REGION_IDS, SIM_CONFIG, canAfford, confidenceLabel, crewsFree, isActive, isKnown, maintenanceCost, mitigation,
  type Domain, type RegionId, type SimState,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { statusColor } from '../map/GlobalMap';
import { Bar, Chip, DOMAIN_COLOR, DOMAIN_LABEL, Gauge, LineChart, Panel, SEV_TONE, Stat, TONE_TEXT, Tabs, tone } from '../components/ui';
import { useUI } from '../uiState';

export function IntelView({ s }: { s: SimState }) {
  const ui = useUI();
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const known = s.events.filter((e) => isKnown(s, e));
  const list = (tab === 'active' ? known.filter(isActive) : known.filter((e) => !isActive(e)).reverse()).slice(0, 120);
  const pending = s.events.filter((e) => isActive(e) && !isKnown(s, e)).length;
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-3" title="Intelligence Picture">
        <div className="flex flex-wrap items-center gap-6">
          <Gauge value={s.metrics.infoQuality} label="Information quality" />
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Active reports" value={known.filter(isActive).length} />
            <Stat label="Unverified" value={known.filter((e) => isActive(e) && e.confidence < 35).length} t="red" />
            <Stat label="Confirmations" value={s.counters.confirmations} t="cyan" />
            <Stat label="Spurious exposed" value={s.counters.falseDismissed} t="green" />
            <Stat label="Reports in transit" value={pending > 0 ? 'YES' : 'NONE'} t={pending ? 'amber' : 'green'} sub="delayed by poor comms" />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ops-dim">Confidence rises over time where awareness is strong and falls for reports that are not corroborated. Some reports are spurious; regions with thin sensor coverage produce more of them. Task an independent confirmation (cheap, a few hours) to confirm or refute a report before committing resources.</p>
      </Panel>
      <Panel className="xl:col-span-2" title="Reports" bodyClass="p-0 overflow-x-auto" right={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'active', label: 'Active' }, { id: 'closed', label: 'Closed' }]} />}>
        <table className="table-ops w-full min-w-[640px]">
          <thead><tr><th>ID</th><th>Report</th><th>Region</th><th>Severity</th><th className="w-40">Confidence</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((e) => {
              const c = confidenceLabel(e.confidence);
              return (
                <tr key={e.id} className="cursor-pointer" onClick={() => ui.openEvent(e.id)}>
                  <td className="text-ops-dim">{e.id}</td>
                  <td className="text-white">{e.title}{e.reportedAt > e.occurredAt && <span className="ml-1 text-[10px] text-ops-amber">delayed {e.reportedAt - e.occurredAt}h</span>}</td>
                  <td>{e.global ? 'GLOBAL' : s.regions[e.region].short}</td>
                  <td><Chip t={SEV_TONE[e.severity]}>{e.conflicting ? `${e.reportedSeverity[0]}–${e.reportedSeverity[1]} ⚠` : e.severity}</Chip></td>
                  <td><div className="flex items-center gap-2"><div className="flex-1"><Bar value={e.confidence} height={4} /></div><span className={`w-20 text-[10px] ${TONE_TEXT[c.tone]}`}>{c.label}</span></div></td>
                  <td className="uppercase text-[10px]">{e.status}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={6} className="text-ops-dim">No reports.</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title="Regional Awareness">
        <div className="space-y-2">
          {REGION_IDS.map((id) => {
            const r = s.regions[id];
            return (
              <div key={id}>
                <div className="flex justify-between text-[11px]"><span>{r.name}</span><span className={TONE_TEXT[tone(r.awareness)]}>{Math.round(r.awareness)}</span></div>
                <Bar value={r.awareness} height={4} />
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel className="xl:col-span-3" title="Information Quality History">
        <LineChart series={[{ name: 'Info quality', color: '#a78bfa', data: s.history.map((h) => h.infoQuality) }, { name: 'Network', color: '#38d6f5', data: s.history.map((h) => h.network) }]} height={120} />
      </Panel>
    </div>
  );
}

export function CommsView({ s }: { s: SimState }) {
  const ui = useUI();
  const comms = s.assets.filter((a) => a.role === 'comms' || a.role === 'command');
  const res = INVESTMENTS.find((i) => i.id === 'resilience')!;
  const err = canAfford(s, res.credits, res.personnel, 0);
  const commsEvents = s.events.filter((e) => isActive(e) && isKnown(s, e) && e.category === 'comms');
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-3" title="Communications Network">
        <div className="flex flex-wrap items-center gap-6">
          <Gauge value={s.metrics.network} label="Network health" />
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            {DOMAINS.map((d) => (
              <div key={d}><div className="label">{DOMAIN_LABEL[d]} share</div><div className="text-lg" style={{ color: DOMAIN_COLOR[d] }}>{Math.round(SIM_CONFIG.commsWeight[d] * 100)}%</div>
                <div className="text-[10px] text-ops-dim">of network capacity</div></div>
            ))}
          </div>
          <div className="w-64 rounded border border-ops-line p-3">
            <div className="label">Network resilience</div>
            <div className="text-xl text-white">{Math.round(s.resilience)} <span className="text-xs text-ops-dim">/ 100</span></div>
            <div className="text-[10px] text-ops-dim">Disruption penalties reduced by {Math.round((1 - mitigation(s)) * 100)}%</div>
            <button className="btn btn-primary mt-2 w-full" disabled={!!err || s.projects.some((p) => p.investmentId === 'resilience')} title={err ?? res.description}
              onClick={() => dispatch({ type: 'invest', investmentId: 'resilience' })}>Resilience program ({res.credits} cr)</button>
          </div>
        </div>
      </Panel>
      <Panel title="Regional Communications">
        <div className="space-y-2">
          {REGION_IDS.map((id) => {
            const r = s.regions[id];
            const restoring = s.projects.some((p) => p.investmentId === 'restore_comms' && p.region === id);
            return (
              <div key={id}>
                <div className="flex items-center justify-between text-[11px]"><span>{r.name}</span>
                  <span className="flex items-center gap-2"><span className={TONE_TEXT[tone(r.comms)]}>{Math.round(r.comms)}</span>
                    <button className="btn px-1.5 py-0 text-[10px]" disabled={restoring || s.credits < 140} title="Communications Restoration Team (140 cr, 10h)" onClick={() => dispatch({ type: 'invest', investmentId: 'restore_comms', region: id as RegionId })}>{restoring ? '…' : 'Restore'}</button></span></div>
                <Bar value={r.comms} height={4} />
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title="Communications Assets" bodyClass="p-0 max-h-[420px] overflow-y-auto">
        <table className="table-ops w-full">
          <tbody>
            {comms.sort((a, b) => a.condition - b.condition).map((a) => (
              <tr key={a.id} className="cursor-pointer" onClick={() => ui.openAsset(a.id)}>
                <td><span style={{ color: DOMAIN_COLOR[a.domain] }}>●</span> {a.name}</td>
                <td className="text-ops-dim">{a.role === 'command' ? 'Command' : 'Relay'}</td>
                <td style={{ color: statusColor(a, s.hour) }}>{Math.round(a.condition)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Active Disruptions & Dependency Model">
        {commsEvents.length === 0 && <div className="mb-2 text-ops-dim">No active communications disruptions.</div>}
        {commsEvents.map((e) => <button key={e.id} className="mb-1 block text-left text-ops-amber hover:underline" onClick={() => ui.openEvent(e.id)}>{e.id} {e.title} ({e.global ? 'GLOBAL' : s.regions[e.region].short})</button>)}
        <table className="table-ops mt-2 w-full text-[10px]">
          <thead><tr><th>Domain</th><th>Net weight</th><th>Current loss</th></tr></thead>
          <tbody>{DOMAINS.map((d) => <tr key={d}><td style={{ color: DOMAIN_COLOR[d] }}>{DOMAIN_LABEL[d]}</td><td>{SIM_CONFIG.networkWeight[d]}</td><td className="text-ops-amber">−{(SIM_CONFIG.networkWeight[d] * (100 - s.metrics.network)).toFixed(1)}%</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[10px] text-ops-dim">Network health scales every domain's effective readiness. Regional comms also controls report delays and confirmation speed.</p>
      </Panel>
    </div>
  );
}

export function LogisticsView({ s }: { s: SimState }) {
  const ui = useUI();
  const [target, setTarget] = useState<Record<string, string>>({});
  const upkeep = s.assets.reduce((x, a) => x + a.upkeep, 0);
  const income = SIM_CONFIG.baseIncomePerHour * (0.5 + s.metrics.stability / 200);
  const queue = s.assets.filter((a) => a.status !== 'maintenance' && a.status !== 'transit' && (a.hoursToService < 24 || a.condition < 60)).sort((a, b) => a.hoursToService - b.hoursToService);
  const inMaint = s.assets.filter((a) => a.status === 'maintenance');
  const spendTotal = Object.values(s.spendByCategory).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-3" title="Global Resource Pool">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Strategic credits" value={Math.round(s.credits)} t={s.credits < 150 ? 'red' : undefined} sub={`net ${(income - upkeep >= 0 ? '+' : '')}${(income - upkeep).toFixed(1)}/h`} />
          <Stat label="Income" value={income.toFixed(1)} unit="/h" t="green" sub="scales with stability" />
          <Stat label="Upkeep" value={upkeep.toFixed(1)} unit="/h" t="amber" />
          <Stat label="Personnel" value={`${Math.round(s.personnel)}/${s.personnelMax}`} sub={`+${SIM_CONFIG.personnelRegenPerHour}/h`} />
          <Stat label="Crews free" value={`${crewsFree(s)}/${s.crews}`} t={crewsFree(s) ? 'green' : 'red'} />
          <Stat label="Logistics" value={Math.round(s.logistics)} t={tone(s.logistics)} />
          <Stat label="Resilience" value={Math.round(s.resilience)} />
          <Stat label="Modernization" value={`+${s.modernization}%`} />
        </div>
      </Panel>
      <Panel className="xl:col-span-2" title="Strategic Investments" bodyClass="p-3 grid gap-2 md:grid-cols-2">
        {INVESTMENTS.map((inv) => {
          const err = canAfford(s, inv.credits, inv.personnel, 0);
          const t = target[inv.id] ?? '';
          const needs = inv.scope !== 'global' && !t;
          return (
            <div key={inv.id} className="flex flex-col rounded border border-ops-line p-2.5">
              <div className="flex justify-between gap-2"><span className="font-semibold text-white">{inv.label}</span><Chip>{inv.category}</Chip></div>
              <p className="mt-1 flex-1 text-[10px] text-ops-dim">{inv.description}</p>
              <div className="mt-1 text-[10px] text-ops-dim">{inv.credits} cr · {inv.personnel} personnel · {inv.hours}h</div>
              <div className="mt-2 flex gap-1">
                {inv.scope === 'region' && (
                  <select className="input flex-1 py-0.5" value={t} onChange={(e) => setTarget({ ...target, [inv.id]: e.target.value })} aria-label={`${inv.label} region`}>
                    <option value="">Region…</option>{REGION_IDS.map((r) => <option key={r} value={r}>{s.regions[r].name} ({Math.round(inv.id === 'harden' ? s.regions[r].infrastructure : inv.id === 'restore_comms' ? s.regions[r].comms : s.regions[r].stability)})</option>)}
                  </select>
                )}
                {inv.scope === 'domain' && (
                  <select className="input flex-1 py-0.5" value={t} onChange={(e) => setTarget({ ...target, [inv.id]: e.target.value })} aria-label={`${inv.label} domain`}>
                    <option value="">Domain…</option>{DOMAINS.map((d) => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
                  </select>
                )}
                <button className="btn btn-primary ml-auto" disabled={!!err || needs} title={err ?? (needs ? 'Select a target' : '')}
                  onClick={() => dispatch({ type: 'invest', investmentId: inv.id, region: inv.scope === 'region' ? (t as RegionId) : undefined, domain: inv.scope === 'domain' ? (t as Domain) : undefined })}>Fund</button>
              </div>
            </div>
          );
        })}
      </Panel>
      <div className="flex flex-col gap-2">
        <Panel title="Active Projects" right={<span>{s.projects.length}</span>}>
          {s.projects.length === 0 && <div className="text-ops-dim">No projects underway.</div>}
          {s.projects.map((p) => (
            <div key={p.id} className="mb-2"><div className="flex justify-between text-[11px]"><span className="truncate">{p.label}</span><span className="text-ops-dim">{Math.ceil(((100 - p.progress) / 100) * p.hours)}h</span></div><Bar value={p.progress} color="#38d6f5" height={4} /></div>
          ))}
        </Panel>
        <Panel title="Expenditure by Category">
          {(Object.keys(s.spendByCategory) as (keyof typeof s.spendByCategory)[]).map((k) => (
            <div key={k} className="mb-1.5"><div className="flex justify-between text-[11px]"><span className="capitalize">{k}</span><span>{Math.round(s.spendByCategory[k])} cr</span></div><Bar value={(s.spendByCategory[k] / spendTotal) * 100} color="#a78bfa" height={4} /></div>
          ))}
          <div className="mt-2 text-[10px] text-ops-dim">Wasted on spurious reports: <span className="text-ops-red">{Math.round(s.counters.wastedCredits)} cr</span></div>
        </Panel>
      </div>
      <Panel className="xl:col-span-2" title="Maintenance Queue" bodyClass="p-0 overflow-x-auto" right={<span>{queue.length} need attention · {inMaint.length} in work</span>}>
        <table className="table-ops w-full min-w-[560px]">
          <thead><tr><th>Asset</th><th>Domain</th><th>Region</th><th className="w-32">Condition</th><th>Service</th><th /></tr></thead>
          <tbody>
            {inMaint.map((a) => (
              <tr key={a.id}><td className="text-white">{a.name}</td><td style={{ color: DOMAIN_COLOR[a.domain] }}>{DOMAIN_LABEL[a.domain]}</td><td>{a.region}</td><td><Bar value={a.condition} showValue /></td><td className="text-ops-cyan">in work {a.maintenanceRemaining}h</td><td /></tr>
            ))}
            {queue.map((a) => {
              const c = maintenanceCost(s, a.domain);
              return (
                <tr key={a.id}>
                  <td><button className="text-white hover:text-ops-cyan" onClick={() => ui.openAsset(a.id)}>{a.name}</button></td>
                  <td style={{ color: DOMAIN_COLOR[a.domain] }}>{DOMAIN_LABEL[a.domain]}</td><td>{a.region}</td>
                  <td><Bar value={a.condition} showValue /></td>
                  <td className={a.hoursToService < 0 ? 'text-ops-red' : 'text-ops-amber'}>{a.hoursToService < 0 ? `${-a.hoursToService}h overdue` : `due ${a.hoursToService}h`}</td>
                  <td className="text-right"><button className="btn" disabled={crewsFree(s) < 1 || s.credits < c} onClick={() => dispatch({ type: 'maintain', assetId: a.id })}>Schedule ({c})</button></td>
                </tr>
              );
            })}
            {!queue.length && !inMaint.length && <tr><td colSpan={6} className="text-ops-dim">No maintenance due in the next 24h.</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title="Credits History">
        <LineChart series={[{ name: 'Credits', color: '#f5b13d', data: s.history.map((h) => h.credits) }]} yMax={Math.max(500, ...s.history.map((h) => h.credits))} height={150} />
      </Panel>
    </div>
  );
}

export function InfraView({ s }: { s: SimState }) {
  const ui = useUI();
  const facilities = s.assets.filter((a) => a.domain === 'ground');
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-2" title="Regional Infrastructure" bodyClass="p-0 overflow-x-auto">
        <table className="table-ops w-full min-w-[620px]">
          <thead><tr><th>Region</th><th className="w-32">Infrastructure</th><th className="w-32">Stability</th><th>Readiness</th><th>Facilities</th><th /></tr></thead>
          <tbody>
            {REGION_IDS.map((id) => {
              const r = s.regions[id];
              const fac = facilities.filter((a) => a.region === id);
              const hardening = s.projects.some((p) => p.investmentId === 'harden' && p.region === id);
              const recovering = s.projects.some((p) => p.investmentId === 'recovery' && p.region === id);
              return (
                <tr key={id}>
                  <td><button className="text-white hover:text-ops-cyan" onClick={() => { ui.setView('global'); ui.setRegion(id); }}>{r.name}</button></td>
                  <td><Bar value={r.infrastructure} showValue /></td>
                  <td><Bar value={r.stability} showValue /></td>
                  <td className={TONE_TEXT[tone(r.readiness)]}>{Math.round(r.readiness)}</td>
                  <td>{fac.map((a) => <span key={a.id} title={`${a.name} ${Math.round(a.condition)}%`} className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: statusColor(a, s.hour) }} />)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn mr-1" disabled={hardening || !!canAfford(s, 220, 8, 0)} onClick={() => dispatch({ type: 'invest', investmentId: 'harden', region: id })}>{hardening ? 'Hardening…' : 'Harden 220'}</button>
                    <button className="btn" disabled={recovering || !!canAfford(s, 200, 10, 0)} onClick={() => dispatch({ type: 'invest', investmentId: 'recovery', region: id })}>{recovering ? 'Recovering…' : 'Recovery 200'}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <Panel title="Resilience Summary">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Avg infrastructure" value={Math.round(s.metrics.infrastructure)} t={tone(s.metrics.infrastructure)} sub={`baseline ${Math.round(s.baseline.infrastructure)}`} />
          <Stat label="Avg stability" value={Math.round(s.metrics.stability)} t={tone(s.metrics.stability)} />
          <Stat label="Ground facilities" value={facilities.length} sub={`${facilities.filter((a) => a.status === 'operational').length} operational`} />
          <Stat label="Escalations" value={s.counters.escalations} t={s.counters.escalations > 3 ? 'red' : 'green'} sub="cause lasting damage" />
        </div>
        <p className="mt-3 text-[10px] text-ops-dim">Infrastructure multiplies regional readiness and communications. Escalated events and unrest erode it permanently; hardening and recovery packages restore it.</p>
      </Panel>
      <Panel className="xl:col-span-3" title="Infrastructure & Stability History">
        <LineChart series={[{ name: 'Infrastructure', color: '#34d399', data: s.history.map((h) => h.infrastructure) }, { name: 'Stability', color: '#f5b13d', data: s.history.map((h) => h.stability) }]} height={130} />
      </Panel>
    </div>
  );
}
