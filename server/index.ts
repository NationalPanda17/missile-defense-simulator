// Server entry point: connects to PostgreSQL, applies migrations, serves the API (and dist/ when built).
import { existsSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { Sessions } from './auth';
import { createPool, migrate } from './db';

const PORT = Number(process.env.PORT ?? 8787);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://mds:mds@localhost:5433/mds';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

async function main() {
  const pool = createPool(DATABASE_URL);
  try {
    await migrate(pool);
  } catch (e) {
    console.error(`[db] cannot reach or migrate ${redact(DATABASE_URL)}: ${(e as Error).message}`);
    console.error('[db] start a local database with `npm run db:start`, or set DATABASE_URL.');
    process.exit(1);
  }
  const staticDir = process.env.SERVE_STATIC === '0' || !existsSync(DIST) ? undefined : DIST;
  // Secure cookies need HTTPS. Default on in production; set COOKIE_SECURE=0 only for plain-HTTP local use.
  const secureCookies = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : process.env.NODE_ENV === 'production';
  const trustProxy = process.env.TRUST_PROXY === '1';
  const server = http.createServer(createApp({ pool, staticDir, secureCookies, trustProxy }));
  const sessions = new Sessions(pool);
  const purge = () => sessions.purgeExpired().then((n) => n && console.log(`[auth] purged ${n} expired sessions`)).catch(() => {});
  void purge();
  setInterval(purge, 3600_000).unref();
  server.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}  (db ${redact(DATABASE_URL)})${staticDir ? ' — serving dist/' : ''}${secureCookies ? ' — secure cookies' : ''}`);
  });
  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function redact(url: string) {
  return url.replace(/\/\/([^:@/]+):[^@/]+@/, '//$1:***@');
}

main();
