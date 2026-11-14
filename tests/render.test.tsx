// Mounts every screen that changed, with realistic game states, to catch errors that only show when a screen is drawn.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import {
  ENDLESS_ID, EQUIPMENT_MAP, QUICK_BATTLE_ID, RAID_ID, createInitialState, defaultSettings, execute, lessonSettings, placementError, proposeDefense, withLevel,
  type RegionId, type SimState,
} from '../src/engine';
import { store } from '../src/store/simStore';
import { UIProvider } from '../src/ui/uiState';
import { PAGES } from '../src/ui/Guide';
import { DeployPanel } from '../src/ui/views/TacticalDeploy';
import { TheaterView } from '../src/ui/views/TheaterView';
import { PracticeRange } from '../src/ui/Extras';
import { MedalCase, Reinforce, StartScreen } from '../src/ui/Modals';
import { DispatchCard } from '../src/ui/Dispatch';
import { NextButton, TopBar, WaveCard } from '../src/ui/Shell';
import { AARView } from '../src/ui/views/AARView';
import { setLang } from '../src/ui/i18n';

const html = (el: ReactElement) => renderToString(<UIProvider>{el}</UIProvider>);
function spot(s: SimState, id: string, region: RegionId, x: number, y: number) {
  const spec = EQUIPMENT_MAP.get(id)!;
  for (let r = 4; r <= 300; r += 3) for (let a = 0; a < 24; a++) {
    const p = { x: Math.round(x + Math.cos((a / 24) * Math.PI * 2) * r), y: Math.round(y + Math.sin((a / 24) * Math.PI * 2) * r) };
    if (!placementError(s, spec, region, p.x, p.y)) return p;
  }
  throw new Error('no spot');
}
/** A campaign played into its third phase with a varied defense, stopped in a briefing. */
function midCampaign(): SimState {
  const s = createInitialState(withLevel({ ...defaultSettings('campaign'), seed: 9, enemy: 'hunter' }, 'commander'));
  s.campaignId = 'render';
  let guard = 0;
  while (s.phaseIndex < 2 && guard++ < 400) {
    if (s.status === 'briefing') {
      for (const r of s.tactical!.forecast) {
        if (s.tactical!.deployments.some((d) => d.region === r)) continue;
        for (const p of proposeDefense(s, r, 350)) execute(s, { type: 'deploy', equipmentId: p.equipmentId, region: r, x: p.x, y: p.y });
        const site = s.tactical!.sites.find((x) => x.region === r)!;
        for (const id of ['patriot-pac3', 'decoy-emitter', 'ew-jammer']) execute(s, { type: 'deploy', equipmentId: id, region: r, ...spot(s, id, r, site.x, site.y) });
      }
      const d = s.tactical!.deployments;
      const pat = d.find((x) => x.equipmentId === 'patriot-pac3');
      if (pat) { execute(s, { type: 'setLoadout', deploymentId: pat.id, loadout: 'gem' }); execute(s, { type: 'setScoot', deploymentId: pat.id, on: true }); execute(s, { type: 'setDoctrine', deploymentId: pat.id, doctrine: 'missiles' }); }
      const rad = d.find((x) => x.equipmentId === 'sentinel');
      if (rad) execute(s, { type: 'setEmcon', deploymentId: rad.id, on: true });
      execute(s, { type: 'beginPhase' });
    }
    execute(s, { type: 'advance', hours: 1 });
  }
  return s;
}

describe('screens render', () => {
  it('every page of the field guide', () => {
    for (const [tab, Page] of Object.entries(PAGES)) {
      const out = html(<Page />);
      expect(out.length, tab).toBeGreaterThan(200);
      expect(out, tab).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
  });

  it('the deploy step and Tactical Theater in a campaign with every new order in use', () => {
    const s = midCampaign();
    expect(s.status).toBe('briefing');
    store.state = s;
    const deploy = html(<DeployPanel s={s} />);
    expect(deploy).toContain('Radar picture');
    expect(deploy).toContain('Adjutant’s proposal');
    expect(deploy).not.toMatch(/NaN|\[object Object\]/);
    execute(s, { type: 'beginPhase' });
    while (!s.tactical!.waves.some((w) => w.phaseIndex === 2 && w.resolved) && s.status === 'running') execute(s, { type: 'advance', hours: 1 });
    const theater = html(<TheaterView s={s} />);
    expect(theater).toContain('Service record');
    expect(theater).toContain('Fire orders');
    expect(theater).toContain('Radar silent');
    expect(theater).toContain('Scope view');
    expect(theater).not.toMatch(/NaN|\[object Object\]/);
    expect(html(<TopBar s={s} />)).toContain('Credits');
    expect(html(<NextButton s={s} />).length).toBeGreaterThan(20);
    expect(html(<WaveCard s={s} />)).toBeDefined();
    expect(html(<AARView s={s} />)).toContain('In the news');
    expect(html(<DispatchCard s={s} phaseIndex={0} />)).toContain('The Meridian Dispatch');
    store.state = null;
  });

  it('the campaign path and reinforcement choices', () => {
    const s = midCampaign();
    const out = html(<Reinforce s={s} />);
    expect(out).toContain('Campaign path');
    expect(out).toContain('Reinforcements are available');
  });

  it('Quick Battle, Endless Defense and a custom raid on the deploy step', () => {
    const raid = { region: 'AFR' as RegionId, waves: [{ atHour: 8, axis: 'north' as const, tracks: { slowDrone: 8, cruise: 3, hypersonic: 1 } }] };
    for (const s of [
      createInitialState(lessonSettings(QUICK_BATTLE_ID, { ...defaultSettings('training'), seed: 5 })),
      createInitialState(lessonSettings(ENDLESS_ID, { ...defaultSettings('training'), seed: 5 })),
      createInitialState({ ...lessonSettings(RAID_ID, defaultSettings('training')), raid }),
    ]) {
      store.state = s;
      const out = html(<DeployPanel s={s} />);
      expect(out, s.settings.name).toContain('Forecast check');
      expect(out, s.settings.name).not.toMatch(/NaN|\[object Object\]/);
    }
    store.state = null;
  });

  it('the start screen, in English and Spanish, with the medal case and practice range', () => {
    const en = html(<StartScreen onSandbox={() => {}} />);
    expect(en).toContain('Endless Defense');
    expect(en).toContain('Raid Designer');
    expect(en).toContain('The Long Winter');
    setLang('es');
    const es = html(<StartScreen onSandbox={() => {}} />);
    expect(es).toContain('Defensa sin fin');
    expect(es).toContain('SIMULADOR DE DEFENSA ANTIMISILES');
    setLang('en');
    expect(html(<MedalCase />)).toContain('Medals');
    const range = html(<PracticeRange />);
    expect(range).toContain('Practice range');
    expect(range).toContain('Result:');
  });
});
