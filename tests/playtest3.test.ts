// Third playtest: the clock in planning views, Phase 1 targets by difficulty, the briefing's difficulty note, and
// coach steps the player ran ahead of.
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_PHASES, LESSON_MAP, createInitialState, defaultSettings, execute, lessonSettings, objectiveProgress, withLevel,
  type CommandLevel, type StepContext,
} from '../src/engine';
import { store } from '../src/store/simStore';

const campaign = (level: CommandLevel, seed = 31) => createInitialState(withLevel(defaultSettings('campaign', { seed }), level));
const target = (s: ReturnType<typeof campaign>, id: string) => s.phases[0].objectives.find((o) => o.id === id)!;

describe('planning views hold the clock', () => {
  it('pauses on the way in and resumes on the way out', () => {
    const s = campaign('officer');
    store.state = s;
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'setPaused', paused: false });
    store.holdForPlanning(true);
    expect(s.paused).toBe(true);
    expect(store.viewHold).toBe(true);
    store.holdForPlanning(false);
    expect(s.paused).toBe(false);
    expect(store.viewHold).toBe(false);
    expect(s.commands.filter((c) => c.text === 'Simulation paused.')).toHaveLength(0); // the game's pause, not logged
  });

  it('leaves the clock alone if it was already paused, or the player took over', () => {
    const s = campaign('officer');
    store.state = s;
    execute(s, { type: 'beginPhase' });
    execute(s, { type: 'setPaused', paused: true });
    store.holdForPlanning(true); // paused already: nothing to hold
    expect(store.viewHold).toBe(false);
    store.holdForPlanning(false);
    expect(s.paused).toBe(true);

    execute(s, { type: 'setPaused', paused: false });
    store.holdForPlanning(true);
    store.dispatch({ type: 'setPaused', paused: false }); // resumed by hand inside the planning view
    store.dispatch({ type: 'setPaused', paused: true }); // and paused again
    store.holdForPlanning(false);
    expect(s.paused).toBe(true); // stays as the player left it
  });
});

describe('Phase 1 objectives by difficulty', () => {
  it('scales network and readiness targets, and the text says the number in force', () => {
    const want = { recruit: [76, 68], officer: [80, 72], commander: [83, 75] } as const;
    for (const lv of ['recruit', 'officer', 'commander'] as const) {
      const s = campaign(lv);
      const [net, ready] = want[lv];
      expect(target(s, 'p1_net').target).toBe(net);
      expect(target(s, 'p1_net').text).toContain(`${net}%`);
      expect(target(s, 'p1_ready').target).toBe(ready);
      expect(target(s, 'p1_ready').text).toContain(`${ready}%`);
      expect(target(s, 'p1_ready')).not.toHaveProperty('byLevel');
    }
    expect(CAMPAIGN_PHASES[0].objectives[0].target).toBe(80); // the shared config is not mutated
  });

  it('a level objective that meets its target at T+0 is only on track, not done', () => {
    const s = campaign('commander');
    for (const id of ['p1_net', 'p1_ready']) {
      const st = objectiveProgress(s, target(s, id));
      expect(st === 'on-track' || st === 'behind').toBe(true);
    }
    expect(objectiveProgress(s, target(s, 'p1_maint'))).toBe('behind');
    s.counters.maintenanceDone = 3;
    expect(objectiveProgress(s, target(s, 'p1_maint'))).toBe('done');
  });
});

describe('briefing notes and difficulty agree', () => {
  it('labels the difficulty in every phase with the real false-report rate', () => {
    const o = campaign('officer');
    const c = campaign('commander');
    expect(o.phases[0].special).toEqual(CAMPAIGN_PHASES[0].special);
    for (let i = 0; i < c.phases.length; i++) {
      const note = c.phases[i].special[0];
      expect(note).toMatch(/^Commander difficulty: 30% more incidents/);
      expect(note).toContain(`${Math.round(c.phases[i].falseRate * 100)}% of reports false`);
      expect(note).toContain(`Officer ${Math.round(o.phases[i].falseRate * 100)}%`);
    }
    expect(campaign('recruit').phases[0].special[0]).toMatch(/^Recruit difficulty: 25% fewer incidents/);
    // No absolute claims that a harder level contradicts.
    for (const p of CAMPAIGN_PHASES) expect(p.special.join(' ')).not.toMatch(/Low event tempo|mostly reliable/);
  });
});

describe('coach recognises work done early', () => {
  const ctx = (over: Partial<StepContext>): StepContext => {
    const s = createInitialState(lessonSettings('situation', defaultSettings('training')));
    return { s, view: 'global', region: null, eventId: null, assetId: null, since: { cmd: 0, hour: 0 }, ...over };
  };
  const seen = { views: ['global'], region: false, event: false, asset: false, maxSpeed: 1 };

  it('counts a view opened before the step', () => {
    const step = LESSON_MAP.get('situation')!.steps.find((x) => x.id === 'air')!;
    expect(step.check!(ctx({}))).toBe(false);
    expect(step.check!(ctx({ seen: { ...seen, views: ['global', 'air'] } }))).toBe(true);
  });

  it('counts a region opened, a speed picked and turn mode tried before the step', () => {
    const steps = LESSON_MAP.get('basics')!.steps;
    const step = (id: string) => steps.find((x) => x.id === id)!;
    expect(step('region').check!(ctx({ seen: { ...seen, region: true } }))).toBe(true);
    expect(step('speed').check!(ctx({ seen: { ...seen, maxSpeed: 8 } }))).toBe(true);
    const c = ctx({});
    execute(c.s, { type: 'beginPhase' });
    execute(c.s, { type: 'setTurnBased', on: true });
    execute(c.s, { type: 'setTurnBased', on: false });
    expect(step('turns').check!(c)).toBe(true);
  });
});
