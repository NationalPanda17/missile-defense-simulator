import { describe, expect, it } from 'vitest';
import {
  createInitialState, defaultSettings, execute, exportJSON, importJSON, isActive, isSea, onMassif, TEMPLATE_MAP, EQUIPMENT_MAP,
  LESSONS, LESSON_MAP, lessonSettings, lessonOf, examStandards, examResult, regionProtection, coverageAt, isUnlimited,
} from '../src/engine';
import type { RegionId, SimState, StepContext, TrainingLesson } from '../src/engine';

interface FakeUI { view: string; region: RegionId | null; eventId: string | null; assetId: string | null }

function landNear(s: SimState, region: RegionId, x = 300, y = 200): { x: number; y: number } {
  const t = s.tactical!.terrain![region];
  for (let r = 0; r < 600; r += 6) {
    for (let a = 0; a < 24; a++) {
      const p: [number, number] = [Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r)];
      if (p[0] >= 0 && p[0] <= 600 && p[1] >= 0 && p[1] <= 400 && !isSea(t, p) && !onMassif(t, p)) return { x: p[0], y: p[1] };
    }
  }
  throw new Error('no land');
}

const known = (s: SimState) => s.events.filter((e) => isActive(e) && e.reportedAt <= s.hour);

function respondAll(s: SimState, best = true) {
  for (const e of known(s)) {
    if (e.status !== 'reported' || !e.isGenuine) continue;
    const opts = TEMPLATE_MAP.get(e.templateId)!.responses.filter((r) => !r.passive);
    const r = [...opts].sort((a, b) => (best ? b.baseSuccess - a.baseSuccess : a.credits - b.credits))
      .find((o) => o.crews <= s.crews - s.crewsBusy && o.credits <= s.credits) ?? opts[0];
    execute(s, { type: 'respond', eventId: e.id, responseId: r.id });
  }
}

/** Cover a region's sites with a short/medium-range system on each uncovered one. */
function protect(s: SimState, region: RegionId, equipmentId = 'nasams') {
  for (const site of s.tactical!.sites.filter((x) => x.region === region)) {
    if (regionProtection(s, region).level === 'protected') return;
    if (Object.values(coverageAt(s, region, site.x, site.y)).some((k) => k > 0)) continue;
    const p = landNear(s, region, site.x, site.y);
    execute(s, { type: 'deploy', equipmentId, region, x: p.x, y: p.y });
  }
}

function nextWaveRegion(s: SimState): RegionId | null {
  const w = s.tactical!.waves.filter((x) => !x.resolved).sort((a, b) => a.atHour - b.atHour)[0];
  return w?.region ?? null;
}

/** A diligent student: does what each step asks. */
function act(l: TrainingLesson, stepId: string, s: SimState, ui: FakeUI) {
  const step = l.steps.find((x) => x.id === stepId)!;
  if (step.view) ui.view = step.view;
  switch (stepId) {
    case 'begin': return void execute(s, { type: 'beginPhase' });
    case 'pause': return void execute(s, { type: 'setPaused', paused: true });
    case 'speed': return void execute(s, { type: 'setSpeed', speed: 8 });
    case 'turns': return void execute(s, { type: 'setTurnBased', on: true });
    case 'advance': return void execute(s, { type: 'advance', hours: 6 });
    case 'region': ui.region = 'EUR'; return;
    case 'realtime': return void execute(s, { type: 'setTurnBased', on: false });
    case 'open': ui.eventId = known(s)[0]?.id ?? null; return;
    case 'asset': ui.assetId = s.assets.find((a) => a.domain === 'air')!.id; return;
    case 'domain': ui.view = 'air'; return;
    case 'confirm': {
      const e = known(s).filter((x) => x.status === 'reported').sort((a, b) => a.confidence - b.confidence)[0];
      if (e) execute(s, { type: 'confirm', eventId: e.id });
      return;
    }
    case 'dismiss': {
      const e = known(s).find((x) => !x.isGenuine && x.status === 'reported');
      if (e) execute(s, { type: 'dismiss', eventId: e.id });
      return;
    }
    case 'monitor': {
      const e = known(s).find((x) => x.status === 'reported' && !x.monitored);
      if (e) execute(s, { type: 'respond', eventId: e.id, responseId: 'monitor' });
      return;
    }
    case 'respond': case 'resolve': case 'reserve': return respondAll(s, l.id !== 'resources');
    case 'maintain': {
      const a = s.assets.filter((x) => x.domain === 'air' && x.status === 'operational').sort((p, q) => p.condition - q.condition)[0];
      return void execute(s, { type: 'maintain', assetId: a.id });
    }
    case 'redeploy': {
      const a = s.assets.find((x) => x.domain === 'air' && x.role !== 'defense' && x.status === 'operational')!;
      return void execute(s, { type: 'redeploy', assetId: a.id, region: a.region === 'EUR' ? 'NAM' : 'EUR' });
    }
    case 'invest': return void execute(s, { type: 'invest', investmentId: 'crews' });
    case 'sensor': { const p = landNear(s, 'EUR'); return void execute(s, { type: 'deploy', equipmentId: 'sentinel', region: 'EUR', ...p }); }
    case 'effector': {
      const c = s.tactical!.sites.find((x) => x.region === 'EUR' && x.type === 'city')!;
      return void execute(s, { type: 'deploy', equipmentId: 'nasams', region: 'EUR', ...landNear(s, 'EUR', c.x, c.y) });
    }
    case 'protect': return protect(s, 'EUR');
    case 'deploy': case 'brief':
      protect(s, 'EUR');
      protect(s, 'MDE', 'iron-dome');
      return;
    case 'alert': {
      const r = nextWaveRegion(s);
      if (r && s.tactical!.deployments.some((d) => d.region === r)) execute(s, { type: 'raiseAlert', region: r });
      return;
    }
    case 'resupply': {
      for (const d of s.tactical!.deployments) {
        const spec = EQUIPMENT_MAP.get(d.equipmentId)!;
        if (!isUnlimited(spec) && d.stock < spec.magazine && d.reloadRemaining === undefined) return void execute(s, { type: 'resupply', deploymentId: d.id });
      }
      return;
    }
    case 'surprise': {
      const d = s.tactical!.deployments.find((x) => !x.transit && x.region !== 'AFR');
      const site = s.tactical!.sites.find((x) => x.region === 'AFR' && x.type === 'city')!;
      if (d) execute(s, { type: 'emergencyRedeploy', deploymentId: d.id, region: 'AFR', ...landNear(s, 'AFR', site.x, site.y) });
      return;
    }
  }
}

/** Plays a lesson start to finish. Returns the state and the ids of the steps completed. */
function playLesson(id: string) {
  const l = LESSON_MAP.get(id)!;
  const s = createInitialState(lessonSettings(id, defaultSettings('training')));
  const ui: FakeUI = { view: 'global', region: null, eventId: null, assetId: null };
  const done: string[] = [];
  for (const step of l.steps) {
    const since = { cmd: s.commands.length, hour: s.hour };
    const ctx = (): StepContext => ({ s, ...ui, since });
    if (step.quiz) {
      const q = step.quiz(s);
      expect(q.options.length, `${id}/${step.id}`).toBeGreaterThanOrEqual(2);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options.length);
      expect(new Set(q.options).size, `${id}/${step.id} options are distinct`).toBe(q.options.length);
      done.push(step.id);
      continue;
    }
    if (!step.check) { done.push(step.id); continue; }
    let ok = false;
    for (let i = 0; i < 400 && !ok; i++) {
      act(l, step.id, s, ui);
      if (l.exam && s.status === 'running') {
        respondAll(s);
        for (const e of known(s)) if (!e.isGenuine && e.status === 'reported' && e.confidence < 50) execute(s, { type: 'confirm', eventId: e.id });
        for (const a of s.assets) if (a.role !== 'defense' && (a.hoursToService < 0 || a.condition < 55)) execute(s, { type: 'maintain', assetId: a.id });
      }
      ok = step.check(ctx());
      if (!ok && s.status === 'running') execute(s, { type: 'advance', hours: 1 });
    }
    expect(ok, `${id}: step "${step.id}" could not be completed`).toBe(true);
    done.push(step.id);
  }
  return { s, done };
}

describe('Training Academy', () => {
  it('has unique lesson ids, scripted events that exist and a single graded exam at the end', () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    expect(LESSONS.length).toBeGreaterThanOrEqual(9);
    expect(LESSONS.filter((l) => l.exam).map((l) => l.id)).toEqual(['exam']);
    expect(LESSONS[LESSONS.length - 1].exam).toBe(true);
    for (const l of LESSONS) {
      for (const sc of l.phase.scripted) expect(TEMPLATE_MAP.has(sc.templateId), `${l.id}: ${sc.templateId}`).toBe(true);
      for (const a of l.after ?? []) expect(LESSON_MAP.has(a)).toBe(true);
      expect(new Set(l.steps.map((x) => x.id)).size, `${l.id} step ids`).toBe(l.steps.length);
    }
  });

  it('builds each lesson as a training scenario with its own phase, and the tactical layer only where it has waves', () => {
    for (const l of LESSONS) {
      const s = createInitialState(lessonSettings(l.id, defaultSettings('training')));
      expect(s.settings.mode).toBe('training');
      expect(lessonOf(s)).toBe(l);
      expect(s.phases).toHaveLength(1);
      expect(s.phases[0].name).toBe(l.phase.name);
      expect(s.tactical!.enabled, l.id).toBe(!!l.waves?.length);
      if (l.waves) {
        expect(s.tactical!.waves).toHaveLength(l.waves.length);
        expect(s.tactical!.forecast.length).toBeGreaterThan(0);
        // surprise waves stay out of the forecast
        for (const w of l.waves.filter((x) => !x.forecast)) expect(s.tactical!.forecast).not.toContain(w.region);
      }
    }
  });

  it('keeps the classic training scenario and the campaign unchanged', () => {
    const t = createInitialState(defaultSettings('training'));
    expect(t.phases[0].name).toBe('Command Familiarization');
    expect(t.tactical!.enabled).toBe(false);
    expect(lessonOf(t)).toBeUndefined();
    expect(createInitialState(defaultSettings('campaign')).tactical!.enabled).toBe(true);
  });

  it('places the same waves for every player of a lesson', () => {
    const a = createInitialState(lessonSettings('tactical2', defaultSettings('training')));
    const b = createInitialState(lessonSettings('tactical2', defaultSettings('training')));
    expect(a.tactical!.waves).toEqual(b.tactical!.waves);
  });

  for (const l of LESSONS) {
    it(`lesson "${l.title}" can be completed step by step`, () => {
      const { s, done } = playLesson(l.id);
      expect(done).toEqual(l.steps.map((x) => x.id));
      if (l.exam) {
        expect(s.status).toBe('complete');
        const r = examResult(s);
        expect(r.total).toBe(6);
        expect(r.passed, `standards: ${JSON.stringify(examStandards(s))}`).toBe(true);
      }
    });
  }

  it('grades the exam: a commander who does nothing fails', () => {
    const s = createInitialState(lessonSettings('exam', defaultSettings('training')));
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'advance', hours: 80 });
    expect(s.status).toBe('complete');
    const st = examStandards(s);
    expect(st.find((x) => x.id === 'defense')!.met).toBe(false);
    expect(examResult(s).passed).toBe(false);
  });

  it('a lesson survives a save and reload', () => {
    const s = createInitialState(lessonSettings('tactical1', defaultSettings('training')));
    const back = importJSON(exportJSON(s))!;
    expect(back.settings.lesson).toBe('tactical1');
    expect(back.tactical!.enabled).toBe(true);
    expect(back.tactical!.waves.length).toBe(1);
  });
});
