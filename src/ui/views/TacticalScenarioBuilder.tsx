// Tactical scenario picker (campaign start) and builder: presets, sliders, preview, export and import.
import { useRef, useState } from 'react';
import {
  TACTICAL_CONFIG, TACTICAL_LIMITS, TACTICAL_PRESETS, THREAT_CLASSES, THREAT_LABELS, exportTacticalScenario,
  importTacticalScenario, normalizeTactical, standardTactical, type TacticalSettings, type ThreatClass,
} from '../../engine';
import { store } from '../../store/simStore';
import { Modal } from '../components/ui';

const STORE_KEY = 'mds.tacticalScenario';

export interface ChosenScenario { name: string; tactical: TacticalSettings }

/** The last scenario this browser used, or Standard. Browser storage is a convenience only. */
export function loadChosenScenario(): ChosenScenario {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const x = JSON.parse(raw) as ChosenScenario;
      return { name: String(x.name ?? 'Custom scenario').slice(0, 80), tactical: normalizeTactical(x.tactical) };
    }
  } catch { /* fall through */ }
  return { name: 'Standard', tactical: standardTactical() };
}

export function saveChosenScenario(c: ChosenScenario) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/** Expected waves and threats per campaign phase under a scenario (before surprises and decoys). */
export function scenarioPreview(t: TacticalSettings) {
  return TACTICAL_CONFIG.waves.map((p, i) => {
    const waves = Math.max(1, Math.round(p.count * t.waveCount));
    const lo = Math.max(1, Math.round(p.tracks[0] * t.waveSize));
    const hi = Math.max(1, Math.round(p.tracks[1] * t.waveSize));
    const weights = THREAT_CLASSES.map((c) => p.mix[c] * t.mix[c]);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const top = THREAT_CLASSES.map((c, k) => ({ c, share: weights[k] / total })).sort((a, b) => b.share - a.share).filter((x) => x.share > 0.15);
    return { phase: i + 1, waves, threats: Math.round(waves * (lo + hi) / 2), top };
  });
}

function Slider({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="label mb-0.5 flex justify-between"><span>{label}</span><span className="text-white">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-cyan-400" />
    </label>
  );
}

export function TacticalScenarioBuilder({ initial, onUse, onClose }: { initial: ChosenScenario; onUse: (c: ChosenScenario) => void; onClose: () => void }) {
  const [name, setName] = useState(initial.name);
  const [t, setT] = useState<TacticalSettings>(initial.tactical);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof TacticalSettings>(k: K, v: TacticalSettings[K]) => setT((x) => ({ ...x, [k]: v, preset: 'custom' }));
  const setMix = (c: ThreatClass, v: number) => setT((x) => ({ ...x, mix: { ...x.mix, [c]: v }, preset: 'custom' }));
  const mult = (v: number) => `×${+v.toFixed(2)}`;
  const L = TACTICAL_LIMITS;

  const download = () => {
    const blob = new Blob([exportTacticalScenario(name, t)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mds-tactical-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Modal wide title="TACTICAL SCENARIO BUILDER" onClose={onClose}
      footer={<>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import…</button>
        <button className="btn" onClick={download}>Export</button>
        <button className="btn btn-primary px-5" onClick={() => onUse({ name: name.trim() || 'Custom scenario', tactical: normalizeTactical(t) })}>Use this scenario</button>
      </>}>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const r = importTacticalScenario(await f.text());
        if (!r) { store.toast('err', 'Not a tactical scenario file (or an unsupported version).'); return; }
        setName(r.name);
        setT(r.tactical);
        store.toast('ok', `Imported "${r.name}"`);
      }} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[12rem] flex-1"><div className="label mb-0.5">Scenario name</div>
            <input className="input w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <div className="flex flex-wrap gap-1">
            {TACTICAL_PRESETS.map((p) => (
              <button key={p.id} className={`btn ${t.preset === p.id ? 'btn-active' : ''}`} title={p.description}
                onClick={() => { setT(p.settings); setName(p.name); }}>{p.name}</button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-ops-dim">
          {TACTICAL_PRESETS.find((p) => p.id === t.preset)?.description ?? 'Custom scenario. Presets and imported files are a starting point; every value can be changed.'}
          {' '}All scenarios are fictional.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3">
            <div className="label text-ops-cyan">Tempo</div>
            <Slider label="Waves per phase" value={t.waveCount} min={L.waveCount[0]} max={L.waveCount[1]} step={0.25} fmt={mult} onChange={(v) => set('waveCount', v)} />
            <Slider label="Threats per wave" value={t.waveSize} min={L.waveSize[0]} max={L.waveSize[1]} step={0.1} fmt={mult} onChange={(v) => set('waveSize', v)} />
            <Slider label="False tracks" value={t.decoys} min={L.decoys[0]} max={L.decoys[1]} step={0.25} fmt={mult} onChange={(v) => set('decoys', v)} />
          </div>
          <div className="space-y-3">
            <div className="label text-ops-cyan">Threat mix</div>
            {THREAT_CLASSES.map((c) => (
              <Slider key={c} label={THREAT_LABELS[c]} value={t.mix[c]} min={L.mix[0]} max={L.mix[1]} step={0.1} fmt={(v) => (v === 0 ? 'none' : mult(v))} onChange={(v) => setMix(c, v)} />
            ))}
          </div>
          <div className="space-y-3">
            <div className="label text-ops-cyan">Intelligence & budget</div>
            <Slider label="Forecast regions" value={t.forecastRegions} min={L.forecastRegions[0]} max={L.forecastRegions[1]} step={1} fmt={(v) => String(v)} onChange={(v) => set('forecastRegions', v)} />
            <Slider label="Surprise chance (extra waves)" value={t.surpriseRate} min={L.surpriseRate[0]} max={L.surpriseRate[1]} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('surpriseRate', v)} />
            <Slider label="Defense budget" value={t.budget} min={L.budget[0]} max={L.budget[1]} step={50} fmt={(v) => `${v > 0 ? '+' : ''}${v} cr`} onChange={(v) => set('budget', v)} />
          </div>
        </div>

        <div>
          <div className="label mb-1">Expected per phase (before surprises and false tracks)</div>
          <div className="overflow-x-auto">
            <table className="table-ops w-full">
              <thead><tr><th>Phase</th><th>Waves</th><th>Threats</th><th>Mostly</th></tr></thead>
              <tbody>
                {scenarioPreview(t).map((p) => (
                  <tr key={p.phase}><td className="text-white">{p.phase}</td><td>{p.waves}</td><td>~{p.threats}</td>
                    <td className="text-ops-dim">{p.top.map((x) => `${THREAT_LABELS[x.c]} ${Math.round(x.share * 100)}%`).join(' · ') || 'mixed'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** The tactical scenario line on the campaign card. */
export function CampaignScenarioPicker({ value, onChange }: { value: ChosenScenario; onChange: (c: ChosenScenario) => void }) {
  const [open, setOpen] = useState(false);
  const presetId = TACTICAL_PRESETS.some((p) => p.id === value.tactical.preset) ? value.tactical.preset : 'custom';
  return (
    <div className="mt-3 space-y-1.5">
      <label className="block"><div className="label mb-0.5">Tactical scenario</div>
        <select className="input w-full" value={presetId} onChange={(e) => {
          const p = TACTICAL_PRESETS.find((x) => x.id === e.target.value);
          if (p) onChange({ name: p.name, tactical: p.settings });
          else setOpen(true);
        }}>
          {TACTICAL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="custom">{presetId === 'custom' ? `Custom: ${value.name}` : 'Custom…'}</option>
        </select>
      </label>
      <button className="btn w-full" onClick={() => setOpen(true)} title="Build, import or export a tactical scenario">Customize…</button>
      {open && <TacticalScenarioBuilder initial={value} onClose={() => setOpen(false)} onUse={(c) => { onChange(c); setOpen(false); }} />}
    </div>
  );
}
