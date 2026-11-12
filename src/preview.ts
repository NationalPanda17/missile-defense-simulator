// Preview switch for features that are built but not yet on for everyone.
// Open the game with ?tactical=1 to turn the tactical layer on in this browser (remembered), ?tactical=0 to turn it off.
// Imported first in main.tsx so the flag is set before any saved game is loaded.
import { TACTICAL_CONFIG } from './engine/config';

const KEY = 'mds.preview.tactical';

function read(): boolean {
  let on = false;
  try {
    const q = new URLSearchParams(window.location.search).get('tactical');
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    on = localStorage.getItem(KEY) === '1';
  } catch {
    on = new URLSearchParams(window.location.search).get('tactical') === '1';
  }
  return on;
}

if (typeof window !== 'undefined' && read()) TACTICAL_CONFIG.enabledInCampaign = true;
