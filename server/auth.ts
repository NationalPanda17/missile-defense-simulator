// Accounts and sessions: password hashing (scrypt), session tokens, cookies and login rate limiting.
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type http from 'node:http';
import type pg from 'pg';
import type { AccountInfo } from '../src/shared/api';

// ── Password hashing ──────────────────────────────────────────────────────

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password.normalize('NFKC'), salt, keylen, opts, (e, k) => (e ? reject(e) : resolve(k))));
}

/** Format: scrypt$N$r$p$salt(b64)$hash(b64). Parameters are stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// A fixed hash to verify against when the username does not exist, so response time doesn't reveal which usernames exist.
let dummyHash: Promise<string> | null = null;
export const dummyVerify = (password: string) => (dummyHash ??= hashPassword('dummy-password-for-timing')).then((h) => verifyPassword(password, h));

// ── Validation ────────────────────────────────────────────────────────────

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export function passwordProblem(pw: unknown, username?: string): string | null {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 200) return 'Password must be at most 200 characters';
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return 'Password must not contain the username';
  return null;
}

// ── Sessions ──────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'mds_session';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const SLIDE_AFTER_MS = 3600_000; // refresh expiry at most hourly

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export interface AuthContext { userId: string; playerId: string; username: string; tokenHash: Buffer }

export class Sessions {
  constructor(private pool: pg.Pool) {}

  async create(userId: string, userAgent: string | undefined): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, now() + $3 * interval '1 millisecond', $4)`,
      [sha256(token), userId, SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null],
    );
    return token;
  }

  async resolve(token: string): Promise<AuthContext | null> {
    if (!token || token.length > 100) return null;
    const h = sha256(token);
    const r = await this.pool.query<{ user_id: string; player_id: string; username: string; last_seen_at: Date }>(
      `SELECT s.user_id, u.player_id, u.username, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [h]);
    const row = r.rows[0];
    if (!row) return null;
    if (Date.now() - row.last_seen_at.getTime() > SLIDE_AFTER_MS) {
      await this.pool.query(
        `UPDATE sessions SET last_seen_at = now(), expires_at = now() + $2 * interval '1 millisecond' WHERE token_hash = $1`,
        [h, SESSION_TTL_MS]);
    }
    return { userId: row.user_id, playerId: row.player_id, username: row.username, tokenHash: h };
  }

  async revoke(tokenHash: Buffer) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /** Revoke every session for the user, optionally keeping one. Returns how many were removed. */
  async revokeAll(userId: string, keep?: Buffer): Promise<number> {
    const r = keep
      ? await this.pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keep])
      : await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return r.rowCount ?? 0;
  }

  async purgeExpired() {
    const r = await this.pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    return r.rowCount ?? 0;
  }
}

// ── Users ─────────────────────────────────────────────────────────────────

export class Users {
  constructor(private pool: pg.Pool) {}

  async findByUsername(username: string) {
    const r = await this.pool.query<{ id: string; username: string; password_hash: string; player_id: string }>(
      'SELECT id, username, password_hash, player_id FROM users WHERE lower(username) = lower($1)', [username]);
    return r.rows[0] ?? null;
  }

  async info(userId: string): Promise<AccountInfo> {
    const r = await this.pool.query(
      `SELECT u.id, u.username, u.created_at, u.last_login_at, p.callsign,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
         FROM users u JOIN players p ON p.id = u.player_id WHERE u.id = $1`, [userId]);
    const x = r.rows[0];
    return {
      id: x.id, username: x.username, callsign: x.callsign, createdAt: x.created_at.toISOString(),
      lastLoginAt: x.last_login_at ? x.last_login_at.toISOString() : null, activeSessions: x.sessions,
    };
  }

  /**
   * Create an account. If `claimPlayerId` names an existing anonymous player that no account owns yet,
   * the account adopts it (keeping its campaigns and saves); otherwise a fresh player is created.
   */
  async create(username: string, passwordHash: string, claimPlayerId?: string): Promise<{ userId: string; claimed: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let playerId: string | null = null;
      if (claimPlayerId) {
        const r = await client.query(
          `SELECT p.id FROM players p WHERE p.id = $1 AND NOT EXISTS (SELECT 1 FROM users u WHERE u.player_id = p.id) FOR UPDATE`,
          [claimPlayerId]);
        playerId = r.rows[0]?.id ?? null;
      }
      const claimed = !!playerId;
      if (!playerId) {
        playerId = randomUUID();
        await client.query('INSERT INTO players (id, callsign) VALUES ($1, $2)', [playerId, username]);
      }
      const userId = randomUUID();
      await client.query('INSERT INTO users (id, username, password_hash, player_id) VALUES ($1, $2, $3, $4)', [userId, username, passwordHash, playerId]);
      await client.query('COMMIT');
      return { userId, claimed };
    } catch (e) {
      await client.query('ROLLBACK');
      if ((e as { code?: string }).code === '23505') throw new UsernameTaken();
      throw e;
    } finally {
      client.release();
    }
  }

  async touchLogin(userId: string) {
    await this.pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  }

  async passwordHash(userId: string): Promise<string> {
    return (await this.pool.query('SELECT password_hash FROM users WHERE id = $1', [userId])).rows[0].password_hash;
  }

  async setPassword(userId: string, hash: string) {
    await this.pool.query('UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1', [userId, hash]);
  }

  /** Deleting the player cascades to the user, sessions, campaigns, saves and phase results. */
  async deleteAccount(userId: string) {
    await this.pool.query('DELETE FROM players WHERE id = (SELECT player_id FROM users WHERE id = $1)', [userId]);
  }
}

export class UsernameTaken extends Error {}

// ── Cookies ───────────────────────────────────────────────────────────────

export function readCookie(req: http.IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`;
}

export function clearedCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// ── Rate limiting (in-memory, fixed window) ───────────────────────────────

export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private limit: number, private windowMs: number) {}

  /** Returns seconds until retry if the key is over its limit, else null. Does not count. */
  blocked(key: string): number | null {
    const h = this.hits.get(key);
    if (!h || h.reset <= Date.now()) return null;
    return h.n >= this.limit ? Math.ceil((h.reset - Date.now()) / 1000) : null;
  }

  hit(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= now) this.hits.set(key, { n: 1, reset: now + this.windowMs });
    else h.n++;
    if (this.hits.size > 50_000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
