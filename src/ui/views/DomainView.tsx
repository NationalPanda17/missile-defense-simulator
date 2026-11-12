import { useState } from 'react';
import {
  REGION_IDS, SIM_CONFIG, availability, crewsFree, isActive, maintenanceCost, type Asset, type Domain, type SimState,
} from '../../engine';
import { dispatch } from '../../store/simStore';
import { statusColor } from '../map/GlobalMap';
import { Bar, Chip, DOMAIN_COLOR, DOMAIN_LABEL, Gauge, LineChart, Panel, Sparkline, Stat, TONE_TEXT, tone } from '../components/ui';
import { useUI } from '../uiState';

const FOCUS: Record<Domain, { title: string; blurb: string }> = {
  space: { title: 'Space Command', blurb: 'Global awareness, information continuity and communications resilience. Relay satellites carry 40% of global network capacity; survey satellites provide multi-region coverage.' },
  air: { title: 'Air Command', blurb: 'Airborne situational awareness and inter-domain coordination. Aircraft can be redeployed between regions to backfill coverage gaps. Air depends on Space relays and Ground control.' },
  sea: { title: 'Maritime Command', blurb: 'Maritime awareness, regional support and resource movement. Support vessels improve response success in their region. Maritime depends heavily on Space relays.' },
  ground: { title: 'Ground Command', blurb: 'Regional infrastructure protection, continuity of operations and resilience. Sensor stations, relay hubs and command centers anchor every region.' },
};

export function DomainView({ s, domain }: { s: SimState; domain: Domain }) {
  const ui = useUI();
  const [sort, setSort] = useState<'condition' | 'service' | 'region'>('condition');
  const assets = s.assets.filter((a) => a.domain === domain);
  const raw = s.metrics.domainRaw[domain];
  const eff = s.metrics.domainEffective[domain];
  const counts = { operational: 0, degraded: 0, maintenance: 0, offline: 0, transit: 0 } as Record<Asset['status'], number>;
  for (const a of assets) counts[a.status]++;
  const deps = SIM_CONFIG.dependencies[domain];
  const upkeep = assets.reduce((x, a) => x + a.upkeep, 0);
  const mcost = maintenanceCost(s, domain);
  const sorted = [...assets].sort((a, b) => sort === 'condition' ? a.condition - b.condition : sort === 'service' ? a.hoursToService - b.hoursToService : a.region.localeCompare(b.region));
  const color = DOMAIN_COLOR[domain];
  const events = s.events.filter((e) => isActive(e) && e.domains.includes(domain) && e.reportedAt <= s.hour);
  const overdue = assets.filter((a) => a.hoursToService < 0 && a.status !== 'maintenance');

  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-3" title={<span style={{ color }}>{FOCUS[domain].title}</span>} right={<span>{assets.length} assets</span>}>
        <div className="flex flex-wrap items-center gap-6">
          <Gauge value={eff} label="Effective readiness" />
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Raw readiness" value={Math.round(raw)} unit="%" t={tone(raw)} sub="asset condition only" />
            <Stat label="Dependency loss" value={`−${Math.max(0, Math.round(Math.min(100, raw) - eff))}`} t={raw - eff > 15 ? 'red' : raw - eff > 6 ? 'amber' : 'green'} sub="from other domains + network" />
            <Stat label="Operational" value={counts.operational} t="green" sub={`${counts.degraded} degraded`} />
            <Stat label="Unavailable" value={counts.maintenance + counts.offline + counts.transit} t={counts.offline ? 'red' : 'cyan'} sub={`${counts.offline} offline · ${counts.maintenance} maint · ${counts.transit} transit`} />
            <Stat label="Upkeep" value={upkeep.toFixed(1)} unit="cr/h" sub={`maintenance ${mcost} cr / cycle`} />
            <Stat label="Service overdue" value={overdue.length} t={overdue.length ? 'amber' : 'green'} sub={`interval ${SIM_CONFIG.serviceInterval[domain]}h`} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-ops-dim">{FOCUS[domain].blurb}</p>
      </Panel>

      <Panel className="xl:col-span-2" title="Asset Inventory" bodyClass="p-0 overflow-x-auto" right={
        <select className="input py-0.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort assets">
          <option value="condition">Sort: condition</option><option value="service">Sort: service due</option><option value="region">Sort: region</option>
        </select>
      }>
        <table className="table-ops w-full min-w-[640px]">
          <thead><tr><th>Asset</th><th>Class</th><th>Region</th><th>Status</th><th className="w-36">Condition</th><th>Service</th><th>Trend</th><th /></tr></thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.id}>
                <td><button className="text-white hover:text-ops-cyan" onClick={() => ui.openAsset(a.id)}>{a.name}</button></td>
                <td className="max-w-[170px] truncate text-ops-dim" title={a.className}>{a.className}</td>
                <td>{domain === 'space' ? a.coverage.map((c) => s.regions[c].short).join(' ') : a.status === 'transit' ? `→ ${a.transitTo}` : s.regions[a.region].short}</td>
                <td><span style={{ color: statusColor(a, s.hour) }} className="uppercase">{a.status}</span></td>
                <td><Bar value={a.condition} showValue /></td>
                <td className={a.hoursToService < 0 ? 'text-ops-red' : a.hoursToService < 24 ? 'text-ops-amber' : 'text-ops-dim'}>
                  {a.status === 'maintenance' ? `in work ${a.maintenanceRemaining}h` : a.hoursToService < 0 ? `${-a.hoursToService}h over` : `${a.hoursToService}h`}
                </td>
                <td><Sparkline data={a.history.slice(-20)} color={color} w={60} h={16} /></td>
                <td className="text-right">
                  <button className="btn" disabled={a.status === 'maintenance' || a.status === 'transit' || crewsFree(s) < 1 || s.credits < mcost}
                    onClick={() => dispatch({ type: 'maintain', assetId: a.id })} title={`${mcost} cr · ${SIM_CONFIG.maintenanceHours[domain]}h · 1 crew`}>Maintain</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="flex flex-col gap-2">
        <Panel title="Cross-Domain Dependencies">
          <div className="space-y-2">
            {Object.keys(deps).length === 0 && <div className="text-ops-dim">No direct dependencies.</div>}
            {(Object.keys(deps) as Domain[]).map((d) => {
              const loss = (deps[d] ?? 0) * (1 - Math.min(100, s.metrics.domainRaw[d]) / 100) * 100;
              return (
                <div key={d}>
                  <div className="flex justify-between text-[11px]"><span>Depends on <span style={{ color: DOMAIN_COLOR[d] }}>{DOMAIN_LABEL[d]}</span> (weight {deps[d]})</span><span className={loss > 5 ? 'text-ops-amber' : 'text-ops-dim'}>−{loss.toFixed(1)}%</span></div>
                  <Bar value={s.metrics.domainRaw[d]} height={4} color={DOMAIN_COLOR[d]} />
                </div>
              );
            })}
            <div>
              <div className="flex justify-between text-[11px]"><span>Network health (weight {SIM_CONFIG.networkWeight[domain]})</span><span className="text-ops-dim">−{(SIM_CONFIG.networkWeight[domain] * (100 - s.metrics.network)).toFixed(1)}%</span></div>
              <Bar value={s.metrics.network} height={4} />
            </div>
          </div>
        </Panel>
        <Panel title="Domain Events" right={<span>{events.length}</span>}>
          {events.length === 0 && <div className="text-ops-dim">No active events affecting this domain.</div>}
          {events.map((e) => (
            <button key={e.id} onClick={() => ui.openEvent(e.id)} className="mb-1 flex w-full items-center gap-2 text-left hover:text-white">
              <Chip t={e.severity >= 3 ? 'red' : 'amber'}>S{e.severity}</Chip><span className="flex-1 truncate">{e.title}</span><span className="text-ops-dim">{s.regions[e.region].short}</span>
            </button>
          ))}
        </Panel>
      </div>

      <Panel className="xl:col-span-2" title="Historical Performance">
        <LineChart series={[
          { name: 'Effective', color, data: s.history.map((h) => h.domains[domain]) },
          { name: 'Global readiness', color: '#5d7391', data: s.history.map((h) => h.readiness) },
          { name: 'Network', color: '#38d6f5', data: s.history.map((h) => h.network) },
        ]} />
      </Panel>

      <DomainSpecific s={s} domain={domain} />
    </div>
  );
}

function DomainSpecific({ s, domain }: { s: SimState; domain: Domain }) {
  const color = DOMAIN_COLOR[domain];
  if (domain === 'space') {
    const sats = s.assets.filter((a) => a.domain === 'space');
    return (
      <Panel title="Orbital Coverage Matrix" bodyClass="p-0 overflow-x-auto">
        <table className="table-ops w-full text-[10px]">
          <thead><tr><th>Platform</th>{REGION_IDS.map((r) => <th key={r} className="text-center">{r}</th>)}</tr></thead>
          <tbody>
            {sats.map((a) => {
              const av = availability(s, a);
              return (
                <tr key={a.id}><td className="whitespace-nowrap">{a.name} <span className="text-ops-dim">{a.role === 'comms' ? 'RLY' : 'SRV'}</span></td>
                  {REGION_IDS.map((r) => <td key={r} className="text-center">{a.coverage.includes(r) ? <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color, opacity: 0.2 + av * 0.8 }} title={`${Math.round(av * 100)}%`} /> : <span className="text-ops-line">·</span>}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="p-2 text-[10px] text-ops-dim">Cell intensity shows current platform availability over each region.</p>
      </Panel>
    );
  }
  const title = domain === 'air' ? 'Airborne Coverage by Region' : domain === 'sea' ? 'Maritime Presence by Region' : 'Regional Ground Network';
  return (
    <Panel title={title}>
      <div className="space-y-1.5">
        {REGION_IDS.map((r) => {
          const here = s.assets.filter((a) => a.domain === domain && a.region === r);
          const v = here.length ? here.reduce((x, a) => x + Math.min(1, availability(s, a)) * 100, 0) / here.length : 0;
          return (
            <div key={r} className="grid grid-cols-[52px_1fr_auto] items-center gap-2">
              <span className="text-[10px]">{s.regions[r].short}</span>
              {here.length ? <Bar value={v} height={5} /> : <span className="text-[10px] text-ops-dim">no {DOMAIN_LABEL[domain].toLowerCase()} assets assigned</span>}
              <span className={`text-[10px] ${here.length ? TONE_TEXT[tone(v)] : 'text-ops-dim'}`}>{here.length}</span>
            </div>
          );
        })}
      </div>
      {(domain === 'air' || domain === 'sea') && <p className="mt-2 text-[10px] text-ops-dim">Open an asset to redeploy it to a region with weak awareness.</p>}
    </Panel>
  );
}
