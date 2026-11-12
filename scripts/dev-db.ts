// Runs a real PostgreSQL server from node_modules (embedded-postgres) for local development.
// Data persists in ./.pgdata. Ctrl+C stops it. Not needed if you already have PostgreSQL — set DATABASE_URL instead.
import { existsSync } from 'node:fs';
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
  try {
    if (!existsSync(path.join(opts.dir, 'PG_VERSION'))) await db.initialise();
    await db.start();
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
  return db;
}

/** The binary package ships its dylib symlinks as a JSON manifest; recreate them if npm skipped its postinstall. */
function hydrateNativeSymlinks() {
  try {
    const require = createRequire(import.meta.url);
    const pkg = path.dirname(require.resolve(`@embedded-postgres/${process.platform}-${process.arch}/package.json`));
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
