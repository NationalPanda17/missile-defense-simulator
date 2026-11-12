import { useEffect, useRef, useState } from 'react';
import { SIM_CONFIG, saveGame } from '../engine';
import { dispatch, store, useStoreVersion } from '../store/simStore';
import { AccountModal } from './Account';
import { AssetModal, BriefingModal, EventModal, HelpModal, StartScreen, Toasts, TutorialPanel } from './Modals';
import { BottomPanel, LeftNav, NAV, RightSidebar, TopBar } from './Shell';
import { UIProvider, useUI } from './uiState';
import { AARView } from './views/AARView';
import { CampaignView, ScenarioEditor } from './views/CampaignViews';
import { DomainView } from './views/DomainView';
import { GlobalOps } from './views/GlobalOps';
import { CommsView, InfraView, IntelView, LogisticsView } from './views/StaffViews';

export default function App() {
  return (
    <UIProvider>
      <Root />
      <Toasts />
    </UIProvider>
  );
}

function Root() {
  useStoreVersion();
  const ui = useUI();
  const [editorFirst, setEditorFirst] = useState(false);
  const s = store.state;
  const lastStatus = useRef<string | null>(null);
  const lastMode = useRef<string | null>(null);

  useEffect(() => {
    if (!s) return;
    if (s.status === 'complete' && lastStatus.current !== 'complete' && lastStatus.current !== null) ui.setView('aar');
    lastStatus.current = s.status;
    if (lastMode.current !== s.settings.name + s.settings.seed) {
      lastMode.current = s.settings.name + s.settings.seed;
      ui.setTutorial(s.settings.mode === 'training');
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = store.state;
      if (!st) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveGame(st, 'slot1')) store.toast('ok', 'Quick-saved to SLOT1');
        store.notify();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (st.status === 'running') dispatch({ type: 'setPaused', paused: !st.paused });
        return;
      }
      if (['1', '2', '3', '4'].includes(e.key)) return void dispatch({ type: 'setSpeed', speed: ([1, 2, 4, 8] as const)[Number(e.key) - 1] });
      if (e.key === '?') return ui.setHelp(true);
      if (e.key === 'Escape') { if (!ui.eventId && !ui.assetId) ui.setRegion(null); return; }
      const k = e.key.toUpperCase();
      if (k === 'T') return void dispatch({ type: 'advance', hours: SIM_CONFIG.turnHours });
      if (k === 'B') return ui.setBottomOpen(!ui.bottomOpen);
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
          <ScenarioEditor s={null} onLaunched={() => { setEditorFirst(false); ui.setView('global'); }} />
        </div>
      );
    }
    return (
      <>
        <StartScreen onSandbox={() => setEditorFirst(true)} />
        {ui.accountOpen && <AccountModal />}
      </>
    );
  }

  const view = (() => {
    switch (ui.view) {
      case 'global': return <GlobalOps s={s} />;
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

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <TopBar s={s} />
      {s.status === 'complete' && (
        <div className="flex items-center justify-center gap-3 border-b border-ops-green/40 bg-ops-green/10 px-3 py-1 text-ops-green">
          SCENARIO COMPLETE — review the after-action report.
          <button className="btn" onClick={() => ui.setView('aar')}>Open AAR</button>
          <button className="btn" onClick={() => ui.setView('campaign')}>New run</button>
        </div>
      )}
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        <LeftNav s={s} />
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:flex-row">
          <main className="min-w-0 flex-1 p-2 lg:min-h-0 lg:overflow-y-auto" id="main">{view}</main>
          <RightSidebar s={s} />
        </div>
      </div>
      <BottomPanel s={s} />
      {s.status === 'briefing' && <BriefingModal s={s} />}
      {ui.eventId && <EventModal s={s} />}
      {ui.assetId && !ui.eventId && <AssetModal s={s} />}
      {ui.help && <HelpModal />}
      {ui.tutorial && <TutorialPanel />}
      {ui.accountOpen && <AccountModal />}
    </div>
  );
}
