// Desktop app: the game, its save server and an embedded PostgreSQL in one window. No Node.js or terminal needed.
// Data (accounts, server saves, Academy progress) lives in the app's own folder in the user's profile.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { createPool, migrate } from '../server/db';
import { startEmbedded } from '../scripts/dev-db';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, 'web');

type Stoppable = { stop: () => Promise<void> };
let db: Stoppable | null = null;
let server: http.Server | null = null;
let pool: ReturnType<typeof createPool> | null = null;

/** A free local port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function start(): Promise<string> {
  const dataDir = path.join(app.getPath('userData'), 'pgdata');
  const pgPort = await freePort();
  db = await startEmbedded({ dir: dataDir, port: pgPort, quiet: true });
  pool = createPool(`postgres://mds:mds@127.0.0.1:${pgPort}/mds`);
  await migrate(pool, () => {});
  server = http.createServer(createApp({ pool, staticDir: WEB, secureCookies: false, trustProxy: false }));
  const port = await freePort();
  await new Promise<void>((resolve) => server!.listen(port, '127.0.0.1', resolve));
  // The page shows a notice when GitHub Releases has a newer version than this one.
  return `http://127.0.0.1:${port}/?desktop=${encodeURIComponent(app.getVersion())}`;
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  await pool?.end().catch(() => {});
  await db?.stop().catch(() => {});
}

async function main() {
  // One copy at a time: a second launch focuses the first window (the database can only be open once).
  if (!app.requestSingleInstanceLock()) return app.quit();
  await app.whenReady();
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]) : null);
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#06111f', title: 'Missile Defense Simulator', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
  // Links to the web (guides, GitHub) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://127.0.0.1')) { e.preventDefault(); void shell.openExternal(url); } });
  void win.loadURL(`data:text/html,<body style="background:%2306111f;color:%23c9d8ec;font:14px monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">Starting the save server…</body>`);
  win.show();
  try {
    await win.loadURL(await start());
  } catch (e) {
    dialog.showErrorBox('Missile Defense Simulator could not start', `${(e as Error).message}\n\nIf another copy is open, close it and try again.`);
    await stop();
    app.quit();
  }
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (e) => {
  if (stopping) return;
  e.preventDefault();
  void stop().then(() => app.exit(0));
});

void main();
