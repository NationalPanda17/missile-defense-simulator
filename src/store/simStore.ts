// Bridges the pure simulation engine to React: owns the real-time loop, autosave and notifications.
import { useSyncExternalStore } from 'react';
import {
  SIM_CONFIG, createInitialState, execute, saveGame, type Command, type CommandResult, type ScenarioSettings, type SimState, type Slot,
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

class SimStore {
  state: SimState | null = null;
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
    this.toast('info', `New scenario: ${settings.name}`);
    this.ensureLoop();
    this.notify();
  }

  load(state: SimState) {
    this.state = state;
    state.paused = true;
    if (!state.campaignId) state.campaignId = newId(); // saves from before the server existed
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
    const r = execute(this.state, cmd);
    if (!r.ok) this.toast('err', r.message);
    else if (!['setPaused', 'setSpeed', 'advance', 'beginPhase'].includes(cmd.type)) this.toast('ok', r.message);
    if (this.state.hour !== before) this.afterHours(before);
    this.notify();
    return r;
  };

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
      saveGame(s, 'auto');
      this.pushAutosave();
    }
  }

  // ── Server persistence ────────────────────────────────────────────────

  /** Probe the API and refresh the save list and campaign history. */
  async refreshServer() {
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
        await this.writeServer('auto', this.state!, false);
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

  private ensureLoop() {
    if (this.timer !== null) return;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.frame(), 50);
  }

  private frame() {
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
    return this.state && !this.state.paused ? this.acc / SIM_CONFIG.msPerHourAt1x : 0;
  }
}

export const store = new SimStore();
if (typeof window !== 'undefined') {
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
