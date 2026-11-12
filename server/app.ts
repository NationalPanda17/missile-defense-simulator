// HTTP API (node:http, no framework). Also serves the built client from dist/ in production.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type pg from 'pg';
import { LESSONS, LESSON_MAP, SAVE_VERSION, SLOTS, stateShapeError, type SimState } from '../src/engine';
import type { ExamRecord } from '../src/shared/api';
import {
  RateLimiter, SESSION_COOKIE, Sessions, USERNAME_RE, UsernameTaken, Users, clearedCookie, dummyVerify, hashPassword,
  passwordProblem, readCookie, sessionCookie, verifyPassword, type AuthContext,
} from './auth';
import { HttpError, Repo } from './repo';

export interface AppOptions {
  pool: pg.Pool;
  staticDir?: string; // serve the SPA from here when set
  maxBodyBytes?: number;
  secureCookies?: boolean; // add the Secure flag (set when served over HTTPS)
  trustProxy?: boolean; // take the client IP from X-Forwarded-For (behind a reverse proxy)
  limits?: { loginPerUser?: number; loginPerIp?: number; registerPerIp?: number; windowMs?: number };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: string[];
  auth: AuthContext | null;
  ip: string;
  body: () => Promise<Record<string, unknown>>;
}
type Handler = (ctx: Ctx) => Promise<void>;
type AuthedHandler = (ctx: Ctx & { auth: AuthContext }) => Promise<void>;

export function createApp(opts: AppOptions) {
  const repo = new Repo(opts.pool);
  const users = new Users(opts.pool);
  const sessions = new Sessions(opts.pool);
  const maxBody = opts.maxBodyBytes ?? 8 * 1024 * 1024;
  const secure = !!opts.secureCookies;
  const win = opts.limits?.windowMs ?? 15 * 60_000;
  const loginUser = new RateLimiter(opts.limits?.loginPerUser ?? 8, win);
  const loginIp = new RateLimiter(opts.limits?.loginPerIp ?? 40, win);
  const registerIp = new RateLimiter(opts.limits?.registerPerIp ?? 10, 4 * win);

  const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
  const route = (method: string, pattern: RegExp, handler: Handler) => routes.push({ method, pattern, handler });
  /** Route that requires a signed-in user. */
  const authed = (method: string, pattern: RegExp, handler: AuthedHandler) =>
    route(method, pattern, async (ctx) => {
      if (!ctx.auth) throw new HttpError(401, 'Sign in required');
      await handler(ctx as Ctx & { auth: AuthContext });
    });

  const startSession = async (ctx: Ctx, userId: string) => {
    const token = await sessions.create(userId, ctx.req.headers['user-agent']);
    ctx.res.setHeader('Set-Cookie', sessionCookie(token, secure));
  };
  const limited = (retry: number | null) => {
    if (retry !== null) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil(retry / 60)} min.`, { 'Retry-After': String(retry) });
  };

  // ── Public ──────────────────────────────────────────────────────────────

  route('GET', /^\/api\/health$/, async ({ res }) => {
    let db = false;
    try {
      await opts.pool.query('SELECT 1');
      db = true;
    } catch { /* reported below */ }
    json(res, db ? 200 : 503, { ok: db, db, saveVersion: SAVE_VERSION });
  });

  route('POST', /^\/api\/auth\/register$/, async (ctx) => {
    limited(registerIp.blocked(ctx.ip));
    const { username, password, claimPlayerId } = await ctx.body();
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 3–32 characters: letters, digits, _ . -');
    const pwErr = passwordProblem(password, username);
    if (pwErr) throw new HttpError(400, pwErr);
    if (claimPlayerId !== undefined && (typeof claimPlayerId !== 'string' || !UUID.test(claimPlayerId))) throw new HttpError(400, 'claimPlayerId must be a UUID');
    registerIp.hit(ctx.ip);
    let created: { userId: string; claimed: boolean };
    try {
      created = await users.create(username, await hashPassword(password as string), claimPlayerId as string | undefined);
    } catch (e) {
      if (e instanceof UsernameTaken) throw new HttpError(409, 'That username is taken');
      throw e;
    }
    await users.touchLogin(created.userId);
    await startSession(ctx, created.userId);
    json(ctx.res, 201, { user: await users.info(created.userId), claimed: created.claimed });
  });

  route('POST', /^\/api\/auth\/login$/, async (ctx) => {
    const { username, password } = await ctx.body();
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) throw new HttpError(400, 'Username and password are required');
    const userKey = username.toLowerCase();
    limited(loginIp.blocked(ctx.ip));
    limited(loginUser.blocked(userKey));
    const u = await users.findByUsername(username);
    const ok = u ? await verifyPassword(password, u.password_hash) : (await dummyVerify(password), false);
    if (!u || !ok) {
      loginIp.hit(ctx.ip);
      loginUser.hit(userKey);
      throw new HttpError(401, 'Incorrect username or password');
    }
    loginUser.reset(userKey);
    await users.touchLogin(u.id);
    await startSession(ctx, u.id);
    json(ctx.res, 200, { user: await users.info(u.id) });
  });

  route('POST', /^\/api\/auth\/logout$/, async (ctx) => {
    if (ctx.auth) await sessions.revoke(ctx.auth.tokenHash);
    ctx.res.setHeader('Set-Cookie', clearedCookie(secure));
    ctx.res.writeHead(204).end();
  });

  // ── Account ─────────────────────────────────────────────────────────────

  authed('GET', /^\/api\/auth\/me$/, async ({ res, auth }) => json(res, 200, { user: await users.info(auth.userId) }));

  authed('POST', /^\/api\/auth\/password$/, async (ctx) => {
    const { currentPassword, newPassword } = await ctx.body();
    limited(loginUser.blocked(ctx.auth.username.toLowerCase()));
    if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, await users.passwordHash(ctx.auth.userId)))) {
      loginUser.hit(ctx.auth.username.toLowerCase());
      throw new HttpError(403, 'Current password is incorrect');
    }
    const pwErr = passwordProblem(newPassword, ctx.auth.username);
    if (pwErr) throw new HttpError(400, pwErr);
    await users.setPassword(ctx.auth.userId, await hashPassword(newPassword as string));
    const revoked = await sessions.revokeAll(ctx.auth.userId, ctx.auth.tokenHash);
    json(ctx.res, 200, { ok: true, revokedSessions: revoked });
  });

  authed('POST', /^\/api\/auth\/logout-others$/, async ({ res, auth }) => {
    json(res, 200, { revokedSessions: await sessions.revokeAll(auth.userId, auth.tokenHash) });
  });

  authed('DELETE', /^\/api\/auth\/account$/, async (ctx) => {
    const { password } = await ctx.body();
    if (typeof password !== 'string' || !(await verifyPassword(password, await users.passwordHash(ctx.auth.userId)))) {
      throw new HttpError(403, 'Password is incorrect');
    }
    await users.deleteAccount(ctx.auth.userId);
    ctx.res.setHeader('Set-Cookie', clearedCookie(secure));
    ctx.res.writeHead(204).end();
  });

  // ── Training Academy progress ───────────────────────────────────────────

  authed('GET', /^\/api\/academy$/, async ({ res, auth }) => json(res, 200, await repo.getAcademy(auth.playerId)));

  authed('PUT', /^\/api\/academy$/, async (ctx) => {
    const body = await ctx.body();
    const done = body.done;
    if (!Array.isArray(done) || done.length > LESSONS.length || !done.every((x) => typeof x === 'string' && LESSON_MAP.has(x))) {
      throw new HttpError(400, 'done must be a list of lesson ids');
    }
    const bestExam = body.bestExam ?? null;
    if (bestExam !== null && !isExamRecord(bestExam)) throw new HttpError(400, 'bestExam is invalid');
    json(ctx.res, 200, await repo.mergeAcademy(ctx.auth.playerId, { done, bestExam }));
  });

  authed('PUT', /^\/api\/player$/, async (ctx) => {
    const { callsign } = await ctx.body();
    if (typeof callsign !== 'string' || !callsign.trim() || callsign.trim().length > 40) throw new HttpError(400, 'callsign must be 1–40 characters');
    await repo.setCallsign(ctx.auth.playerId, callsign.trim());
    json(ctx.res, 200, { user: await users.info(ctx.auth.userId) });
  });

  // ── Saves & campaigns (scoped to the signed-in user's player) ───────────

  authed('GET', /^\/api\/saves$/, async ({ res, auth }) => json(res, 200, await repo.listSaves(auth.playerId)));

  authed('GET', /^\/api\/saves\/([a-z0-9]+)$/, async ({ res, auth, params }) => {
    const slot = checkSlot(params[0]);
    const state = await repo.getSaveJson(auth.playerId, slot);
    if (!state) throw new HttpError(404, 'Save slot is empty');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(`{"v":${SAVE_VERSION},"state":${state}}`);
  });

  authed('PUT', /^\/api\/saves\/([a-z0-9]+)$/, async ({ res, auth, params, body }) => {
    const slot = checkSlot(params[0]);
    const parsed = await body();
    if (parsed.v !== SAVE_VERSION) throw new HttpError(400, `Unsupported save version (expected ${SAVE_VERSION})`);
    const err = stateShapeError(parsed.state);
    if (err) throw new HttpError(422, err);
    const state = parsed.state as SimState;
    if (typeof state.campaignId !== 'string' || !UUID.test(state.campaignId)) throw new HttpError(422, 'state.campaignId must be a UUID');
    json(res, 200, await repo.putSave(auth.playerId, slot, state, JSON.stringify(state)));
  });

  authed('DELETE', /^\/api\/saves\/([a-z0-9]+)$/, async ({ res, auth, params }) => {
    const ok = await repo.deleteSave(auth.playerId, checkSlot(params[0]));
    if (!ok) throw new HttpError(404, 'Save slot is empty');
    res.writeHead(204).end();
  });

  authed('GET', /^\/api\/campaigns$/, async ({ res, auth }) => json(res, 200, await repo.listCampaigns(auth.playerId)));

  authed('GET', /^\/api\/campaigns\/([0-9a-f-]{36})$/, async ({ res, auth, params }) => {
    const c = await repo.getCampaign(auth.playerId, params[0]);
    if (!c) throw new HttpError(404, 'Campaign not found');
    json(res, 200, c);
  });

  authed('DELETE', /^\/api\/campaigns\/([0-9a-f-]{36})$/, async ({ res, auth, params }) => {
    if (!(await repo.deleteCampaign(auth.playerId, params[0]))) throw new HttpError(404, 'Campaign not found');
    res.writeHead(204).end();
  });

  return async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const matches = routes.filter((r) => r.pattern.test(url.pathname));
        if (!matches.length) throw new HttpError(404, 'Not found');
        const r = matches.find((m) => m.method === req.method);
        if (!r) throw new HttpError(405, 'Method not allowed');
        checkCsrf(req);
        const token = readCookie(req, SESSION_COOKIE);
        const auth = token ? await sessions.resolve(token) : null;
        if (token && !auth) res.setHeader('Set-Cookie', clearedCookie(secure)); // expired or revoked
        const ip = clientIp(req, !!opts.trustProxy);
        await r.handler({
          req, res, auth, ip, params: url.pathname.match(r.pattern)!.slice(1),
          body: async () => parseJson(await readBody(req, maxBody)),
        });
        return;
      }
      if (opts.staticDir && (req.method === 'GET' || req.method === 'HEAD')) return await serveStatic(opts.staticDir, url.pathname, res);
      throw new HttpError(404, 'Not found');
    } catch (e) {
      if (res.headersSent) return void res.end();
      if (e instanceof HttpError) {
        for (const [k, v] of Object.entries(e.headers)) res.setHeader(k, v);
        return json(res, e.status, { error: e.message });
      }
      console.error('[api]', req.method, url.pathname, e);
      json(res, 500, { error: 'Internal server error' });
    }
  };
}

/**
 * CSRF defence for cookie auth: state-changing requests must be JSON (HTML forms cannot send that cross-site
 * without a CORS preflight, which this server never grants) and, when the browser sends an Origin, it must match Host.
 */
function checkCsrf(req: http.IncomingMessage) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* invalid */ }
    if (host !== req.headers.host && host !== req.headers['x-forwarded-host']) throw new HttpError(403, 'Cross-origin request refused');
  }
  const len = Number(req.headers['content-length'] ?? 0);
  const chunked = !!req.headers['transfer-encoding'];
  if ((len > 0 || chunked || req.method !== 'DELETE') && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
}

function clientIp(req: http.IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function checkSlot(s: string): string {
  if (!(SLOTS as readonly string[]).includes(s)) throw new HttpError(400, `slot must be one of ${SLOTS.join(', ')}`);
  return s;
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function parseJson(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object');
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, `Body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(root: string, pathname: string, res: http.ServerResponse) {
  const base = path.resolve(root);
  let file = path.resolve(base, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(base + path.sep) && file !== base) throw new HttpError(403, 'Forbidden');
  let st = await stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    file = path.join(base, 'index.html'); // SPA fallback
    st = await stat(file).catch(() => null);
    if (!st) throw new HttpError(404, 'Client not built — run npm run build');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function isExamRecord(x: unknown): x is ExamRecord {
  const e = x as ExamRecord;
  return !!e && typeof e === 'object' && typeof e.passed === 'boolean'
    && Number.isInteger(e.met) && Number.isInteger(e.total) && e.met >= 0 && e.met <= e.total && e.total <= 20
    && Number.isFinite(e.score) && e.score >= 0 && e.score <= 100
    && typeof e.grade === 'string' && e.grade.length <= 4 && Number.isFinite(e.at);
}
