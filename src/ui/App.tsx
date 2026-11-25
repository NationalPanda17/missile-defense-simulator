import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { SIM_CONFIG, incomingWaves, lessonOf, saveGame, urgentList } from '../engine';
import { dispatch, store, useStoreVersion } from '../store/simStore';
import { AccountModal } from './Account';
import { AssetModal, BriefingModal, EventModal, StartScreen, Toasts, TutorialPanel } from './Modals';
import { GuideModal } from './Guide';
import { awardMedals } from './medals';
import { tr, useLang } from './i18n';
import { BottomPanel, LeftNav, MobileTabs, NAV, RightSidebar, TopBar, WaveCard, chooseSpeed, goToUrgent, opensOverBattle } from './Shell';
import { followWaves } from './follow';
import { sound } from './audio/sound';
import { PausePrompt } from './PausePrompt';
import { installA11y } from './a11y/settings';
import { ChallengeInvite } from './Challenge';
import { checkForUpdate, desktopVersion, dismissUpdate, type UpdateInfo } from './desktopUpdate';
import { applyUpdate, onUpdateReady, updateReady } from './pwa';

import { UIProvider, useUI } from './uiState';

// Screens load on first use, so the start screen appears quickly (especially on phones).
const GlobalOps = lazy(() => import('./views/GlobalOps').then((m) => ({ default: m.GlobalOps })));
const TheaterView = lazy(() => import('./views/TheaterView').then((m) => ({ default: m.TheaterView })));
const DomainView = lazy(() => import('./views/DomainView').then((m) => ({ default: m.DomainView })));
const IntelView = lazy(() => import('./views/StaffViews').then((m) => ({ default: m.IntelView })));
const CommsView = lazy(() => import('./views/StaffViews').then((m) => ({ default: m.CommsView })));
const LogisticsView = lazy(() => import('./views/StaffViews').then((m) => ({ default: m.LogisticsView })));
const InfraView = lazy(() => import('./views/StaffViews').then((m) => ({ default: m.InfraView })));
const CampaignView = lazy(() => import('./views/CampaignViews').then((m) => ({ default: m.CampaignView })));
const ScenarioEditor = lazy(() => import('./views/CampaignViews').then((m) => ({ default: m.ScenarioEditor })));
const AARView = lazy(() => import('./views/AARView').then((m) => ({ default: m.AARView })));
const AcademyModal = lazy(() => import('./training/Academy').then((m) => ({ default: m.AcademyModal })));
const Coach = lazy(() => import('./training/Coach').then((m) => ({ default: m.Coach })));

// Once the start screen is up, fetch the main screens in the background so they open instantly.
if (typeof window !== 'undefined') {
  const warm = () => { void import('./views/GlobalOps'); void import('./views/TheaterView'); void import('./views/TacticalDeploy'); };
  window.addEventListener('load', () => window.setTimeout(warm, 1500), { once: true });
}

function Loading() {
  return <div className="p-6 text-center text-ops-dim" role="status">Loading…</div>;
}

sound.install();
installA11y();

function UpdateBanner() {
  useStoreVersion();
  const [ready, setReady] = useState(updateReady);
  useEffect(() => onUpdateReady(() => setReady(true)), []);
  // Never interrupt a running phase: wait for a briefing, the end of a run or the start screen.
  const busy = store.state?.status === 'running';
  if (!ready || busy) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[60] flex items-center gap-2 rounded border border-ops-cyan/50 bg-ops-panel px-3 py-2 text-[11px] shadow-lg" role="status">
      A new version is ready.
      <button className="btn btn-primary" onClick={applyUpdate}>Reload</button>
      <button className="btn px-2" onClick={() => setReady(false)} aria-label="Later">✕</button>
    </div>
  );
}

/** Desktop app: a newer version is on GitHub. */
function DesktopUpdateNotice() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const version = desktopVersion();
  useEffect(() => {
    if (!version) return;
    let live = true;
    void checkForUpdate(version).then((u) => { if (live) setInfo(u); });
    return () => { live = false; };
  }, [version]);
  if (!info || !version) return null;
  return (
    <div className="fixed bottom-3 right-3 z-[60] max-w-sm rounded border border-ops-cyan/50 bg-ops-panel px-3 py-2 text-[11px] shadow-lg" role="status">
      <div className="text-white">Version {info.version} is available.</div>
      <div className="text-ops-dim">You have {version}. Your accounts and saves are kept when you install it.</div>
      <div className="mt-1.5 flex justify-end gap-2">
        <button className="btn" onClick={() => { dismissUpdate(info.version); setInfo(null); }}>Not now</button>
        <a className="btn btn-primary" href={info.url} target="_blank" rel="noreferrer">Download</a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <UIProvider>
      <Root />
      <UpdateBanner />
      <DesktopUpdateNotice />
      <ChallengeInvite />
      <Toasts />
    </UIProvider>
  );
}

/** Views for planning rather than running operations: the clock is held while one is open. */
const PLANNING_VIEWS: string[] = ['campaign', 'editor', 'aar'];

function Root() {
  useLang(); // the whole game re-renders when the language changes
  useStoreVersion();
  const ui = useUI();
  const [editorFirst, setEditorFirst] = useState(false);
  const s = store.state;
  const lastStatus = useRef<string | null>(null);
  const lastMode = useRef<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // The battle underneath a screen opened over it can't be focused or clicked (React 18 has no inert prop).
  const isOver = !!s && opensOverBattle(s, ui.view);
  useEffect(() => { mainRef.current?.toggleAttribute('inert', isOver); }, [isOver]);

  useEffect(() => {
    if (!s) return;
    if (s.status === 'complete' && lastStatus.current !== 'complete' && lastStatus.current !== null) {
      ui.setView('aar');
      // Medals earned by the game that just ended.
      for (const m of awardMedals(s)) store.toast('ok', `Medal earned: ${m.name}`);
    }
    lastStatus.current = s.status;
    if (lastMode.current !== s.settings.name + s.settings.seed) {
      lastMode.current = s.settings.name + s.settings.seed;
      ui.setTutorial(s.settings.mode === 'training' && !lessonOf(s));
      // A new or loaded game starts on the main screen with nothing left open from the last one.
      // The battle is home: anything with threat waves opens on the theater map; the rest on Global Operations.
      ui.setView(s.tactical?.enabled ? 'theater' : 'global');
      ui.setRegion(null);
      ui.openEvent(null);
      ui.openAsset(null);
      ui.setTheaterRegion(null);
      ui.setDeployRegion(null);
      ui.setReplayWave(null);
    }
  });

  // Hold the clock while a planning view is open (see store.holdForPlanning).
  const planning = PLANNING_VIEWS.includes(ui.view);
  useEffect(() => { store.holdForPlanning(planning); }, [planning, s?.campaignId, s?.status]);

  // Follow waves: when one launches, go to it on the theater map and drop to 1x until the last wave in flight lands,
  // then return to the player's speed. Waves already in flight when a game is opened are not followed.
  const follow = useRef<{ game?: string; seen: Set<string>; speed: number | null }>({ seen: new Set(), speed: null });
  useEffect(() => {
    if (!s?.tactical?.enabled) return;
    const f = follow.current;
    const flying = incomingWaves(s).filter((x) => x.launched);
    const game = s.campaignId ?? s.settings.name + s.settings.seed;
    if (f.game !== game) { f.game = game; f.seen = new Set(flying.map((x) => x.wave.id)); f.speed = null; return; }
    if (s.status !== 'running') return;
    const fresh = flying.filter((x) => !f.seen.has(x.wave.id));
    for (const x of fresh) f.seen.add(x.wave.id);
    if (fresh.length && followWaves()) {
      ui.setTheaterFocus(fresh[0].wave.region);
      if (!planning) ui.setView('theater');
      if (!s.turnBased && s.speed > 1) { f.speed = f.speed ?? s.speed; dispatch({ type: 'setSpeed', speed: 1 }); }
    }
    if (!flying.length && f.speed !== null) {
      if (!s.turnBased && s.speed === 1) dispatch({ type: 'setSpeed', speed: f.speed as 1 | 2 | 4 | 8 });
      f.speed = null;
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = store.state;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (!st) { if (e.key === '?') ui.setHelp(true); return; } // start screen: only the guide
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveGame(st, 'slot1')) store.toast('ok', 'Quick-saved to SLOT1');
        store.notify();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A window is open (briefing, report, asset, help): its own keys apply, not the command shortcuts behind it.
      if (document.querySelector('.modal-overlay')) { if (e.key === '?') ui.setHelp(true); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (st.status === 'running') dispatch({ type: 'setPaused', paused: !st.paused });
        return;
      }
      if (['1', '2', '3', '4'].includes(e.key)) return chooseSpeed(st, ([1, 2, 4, 8] as const)[Number(e.key) - 1]);
      if (e.key === '?') return ui.setHelp(true);
      if (e.key === 'Escape') {
        if (ui.eventId || ui.assetId) return;
        if (opensOverBattle(st, ui.view)) return ui.setView('theater'); // close a screen opened over the battle
        ui.setRegion(null);
        return;
      }
      const k = e.key.toUpperCase();
      if (k === 'T') { if (dispatch({ type: 'advance', hours: SIM_CONFIG.turnHours }).ok && !st.turnBased) store.toast('info', `Advanced ${SIM_CONFIG.turnHours} hours.`); return; }
      if (k === 'B') return ui.setBottomOpen(!ui.bottomOpen);
      if (k === 'N') { const u = urgentList(st)[0]; if (u) goToUrgent(ui, u); else store.toast('info', 'Nothing needs you right now.'); return; }
      if (k === 'V') return sound.toggleMute();
      const nav = NAV.find((n) => n.key === k);
      if (nav) ui.setView(nav.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui]);

  if (!s) {
    if (editorFirst) {
      return (
        <div className="mx-auto max-w-6xl space-y-2 p-3">
          <button className="btn" onClick={() => setEditorFirst(false)}>◂ Back to main menu</button>
          <Suspense fallback={<Loading />}><ScenarioEditor s={null} onLaunched={() => { setEditorFirst(false); ui.setView('global'); }} /></Suspense>
        </div>
      );
    }
    return (
      <>
        <StartScreen onSandbox={() => setEditorFirst(true)} />
        {ui.help && <GuideModal />}
        {ui.accountOpen && <AccountModal />}
        {ui.academyOpen && <Suspense fallback={null}><AcademyModal /></Suspense>}
      </>
    );
  }

  const lesson = lessonOf(s);
  const view = (() => {
    switch (ui.view) {
      case 'global': return <GlobalOps s={s} />;
      case 'theater': return <TheaterView s={s} />;
      case 'space': case 'air': case 'sea': case 'ground': return <DomainView s={s} domain={ui.view} />;
      case 'intel': return <IntelView s={s} />;
      case 'comms': return <CommsView s={s} />;
      case 'logistics': return <LogisticsView s={s} />;
      case 'infra': return <InfraView s={s} />;
      case 'campaign': return <CampaignView s={s} />;
      case 'editor': return <ScenarioEditor s={s} onLaunched={() => ui.setView('global')} />;
      case 'aar': return <AARView s={s} />;
    }
  })();

  const over = opensOverBattle(s, ui.view);
  const overTitle = NAV.find((n) => n.id === ui.view)?.label ?? '';
  const inbound = incomingWaves(s);
  return (
    <div className="app-root flex min-h-full flex-col pb-[var(--tabbar-h)] lg:h-full lg:pb-0">
      <TopBar s={s} />
      {s.status === 'complete' && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-ops-green/40 bg-ops-green/10 px-3 py-1 text-ops-green">
          SCENARIO COMPLETE — review the after-action report.
          <button className="btn" onClick={() => ui.setView('aar')}>Open AAR</button>
          <button className="btn" onClick={() => { store.quit(); ui.setView('global'); }} title="Back to the start screen to begin a new run (this run stays in your autosave)">New run: start screen ▸</button>
        </div>
      )}
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <LeftNav s={s} />
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:flex-row">
          <div className="relative flex min-w-0 flex-1 flex-col lg:min-h-0">
            {/* The battle stays live underneath a network or staff screen opened over it. */}
            <main className="min-w-0 flex-1 p-2 lg:min-h-0 lg:overflow-y-auto" id="main" ref={mainRef} aria-hidden={over || undefined}>
              <Suspense fallback={<Loading />}>{over ? <TheaterView s={s} /> : view}</Suspense>
            </main>
            {over && (
              <section className="fixed inset-x-0 bottom-[var(--tabbar-h)] top-[var(--header-h,3.5rem)] z-30 flex flex-col border-l border-ops-cyan/30 bg-ops-bg shadow-2xl lg:absolute lg:inset-0" aria-label={overTitle} data-over-battle>
                <div className="flex flex-wrap items-center gap-2 border-b border-ops-line bg-ops-panel/90 px-2 py-1.5">
                  <button className="btn" onClick={() => ui.setView('theater')} title="Back to the battle (Esc)">◂ {tr('Battle')}</button>
                  <span className="font-sans text-[13px] font-semibold uppercase tracking-[0.14em] text-white">{tr(overTitle)}</span>
                  {inbound.length > 0 && (
                    <button className="chip blink ml-auto border-ops-red/60 bg-ops-red/15 px-2 py-0.5 text-[11px] text-ops-red" onClick={() => { ui.setTheaterFocus(inbound[0].wave.region); ui.setView('theater'); }}>
                      ⚠ {inbound.length} wave{inbound.length === 1 ? '' : 's'} inbound · {s.regions[inbound[0].wave.region].short}
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2"><Suspense fallback={<Loading />}>{view}</Suspense></div>
              </section>
            )}
          </div>
          <RightSidebar s={s} />
        </div>
      </div>
      <BottomPanel s={s} />
      <MobileTabs s={s} />
      {s.status === 'briefing' && <BriefingModal s={s} />}
      <PausePrompt s={s} docked={PLANNING_VIEWS.includes(ui.view)} />
      <WaveCard s={s} />
      {ui.eventId && <EventModal s={s} />}
      {ui.assetId && !ui.eventId && <AssetModal s={s} />}
      {ui.help && <GuideModal />}
      {lesson ? <Suspense fallback={null}><Coach key={s.campaignId ?? s.settings.name} s={s} lesson={lesson} /></Suspense> : ui.tutorial && <TutorialPanel />}
      {ui.accountOpen && <AccountModal />}
      {ui.academyOpen && <Suspense fallback={null}><AcademyModal /></Suspense>}
    </div>
  );
}
