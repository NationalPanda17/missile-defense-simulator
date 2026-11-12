import {
  DOMAINS, REGION_IDS, SCORE_WEIGHTS, TEMPLATE_MAP, computeScore, isActive, lessonsLearned, type CommandEntry, type SimState,
} from '../../engine';
import { Bar, Chip, DOMAIN_COLOR, DOMAIN_LABEL, LineChart, Panel, Stat, TONE_TEXT, tone } from '../components/ui';
import { useUI } from '../uiState';

const LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  readiness: 'Global readiness', network: 'Network reliability', stability: 'Regional stability', response: 'Event response',
  infrastructure: 'Infrastructure preservation', efficiency: 'Resource efficiency', information: 'Information quality', recovery: 'Recovery performance',
};

function verdict(s: SimState, c: CommandEntry): { tone: 'green' | 'red' | 'dim' | 'amber'; text: string } {
  const e = c.eventId ? s.events.find((x) => x.id === c.eventId) : undefined;
  if (c.kind === 'respond' && e) {
    if (!e.isGenuine && e.status !== 'responding') return { tone: 'red', text: 'Spent on a spurious report' };
    if (e.status === 'resolved') return { tone: 'green', text: 'Resolved the event' };
    if (e.status === 'escalated') return { tone: 'red', text: 'Event still escalated' };
    return { tone: 'dim', text: 'In progress' };
  }
  if (c.kind === 'dismiss' && e) return e.isGenuine ? { tone: 'red', text: 'Dismissed a genuine event' } : { tone: 'green', text: 'Correctly dismissed' };
  if (c.kind === 'confirm' && e) return e.isGenuine ? { tone: 'green', text: 'Confirmed genuine' } : e.status === 'expired' ? { tone: 'green', text: 'Exposed spurious report' } : { tone: 'dim', text: 'Pending' };
  if (c.kind === 'monitor' && e) return e.status === 'escalated' ? { tone: 'amber', text: 'Delayed action; escalated' } : { tone: 'dim', text: 'Bought time' };
  if (c.kind === 'invest') return { tone: 'green', text: 'Long-term investment' };
  if (c.kind === 'maintain') return { tone: 'green', text: 'Preventive upkeep' };
  return { tone: 'dim', text: '' };
}

export function AARView({ s }: { s: SimState }) {
  const ui = useUI();
  const score = computeScore(s);
  const lessons = lessonsLearned(s);
  const final = s.status === 'complete';
  const major = s.events.filter((e) => e.reportedAt <= s.hour && (e.severity >= 3 || e.status === 'escalated' || e.global));
  const unresolved = s.events.filter((e) => (isActive(e) && e.reportedAt <= s.hour) || e.hiddenLive);
  const degraded = s.assets.filter((a) => a.status === 'offline' || a.status === 'degraded');
  const decisions = s.commands.filter((c) => c.category !== 'control');
  const spendTotal = Object.values(s.spendByCategory).reduce((a, b) => a + b, 0);
  const first = s.history[0];

  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-3" title={final ? 'After-Action Review · Final Report' : 'After-Action Review · Interim Report'} right={<button className="btn" onClick={() => window.print()}>Print</button>}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="text-center">
            <div className="label">Final score</div>
            <div className="font-sans text-6xl font-bold leading-none text-ops-cyan">{score.total.toFixed(1)}</div>
            <div className="font-sans text-2xl font-bold text-white">GRADE {score.grade}</div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
            {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
              <div key={k}>
                <div className="flex justify-between text-[10px]"><span className="label">{LABELS[k]} · {Math.round(SCORE_WEIGHTS[k] * 100)}%</span><span className={TONE_TEXT[tone(score.components[k])]}>{Math.round(score.components[k])}</span></div>
                <Bar value={score.components[k]} height={5} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Duration" value={`${s.hour}h`} />
            <Stat label="Objective bonus" value={`+${score.objectiveBonus}`} t="green" />
            <Stat label="Resolved" value={s.counters.resolved} t="green" />
            <Stat label="Escalated" value={s.counters.escalations} t={s.counters.escalations > 3 ? 'red' : 'amber'} />
          </div>
        </div>
        {!final && <p className="mt-2 text-[10px] text-ops-dim">Interim report — the scenario is still running. A final report is produced when the last phase ends.</p>}
      </Panel>

      <Panel className="xl:col-span-2" title="Readiness, Network & Stability">
        <LineChart series={[
          { name: 'Readiness', color: '#34d399', data: s.history.map((h) => h.readiness) },
          { name: 'Network', color: '#38d6f5', data: s.history.map((h) => h.network) },
          { name: 'Stability', color: '#f5b13d', data: s.history.map((h) => h.stability) },
          { name: 'Info quality', color: '#a78bfa', data: s.history.map((h) => h.infoQuality) },
        ]} height={170} />
      </Panel>
      <Panel title="Lessons Learned">
        <ul className="space-y-2">
          {lessons.map((l, i) => (
            <li key={i} className="flex gap-2 text-[11px] leading-relaxed"><span className={l.tone === 'good' ? 'text-ops-green' : l.tone === 'poor' ? 'text-ops-red' : 'text-ops-dim'}>{l.tone === 'good' ? '▲' : l.tone === 'poor' ? '▼' : '■'}</span><span>{l.text}</span></li>
          ))}
        </ul>
      </Panel>

      <Panel className="xl:col-span-2" title="Domain Performance">
        <LineChart series={DOMAINS.map((d) => ({ name: DOMAIN_LABEL[d], color: DOMAIN_COLOR[d], data: s.history.map((h) => h.domains[d]) }))} height={150} />
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
          {DOMAINS.map((d) => {
            const avg = s.history.length ? s.history.reduce((x, h) => x + h.domains[d], 0) / s.history.length : 0;
            return <Stat key={d} label={`${DOMAIN_LABEL[d]} avg`} value={Math.round(avg)} t={tone(avg)} sub={`now ${Math.round(s.metrics.domainEffective[d])}`} />;
          })}
        </div>
      </Panel>
      <Panel title="Regional Performance" bodyClass="p-0">
        <table className="table-ops w-full">
          <thead><tr><th>Region</th><th>Avg rdy</th><th>Stab</th><th>Infra</th><th>Events</th></tr></thead>
          <tbody>
            {REGION_IDS.map((id) => {
              const avg = s.history.length ? s.history.reduce((x, h) => x + h.regions[id], 0) / s.history.length : 0;
              const r = s.regions[id];
              const n = s.events.filter((e) => e.region === id && e.isGenuine).length;
              return <tr key={id}><td className="text-white">{r.short}</td><td className={TONE_TEXT[tone(avg)]}>{Math.round(avg)}</td><td className={TONE_TEXT[tone(r.stability)]}>{Math.round(r.stability)}</td><td className={TONE_TEXT[tone(r.infrastructure)]}>{Math.round(r.infrastructure)}{first ? '' : ''}</td><td>{n}</td></tr>;
            })}
          </tbody>
        </table>
      </Panel>

      <Panel className="xl:col-span-2" title="Major Events — Chronological" bodyClass="p-0 max-h-80 overflow-y-auto">
        <table className="table-ops w-full">
          <tbody>
            {major.map((e) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => ui.openEvent(e.id)}>
                <td className="w-16 text-ops-dim">T+{e.reportedAt}h</td>
                <td><Chip t={e.severity >= 3 ? 'red' : 'amber'}>S{e.severity}</Chip></td>
                <td className="text-white">{e.title}</td>
                <td>{e.global ? 'GLOBAL' : e.region}</td>
                <td className={e.status === 'resolved' ? 'text-ops-green' : e.status === 'escalated' ? 'text-ops-red' : 'text-ops-dim'}>{e.status.toUpperCase()}{e.resolvedAt !== undefined ? ` T+${e.resolvedAt}h` : ''}</td>
                <td className="text-[10px] text-ops-dim">{e.isGenuine ? '' : 'spurious'}</td>
              </tr>
            ))}
            {!major.length && <tr><td className="text-ops-dim">No major events recorded.</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title="Resource Expenditure">
        {(Object.keys(s.spendByCategory) as (keyof typeof s.spendByCategory)[]).map((k) => (
          <div key={k} className="mb-1.5"><div className="flex justify-between text-[11px]"><span className="capitalize">{k}</span><span>{Math.round(s.spendByCategory[k])} cr</span></div><Bar value={spendTotal ? (s.spendByCategory[k] / spendTotal) * 100 : 0} color="#a78bfa" height={4} /></div>
        ))}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Stat label="Total spent" value={Math.round(spendTotal)} />
          <Stat label="Wasted" value={Math.round(s.counters.wastedCredits)} t={s.counters.wastedCredits > 0 ? 'red' : 'green'} />
          <Stat label="Reserve" value={Math.round(s.credits)} />
          <Stat label="Failed responses" value={s.counters.failedResponses} t={s.counters.failedResponses ? 'amber' : 'green'} />
        </div>
      </Panel>

      <Panel className="xl:col-span-2" title="Decisions Made" bodyClass="p-0 max-h-80 overflow-y-auto">
        <table className="table-ops w-full">
          <thead><tr><th>Time</th><th>Decision</th><th>Cost</th><th>Assessment</th></tr></thead>
          <tbody>
            {[...decisions].reverse().map((c, i) => {
              const v = verdict(s, c);
              return <tr key={i}><td className="w-16 text-ops-dim">T+{c.t}h</td><td>{c.text}</td><td className="text-right tabular-nums">{c.credits || ''}</td><td className={TONE_TEXT[v.tone]}>{v.text}</td></tr>;
            })}
            {!decisions.length && <tr><td colSpan={4} className="text-ops-dim">No decisions recorded.</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title="Unresolved Issues & Recovery">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Stat label="Lowest readiness" value={Math.round(s.minReadiness === 100 ? s.metrics.globalReadiness : s.minReadiness)} t="amber" />
          <Stat label="Current readiness" value={Math.round(s.metrics.globalReadiness)} t={tone(s.metrics.globalReadiness)} sub={`baseline ${Math.round(s.baseline.readiness)}`} />
        </div>
        <div className="label mb-1">Open events ({unresolved.length})</div>
        {unresolved.slice(0, 8).map((e) => <div key={e.id} className="text-[11px]"><button className="text-ops-amber hover:underline" onClick={() => ui.openEvent(e.id)}>{e.id}</button> {e.title} <span className="text-ops-dim">{TEMPLATE_MAP.get(e.templateId)?.category}</span></div>)}
        {!unresolved.length && <div className="text-ops-dim">None.</div>}
        <div className="label mb-1 mt-2">Degraded / offline assets ({degraded.length})</div>
        {degraded.slice(0, 8).map((a) => <div key={a.id} className="text-[11px]"><button className="text-white hover:underline" onClick={() => ui.openAsset(a.id)}>{a.name}</button> <span className="text-ops-dim">{Math.round(a.condition)}%</span></div>)}
        {!degraded.length && <div className="text-ops-dim">None.</div>}
      </Panel>
    </div>
  );
}
