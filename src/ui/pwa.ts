// Installable app and offline play: registers the service worker that vite.config.ts writes at build time, and
// tells the page when a new version is ready (the update applies when the player chooses to reload).

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

export const updateReady = () => !!waiting;
export function onUpdateReady(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

export function applyUpdate() {
  if (!waiting) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('skip-waiting');
}

export function registerOfflineSupport() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const found = (w: ServiceWorker | null) => {
        if (!w) return;
        const check = () => {
          // Only an update: on the very first install there is nothing to replace.
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            listeners.forEach((f) => f());
          }
        };
        w.addEventListener('statechange', check);
        check();
      };
      found(reg.waiting);
      reg.addEventListener('updatefound', () => found(reg.installing));
      // Check for a new version now and then while the game is open.
      window.setInterval(() => void reg.update().catch(() => {}), 30 * 60_000);
    } catch { /* offline support is a bonus; the game works without it */ }
  });
}
