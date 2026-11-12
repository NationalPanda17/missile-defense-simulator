import { describe, expect, it } from 'vitest';
import {
  DRILLS, LESSON_MAP, TEMPLATE_MAP, EQUIPMENT_MAP, coverageAt, createInitialState, defaultSettings, execute, isActive, isSea, isUnlimited,
  lessonSettings, onMassif, starsFor,
} from '../src/engine';
import type { RegionId, SimState } from '../src/engine';

function landNear(s: SimState, region: RegionId, x: number, y: number) {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 400; r += 6) for (let a = 0; a < 24; a++) {
    const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
    if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
  }
  throw new Error('no land');
}

function defend(s: SimState, region: RegionId, ids: string[]) {
  for (const site of [...s.tactical!.sites.filter((x) => x.region === region)].sort((a, b) => b.importance - a.importance)) {
    for (const id of ids) {
      if (Object.values(coverageAt(s, region, site.x, site.y)).some((k) => k > 0) && id === ids[0]) break;
      execute(s, { type: 'deploy', equipmentId: id, region, ...landNear(s, region, site.x, site.y) });
    }
  }
}

function manage(s: SimState) {
  for (const e of s.events.filter((x) => isActive(x) && x.reportedAt <= s.hour && x.status === 'reported')) {
    if (e.confidence < 60) { execute(s, { type: 'confirm', eventId: e.id }); continue; }
    const r = TEMPLATE_MAP.get(e.templateId)!.responses.filter((x) => !x.passive).sort((a, b) => b.baseSuccess - a.baseSuccess)
      .find((o) => o.crews <= s.crews - s.crewsBusy && o.credits <= s.credits);
    if (r) execute(s, { type: 'respond', eventId: e.id, responseId: r.id });
  }
  for (const a of s.assets) {
    if (a.role !== 'defense' && a.status !== 'maintenance' && a.status !== 'transit' && (a.hoursToService < 0 || a.condition < 55) && s.credits > 250) execute(s, { type: 'maintain', assetId: a.id });
  }
  for (const d of s.tactical?.deployments ?? []) {
    const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
    if (!isUnlimited(spec) && d.stock < spec.magazine / 2 && d.reloadRemaining === undefined) execute(s, { type: 'resupply', deploymentId: d.id });
  }
}

function play(id: string, student: boolean) {
  const s = createInitialState(lessonSettings(id, defaultSettings('training')));
  if (student) {
    if (id === 'drill-swarm') defend(s, 'EUR', ['skynex', 'coyote']);
    if (id === 'drill-higharc') { defend(s, 'MDE', ['patriot-pac3']); defend(s, 'MDE', ['iron-dome']); }
    if (id === 'drill-surprise') { defend(s, 'EUR', ['nasams']); }
  }
  execute(s, { type: 'beginPhase' });
  for (let i = 0; i < 200 && s.status === 'running'; i++) {
    if (student) {
      manage(s);
      if (id === 'drill-surprise') {
        const next = s.tactical!.waves.find((w) => !w.resolved && w.region !== 'EUR' && w.launchAt! - s.hour <= 16 && !s.tactical!.deployments.some((d) => d.region === w.region || d.transit?.region === w.region));
        if (next) {
          const site = s.tactical!.sites.find((x) => x.region === next.region && x.type === 'city')!;
          for (const d of s.tactical!.deployments.filter((x) => x.region === 'EUR' && !x.transit).slice(0, 3)) {
            execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: next.region, ...landNear(s, next.region, site.x, site.y) });
          }
        }
      }
    }
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

describe('practice drills', () => {
  it('are well formed: unique ids, real event templates, three rising star thresholds', () => {
    expect(DRILLS.length).toBeGreaterThanOrEqual(5);
    for (const d of DRILLS) {
      expect(LESSON_MAP.get(d.id)).toBe(d);
      expect(d.drill).toBeTruthy();
      const [a, b, c] = d.drill!.stars;
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
      for (const sc of d.phase.scripted) expect(TEMPLATE_MAP.has(sc.templateId)).toBe(true);
      const s = createInitialState(lessonSettings(d.id, defaultSettings('training')));
      expect(s.tactical!.enabled).toBe(!!d.waves?.length);
    }
  });

  for (const d of DRILLS) {
    it(`"${d.title}": a capable player earns stars and beats an idle one`, () => {
      const good = play(d.id, true);
      const idle = play(d.id, false);
      expect(good.status).toBe('complete');
      const gs = d.drill!.score(good);
      const is = d.drill!.score(idle);
      expect(gs).toBeGreaterThanOrEqual(0);
      expect(gs).toBeLessThanOrEqual(100);
      expect(starsFor(d.drill!, gs), `${d.id}: good ${gs}, idle ${is}`).toBeGreaterThanOrEqual(1);
      expect(gs, `${d.id}: good ${gs}, idle ${is}`).toBeGreaterThan(is);
      expect(starsFor(d.drill!, is)).toBeLessThan(3);
    });
  }
});
