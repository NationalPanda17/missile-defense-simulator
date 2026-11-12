// Builds the desktop app's contents into desktop/app (then `electron-builder` packages it; see electron-builder.yml).
//   npx tsx scripts/build-desktop.ts
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'desktop', 'app');
const run = (cmd: string, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

run('npx vite build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'desktop', 'main.ts')],
  outfile: path.join(out, 'main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'embedded-postgres', 'pg-native'],
  // CommonJS packages bundled into an ES module still call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

cpSync(path.join(root, 'dist'), path.join(out, 'web'), { recursive: true });
cpSync(path.join(root, 'server', 'migrations'), path.join(out, 'migrations'), { recursive: true });

const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const pgVersion = JSON.parse(readFileSync(path.join(root, 'node_modules', 'embedded-postgres', 'package.json'), 'utf8')).version;
writeFileSync(path.join(out, 'package.json'), JSON.stringify({
  name: 'missile-defense-simulator',
  productName: 'Missile Defense Simulator',
  version: rootPkg.version,
  description: 'Command a fictional four-domain defense network.',
  author: 'NationalPanda17',
  type: 'module',
  main: 'main.mjs',
  dependencies: { 'embedded-postgres': pgVersion },
}, null, 2));
// The database binaries for this platform only (each platform's app is built on that platform).
run('npm install --omit=dev --no-audit --no-fund --no-package-lock', out);
// Recreate the binaries' library links now, in case npm skipped the package's install script.
const nativeDir = path.join(out, 'node_modules', '@embedded-postgres', `${process.platform}-${process.arch}`);
try { run('node scripts/hydrate-symlinks.js', nativeDir); } catch { /* not every platform package has one */ }
console.log(`\nDesktop app contents ready in ${path.relative(root, out)}`);
