import { useRef, useState } from 'react';
import {
  DOMAINS, REGION_IDS, SLOTS, autosaveSlot, isAutosaveSlot, slotLabel, computeScore, defaultSettings, deleteSave, exportJSON, importJSON, listSaves, loadGame,
  objectiveProgress, objectiveValue, saveGame, type Domain, type RegionId, type ScenarioSettings, type SimState, type Slot,
} from '../../engine';
import { store, useStoreVersion } from '../../store/simStore';
import { Bar, Chip, OBJECTIVE_LOOK, DOMAIN_LABEL, Panel, Stat, ConfirmDelete } from '../components/ui';
import { useUI } from '../uiState';
import { ServerSavesPanel, ServiceRecord } from './ServerPanels';

const ACH: Record<string, string> = {
  resolver: 'Crisis Manager — resolve 10 events', skeptic: 'Healthy Skepticism — expose 3 spurious reports',
  backbone: 'Iron Backbone — network health 90%+', wrench: 'Preventive Mindset — 10 maintenance cycles',
  modern: 'Future Force — two modernization tranches', clean48: 'Clean Watch — 48h with zero escalations',
};

export function CampaignView({ s }: { s: SimState }) {
  useStoreVersion();
  const ui = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const phase = s.phases[s.phaseIndex];
  const score = computeScore(s);
  const saves = listSaves();
  const download = () => {
    const blob = new Blob([exportJSON(s)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mds-${s.settings.mode}-T${s.hour}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel className="xl:col-span-2" title="Campaign Status">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="label">{s.settings.mode} · {s.settings.name}</div>
            <div className="font-sans text-2xl font-semibold text-white">Phase {phase.id}: {phase.name}</div>
            <div className="text-ops-dim">{s.status === 'complete' ? 'Scenario complete' : `${Math.max(0, phase.hours - (s.hour - s.phaseStartHour))}h remaining in phase`}</div>
          </div>
          <div className="text-right"><div className="label">Projected score</div><div className="font-sans text-3xl font-bold text-ops-cyan">{score.total.toFixed(1)} <span className="text-lg text-white">{score.grade}</span></div></div>
        </div>
        <div className="label mb-1">Current objectives (evaluated at phase end)</div>
        <div className="space-y-2">
          {phase.objectives.map((o) => {
            const v = objectiveValue(s, o.metric);
            const look = OBJECTIVE_LOOK[objectiveProgress(s, o)];
            return (
              <div key={o.id} className="rounded border border-ops-line p-2" title={look.title}>
                <div className="flex justify-between gap-2"><span className={look.cls}>{look.icon} {o.text}</span><span className="shrink-0 text-ops-dim">{Math.round(v)} / {o.target}{o.reward ? ` · +${o.reward} cr` : ''}</span></div>
                {o.metric !== 'escalationsMax' && <div className="mt-1"><Bar value={Math.min(v, o.target)} max={o.target} height={4} color={look.bar} /></div>}
              </div>
            );
          })}
        </div>
        <div className="label mb-1 mt-4">Phases</div>
        <div className="grid gap-2 md:grid-cols-4">
          {s.phases.map((p, i) => (
            <div key={p.id} className={`rounded border p-2 ${i === s.phaseIndex && s.status !== 'complete' ? 'border-ops-cyan/60 bg-ops-cyan/5' : 'border-ops-line'}`}>
              <div className="text-white">P{p.id} {p.name}</div>
              <div className="text-[10px] text-ops-dim">{p.hours}h · events {+(p.eventRate * s.settings.eventFrequency).toFixed(2)}/h · max severity {p.maxSeverity}</div>
              <div className="mt-1 flex flex-wrap gap-1">{p.delayedInfo && <Chip t="amber">Delays</Chip>}{p.conflicting && <Chip t="amber">Conflicts</Chip>}{p.chains && <Chip>Chains</Chip>}</div>
              <div className="mt-1 text-[10px]">
                {s.objectiveResults.filter((r) => r.phase === p.id).map((r) => <div key={r.objectiveId} className={r.met ? 'text-ops-green' : 'text-ops-red'}>{r.met ? '✔' : '✘'} {r.text}</div>)}
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <div className="flex flex-col gap-2">
        <Panel title="Browser Saves · This Device">
          <div className="space-y-1.5">
            {SLOTS.map((slot) => {
              const m = saves.find((x) => x.slot === slot);
              return (
                <div key={slot} className="flex items-center gap-1 rounded border border-ops-line p-1.5">
                  <div className="min-w-0 flex-1"><div className="text-white">{slotLabel(slot)}</div><div className="truncate text-[10px] text-ops-dim">{m ? `${m.name} · T+${m.hour}h · ${new Date(m.savedAt).toLocaleTimeString()}` : 'empty'}</div></div>
                  {!isAutosaveSlot(slot) && <button className="btn" onClick={() => { saveGame(s, slot); store.toast('ok', `Saved to ${slot}`); store.notify(); }}>Save</button>}
                  <button className="btn" disabled={!m} onClick={() => { const st = loadGame(slot as Slot); if (st) { store.load(st); store.toast('ok', `Loaded ${slot}`); } }}>Load</button>
                  {m && <ConfirmDelete className="px-1.5" label={`Delete ${slotLabel(slot)}`} onConfirm={() => { deleteSave(slot); store.toast('info', `${slotLabel(slot)} deleted.`); store.notify(); }} />}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <button className="btn" onClick={download}>Export JSON</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const st = importJSON(await f.text());
              if (st) { store.load(st); store.toast('ok', 'Save imported'); } else store.toast('err', 'Invalid save file');
              e.target.value = '';
            }} />
          </div>
        </Panel>
        <ServerSavesPanel canSave />
        <Panel title="Scenario Control">
          <div className="flex flex-wrap gap-1">
            {!confirmReset ? <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Reset scenario</button> : (
              <>
                <span className="w-full text-[11px] text-ops-amber">Restart this scenario with the same settings and seed? Unsaved progress is lost.</span>
                <button className="btn btn-danger" onClick={() => { store.newGame({ ...s.settings }); setConfirmReset(false); ui.setView('global'); }}>Confirm reset</button>
                <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
              </>
            )}
            <button className="btn" onClick={() => { store.newGame(defaultSettings(s.settings.mode === 'sandbox' ? 'campaign' : s.settings.mode)); ui.setView('global'); }}>New randomized run</button>
            <button className="btn" onClick={() => { saveGame(s, autosaveSlot(s)); store.quit(); }}>Main menu</button>
          </div>
        </Panel>
        <Panel title="Achievements" right={<span>{s.achievements.length}/{Object.keys(ACH).length}</span>}>
          {Object.entries(ACH).map(([id, t]) => <div key={id} className={`text-[11px] ${s.achievements.includes(id) ? 'text-ops-green' : 'text-ops-dim'}`}>{s.achievements.includes(id) ? '★' : '☆'} {t}</div>)}
        </Panel>
      </div>
      <div className="xl:col-span-3"><ServiceRecord /></div>
    </div>
  );
}

export function ScenarioEditor({ s, onLaunched }: { s: SimState | null; onLaunched?: () => void }) {
  const [cfg, setCfg] = useState<ScenarioSettings>(() => ({ ...defaultSettings('sandbox'), seed: Math.floor(Math.random() * 1e6), waves: true }));
  const set = <K extends keyof ScenarioSettings>(k: K, v: ScenarioSettings[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const num = (label: string, k: 'startCredits' | 'startPersonnel' | 'crews' | 'durationHours' | 'seed', min: number, max: number, step = 1) => (
    <label className="block">
      <div className="label mb-0.5 flex justify-between"><span>{label}</span><span className="text-white">{cfg[k]}</span></div>
      <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} className="w-full accent-cyan-400" />
    </label>
  );
  const launch = () => {
    store.newGame({ ...cfg, mode: 'sandbox' });
    onLaunched?.();
  };
  return (
    <div className="grid gap-2 xl:grid-cols-3">
      <Panel title="Scenario Editor · Sandbox" className="xl:col-span-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1"><div className="label mb-0.5">Scenario name</div><input className="input w-full" value={cfg.name} onChange={(e) => set('name', e.target.value)} /></label>
          <button className="btn" onClick={() => setCfg({ ...defaultSettings('crisis'), mode: 'sandbox', name: 'Sandbox: Crisis Preset', seed: cfg.seed, waves: true })} title="Crisis conditions, with threat waves">Crisis preset · waves on</button>
          <button className="btn" onClick={() => setCfg({ ...defaultSettings('sandbox'), seed: cfg.seed, waves: true })} title="Default conditions, with threat waves">Defaults · waves on</button>
          <button className="btn btn-primary px-5 py-2" onClick={launch}>Launch simulation ▶</button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={cfg.waves === true} onChange={(e) => set('waves', e.target.checked)} />
          <span className="text-white">Threat waves</span>
          <span className="text-ops-dim">
            {cfg.waves ? `On: the briefing has a Deploy defenses step, and about ${Math.max(1, Math.round(3 * cfg.durationHours / 72))} waves strike over ${cfg.durationHours}h.` : 'Off: network management only, no attacks and no defenses to place.'}
          </span>
        </label>
        {s && <p className="mt-2 text-[10px] text-ops-amber">Launching replaces the current scenario. Save first from Campaign Management if you want to keep it.</p>}
      </Panel>
      <Panel title="Resources & Tempo">
        <div className="space-y-3">
          {num('Starting credits', 'startCredits', 200, 4000, 50)}
          {num('Starting personnel', 'startPersonnel', 20, 100)}
          {num('Maintenance crews', 'crews', 1, 8)}
          {num('Duration (hours)', 'durationHours', 24, 480, 12)}
          <label className="block"><div className="label mb-0.5 flex justify-between"><span>Event frequency</span><span className="text-white">x{cfg.eventFrequency.toFixed(1)}</span></div>
            <input type="range" min={0.2} max={3} step={0.1} value={cfg.eventFrequency} onChange={(e) => set('eventFrequency', Number(e.target.value))} className="w-full accent-cyan-400" /></label>
          <label className="block"><div className="label mb-0.5 flex justify-between"><span>Spurious report rate</span><span className="text-white">{Math.round(cfg.falseReportRate * 100)}%</span></div>
            <input type="range" min={0} max={0.6} step={0.02} value={cfg.falseReportRate} onChange={(e) => set('falseReportRate', Number(e.target.value))} className="w-full accent-cyan-400" /></label>
          {num('Random seed', 'seed', 0, 999999)}
        </div>
      </Panel>
      <Panel title="Regional Conditions">
        <div className="overflow-x-auto">
        <table className="table-ops w-full">
          <thead><tr><th>Region</th><th title="Stability">Stab.</th><th title="Infrastructure">Infra.</th></tr></thead>
          <tbody>
            {REGION_IDS.map((id) => (
              <tr key={id}><td>{id}</td>
                {(['regionStability', 'regionInfrastructure'] as const).map((k) => (
                  <td key={k} className="whitespace-nowrap"><input type="range" min={20} max={100} value={cfg[k][id] ?? 75} aria-label={`${id} ${k === 'regionStability' ? 'stability' : 'infrastructure'}`}
                    onChange={(e) => set(k, { ...cfg[k], [id]: Number(e.target.value) } as Partial<Record<RegionId, number>>)} className="w-16 accent-cyan-400 align-middle" />
                    <span className="ml-1 inline-block w-6 text-right tabular-nums">{cfg[k][id] ?? 75}</span></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
      <Panel title="Domain Readiness (starting condition)">
        <div className="space-y-3">
          {DOMAINS.map((d: Domain) => (
            <label key={d} className="block"><div className="label mb-0.5 flex justify-between"><span>{DOMAIN_LABEL[d]}</span><span className="text-white">{cfg.domainCondition[d] ?? 84}%</span></div>
              <input type="range" min={30} max={100} value={cfg.domainCondition[d] ?? 84} onChange={(e) => set('domainCondition', { ...cfg.domainCondition, [d]: Number(e.target.value) })} className="w-full accent-cyan-400" /></label>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2"><Stat label="Mode" value="SANDBOX" /><Stat label="All event types" value="ON" t="green" /></div>
      </Panel>
    </div>
  );
}
