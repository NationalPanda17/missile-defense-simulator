// Browser client for the persistence API. Authentication is a server session in an HttpOnly cookie.
import { SAVE_VERSION, type SimState, type Slot } from '../engine';
import type { AuthResult, CampaignDetail, CampaignSummary, SaveSummary } from '../shared/api';

const ID_KEY = 'mds.playerId';

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); // needs a secure context
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const newId = uuid;

/**
 * Anonymous player id from the pre-accounts version (if this browser has one). Sent once at registration so the
 * new account can adopt that player's existing server campaigns. Never used for authentication.
 */
export function legacyPlayerId(): string | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}
export function forgetLegacyPlayerId() {
  try { localStorage.removeItem(ID_KEY); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api${path}`, {
      ...init,
      signal: ctl.signal,
      credentials: 'same-origin', // session cookie
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. dev proxy error page) */ }
    if (!res.ok) {
      // A non-JSON error means the API itself never answered (e.g. the dev proxy could not reach it).
      if (body === null && res.status >= 500) throw new ApiError(0, 'Server unreachable');
      throw new ApiError(res.status, (body as { error?: string })?.error ?? `HTTP ${res.status}`);
    }
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, ctl.signal.aborted ? 'Server timed out' : 'Server unreachable');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request<{ ok: boolean; db: boolean; saveVersion: number }>('/health', {}, 4000),
  me: () => request<AuthResult>('/auth/me'),
  register: (username: string, password: string, claimPlayerId?: string) =>
    request<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, claimPlayerId }) }),
  login: (username: string, password: string) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST', body: '{}' }),
  logoutOthers: () => request<{ revokedSessions: number }>('/auth/logout-others', { method: 'POST', body: '{}' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ revokedSessions: number }>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  deleteAccount: (password: string) => request<void>('/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) }),
  setCallsign: (callsign: string) => request<AuthResult>('/player', { method: 'PUT', body: JSON.stringify({ callsign }) }),
  listSaves: () => request<SaveSummary[]>('/saves'),
  async getSave(slot: Slot): Promise<SimState> {
    const r = await request<{ v: number; state: SimState }>(`/saves/${slot}`);
    if (r.v !== SAVE_VERSION) throw new ApiError(0, 'Incompatible save version');
    return r.state;
  },
  putSave: (slot: Slot, state: SimState) =>
    request<SaveSummary>(`/saves/${slot}`, { method: 'PUT', body: JSON.stringify({ v: SAVE_VERSION, state }) }, 20_000),
  deleteSave: (slot: Slot) => request<void>(`/saves/${slot}`, { method: 'DELETE' }),
  listCampaigns: () => request<CampaignSummary[]>('/campaigns'),
  getCampaign: (id: string) => request<CampaignDetail>(`/campaigns/${id}`),
  deleteCampaign: (id: string) => request<void>(`/campaigns/${id}`, { method: 'DELETE' }),
};
