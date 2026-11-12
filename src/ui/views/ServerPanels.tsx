// UI for the PostgreSQL persistence service: status chip, server save slots, campaign service record.
import { useState } from 'react';
import { SLOTS, type Slot } from '../../engine';
import type { CampaignDetail } from '../../shared/api';
import { api } from '../../store/remote';
import { store, useStoreVersion } from '../../store/simStore';
import { Chip, Panel, TONE_TEXT, tone } from '../components/ui';
import { useUI } from '../uiState';

const ago = (iso: string | number) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export function ServerStatusChip() {
  useStoreVersion();
  const ui = useUI();
  const sv = store.server;
  if (sv.status === 'online' && !sv.user) {
    return (
      <button className="leading-tight text-left" onClick={() => ui.setAccountOpen(true)} title="Sign in to store campaigns on the server">
        <div className="label">Storage · local</div>
        <span className="chip border-ops-cyan/60 bg-ops-cyan/10 text-ops-cyan">Sign in</span>
      </button>
    );
  }
  const label = sv.status === 'online' ? (sv.syncing ? 'SYNC…' : sv.user!.username) : sv.status === 'offline' ? 'LOCAL ONLY' : 'DB …';
  const title = sv.status === 'online'
    ? `Signed in as ${sv.user!.username}. Campaigns persist to PostgreSQL.${sv.lastSync ? ` Last sync ${ago(sv.lastSync)}.` : ''}`
    : `Persistence server unavailable${sv.error ? ` (${sv.error})` : ''}. Saves stay in this browser.`;
  return (
    <button className="leading-tight text-left" onClick={() => (sv.status === 'online' ? ui.setAccountOpen(true) : ui.setView('campaign'))} title={title}>
      <div className="label">{sv.status === 'online' ? 'Account · DB' : 'Storage'}</div>
      <Chip t={sv.status === 'online' ? 'green' : sv.status === 'offline' ? 'amber' : 'dim'}><span className="max-w-[110px] truncate normal-case">{label}</span></Chip>
    </button>
  );
}

export function ServerSavesPanel({ canSave }: { canSave: boolean }) {
  useStoreVersion();
  const ui = useUI();
  const sv = store.server;
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };
  return (
    <Panel title={sv.user ? `Server Saves · ${sv.user.username}` : 'Server Saves · PostgreSQL'} right={
      <span className="flex items-center gap-1">
        <Chip t={sv.status === 'online' && sv.user ? 'green' : 'amber'}>{sv.status === 'online' ? (sv.user ? 'signed in' : 'signed out') : sv.status}</Chip>
        <button className="btn px-1.5" onClick={() => run('refresh', () => store.refreshServer())} disabled={busy === 'refresh'} aria-label="Refresh server status">⟳</button>
      </span>
    }>
      {sv.status !== 'online' ? (
        <div className="space-y-1 text-[11px] text-ops-dim">
          <p>The persistence server is not reachable{sv.error ? ` (${sv.error})` : ''}. Browser saves still work.</p>
          <p>Start it with <code className="text-ops-cyan">npm run dev:full</code>, or <code className="text-ops-cyan">npm run db:start</code> + <code className="text-ops-cyan">npm run server</code>.</p>
        </div>
      ) : !sv.user ? (
        <div className="space-y-2 text-[11px] text-ops-dim">
          <p>Sign in to keep campaigns on the server and continue them from any browser. Without an account, saves stay on this device.</p>
          <button className="btn btn-primary" onClick={() => ui.setAccountOpen(true)}>Sign in / create account</button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {SLOTS.map((slot) => {
            const m = sv.saves.find((x) => x.slot === slot);
            return (
              <div key={slot} className="flex items-center gap-1 rounded border border-ops-line p-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-white">{slot === 'auto' ? 'Server autosave' : slot.toUpperCase()}</div>
                  <div className="truncate text-[10px] text-ops-dim">{m ? `${m.name} · T+${m.hour}h · ${m.phase} · ${(m.sizeBytes / 1024).toFixed(0)} KB · ${ago(m.savedAt)}` : 'empty'}</div>
                </div>
                {slot !== 'auto' && <button className="btn" disabled={!canSave || !!busy} onClick={() => run(`s${slot}`, () => store.serverSave(slot as Slot))}>{busy === `s${slot}` ? '…' : 'Save'}</button>}
                <button className="btn" disabled={!m || !!busy} onClick={() => run(`l${slot}`, () => store.serverLoad(slot as Slot))}>{busy === `l${slot}` ? '…' : 'Load'}</button>
                <button className="btn px-1.5" disabled={!m || !!busy} onClick={() => run(`d${slot}`, () => store.serverDelete(slot as Slot))} aria-label={`Delete server ${slot}`}>✕</button>
              </div>
            );
          })}
          <p className="text-[10px] text-ops-dim">The server autosave updates every 12 simulated hours and at each phase change.</p>
        </div>
      )}
    </Panel>
  );
}

export function ServiceRecord({ limit }: { limit?: number }) {
  useStoreVersion();
  const sv = store.server;
  const [open, setOpen] = useState<CampaignDetail | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  if (sv.status !== 'online' || !sv.user) return null;
  const rows = limit ? sv.campaigns.slice(0, limit) : sv.campaigns;
  const current = store.state?.campaignId;
  return (
    <Panel title="Service Record · Campaign History" right={<span>{sv.campaigns.length} runs</span>} bodyClass="p-0 overflow-x-auto">
      {rows.length === 0 ? <div className="p-3 text-ops-dim">No campaigns stored yet. Runs appear here after their first server save.</div> : (
        <table className="table-ops w-full min-w-[620px]">
          <thead><tr><th>Operation</th><th>Mode</th><th>Progress</th><th>Score</th><th>Objectives</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={async () => setOpen(open?.id === c.id ? null : await api.getCampaign(c.id).catch(() => null))}>
                <td className="text-white">{c.name}{c.id === current && <span className="ml-1 text-[10px] text-ops-cyan">(current)</span>}</td>
                <td className="uppercase">{c.mode}</td>
                <td>{c.status === 'complete' ? <Chip t="green">complete</Chip> : <span>P{c.phaseIndex + 1}/{c.phaseCount} · T+{c.hour}h</span>}</td>
                <td className={c.score !== null ? TONE_TEXT[tone(c.score)] : ''}>{c.score !== null ? `${c.score.toFixed(1)} ${c.grade}` : '—'}{c.status !== 'complete' && c.score !== null && <span className="text-[10px] text-ops-dim"> proj.</span>}</td>
                <td>{c.objectivesMet}/{c.objectivesTotal}</td>
                <td className="text-ops-dim">{ago(c.updatedAt)}</td>
                <td className="text-right" onClick={(e) => e.stopPropagation()}>
                  {confirmDel === c.id ? (
                    <span className="whitespace-nowrap"><button className="btn btn-danger" onClick={() => { void store.deleteCampaign(c.id); setConfirmDel(null); }}>Delete record + saves</button> <button className="btn" onClick={() => setConfirmDel(null)}>Keep</button></span>
                  ) : <button className="btn px-1.5" onClick={() => setConfirmDel(c.id)} aria-label={`Delete ${c.name}`}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && (
        <div className="border-t border-ops-line p-3 text-[11px]">
          <div className="mb-1 font-semibold text-white">{open.name} — phase results</div>
          {open.phaseResults.length === 0 && <div className="text-ops-dim">No phases completed yet.</div>}
          {open.phaseResults.map((r) => <div key={r.objectiveId}><span className={r.met ? 'text-ops-green' : 'text-ops-red'}>{r.met ? '✔' : '✘'}</span> P{r.phase} {r.text} <span className="text-ops-dim">({Math.round(r.value)})</span></div>)}
          {open.scoreComponents && (
            <div className="mt-2 flex flex-wrap gap-x-4 text-ops-dim">{Object.entries(open.scoreComponents).map(([k, v]) => <span key={k}>{k} <span className={TONE_TEXT[tone(v)]}>{Math.round(v)}</span></span>)}</div>
          )}
          <div className="mt-1 text-ops-dim">Seed {open.seed} · started {new Date(open.createdAt).toLocaleString()}{open.slots.length ? ` · in server slots: ${open.slots.join(', ')}` : ''}</div>
        </div>
      )}
    </Panel>
  );
}
