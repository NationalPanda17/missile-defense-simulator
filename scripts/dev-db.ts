// Runs a real PostgreSQL server from node_modules (embedded-postgres) for local development.
// Data persists in ./.pgdata. Ctrl+C stops it. Not needed if you already have PostgreSQL — set DATABASE_URL instead.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export const PORT = Number(process.env.PGPORT ?? 5433);
export const DIR = path.resolve(process.env.PGDATA_DIR ?? '.pgdata');

export async function startEmbedded(opts: { dir: string; port: number; quiet?: boolean }) {
  hydrateNativeSymlinks();
  // Keep the last lines PostgreSQL printed, so a failed start can say why.
  const recent: string[] = [];
  const keep = (m: unknown) => {
    for (const line of String(m instanceof Error ? m.message : m ?? '').split(/\r?\n/)) if (line.trim()) recent.push(line.trim());
    if (recent.length > 12) recent.splice(0, recent.length - 12);
  };
  const db = new EmbeddedPostgres({
    databaseDir: opts.dir, port: opts.port, user: 'mds', password: 'mds', persistent: true,
    onLog: (m) => { keep(m); if (!opts.quiet) process.stdout.write(`[postgres] ${m}`); },
    onError: (m) => { keep(m); console.error('[postgres]', m); },
  });
  let handle: { stop: () => Promise<void> } = db;
  try {
    if (!existsSync(path.join(opts.dir, 'PG_VERSION'))) await db.initialise();
    if (process.platform === 'win32') handle = startWithPgCtl(opts.dir, opts.port, keep);
    else await db.start();
  } catch (e) {
    const busy = existsSync(path.join(opts.dir, 'postmaster.pid'));
    throw new Error(
      busy
        ? `PostgreSQL data dir ${opts.dir} is already in use — is another \`npm run db:start\` / \`dev:full\` running? Stop it, or set PGDATA_DIR and PGPORT.`
        : `Could not start embedded PostgreSQL on port ${opts.port} (${e instanceof Error ? e.message : String(e ?? 'unknown error')}). Is the port taken? Set PGPORT.`
          + (recent.length ? `\nPostgreSQL said:\n  ${recent.join('\n  ')}` : ''),
    );
  }
  const client = new pg.Client({ connectionString: `postgres://mds:mds@localhost:${opts.port}/postgres` });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'mds'");
  if (!exists.rowCount) await client.query('CREATE DATABASE mds');
  await client.end();
  return handle;
}

/**
 * Windows: start through pg_ctl, which drops administrator rights before running the server. PostgreSQL refuses to
 * run as an administrator, and some players (and CI machines) run elevated; starting postgres directly then fails.
 */
function startWithPgCtl(dir: string, port: number, keep: (m: unknown) => void): { stop: () => Promise<void> } {
  const bin = path.join(nativePackageDir(createRequire(import.meta.url)), 'native', 'bin', 'pg_ctl.exe');
  const run = (args: string[]) => {
    try {
      return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      keep(`pg_ctl: ${err.message}`);
      keep(err.stdout ?? '');
      keep(err.stderr ?? '');
      throw new Error('pg_ctl failed');
    }
  };
  const logFile = path.join(dir, 'server.log');
  try {
    run(['start', '-D', dir, '-o', `-p ${port}`, '-l', logFile, '-w', '-t', '60']);
  } catch (e) {
    try { keep(readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-15).join('\n')); } catch { /* no log yet */ }
    throw e;
  }
  return {
    stop: async () => { try { run(['stop', '-D', dir, '-m', 'fast', '-w']); } catch { /* already stopped */ } },
  };
}

/** The binary package ships its dylib symlinks as a JSON manifest; recreate them if npm skipped its postinstall. */
function hydrateNativeSymlinks() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = nativePackageDir(require);
    // ELECTRON_RUN_AS_NODE: inside the desktop app, process.execPath is the app itself, not Node.
    execFileSync(process.execPath, ['scripts/hydrate-symlinks.js'], { cwd: pkg, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  } catch { /* other platforms or already hydrated */ }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = await startEmbedded({ dir: DIR, port: PORT }).catch((e: Error) => {
    console.error(`[dev-db] ${e.message}`);
    process.exit(1);
  });
  console.log(`\n[dev-db] PostgreSQL ready: postgres://mds:mds@localhost:${PORT}/mds  (data in ${DIR})`);
  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Folder of this platform's PostgreSQL binary package. It only exports dist/index.js, so resolve that and go up. */
function nativePackageDir(require: NodeRequire): string {
  const os = process.platform === 'win32' ? 'windows' : process.platform; // the packages are named windows-x64, darwin-arm64, …
  return path.resolve(path.dirname(require.resolve(`@embedded-postgres/${os}-${process.arch}`)), '..');
}
