// A small world map beside the theater's region tabs: every region coloured by how well it is covered, waves inbound
// blinking, the region on screen outlined. Click a region to go to it; the button opens Global Operations.
import { useMemo } from 'react';
import { REGION_IDS, incomingWaves, regionProtection, type RegionId, type SimState } from '../../../engine';
import { MAP_H, MAP_W, REGION_SHAPES, ringPath } from '../../map/geography';

const FILL = { protected: '#34d399', thin: '#f5b13d', exposed: '#f2545b' } as const;

export function WorldInset({ s, region, onPick, onWorld }: { s: SimState; region: RegionId; onPick: (r: RegionId) => void; onWorld: () => void }) {
  // Coarse outlines: every third point is plenty at this size.
  const paths = useMemo(() => Object.fromEntries(REGION_IDS.map((r) => [r, REGION_SHAPES[r]
    .filter((ring) => ring.length > 12)
    .map((ring) => ringPath(ring.filter((_, i) => i % 3 === 0)))
    .join('')])) as Record<RegionId, string>, []);
  const inbound = new Set(incomingWaves(s).map((x) => x.wave.region));
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <svg viewBox={`0 40 ${MAP_W} ${MAP_H - 80}`} className="h-12 w-[6.5rem] rounded border border-ops-line bg-black/30" role="group" aria-label="World: pick a region">
        {REGION_IDS.map((r) => {
          const lvl = regionProtection(s, r).level;
          return (
            <path key={r} d={paths[r]} fill={FILL[lvl]} fillOpacity={r === region ? 0.75 : 0.32} stroke={r === region ? '#fff' : FILL[lvl]} strokeWidth={r === region ? 6 : 2}
              className={`cursor-pointer ${inbound.has(r) ? 'blink' : ''}`} onClick={() => onPick(r)}>
              <title>{s.regions[r].name}: {lvl}{inbound.has(r) ? ', wave inbound' : ''}</title>
            </path>
          );
        })}
      </svg>
      <button className="btn px-2" onClick={onWorld} title="Open the world map (Global Operations, G)">World ▸</button>
    </div>
  );
}
