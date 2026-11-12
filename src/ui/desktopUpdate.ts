// Desktop app only: once per launch, ask GitHub Releases whether a newer version is out, and offer the download.
// The desktop app opens the game with ?desktop=<its version>; the browser game never checks.

const REPO = 'NationalPanda17/missile-defense-simulator';
const KEY = 'mds.desktopUpdate';

export interface UpdateInfo { version: string; url: string }

/** Compares dotted versions (1.10.0 > 1.9.2). A leading "v" is ignored; pre-release suffixes count as lower. */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => {
    const [main, pre] = v.trim().replace(/^v/i, '').split('-', 2);
    return { nums: main.split('.').map((x) => Number.parseInt(x, 10) || 0), pre: !!pre };
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  return !a.pre && b.pre; // 1.2.0 is newer than 1.2.0-beta
}

/** The version of the desktop app this page runs in, or null in the browser. Remembered for the session. */
export function desktopVersion(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('desktop');
    if (q) sessionStorage.setItem('mds.desktop', q);
    return q ?? sessionStorage.getItem('mds.desktop');
  } catch {
    return null;
  }
}

/** A newer release, if there is one the player hasn't dismissed. Fails quietly when offline. */
export async function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  let saved: { checkedAt: number; latest?: UpdateInfo; dismissed?: string } = { checkedAt: 0 };
  try { saved = { ...saved, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* ignore */ }
  let latest = saved.latest;
  // At most one request every six hours.
  if (Date.now() - saved.checkedAt > 6 * 3600_000) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (r.ok) {
        const j = (await r.json()) as { tag_name?: string; html_url?: string; draft?: boolean; prerelease?: boolean };
        if (j.tag_name && j.html_url && !j.draft && !j.prerelease) latest = { version: j.tag_name.replace(/^v/i, ''), url: j.html_url };
      }
      saved = { ...saved, checkedAt: Date.now(), latest };
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch { /* offline: try again next launch */ }
  }
  if (!latest || !isNewer(latest.version, current) || saved.dismissed === latest.version) return null;
  return latest;
}

export function dismissUpdate(version: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...saved, dismissed: version }));
  } catch { /* ignore */ }
}
