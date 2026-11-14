// What damaged sites cost a region. Kept free of other engine imports so the metric model can use it.
import type { RegionId, SimState, SiteType } from './types';

/** Share (0-1) of a region's site value lost to threat waves so far; it carries over from phase to phase. */
export function siteDamageShare(s: SimState, region: RegionId): number {
  const sites = s.tactical?.sites.filter((x) => x.region === region) ?? [];
  const total = sites.reduce((a, x) => a + x.importance * 100, 0);
  if (!total) return 0;
  return sites.reduce((a, x) => a + x.importance * (100 - x.integrity), 0) / total;
}

/** Average damage (0-1) to a region's sites of one type: 0 when untouched (or the tactical layer is off). */
export function siteLoss(s: SimState, region: RegionId, type: SiteType): number {
  if (!s.tactical?.enabled) return 0;
  const sites = s.tactical.sites.filter((x) => x.region === region && x.type === type);
  if (!sites.length) return 0;
  return sites.reduce((a, x) => a + (100 - x.integrity), 0) / (sites.length * 100);
}

/** Share (0-1) of all regions' site value lost, averaged over regions. */
export function networkDamageShare(s: SimState): number {
  if (!s.tactical?.enabled) return 0;
  const regions = Object.keys(s.regions) as RegionId[];
  return regions.reduce((a, r) => a + siteDamageShare(s, r), 0) / regions.length;
}
