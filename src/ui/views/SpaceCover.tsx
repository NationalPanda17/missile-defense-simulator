// What space gives the forecast regions, and what is about to go wrong in orbit (briefing and Space Ops).
import { MISSIONS, lonText, missionUp, sats, spaceOutlook, type RegionId, type SimState } from '../../engine';

/**
 * What space gives the regions the forecast names, and what is about to go wrong: hours without missile warning,
 * satellites down or fading. Shown in the briefing and on Space Ops.
 */
export function SpaceCover({ s, compact }: { s: SimState; compact?: boolean }) {
  const { gaps, watch, window } = spaceOutlook(s);
  const forecast = s.tactical?.enabled ? s.tactical.forecast : [];
  if (!forecast.length || !sats(s).length) return null;
  const name = (r: RegionId) => s.regions[r].name;
  const tracking = sats(s).find((a) => a.orbit!.mission === 'tracking');
  const trackingUp = !!tracking && missionUp(s, tracking);
  const watched = watch.filter((w) => w.why !== 'servicing');
  return (
    <div className={compact ? 'mt-1.5 rounded border border-ops-cyan/30 bg-ops-cyan/5 px-2 py-1' : 'text-[11px]'}>
      {compact && <span className="label text-ops-cyan">Space cover</span>}{' '}
      {forecast.map((r, i) => {
        const g = gaps.find((x) => x.region === r);
        return (
          <span key={r} className={g ? 'text-ops-amber' : ''}>
            {i > 0 && ' · '}{name(r)}: missile warning {g ? `${window - g.hours} of ${window}h` : 'throughout'}
          </span>
        );
      })}
      {' · '}<span className={trackingUp ? '' : 'text-ops-amber'}>tracking layer {trackingUp ? 'up' : 'down'}</span>.
      {(gaps.length > 0 || watched.length > 0) && (
        <ul className="mt-0.5 space-y-0.5">
          {gaps.map((g) => (
            <li key={g.region} className="text-ops-amber">
              {name(g.region)}: no warning for {g.hours}h{g.from > s.hour ? ` from hour ${g.from}` : ''}.{' '}
              <span className="text-ops-dim">
                {g.fix.kind === 'move' ? `Fix: move ${g.fix.asset.name} to ${lonText(g.fix.lon)} (${g.fix.hours}h drift).`
                  : g.fix.kind === 'service' ? (g.fix.asset.status === 'maintenance' ? `${g.fix.asset.name} is being serviced: back in ${g.fix.asset.maintenanceRemaining}h.` : `Fix: get ${g.fix.asset.name} flying again.`)
                    : g.fix.kind === 'launching' ? 'A warning satellite is being launched for it.'
                      : 'Fix: launch a warning satellite (Logistics).'}
              </span>
            </li>
          ))}
          {watched.map((w) => (
            <li key={w.asset.id} className={w.state === 'down' ? 'text-ops-red' : 'text-ops-dim'}>
              {w.asset.name} ({MISSIONS[w.mission].name.toLowerCase()}): {w.why === 'jammed' ? 'jammed' : w.state === 'down' ? `down, condition ${Math.round(w.asset.condition)}%` : `fading, condition ${Math.round(w.asset.condition)}%`}.
              {w.why === 'worn' && <span className="text-ops-dim"> Service it between waves (18h off station).</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
