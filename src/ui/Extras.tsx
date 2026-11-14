// The practice range: one system, one threat, one engagement, dice shown. (The raid designer is in RaidDesigner.tsx.)
import { useMemo, useState } from 'react';
import { EQUIPMENT, THREAT_CLASSES, THREAT_LABELS, isEffector, practiceShot, type ThreatClass } from '../engine';

const SHOOTERS = EQUIPMENT.filter(isEffector);
const SENSORS = EQUIPMENT.filter((e) => e.layer === 'detection' && !e.lure);

/** One engagement at a time, with every die shown. */
export function PracticeRange() {
  const [eq, setEq] = useState('nasams');
  const [cls, setCls] = useState<ThreatClass>('cruise');
  const [offset, setOffset] = useState(10);
  const [sensor, setSensor] = useState('');
  const [seed, setSeed] = useState(1);
  const [tally, setTally] = useState<{ key: string; shots: number; stops: number }>({ key: '', shots: 0, stops: 0 });
  const key = `${eq}|${cls}|${offset}|${sensor}`;
  const result = useMemo(() => practiceShot({ equipmentId: eq, cls, offsetKm: offset, sensorId: sensor || undefined, seed }), [eq, cls, offset, sensor, seed]);
  const fire = () => {
    const next = seed + 1;
    const r = practiceShot({ equipmentId: eq, cls, offsetKm: offset, sensorId: sensor || undefined, seed: next });
    setSeed(next);
    setTally((t) => (t.key === key ? { key, shots: t.shots + 1, stops: t.stops + (r.stopped ? 1 : 0) } : { key, shots: 1, stops: r.stopped ? 1 : 0 }));
  };
  return (
    <div className="rounded border border-ops-line p-3 text-[12px]">
      <div className="font-sans text-lg font-semibold uppercase tracking-widest text-ops-cyan">Practice range</div>
      <p className="mt-1 leading-relaxed text-ops-dim">One system, one threat, flat empty ground. Fire as often as you like and read exactly why each shot hit or missed.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5"><span className="label">System</span>
          <select className="input py-1" value={eq} onChange={(e) => setEq(e.target.value)}>{SHOOTERS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="flex flex-col gap-0.5"><span className="label">Threat</span>
          <select className="input py-1" value={cls} onChange={(e) => setCls(e.target.value as ThreatClass)}>{THREAT_CLASSES.map((c) => <option key={c} value={c}>{THREAT_LABELS[c]}</option>)}</select></label>
        <label className="flex flex-col gap-0.5"><span className="label">Passes this close (km)</span>
          <input type="number" className="input w-24 py-1" min={0} max={300} value={offset} onChange={(e) => setOffset(Math.max(0, Math.min(300, Number(e.target.value) || 0)))} /></label>
        <label className="flex flex-col gap-0.5"><span className="label">Extra sensor beside it</span>
          <select className="input py-1" value={sensor} onChange={(e) => setSensor(e.target.value)}><option value="">None</option>{SENSORS.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <button className="btn btn-primary px-4 py-1.5" onClick={fire}>Fire again ▶</button>
      </div>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5" aria-live="polite">
        {result.lines.map((l, i) => <li key={i} className={l.tone === 'good' ? 'text-ops-green' : l.tone === 'bad' ? 'text-ops-amber' : 'text-ops-text'}>{l.text}</li>)}
      </ol>
      {tally.key === key && tally.shots > 1 && <p className="mt-1 text-[11px] text-ops-dim">This setup so far: stopped {tally.stops} of {tally.shots} ({Math.round((tally.stops / tally.shots) * 100)}%).</p>}
    </div>
  );
}
