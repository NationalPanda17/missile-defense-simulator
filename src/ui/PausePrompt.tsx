// When the game pauses itself (a launch warning, a report about to escalate, a new report), say why and offer what
// the commander can do right now. The same actions appear in the Tactical Theater whenever a wave is inbound.
import { useSyncExternalStore } from 'react';
import {
  EQUIPMENT_MAP, alertActive, alertCost, isActive, isEffector, isUnlimited, resupplyCost, type PauseReason, type RegionId, type SimState,
} from '../engine';
import { dispatch, store } from '../store/simStore';
import { useUI, type ViewId } from './uiState';

const version = () => store.getVersion();

/** One-click options before a wave arrives: raise an alert, resupply, move a system, settle uncertain reports. */
export function WaveActions({ s, region, compact }: { s: SimState; region: RegionId; compact?: boolean }) {
  const ui = useUI();
  const t = s.tactical;
  if (!t) return null;
  const deps = t.deployments.filter((d) => d.region === region && !d.transit);
  const alertOn = alertActive(s, region);
  const aCost = alertCost(s, region);
  const low = deps.filter((d) => {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    return isEffector(spec) && !isUnlimited(spec) && d.reloadRemaining === undefined && d.stock < spec.magazine;
  });
  const rCost = low.reduce((a, d) => a + resupplyCost(d), 0);
  const unsure = s.events.filter((e) => isActive(e) && e.reportedAt <= s.hour && e.status === 'reported' && e.confidence < 55);
  const go = (view: ViewId) => { if (view === 'theater') ui.setTheaterFocus(region); ui.setView(view); };
  const running = s.status === 'running';
  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? '' : 'pt-1'}`}>
      <button className="btn" disabled={!running || alertOn || !deps.length || s.credits < aCost}
        title={!deps.length ? 'Nothing deployed there to put on alert' : 'Faster reactions and better detection for 8h'}
        onClick={() => dispatch({ type: 'raiseAlert', region })}>
        {alertOn ? '✓ Alert raised' : `Raise alert (${aCost} cr)`}
      </button>
      <button className="btn" disabled={!low.length || s.credits < rCost} title={low.length ? low.map((d) => EQUIPMENT_MAP.get(d.equipmentId)!.name).join(', ') : 'Every magazine there is full or reloading'}
        onClick={() => { for (const d of low) dispatch({ type: 'resupply', deploymentId: d.id }); }}>
        {low.length ? `Resupply ${low.length} (${rCost} cr)` : 'Magazines full'}
      </button>
      <button className="btn" onClick={() => go('theater')} title="Move a system there with an emergency redeploy (out of action while it moves)">Move a system…</button>
      {unsure.length > 0 && <button className="btn" onClick={() => go('intel')}>Review {unsure.length} uncertain report{unsure.length === 1 ? '' : 's'}</button>}
    </div>
  );
}

const KIND_LABEL: Record<PauseReason['kind'], string> = { launch: 'launch warnings', deadline: 'reports about to escalate', report: 'every new report' };

export function PausePrompt({ s }: { s: SimState }) {
  useSyncExternalStore(store.subscribe, version);
  const ui = useUI();
  const reasons = store.pausePrompt;
  if (!reasons?.length || s.status !== 'running') return null;
  const first = reasons[0];
  const pacing = store.autoPause();
  const resume = () => { store.dismissPausePrompt(); if (!s.turnBased) dispatch({ type: 'setPaused', paused: false }); };
  const stopFor = (kind: PauseReason['kind'], on: boolean) => { if (pacing) store.setPacing({ ...pacing, [kind]: on }); };
  return (
    <div className="fixed inset-x-2 top-16 z-[56] mx-auto max-w-xl rounded border border-ops-amber/60 bg-ops-panel p-3 shadow-2xl sm:top-20" role="alertdialog" aria-label="Paused: your decision">
      {/* Continue sits in the same place on every prompt; Enter or Space presses it. */}
      <div className="flex items-start justify-between gap-2">
        <div className="label pt-1 text-ops-amber">Paused · {first.kind === 'launch' ? 'incoming wave' : first.kind === 'deadline' ? 'decision needed' : 'new report'}</div>
        <span className="flex shrink-0 gap-1.5">
          <button className="btn" onClick={() => store.dismissPausePrompt()} title="Close this and stay paused">Stay paused</button>
          <button className="btn btn-primary" autoFocus onClick={resume} title="Enter or Space">Continue ▶</button>
        </span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[12px] text-white">
        {reasons.slice(0, 4).map((r, i) => <li key={i}>{r.text}</li>)}
        {reasons.length > 4 && <li className="text-ops-dim">+{reasons.length - 4} more</li>}
      </ul>
      {first.kind === 'launch' && first.region && (
        <div className="mt-2">
          <div className="label">What you can do now</div>
          <WaveActions s={s} region={first.region} />
        </div>
      )}
      {first.kind !== 'launch' && first.eventId && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button className="btn btn-primary" onClick={() => { ui.openEvent(first.eventId!); store.dismissPausePrompt(); }}>Open the report</button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ops-dim">
        {pacing && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={pacing[first.kind]} onChange={(e) => stopFor(first.kind, e.target.checked)} />
            Pause for {KIND_LABEL[first.kind]}
          </label>
        )}
        {pacing && (pacing.deadline || pacing.report) && (
          <button className="underline hover:text-white" onClick={() => store.setPacing({ launch: true, deadline: false, report: false })}>Pause only for waves</button>
        )}
      </div>
    </div>
  );
}

/** Auto-pause choices, for the settings panel. */
export function PacingSettings() {
  useSyncExternalStore(store.subscribe, version);
  const cur = store.autoPause() ?? store.pacing ?? { launch: true, deadline: true, report: false };
  const row = (kind: PauseReason['kind'], label: string) => (
    <label key={kind} className="flex items-center justify-between gap-2">
      <span className="text-white">{label}</span>
      <input type="checkbox" checked={cur[kind]} onChange={(e) => store.setPacing({ ...cur, [kind]: e.target.checked })} />
    </label>
  );
  return (
    <div className="space-y-1.5 text-[11px]">
      {row('launch', 'Pause for launch warnings')}
      {row('deadline', 'Pause before a report escalates')}
      {row('report', 'Pause for every new report')}
      <div className="flex flex-wrap gap-1">
        <button className="btn px-1.5 py-0 text-[10px]" onClick={() => store.setPacing({ launch: true, deadline: false, report: false })}>Waves only</button>
        <button className="btn px-1.5 py-0 text-[10px]" onClick={() => store.setPacing({ launch: true, deadline: true, report: true })}>Everything</button>
        <button className="btn px-1.5 py-0 text-[10px]" onClick={() => store.setPacing({ launch: false, deadline: false, report: false })}>Never</button>
      </div>
      <p className="text-[10px] text-ops-dim">Report and escalation pauses come at most once every 6 sim hours, batched together.</p>
      <p className="text-[10px] text-ops-dim">
        {store.pacing ? <>Your choice, for every difficulty. <button className="underline" onClick={() => store.setPacing(null)}>Use the defaults</button></>
          : 'Defaults for the difficulty: launch warnings always pause; Recruit also stops for every report, Officer for reports about to escalate.'}
      </p>
    </div>
  );
}
