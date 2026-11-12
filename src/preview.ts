// Per-browser switch for the tactical layer, which is on by default in campaigns.
// Open the game with ?tactical=0 to turn it off in this browser (remembered), ?tactical=1 to turn it back on.
// Imported first in main.tsx so the flag is set before any saved game is loaded.
import { TACTICAL_CONFIG } from './engine/config';

const KEY = 'mds.preview.tactical';

function override(): '0' | '1' | null {
  const q = new URLSearchParams(window.location.search).get('tactical');
  try {
    if (q === '0') localStorage.setItem(KEY, '0');
    if (q === '1') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '0' ? '0' : null;
  } catch {
    return q === '0' ? '0' : null;
  }
}

if (typeof window !== 'undefined' && override() === '0') TACTICAL_CONFIG.enabledInCampaign = false;
