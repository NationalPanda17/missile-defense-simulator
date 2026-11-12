import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, dismissUpdate, isNewer } from '../src/ui/desktopUpdate';

describe('desktop update check', () => {
  it('compares versions', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.0', '1.0.0')).toBe(false);
    expect(isNewer('1.2.0', '1.2.0-beta.1')).toBe(true);
    expect(isNewer('1.2.0-beta.2', '1.2.0')).toBe(false);
  });

  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const release = (tag: string, extra = {}) => vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/x/releases/tag/${tag}`, ...extra }) }));

  it('offers a newer release, then remembers a dismissal', async () => {
    const fetch = release('v0.3.0');
    vi.stubGlobal('fetch', fetch);
    expect(await checkForUpdate('0.2.0')).toEqual({ version: '0.3.0', url: 'https://github.com/x/releases/tag/v0.3.0' });
    // Cached: no second request within six hours.
    expect(await checkForUpdate('0.2.0')).toEqual({ version: '0.3.0', url: 'https://github.com/x/releases/tag/v0.3.0' });
    expect(fetch).toHaveBeenCalledTimes(1);
    dismissUpdate('0.3.0');
    expect(await checkForUpdate('0.2.0')).toBeNull();
  });

  it('says nothing when up to date, for pre-releases, or offline', async () => {
    vi.stubGlobal('fetch', release('v0.2.0'));
    expect(await checkForUpdate('0.2.0')).toBeNull();
    store.clear();
    vi.stubGlobal('fetch', release('v0.5.0', { prerelease: true }));
    expect(await checkForUpdate('0.2.0')).toBeNull();
    store.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await checkForUpdate('0.2.0')).toBeNull();
  });
});
