import { DOMAINS, INVESTMENTS, isActive, isKnown, canAfford, type RegionId, type SimState } from '../../engine';
import { dispatch } from '../../store/simStore';
import GlobalMap from '../map/GlobalMap';
import { Bar, Chip, DOMAIN_COLOR, DOMAIN_LABEL, Gauge, SEV_TONE, Sparkline, Stat, TONE_TEXT, statusColor, tone } from '../components/ui';
import { useUI } from '../uiState';

export function GlobalOps({ s }: { s: SimState }) {
  const ui = useUI();
  const m = s.metrics;
  const activeKnown = s.events.filter((e) => isActive(e) && isKnown(s, e));
  return (
    <div className="flex h-full min-h-[520px] flex-col gap-2">
      <div className="panel grid grid-cols-3 gap-3 px-3 py-2 sm:grid-cols-6 xl:grid-cols-9">
        <Stat label="Readiness" full="Global readiness" value={Math.round(m.globalReadiness)} unit="%" t={tone(m.globalReadiness)} />
        <Stat label="Network" full="Network health" value={Math.round(m.network)} unit="%" t={tone(m.network)} />
        <Stat label="Sensors" full="Sensor availability" value={Math.round(m.sensorAvailability)} unit="%" t={tone(m.sensorAvailability)} />
        <Stat label="Info" full="Information quality" value={Math.round(m.infoQuality)} unit="%" t={tone(m.infoQuality)} />
        <Stat label="Stability" full="Average stability" value={Math.round(m.stability)} t={tone(m.stability)} />
        <Stat label="Infra" full="Infrastructure" value={Math.round(m.infrastructure)} t={tone(m.infrastructure)} />
        <Stat label="Events" full="Active events" value={activeKnown.length} t={activeKnown.length > 5 ? 'red' : activeKnown.length > 2 ? 'amber' : 'green'} />
        <Stat label="Backlog" full="Maintenance backlog" value={m.maintenanceBacklog} t={m.maintenanceBacklog > 4 ? 'red' : m.maintenanceBacklog > 1 ? 'amber' : 'green'} />
        <Stat label="Staff" full="Personnel" value={Math.round(s.personnel)} sub={`crews ${s.crews - s.crewsBusy}/${s.crews} free`} />
      </div>
      <div className="relative flex min-h-0 flex-1 gap-2">
        <div className="min-h-[380px] min-w-0 flex-1" data-coach="map"><GlobalMap s={s} /></div>
        {ui.region && <RegionPanel s={s} id={ui.region} />}
      </div>
    </div>
  );
}

export function RegionPanel({ s, id }: { s: SimState; id: RegionId }) {
  const ui = useUI();
  const r = s.regions[id];
  const assets = s.assets.filter((a) => a.region === id || (a.domain === 'space' && a.coverage.includes(id)));
  const events = s.events.filter((e) => (e.region === id || e.global) && isActive(e) && isKnown(s, e));
  const hist = s.history.slice(-72).map((h) => h.regions[id]);
  const regional = INVESTMENTS.filter((i) => i.scope === 'region');
  return (
    <aside className="panel fadein absolute inset-y-0 right-0 z-10 flex w-[min(360px,100%)] flex-col overflow-hidden bg-ops-panel md:static md:bg-ops-panel/95">
      <div className="panel-title">
        <span>Regional Command · {r.short}</span>
        <button className="btn px-2" onClick={() => ui.setRegion(null)} aria-label="Close regional panel">✕</button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div>
          <h2 className="font-sans text-2xl font-semibold text-white">{r.name}</h2>
          <div className="text-[11px] text-ops-dim">Threat pressure {Math.round(r.threatLevel)} · {events.length} active event(s)</div>
        </div>
        <div className="flex justify-around"><Gauge value={r.readiness} label="Readiness" size={84} /><Gauge value={r.stability} label="Stability" size={84} /></div>
        <div className="space-y-1.5">
          {([['Awareness', r.awareness], ['Communications', r.comms], ['Infrastructure', r.infrastructure]] as const).map(([l, v]) => (
            <div key={l}><div className="flex justify-between text-[10px]"><span className="label">{l}</span><span className={TONE_TEXT[tone(v)]}>{Math.round(v)}</span></div><Bar value={v} height={4} /></div>
          ))}
        </div>
        <div><div className="label mb-1">Readiness trend (72h)</div><Sparkline data={hist} w={320} h={34} /></div>
        <div>
          <div className="label mb-1">Active events</div>
          {events.length === 0 && <div className="text-ops-dim">None.</div>}
          {events.map((e) => (
            <button key={e.id} onClick={() => ui.openEvent(e.id)} className="mb-1 flex w-full items-center gap-2 rounded border border-ops-line px-2 py-1 text-left hover:border-ops-cyan/50">
              <Chip t={SEV_TONE[e.severity]}>S{e.severity}</Chip><span className="flex-1 truncate">{e.title}</span><span className="text-[10px] text-ops-dim">{Math.round(e.confidence)}%</span>
            </button>
          ))}
        </div>
        <div>
          <div className="label mb-1">Assigned & covering assets ({assets.length})</div>
          <div className="space-y-0.5">
            {DOMAINS.map((d) => assets.filter((a) => a.domain === d).map((a) => (
              <button key={a.id} onClick={() => ui.openAsset(a.id)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-ops-panel2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(a, s.hour) }} />
                <span className="w-14 shrink-0 text-[10px]" style={{ color: DOMAIN_COLOR[d] }}>{DOMAIN_LABEL[d].toUpperCase()}</span>
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-[10px] tabular-nums text-ops-dim">{Math.round(a.condition)}%</span>
              </button>
            )))}
          </div>
        </div>
        <div>
          <div className="label mb-1">Regional actions</div>
          <div className="space-y-1.5">
            {regional.map((inv) => {
              const err = canAfford(s, inv.credits, inv.personnel, 0);
              const running = s.projects.some((p) => p.investmentId === inv.id && p.region === id);
              return (
                <div key={inv.id} className="rounded border border-ops-line p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white">{inv.label}</span>
                    <button className="btn btn-primary shrink-0" disabled={!!err || running} title={err ?? inv.description} onClick={() => dispatch({ type: 'invest', investmentId: inv.id, region: id })}>
                      {running ? 'Underway' : `${inv.credits} cr`}
                    </button>
                  </div>
                  <div className="text-[10px] text-ops-dim">{inv.description} {inv.hours}h.</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
