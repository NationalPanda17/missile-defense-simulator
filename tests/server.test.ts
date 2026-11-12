// Integration tests for the persistence API and authentication against a real PostgreSQL.
// Uses TEST_DATABASE_URL if set (its data is TRUNCATED); otherwise boots a throwaway embedded PostgreSQL.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from '../server/app';
import { hashPassword, verifyPassword } from '../server/auth';
import { createPool, migrate } from '../server/db';
import { createInitialState, defaultSettings, execute, type SimState } from '../src/engine';
import { startEmbedded } from '../scripts/dev-db';

let pool: pg.Pool;
let cleanup: () => Promise<void> = async () => {};
const servers: http.Server[] = [];

async function listen(extra: Partial<AppOptions> = {}) {
  const server = http.createServer(createApp({ pool, ...extra }));
  await new Promise<void>((r) => server.listen(0, r));
  servers.push(server);
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

/** A minimal cookie-jar client, like one browser. */
function agent(origin: string) {
  let cookie = '';
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(origin + '/api' + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = /Max-Age=0/.test(set) ? '' : set.split(';')[0];
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed, setCookie: set, headers: res.headers };
  };
  return { call, get cookie() { return cookie; }, set cookie(v: string) { cookie = v; } };
}

const PW = 'correct horse battery staple';
let uniq = 0;
const uname = (p = 'cmdr') => `${p}${++uniq}_${randomUUID().slice(0, 6)}`;

async function signedUp(origin: string, username = uname()) {
  const a = agent(origin);
  const r = await a.call('POST', '/auth/register', { username, password: PW });
  expect(r.status).toBe(201);
  return Object.assign(a, { username, userId: r.body.user.id as string });
}

function playedState(hours: number, campaignId = randomUUID()): SimState {
  const s = createInitialState(defaultSettings('campaign', { seed: 99 }));
  s.campaignId = campaignId;
  execute(s, { type: 'beginPhase' });
  execute(s, { type: 'advance', hours });
  return s;
}

let base = '';

beforeAll(async () => {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mds-pg-'));
    const port = 55000 + Math.floor(Math.random() * 5000);
    const db = await startEmbedded({ dir, port, quiet: true });
    url = `postgres://mds:mds@localhost:${port}/mds`;
    cleanup = async () => {
      await db.stop();
      await rm(dir, { recursive: true, force: true });
    };
  }
  pool = createPool(url);
  await migrate(pool, () => {});
  await pool.query('TRUNCATE players CASCADE');
  base = await listen({ limits: { registerPerIp: 1000, loginPerIp: 1000 } }); // many sign-ups from one test IP
}, 120_000);

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await pool?.end();
  await cleanup();
}, 60_000);

describe('password hashing', () => {
  it('uses salted scrypt and verifies only the right password', async () => {
    const a = await hashPassword(PW);
    const b = await hashPassword(PW);
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PW, a)).toBe(true);
    expect(await verifyPassword(PW + 'x', a)).toBe(false);
    expect(await verifyPassword(PW, 'garbage')).toBe(false);
  });
});

describe('authentication', () => {
  it('health is public; everything else requires a session', async () => {
    const a = agent(base);
    expect((await a.call('GET', '/health')).body).toMatchObject({ ok: true, db: true });
    for (const [m, u] of [['GET', '/saves'], ['GET', '/campaigns'], ['GET', '/auth/me'], ['PUT', '/saves/slot1']] as const) {
      expect((await a.call(m, u, m === 'PUT' ? { v: 1, state: {} } : undefined)).status).toBe(401);
    }
    // The pre-accounts header is no longer a credential.
    expect((await a.call('GET', '/saves', undefined, { 'X-Player-Id': randomUUID() })).status).toBe(401);
  });

  it('registers with a hardened HttpOnly session cookie and stores only a token hash', async () => {
    const a = agent(base);
    const r = await a.call('POST', '/auth/register', { username: 'Alpha_One', password: PW });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ username: 'Alpha_One', callsign: 'Alpha_One', activeSessions: 1 });
    expect(r.setCookie).toMatch(/^mds_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    const token = a.cookie.split('=')[1];
    const rows = (await pool.query('SELECT token_hash FROM sessions')).rows.map((x) => x.token_hash.toString('hex'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.join()).not.toContain(Buffer.from(token).toString('hex'));
    expect((await pool.query("SELECT password_hash FROM users WHERE username = 'Alpha_One'")).rows[0].password_hash).not.toContain(PW);
    expect((await a.call('GET', '/auth/me')).body.user.username).toBe('Alpha_One');
  });

  it('adds the Secure flag when configured', async () => {
    const r = await agent(await listen({ secureCookies: true })).call('POST', '/auth/register', { username: uname(), password: PW });
    expect(r.setCookie).toMatch(/; Secure$/);
  });

  it('validates usernames and passwords and rejects duplicates case-insensitively', async () => {
    const a = agent(base);
    expect((await a.call('POST', '/auth/register', { username: 'ab', password: PW })).status).toBe(400);
    expect((await a.call('POST', '/auth/register', { username: 'bad name', password: PW })).status).toBe(400);
    expect((await a.call('POST', '/auth/register', { username: uname(), password: 'short' })).body.error).toMatch(/10 characters/);
    expect((await a.call('POST', '/auth/register', { username: 'samename1', password: 'xxsamename1xx' })).body.error).toMatch(/username/);
    expect((await a.call('POST', '/auth/register', { username: 'alpha_one', password: PW })).status).toBe(409);
  });

  it('logs in case-insensitively and rejects wrong passwords with one generic message', async () => {
    expect((await agent(base).call('POST', '/auth/login', { username: 'ALPHA_ONE', password: PW })).status).toBe(200);
    const wrong = await agent(base).call('POST', '/auth/login', { username: 'alpha_one', password: 'nope-nope-nope' });
    const missing = await agent(base).call('POST', '/auth/login', { username: 'no_such_user', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error).toBe(missing.body.error);
  });

  it('rate-limits repeated failed logins per username', async () => {
    const origin = await listen({ limits: { loginPerUser: 3, loginPerIp: 100 } });
    const u = await signedUp(origin);
    for (let i = 0; i < 3; i++) expect((await agent(origin).call('POST', '/auth/login', { username: u.username, password: 'wrong-wrong-1' })).status).toBe(401);
    const blocked = await agent(origin).call('POST', '/auth/login', { username: u.username, password: PW });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rate-limits account creation per IP', async () => {
    const origin = await listen({ limits: { registerPerIp: 2 } });
    await signedUp(origin);
    await signedUp(origin);
    expect((await agent(origin).call('POST', '/auth/register', { username: uname(), password: PW })).status).toBe(429);
  });

  it('logout revokes the session server-side, not just the cookie', async () => {
    const a = await signedUp(base);
    const stolen = a.cookie;
    expect((await a.call('POST', '/auth/logout', {})).status).toBe(204);
    const b = agent(base);
    b.cookie = stolen;
    expect((await b.call('GET', '/auth/me')).status).toBe(401);
  });

  it('rejects expired sessions and clears the cookie', async () => {
    const a = await signedUp(base);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [a.userId]);
    const r = await a.call('GET', '/auth/me');
    expect(r.status).toBe(401);
    expect(r.setCookie).toMatch(/Max-Age=0/);
  });

  it('changing the password needs the current one and signs out other sessions', async () => {
    const a = await signedUp(base);
    const other = agent(base);
    expect((await other.call('POST', '/auth/login', { username: a.username, password: PW })).status).toBe(200);
    expect((await a.call('POST', '/auth/password', { currentPassword: 'wrong-password', newPassword: 'a brand new passphrase' })).status).toBe(403);
    const r = await a.call('POST', '/auth/password', { currentPassword: PW, newPassword: 'a brand new passphrase' });
    expect(r.body).toMatchObject({ ok: true, revokedSessions: 1 });
    expect((await a.call('GET', '/auth/me')).status).toBe(200);
    expect((await other.call('GET', '/auth/me')).status).toBe(401);
    expect((await agent(base).call('POST', '/auth/login', { username: a.username, password: PW })).status).toBe(401);
    expect((await agent(base).call('POST', '/auth/login', { username: a.username, password: 'a brand new passphrase' })).status).toBe(200);
  });

  it('refuses CSRF-shaped requests: non-JSON bodies and foreign origins', async () => {
    const a = await signedUp(base);
    const form = await fetch(`${base}/api/auth/logout-others`, {
      method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1',
    });
    expect(form.status).toBe(415);
    expect((await a.call('POST', '/auth/logout-others', {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await a.call('POST', '/auth/logout-others', {}, { Origin: base })).status).toBe(200);
  });

  it('claims a pre-accounts anonymous player once, keeping its campaigns', async () => {
    const legacy = randomUUID();
    const cid = randomUUID();
    await pool.query('INSERT INTO players (id) VALUES ($1)', [legacy]);
    await pool.query(
      `INSERT INTO campaigns (id, player_id, name, mode, seed, status, phase_index, phase_name, phase_count, sim_hour)
       VALUES ($1, $2, 'Old Op', 'campaign', 1, 'running', 0, 'P1', 4, 12)`, [cid, legacy]);
    const a = agent(base);
    const r = await a.call('POST', '/auth/register', { username: uname('claim'), password: PW, claimPlayerId: legacy });
    expect(r.body.claimed).toBe(true);
    expect((await a.call('GET', '/campaigns')).body.map((c: { id: string }) => c.id)).toEqual([cid]);
    const b = agent(base);
    const again = await b.call('POST', '/auth/register', { username: uname('claim'), password: PW, claimPlayerId: legacy });
    expect(again.body.claimed).toBe(false);
    expect((await b.call('GET', '/campaigns')).body).toEqual([]);
  });

  it('deleting the account requires the password and removes all of its data', async () => {
    const a = await signedUp(base);
    await a.call('PUT', '/saves/slot1', { v: 1, state: playedState(5) });
    expect((await a.call('DELETE', '/auth/account', { password: 'wrong-password' })).status).toBe(403);
    expect((await a.call('DELETE', '/auth/account', { password: PW })).status).toBe(204);
    for (const t of ['users WHERE id', 'sessions WHERE user_id']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${t} = $1`, [a.userId])).rows[0].n).toBe(0);
    }
    expect((await agent(base).call('POST', '/auth/login', { username: a.username, password: PW })).status).toBe(401);
  });

  it('updates the callsign', async () => {
    const a = await signedUp(base);
    expect((await a.call('PUT', '/player', { callsign: '  Night Watch ' })).body.user.callsign).toBe('Night Watch');
    expect((await a.call('PUT', '/player', { callsign: '' })).status).toBe(400);
  });
});

describe('persistence API (signed in)', () => {
  it('migrations are idempotent', async () => {
    expect(await migrate(pool, () => {})).toEqual([]);
  });

  it('rejects bad slots, versions and malformed state', async () => {
    const a = await signedUp(base);
    expect((await a.call('PUT', '/saves/slot9', { v: 1, state: {} })).status).toBe(400);
    expect((await a.call('PUT', '/saves/slot1', { v: 99, state: {} })).status).toBe(400);
    expect((await a.call('PUT', '/saves/slot1', '{not json')).status).toBe(400);
    expect((await a.call('PUT', '/saves/slot1', { v: 1, state: { hour: 1 } })).status).toBe(422);
    const noId = playedState(1);
    delete noId.campaignId;
    expect((await a.call('PUT', '/saves/slot1', { v: 1, state: noId })).status).toBe(422);
  });

  it('saves, lists and loads losslessly; the loaded state simulates identically', async () => {
    const a = await signedUp(base);
    const s = playedState(30);
    const put = await a.call('PUT', '/saves/slot1', { v: 1, state: s });
    expect(put.body).toMatchObject({ slot: 'slot1', campaignId: s.campaignId, hour: 30, mode: 'campaign' });
    expect((await a.call('GET', '/saves')).body.map((x: { slot: string }) => x.slot)).toEqual(['slot1']);
    const got = await a.call('GET', '/saves/slot1');
    expect(got.body.state).toEqual(JSON.parse(JSON.stringify(s)));
    const loaded = got.body.state as SimState;
    execute(s, { type: 'advance', hours: 10 });
    execute(loaded, { type: 'advance', hours: 10 });
    expect(loaded.metrics.globalReadiness).toBeCloseTo(s.metrics.globalReadiness, 9);
  });

  it('keeps users isolated, including campaign ids', async () => {
    const a = await signedUp(base);
    const b = await signedUp(base);
    const s = playedState(3);
    await a.call('PUT', '/saves/slot1', { v: 1, state: s });
    expect((await b.call('GET', '/saves')).body).toEqual([]);
    expect((await b.call('GET', '/saves/slot1')).status).toBe(404);
    expect((await b.call('PUT', '/saves/slot2', { v: 1, state: s })).status).toBe(403);
    expect((await b.call('GET', `/campaigns/${s.campaignId}`)).status).toBe(404);
    expect((await b.call('DELETE', `/campaigns/${s.campaignId}`)).status).toBe(404);
  });

  it('records progress, phase results, a server-computed score and completion once', async () => {
    const a = await signedUp(base);
    const s = playedState(60); // stops at the 48h phase-1 briefing
    await a.call('PUT', '/saves/auto', { v: 1, state: s });
    const [c] = (await a.call('GET', '/campaigns')).body;
    expect(c).toMatchObject({ id: s.campaignId, phaseIndex: 1, hour: 48, objectivesTotal: 3, status: 'briefing' });
    expect((await a.call('GET', `/campaigns/${s.campaignId}`)).body.phaseResults).toHaveLength(3);

    (s as unknown as { score: number }).score = 100; // a client-supplied score is ignored
    let guard = 0;
    while (s.status !== 'complete' && guard++ < 10) {
      if (s.status === 'briefing') execute(s, { type: 'beginPhase' });
      execute(s, { type: 'advance', hours: 80 });
    }
    await a.call('PUT', '/saves/auto', { v: 1, state: s });
    const done = (await a.call('GET', `/campaigns/${s.campaignId}`)).body;
    expect(done).toMatchObject({ status: 'complete' });
    expect(done.score).toBeLessThan(100);
    expect(done.completedAt).toBeTruthy();
    await a.call('PUT', '/saves/auto', { v: 1, state: s });
    expect((await a.call('GET', `/campaigns/${s.campaignId}`)).body.completedAt).toBe(done.completedAt);
  });

  it('deletes slots and cascades campaign deletion', async () => {
    const a = await signedUp(base);
    const s = playedState(5);
    await a.call('PUT', '/saves/slot1', { v: 1, state: s });
    await a.call('PUT', '/saves/slot2', { v: 1, state: s });
    expect((await a.call('DELETE', '/saves/slot1')).status).toBe(204);
    expect((await a.call('DELETE', '/saves/slot1')).status).toBe(404);
    expect((await a.call('DELETE', `/campaigns/${s.campaignId}`)).status).toBe(204);
    expect((await a.call('GET', '/saves')).body).toEqual([]);
  });

  it('enforces the body size limit', async () => {
    const origin = await listen({ maxBodyBytes: 1000 });
    const a = await signedUp(origin);
    const r = await a.call('PUT', '/saves/slot1', { v: 1, state: playedState(1) }).catch(() => null);
    expect(r === null || r.status === 413).toBe(true);
  });
});

describe('static client', () => {
  it('serves the SPA with fallback and blocks path traversal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mds-static-'));
    await writeFile(path.join(dir, 'index.html'), '<!doctype html><title>MDS</title>');
    const origin = await listen({ staticDir: dir });
    expect(await (await fetch(`${origin}/`)).text()).toContain('MDS');
    expect(await (await fetch(`${origin}/campaign/deep/link`)).text()).toContain('MDS');
    const port = new URL(origin).port;
    const raw = (p: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get({ host: 'localhost', port, path: p }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }).on('error', reject);
    });
    expect((await raw('/..%2f..%2fetc%2fpasswd')).status).toBe(403);
    expect((await raw('/%2e%2e/%2e%2e/etc/passwd')).body).toContain('MDS');
    expect((await fetch(`${origin}/api/nope`)).status).toBe(404);
    await rm(dir, { recursive: true, force: true });
  });
});
