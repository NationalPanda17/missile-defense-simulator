// UI-only state (navigation, selection, overlays). Kept separate from the simulation state.
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { RegionId } from '../engine';

export type ViewId =
  | 'global' | 'space' | 'air' | 'sea' | 'ground' | 'intel' | 'comms' | 'logistics' | 'infra'
  | 'campaign' | 'editor' | 'aar';

export type OverlayMetric = 'readiness' | 'stability' | 'comms' | 'awareness' | 'infrastructure' | 'none';
export interface Layers {
  space: boolean; air: boolean; sea: boolean; ground: boolean; infrastructure: boolean;
  comms: boolean; sensors: boolean; events: boolean; history: boolean; labels: boolean;
}

interface UIState {
  view: ViewId; setView: (v: ViewId) => void;
  region: RegionId | null; setRegion: (r: RegionId | null) => void;
  eventId: string | null; openEvent: (id: string | null) => void;
  assetId: string | null; openAsset: (id: string | null) => void;
  layers: Layers; toggleLayer: (k: keyof Layers) => void;
  overlay: OverlayMetric; setOverlay: (m: OverlayMetric) => void;
  tutorial: boolean; setTutorial: (b: boolean) => void;
  help: boolean; setHelp: (b: boolean) => void;
  bottomOpen: boolean; setBottomOpen: (b: boolean) => void;
  accountOpen: boolean; setAccountOpen: (b: boolean) => void;
}

const Ctx = createContext<UIState | null>(null);

function loadLayers(): Layers {
  const def: Layers = { space: true, air: true, sea: true, ground: true, infrastructure: true, comms: true, sensors: true, events: true, history: false, labels: true };
  try {
    const raw = localStorage.getItem('mds.layers');
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>('global');
  const [region, setRegion] = useState<RegionId | null>(null);
  const [eventId, openEvent] = useState<string | null>(null);
  const [assetId, openAsset] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>(loadLayers);
  const [overlay, setOverlay] = useState<OverlayMetric>('readiness');
  const [tutorial, setTutorial] = useState(false);
  const [help, setHelp] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const toggleLayer = (k: keyof Layers) =>
    setLayers((l) => {
      const n = { ...l, [k]: !l[k] };
      try { localStorage.setItem('mds.layers', JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });
  return (
    <Ctx.Provider value={{ view, setView, region, setRegion, eventId, openEvent, assetId, openAsset, layers, toggleLayer, overlay, setOverlay, tutorial, setTutorial, help, setHelp, bottomOpen, setBottomOpen, accountOpen, setAccountOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUI() {
  const c = useContext(Ctx);
  if (!c) throw new Error('UIProvider missing');
  return c;
}
