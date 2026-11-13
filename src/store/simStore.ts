// Bridges the pure simulation engine to React: owns the real-time loop, autosave and notifications.
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  SIM_CONFIG, createInitialState, execute, saveGame, type Command, type CommandResult, type ScenarioSettings, type SimState, type Slot,
  BATCH_HOURS, autosaveSlot, defaultAutoPause, pauseMemo, pauseReasons, type AutoPauseSettings, type PauseMemo, type PauseReason,
} from '../engine';
import type { AccountInfo, CampaignSummary, SaveSummary } from '../shared/api';
import { api, ApiError, forgetLegacyPlayerId, legacyPlayerId, newId } from './remote';

export interface Toast { id: number; tone: 'ok' | 'err' | 'info'; text: string }

export interface ServerState {
  status: 'unknown' | 'online' | 'offline';
  user: AccountInfo | null; // signed-in account (null = guest: browser saves only)
  saves: SaveSummary[];
  campaigns: CampaignSummary[];
  lastSync: number | null; // epoch ms of last successful server write
  syncing: boolean;
  error: string | null;
}

const PACING_KEY = 'mds.autopause';

/** A held report or escalation is only worth pausing for if the report is still waiting on the player. */
function isStillRelevant(s: SimState, r: PauseReason): boolean {
  if (!r.eventId) return true;
  const e = s.events.find((x) => x.id === r.eventId);
  return !!e && e.status === 'reported';
}

/** The player's auto-pause choices, or null to use the defaults for the scenario's difficulty. */
function loadPacing(): AutoPauseSettings | null {
  try {
    const raw = localStorage.getItem(PACING_KEY);
    return raw ? (JSON.parse(raw) as AutoPauseSettings) : null;
  } catch { return null; }
}

class SimStore {
  state: SimState | null = null;
  /** Why the game just paused itself (shown with what the player can do), or null. */
  pausePrompt: PauseReason[] | null = null;
  pacing: AutoPauseSettings | null = loadPacing();
  private pMemo: PauseMemo | null = null;
  private held: PauseReason[] = [];
  /** True while the clock is stopped because the player is in a planning view (not by the player's own order). */
  viewHold = false;
  private lastBatchPause = -Infinity;
  version = 0;
  toasts: Toast[] = [];
  server: ServerState = { status: 'unknown', user: null, saves: [], campaigns: [], lastSync: null, syncing: false, error: null };
  private pushInFlight = false;
  private pushQueued = false;
  private listeners = new Set<() => void>();
  private acc = 0;
  private last = 0;
  private timer: number | null = null;
  private toastId = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  notify() {
    this.version++;
    for (const l of this.listeners) l();
  }

  newGame(settings: ScenarioSettings) {
    this.state = createInitialState(settings);
    this.state.campaignId = newId();
    this.pMemo = pauseMemo(this.state);
    this.pausePrompt = null;
    this.held = [];
    this.viewHold = false;
    this.lastBatchPause = -Infinity;
    this.toast('info', `New scenario: ${settings.name}`);
    this.ensureLoop();
    this.notify();
  }

  load(state: SimState) {
    this.state = state;
    state.paused = true;
    if (!state.campaignId) state.campaignId = newId(); // saves from before the server existed
    this.pMemo = pauseMemo(state);
    this.pausePrompt = null;
    this.held = [];
    this.viewHold = false;
    this.lastBatchPause = -Infinity;
    this.ensureLoop();
    this.notify();
  }

  quit() {
    this.state = null;
    this.notify();
  }

  dispatch = (cmd: Command): CommandResult => {
    if (!this.state) return { ok: false, message: 'No active scenario' };
    const before = this.state.hour;
    const r = cmd.type === 'advance' ? this.advanceWatched(cmd.hours) : execute(this.state, cmd);
    if (cmd.type === 'setPaused' && !cmd.paused) this.pausePrompt = null;
    if (cmd.type === 'setPaused' || cmd.type === 'setTurnBased') this.viewHold = false; // the player has taken over
    if (!r.ok) this.toast('err', r.message);
    else if (!['setPaused', 'setSpeed', 'advance', 'beginPhase'].includes(cmd.type)) this.toast('ok', r.message);
    if (this.state.hour !== before) this.afterHours(before);
    this.notify();
    return r;
  };

  /** Auto-pause choices in force for the current scenario (training lessons have the coach instead). */
  autoPause(): AutoPauseSettings | null {
    const s = this.state;
    if (!s || s.settings.mode === 'training') return null;
    return this.pacing ?? defaultAutoPause(s.settings.level);
  }

  setPacing(p: AutoPauseSettings | null) {
    this.pacing = p;
    try { if (p) localStorage.setItem(PACING_KEY, JSON.stringify(p)); else localStorage.removeItem(PACING_KEY); } catch { /* ignore */ }
    this.notify();
  }

  /** Advance hour by hour, stopping as soon as something the player asked to be stopped for happens. */
  private advanceWatched(hours: number) {
    const s = this.state!;
    let r = { ok: true, message: `Advanced ${hours}h` };
    for (let i = 0; i < hours && s.status === 'running'; i++) {
      r = execute(s, { type: 'advance', hours: 1 });
      if (!r.ok) return r;
      const found = pauseReasons(this.pMemo, s);
      this.pMemo = found.memo;
      const want = this.autoPause();
      const wanted = want ? found.reasons.filter((x) => want[x.kind]) : [];
      // Batch report and escalation pauses (at most one per BATCH_HOURS); keep what happened meanwhile for the prompt.
      this.held.push(...wanted.filter((x) => x.kind !== 'launch'));
      const launch = wanted.filter((x) => x.kind === 'launch');
      const due = this.held.length > 0 && s.hour - this.lastBatchPause >= BATCH_HOURS;
      if (launch.length || due) {
        const hits = [...launch, ...this.held.filter((x) => isStillRelevant(s, x))];
        this.held = [];
        if (!launch.length) this.lastBatchPause = s.hour;
        if (!hits.length) continue;
        this.pausePrompt = hits;
        s.paused = true; // the game's own pause, not a player order: not written to the command log
        this.acc = 0;
        break;
      }
    }
    return r;
  }

  /**
   * Planning views (Campaign Management, the Scenario Editor, the AAR) are not where a running crisis can be handled,
   * so the clock stops while one is open and restarts on the way back to operations, unless the player paused or
   * resumed it themselves meanwhile. Like the auto-pause, this is the game's pause and is not written to the log.
   */
  holdForPlanning(planning: boolean) {
    const s = this.state;
    if (!s) return;
    if (planning) {
      if (s.status !== 'running' || s.paused || s.turnBased || this.viewHold) return;
      s.paused = true;
      this.acc = 0;
      this.viewHold = true;
      this.notify();
    } else if (this.viewHold) {
      this.viewHold = false;
      if (s.status === 'running' && s.paused && !this.pausePrompt) s.paused = false;
      this.notify();
    }
  }

  dismissPausePrompt() {
    this.pausePrompt = null;
    this.notify();
  }

  toast(tone: Toast['tone'], text: string) {
    const id = ++this.toastId;
    this.toasts = [...this.toasts.slice(-4), { id, tone, text }];
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }, 3800);
  }

  private afterHours(before: number) {
    const s = this.state!;
    if (Math.floor(s.hour / 12) !== Math.floor(before / 12) || s.status === 'complete' || s.status === 'briefing') {
      saveGame(s, autosaveSlot(s));
      this.pushAutosave();
    }
  }

  // ── Server persistence ────────────────────────────────────────────────

  /** Probe the API and refresh the save list and campaign history. */
  async refreshServer() {
    if (BROWSER_ONLY) {
      this.server = { ...this.server, status: 'offline', error: null };
      return;
    }
    try {
      const h = await api.health();
      if (!h.db) throw new ApiError(503, 'Database unavailable');
      let user: AccountInfo | null = null;
      try {
        user = (await api.me()).user;
      } catch (e) {
        if ((e as ApiError).status !== 401) throw e;
      }
      const [saves, campaigns] = user ? await Promise.all([api.listSaves(), api.listCampaigns()]) : [[], []];
      this.server = { ...this.server, status: 'online', user, saves, campaigns, error: null };
    } catch (e) {
      this.server = { ...this.server, status: 'offline', error: (e as Error).message };
    }
    this.notify();
  }

  // ── Accounts ──────────────────────────────────────────────────────────

  async login(username: string, password: string) {
    const r = await api.login(username, password);
    this.server = { ...this.server, user: r.user };
    this.toast('ok', `Signed in as ${r.user.username}`);
    await this.refreshServer();
    this.pushAutosave();
  }

  async register(username: string, password: string) {
    const r = await api.register(username, password, legacyPlayerId() ?? undefined);
    forgetLegacyPlayerId();
    this.server = { ...this.server, user: r.user };
    this.toast('ok', r.claimed ? 'Account created — your earlier server saves are now linked to it.' : `Welcome, ${r.user.username}`);
    await this.refreshServer();
    this.pushAutosave();
  }

  async logout() {
    try { await api.logout(); } catch { /* clear locally regardless */ }
    this.server = { ...this.server, user: null, saves: [], campaigns: [], lastSync: null };
    this.toast('info', 'Signed out. Saves now stay in this browser.');
    this.notify();
  }

  async updateAccount(fn: () => Promise<{ user: AccountInfo } | unknown>) {
    const r = (await fn()) as { user?: AccountInfo };
    if (r?.user) this.server = { ...this.server, user: r.user };
    else await this.refreshServer();
    this.notify();
  }

  async deleteAccount(password: string) {
    await api.deleteAccount(password);
    this.server = { ...this.server, user: null, saves: [], campaigns: [], lastSync: null };
    if (this.state) this.state.campaignId = newId(); // the old campaign record no longer exists
    this.toast('info', 'Account and all server data deleted.');
    this.notify();
  }

  /** A 401 from any authenticated call means the session ended (expired, revoked or password changed elsewhere). */
  private sessionEnded() {
    if (!this.server.user) return;
    this.server = { ...this.server, user: null, saves: [], campaigns: [] };
    this.toast('err', 'Your session has ended — sign in again to keep saving to the server.');
    this.notify();
  }

  /** Autosave to the server. Coalesces: at most one request in flight, latest state wins. */
  private async pushAutosave() {
    if (this.server.status !== 'online' || !this.server.user || !this.state) return;
    if (this.pushInFlight) {
      this.pushQueued = true;
      return;
    }
    this.pushInFlight = true;
    try {
      do {
        this.pushQueued = false;
        await this.writeServer(autosaveSlot(this.state!), this.state!, false);
      } while (this.pushQueued && this.state);
    } finally {
      this.pushInFlight = false;
    }
  }

  private async writeServer(slot: Slot, state: SimState, announce: boolean) {
    this.server = { ...this.server, syncing: true };
    this.notify();
    try {
      const meta = await api.putSave(slot, state);
      this.server = {
        ...this.server, syncing: false, lastSync: Date.now(), error: null,
        saves: [...this.server.saves.filter((x) => x.slot !== slot), meta].sort((a, b) => a.slot.localeCompare(b.slot)),
      };
      if (announce) this.toast('ok', `Saved to server ${slot.toUpperCase()}`);
      void this.refreshCampaigns(); // keep the service record current
      return true;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        this.server = { ...this.server, syncing: false };
        this.sessionEnded();
        return false;
      }
      const down = err.status === 0 || err.status >= 500;
      this.server = { ...this.server, syncing: false, error: err.message, status: down ? 'offline' : this.server.status };
      if (announce) this.toast('err', `Server save failed: ${err.message}`);
      else if (down) this.toast('info', 'Persistence server offline — saving to this browser only.');
      else this.toast('err', `Server autosave rejected: ${err.message}`);
      return false;
    } finally {
      this.notify();
    }
  }

  async serverSave(slot: Slot) {
    if (!this.state) return false;
    return this.writeServer(slot, this.state, true);
  }

  async serverLoad(slot: Slot) {
    try {
      const st = await api.getSave(slot);
      this.load(st);
      this.toast('ok', `Loaded server ${slot.toUpperCase()}`);
      return true;
    } catch (e) {
      if ((e as ApiError).status === 401) this.sessionEnded();
      else this.toast('err', `Server load failed: ${(e as Error).message}`);
      return false;
    }
  }

  async serverDelete(slot: Slot) {
    try {
      await api.deleteSave(slot);
      this.server = { ...this.server, saves: this.server.saves.filter((x) => x.slot !== slot) };
      this.toast('info', `Deleted server ${slot.toUpperCase()}`);
    } catch (e) {
      this.toast('err', `Delete failed: ${(e as Error).message}`);
    }
    this.notify();
  }

  async deleteCampaign(id: string) {
    try {
      await api.deleteCampaign(id);
      this.toast('info', 'Campaign record deleted');
      await this.refreshServer();
    } catch (e) {
      this.toast('err', `Delete failed: ${(e as Error).message}`);
    }
  }

  private async refreshCampaigns() {
    try {
      this.server = { ...this.server, campaigns: await api.listCampaigns() };
      this.notify();
    } catch { /* non-critical */ }
  }

  private tickVar = '';
  /** Expose one simulated hour's real duration as the CSS variable --tick, so meters glide from hour to hour. */
  private syncTickVar() {
    const s = this.state;
    const v = s && s.status === 'running' && !s.paused && !s.turnBased ? `${Math.round(SIM_CONFIG.msPerHourAt1x / s.speed)}ms` : '400ms';
    if (v !== this.tickVar && typeof document !== 'undefined') {
      this.tickVar = v;
      document.documentElement.style.setProperty('--tick', v);
    }
  }

  private ensureLoop() {
    if (this.timer !== null) return;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.frame(), 50);
  }

  private frame() {
    this.syncTickVar();
    const now = performance.now();
    const dt = Math.min(500, now - this.last);
    this.last = now;
    const s = this.state;
    if (!s || s.paused || s.turnBased || s.status !== 'running') {
      this.acc = 0;
      return;
    }
    this.acc += dt * s.speed;
    const per = SIM_CONFIG.msPerHourAt1x;
    if (this.acc >= per) {
      const hours = Math.floor(this.acc / per);
      this.acc -= hours * per;
      this.dispatch({ type: 'advance', hours });
    }
  }

  /** Fraction of the current hour elapsed — used for smooth map animation. */
  hourFraction() {
    const s = this.state;
    if (!s || s.paused || s.turnBased || s.status !== 'running') return 0;
    return Math.min(0.999, this.acc / SIM_CONFIG.msPerHourAt1x);
  }

  /** Continuous sim time in hours: the current hour plus the fraction already elapsed, for smooth display. */
  simTime() {
    return (this.state?.hour ?? 0) + this.hourFraction();
  }
}

/**
 * The GitHub Pages build has no save server, so it never asks for one (set VITE_BROWSER_ONLY=1 at build time).
 * Saves stay in the browser; accounts need the desktop app, the start files or a hosted server.
 */
export const BROWSER_ONLY = import.meta.env.VITE_BROWSER_ONLY === '1';

export const store = new SimStore();
if (typeof window !== 'undefined' && !BROWSER_ONLY) {
  void store.refreshServer();
  // Re-probe periodically so the game picks the server up if it starts later.
  window.setInterval(() => {
    if (store.server.status !== 'online') void store.refreshServer();
  }, 30_000);
}

export function useSim(): SimState {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state!;
}

export function useStoreVersion() {
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

export const dispatch = store.dispatch;

/**
 * Continuous sim time (hours) that updates every animation frame while the clock runs. Use only in small components
 * (clock, timeline, moving markers): each one re-renders per frame.
 */
export function useSimTime(): number {
  useStoreVersion();
  const [t, setT] = useState(() => store.simTime());
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setT(store.simTime());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return Math.max(t, store.state?.hour ?? 0);
}
