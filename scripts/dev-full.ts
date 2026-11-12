// One command for local development: embedded PostgreSQL + API server (watch) + Vite client.
import { spawn, type ChildProcess } from 'node:child_process';
import { DIR, PORT, startEmbedded } from './dev-db';

const db = await startEmbedded({ dir: DIR, port: PORT, quiet: true }).catch((e: Error) => {
  console.error(`[dev-full] ${e.message}`);
  process.exit(1);
});
console.log(`[dev-full] PostgreSQL on :${PORT}`);
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? `postgres://mds:mds@localhost:${PORT}/mds`, SERVE_STATIC: '0' };
// On Windows npm is npm.cmd and has to be started through a shell.
const shell = process.platform === 'win32';
const kids: ChildProcess[] = [
  spawn('npm', ['run', 'server'], { stdio: 'inherit', env, shell }),
  spawn('npm', ['run', 'dev'], { stdio: 'inherit', env, shell }),
];
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  for (const k of kids) k.kill('SIGINT');
  await db.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const k of kids) k.on('exit', () => void stop());
