// "Follow waves": when a wave launches, the camera goes to it on the theater map and the clock drops to 1x until the
// last wave in flight lands, then returns to the speed the player had chosen. Remembered in this browser.
const KEY = 'mds.followWaves';
const listeners = new Set<() => void>();

export function followWaves(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setFollowWaves(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  listeners.forEach((f) => f());
}

export function subscribeFollow(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
