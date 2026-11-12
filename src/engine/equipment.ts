// Tactical layer equipment catalog: real air defense systems.
//
// Sourcing rule (see CONTRIBUTING.md): figures come only from official public statements by manufacturers or
// governments. Where none exists, the value is made up for the game. Never classified or leaked information.
// `sources` lists the official references used, for maintainers; it is not shown in the game. Where no official
// figure was published (often: kill rates, reaction times, classified ranges), the value is the game's own.
import { TACTICAL_CONFIG } from './config';
import type { Domain, ThreatClass } from './types';

export type { ThreatClass } from './types';
export const THREAT_CLASSES: ThreatClass[] = ['slowDrone', 'fastDrone', 'cruise', 'rocket', 'ballistic'];
export const THREAT_LABELS: Record<ThreatClass, string> = {
  slowDrone: 'Slow drone',
  fastDrone: 'Fast drone',
  cruise: 'Cruise missile',
  rocket: 'Rocket',
  ballistic: 'Ballistic missile',
};

export type DefenseLayer = 'detection' | 'pointDefense' | 'directedEnergy' | 'shortMedium' | 'long' | 'upper';
export const LAYER_LABELS: Record<DefenseLayer, string> = {
  detection: 'Detection',
  pointDefense: 'Counter-drone and point defense',
  directedEnergy: 'Directed energy',
  shortMedium: 'Short to medium range',
  long: 'Long range',
  upper: 'Upper tier',
};

export interface RadarSpec {
  name: string;
  band: string;
  rangeKm: number;
}

export interface EquipmentSpec {
  id: string;
  name: string;
  origin: string; // country of manufacture, display only
  domain: Domain;
  layer: DefenseLayer;
  description: string;
  rangeKm: number; // engagement range for effectors, detection range for sensors
  altitudeKm: number; // maximum engagement (or coverage) altitude
  unitCostUsdM: number; // cost of one fire unit / battery / platform, in millions of US dollars
  killRate: Record<ThreatClass, number>; // 0-1 chance one engagement stops the threat; 0 = cannot engage
  reactionSec: number; // time from detection to first engagement
  radar: RadarSpec | null; // own sensor, if any
  magazine: number; // ready engagements per unit before resupply
  reloadHours: number; // time to resupply a full magazine
  generic?: boolean; // a class of equipment rather than a named product
  sources: Source[];
}

/** An official public reference (manufacturer or government). `url` only where a working page was found. */
export interface Source { name: string; url?: string }

/** Kill rates for sensors: they engage nothing. */
const NONE: Record<ThreatClass, number> = { slowDrone: 0, fastDrone: 0, cruise: 0, rocket: 0, ballistic: 0 };
const kr = (slowDrone: number, fastDrone: number, cruise: number, rocket: number, ballistic: number) =>
  ({ slowDrone, fastDrone, cruise, rocket, ballistic });

export const EQUIPMENT: EquipmentSpec[] = [
  // ── DETECTION: GROUND ────────────────────────────────────────────────
  {
    id: 'giraffe-4a', name: 'Giraffe 4A', origin: 'Sweden', domain: 'ground', layer: 'detection',
    description: 'Multi-function S-band AESA radar for air surveillance and fire control.',
    rangeKm: 400, altitudeKm: 20, unitCostUsdM: 30, killRate: NONE, reactionSec: 2,
    radar: { name: 'Giraffe 4A', band: 'S', rangeKm: 400 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Saab, Giraffe 4A product page', url: 'https://www.saab.com/products/giraffe-4a' }],
  },
  {
    id: 'gm200', name: 'Ground Master 200', origin: 'France', domain: 'ground', layer: 'detection',
    description: 'Mobile S-band 4D air surveillance radar.',
    rangeKm: 250, altitudeKm: 20, unitCostUsdM: 25, killRate: NONE, reactionSec: 2,
    radar: { name: 'GM200', band: 'S', rangeKm: 250 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Thales, Ground Master 200 product page', url: 'https://www.thalesgroup.com/en/ground-master-200' }],
  },
  {
    id: 'gm400', name: 'Ground Master 400', origin: 'France', domain: 'ground', layer: 'detection',
    description: 'Long-range L-band air surveillance radar.',
    rangeKm: 515, altitudeKm: 30, unitCostUsdM: 45, killRate: NONE, reactionSec: 3,
    radar: { name: 'GM400', band: 'L', rangeKm: 515 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Thales, Ground Master 400 Alpha press release (2021)', url: 'https://www.thalesgroup.com/en/news-centre/press-releases/ground-master-400-alpha-taking-long-range-air-surveillance-next-level' }],
  },
  {
    id: 'sentinel', name: 'AN/MPQ-64 Sentinel', origin: 'United States', domain: 'ground', layer: 'detection',
    description: 'X-band short-range air defense radar; cues NASAMS and short-range systems.',
    rangeKm: 75, altitudeKm: 10, unitCostUsdM: 15, killRate: NONE, reactionSec: 2,
    radar: { name: 'AN/MPQ-64', band: 'X', rangeKm: 75 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'RTX (Raytheon), Sentinel radar product page', url: 'https://rtx.com/raytheon/what-we-do/land/sentinel-radar' }],
  },
  {
    id: 'trml-4d', name: 'TRML-4D', origin: 'Germany', domain: 'ground', layer: 'detection',
    description: 'C-band AESA air surveillance and target acquisition radar; cues IRIS-T SLM.',
    rangeKm: 250, altitudeKm: 30, unitCostUsdM: 25, killRate: NONE, reactionSec: 2,
    radar: { name: 'TRML-4D', band: 'C', rangeKm: 250 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Hensoldt, TRML-4D product page', url: 'https://www.hensoldt.net/products/trml-4d-air-surveillance-and-target-acquisition-radar' }],
  },
  {
    id: 'tpy-2', name: 'AN/TPY-2', origin: 'United States', domain: 'ground', layer: 'detection',
    description: 'Transportable X-band radar for ballistic missile detection and tracking.',
    rangeKm: 1000, altitudeKm: 500, unitCostUsdM: 600, killRate: NONE, reactionSec: 5,
    radar: { name: 'AN/TPY-2', band: 'X', rangeKm: 1000 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'US Missile Defense Agency, AN/TPY-2 fact sheet (archived)', url: 'https://webarchive.library.unt.edu/web/20130216205002/http://www.mda.mil/global/documents/pdf/an_tpy2.pdf' }],
  },
  {
    id: 'passive-rf', name: 'Passive RF detector', origin: 'Generic', domain: 'ground', layer: 'detection',
    description: 'Listens for drone control and video links. Cheap, short range, invisible to the enemy.',
    rangeKm: 10, altitudeKm: 3, unitCostUsdM: 0.5, killRate: NONE, reactionSec: 1,
    radar: null, magazine: 0, reloadHours: 0, generic: true, sources: [],
  },
  {
    id: 'acoustic-net', name: 'Acoustic sensor network', origin: 'Generic', domain: 'ground', layer: 'detection',
    description: 'A grid of microphones that hears low, slow drones that radars miss.',
    rangeKm: 5, altitudeKm: 1, unitCostUsdM: 0.3, killRate: NONE, reactionSec: 3,
    radar: null, magazine: 0, reloadHours: 0, generic: true, sources: [],
  },

  // ── DETECTION: AIR ───────────────────────────────────────────────────
  {
    id: 'e-7', name: 'E-7 Wedgetail', origin: 'United States / Australia', domain: 'air', layer: 'detection',
    description: 'Airborne early warning and control aircraft with an L-band MESA radar.',
    rangeKm: 400, altitudeKm: 30, unitCostUsdM: 580, killRate: NONE, reactionSec: 4,
    radar: { name: 'MESA', band: 'L', rangeKm: 400 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Royal Australian Air Force, E-7A Wedgetail fact sheet' }],
  },
  {
    id: 'e-2d', name: 'E-2D Advanced Hawkeye', origin: 'United States', domain: 'air', layer: 'detection',
    description: 'Airborne early warning aircraft with a UHF radar suited to low, small targets over sea.',
    rangeKm: 550, altitudeKm: 30, unitCostUsdM: 175, killRate: NONE, reactionSec: 4,
    radar: { name: 'AN/APY-9', band: 'UHF', rangeKm: 550 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'US Navy statements on the AN/APY-9 radar (reported by USNI News)', url: 'https://news.usni.org/2014/06/09/u-s-navys-secret-counter-stealth-weapon-hiding-plain-sight' }],
  },
  {
    id: 'globaleye', name: 'GlobalEye', origin: 'Sweden', domain: 'air', layer: 'detection',
    description: 'Multi-domain airborne surveillance aircraft with the Erieye ER radar.',
    rangeKm: 650, altitudeKm: 30, unitCostUsdM: 400, killRate: NONE, reactionSec: 4,
    radar: { name: 'Erieye ER', band: 'S', rangeKm: 650 }, magazine: 0, reloadHours: 0,
    sources: [{ name: 'Saab, GlobalEye product page', url: 'https://saab.com/products/globaleye' }],
  },

  // ── COUNTER-DRONE AND POINT DEFENSE ──────────────────────────────────
  {
    id: 'zu-23-2', name: 'ZU-23-2', origin: 'Soviet Union (widely built)', domain: 'ground', layer: 'pointDefense',
    description: 'Towed twin 23 mm anti-aircraft gun. Cheap and plentiful; aimed by eye.',
    rangeKm: 2.5, altitudeKm: 1.5, unitCostUsdM: 0.1, killRate: kr(0.35, 0.15, 0.05, 0, 0), reactionSec: 12,
    radar: null, magazine: 20, reloadHours: 1, sources: [],
  },
  {
    id: 'gepard', name: 'Gepard', origin: 'Germany', domain: 'ground', layer: 'pointDefense',
    description: 'Self-propelled twin 35 mm anti-aircraft gun with its own search and tracking radars.',
    rangeKm: 5.5, altitudeKm: 3, unitCostUsdM: 10, killRate: kr(0.7, 0.5, 0.25, 0, 0), reactionSec: 6,
    radar: { name: 'Search radar', band: 'S', rangeKm: 15 }, magazine: 16, reloadHours: 2,
    sources: [{ name: 'German Federal Ministry of Defence, Gepard information' }],
  },
  {
    id: 'skynex', name: 'Skynex', origin: 'Germany', domain: 'ground', layer: 'pointDefense',
    description: 'Networked 35 mm revolver guns firing programmable airburst rounds, cued by an X-band radar.',
    rangeKm: 4, altitudeKm: 3, unitCostUsdM: 40, killRate: kr(0.85, 0.7, 0.4, 0.2, 0), reactionSec: 4,
    radar: { name: 'X-TAR3D', band: 'X', rangeKm: 50 }, magazine: 30, reloadHours: 2,
    sources: [{ name: 'Rheinmetall, Skynex product page', url: 'https://www.rheinmetall.com/en/products/air-defence-systems/networked-air-defence-skynex' }, { name: 'Rheinmetall, Skynex brochure', url: 'https://www.rheinmetall.com/Rheinmetall%20Group/brochure-download/Air-Defence/B200e0424-Oerlikon-Skynex-air-defence-system.pdf' }],
  },
  {
    id: 'stinger', name: 'Stinger team', origin: 'United States', domain: 'ground', layer: 'pointDefense',
    description: 'Shoulder-fired infrared-guided missiles. Mobile, cheap to field, short magazine.',
    rangeKm: 5, altitudeKm: 3.8, unitCostUsdM: 1, killRate: kr(0.6, 0.55, 0.3, 0, 0), reactionSec: 10,
    radar: null, magazine: 4, reloadHours: 3,
    sources: [{ name: 'RTX (Raytheon), Stinger missile product information' }],
  },
  {
    id: 'avenger', name: 'Avenger', origin: 'United States', domain: 'ground', layer: 'pointDefense',
    description: 'Vehicle-mounted turret with eight Stinger missiles and a heavy machine gun.',
    rangeKm: 5, altitudeKm: 3.8, unitCostUsdM: 3, killRate: kr(0.65, 0.6, 0.35, 0, 0), reactionSec: 8,
    radar: null, magazine: 8, reloadHours: 2,
    sources: [{ name: 'US Army, Avenger air defense system information' }],
  },
  {
    id: 'coyote', name: 'Coyote Block 2', origin: 'United States', domain: 'ground', layer: 'pointDefense',
    description: 'Small jet-powered interceptor drone built to destroy hostile drones, cued by the KuRFS radar.',
    rangeKm: 15, altitudeKm: 5, unitCostUsdM: 20, killRate: kr(0.85, 0.8, 0.3, 0, 0), reactionSec: 8,
    radar: { name: 'KuRFS', band: 'Ku', rangeKm: 16 }, magazine: 12, reloadHours: 3,
    sources: [{ name: 'RTX (Raytheon), Coyote counter-UAS news release (2021)', url: 'https://rtx.com/raytheon/news/2021/10/11/rmd-proves-counter-uas-effectiveness' }],
  },
  {
    id: 'ew-jammer', name: 'Electronic jammer', origin: 'Generic', domain: 'ground', layer: 'pointDefense',
    description: 'Breaks the control and navigation links of drones in an area. No effect on missiles.',
    rangeKm: 5, altitudeKm: 2, unitCostUsdM: 2, killRate: kr(0.5, 0.25, 0, 0, 0), reactionSec: 1,
    radar: null, magazine: 999, reloadHours: 0, generic: true, sources: [],
  },
  {
    id: 'hpm', name: 'High-power microwave', origin: 'Generic', domain: 'ground', layer: 'pointDefense',
    description: 'Fries the electronics of every drone in a short cone. Good against swarms.',
    rangeKm: 1, altitudeKm: 1, unitCostUsdM: 15, killRate: kr(0.8, 0.6, 0, 0, 0), reactionSec: 2,
    radar: null, magazine: 999, reloadHours: 0, generic: true, sources: [],
  },

  // ── DIRECTED ENERGY ──────────────────────────────────────────────────
  {
    id: 'iron-beam', name: 'Iron Beam', origin: 'Israel', domain: 'ground', layer: 'directedEnergy',
    description: 'High-energy laser. Very cheap per shot, limited range, weakened by cloud and haze.',
    rangeKm: 10, altitudeKm: 5, unitCostUsdM: 100, killRate: kr(0.9, 0.75, 0.3, 0.6, 0), reactionSec: 5,
    radar: null, magazine: 999, reloadHours: 0,
    sources: [{ name: 'Rafael Advanced Defense Systems, Iron Beam statements (reported by Globes)', url: 'https://en.globes.co.il/en/article-iron-beam-set-for-deployment-this-year-1001500840' }],
  },

  // ── SHORT TO MEDIUM RANGE ────────────────────────────────────────────
  {
    id: 'nasams', name: 'NASAMS', origin: 'Norway / United States', domain: 'ground', layer: 'shortMedium',
    description: 'Networked launchers firing AMRAAM missiles, cued by the Sentinel radar.',
    rangeKm: 30, altitudeKm: 16, unitCostUsdM: 150, killRate: kr(0.85, 0.85, 0.8, 0.1, 0), reactionSec: 8,
    radar: { name: 'AN/MPQ-64F1', band: 'X', rangeKm: 75 }, magazine: 18, reloadHours: 4,
    sources: [{ name: 'Kongsberg, NASAMS brochure (2026)', url: 'https://www.kongsberg.com/globalassets/kongsberg/1.-what-we-do/1.-defence-and-security/intergrated-air-and-missile-defence/nasams-air-defence-system/nasams_brochure_2026.pdf' }],
  },
  {
    id: 'iris-t-slm', name: 'IRIS-T SLM', origin: 'Germany', domain: 'ground', layer: 'shortMedium',
    description: 'Medium-range missile system with a 360° launcher and the TRML-4D radar.',
    rangeKm: 40, altitudeKm: 20, unitCostUsdM: 150, killRate: kr(0.85, 0.85, 0.85, 0.3, 0.1), reactionSec: 7,
    radar: { name: 'TRML-4D', band: 'C', rangeKm: 250 }, magazine: 24, reloadHours: 4,
    sources: [{ name: 'Diehl Defence, GBAD brochure', url: 'https://new.diehl.com/defence/de/content/download/2072/file/GBAD_e.pdf' }],
  },
  {
    id: 'iron-dome', name: 'Iron Dome', origin: 'Israel', domain: 'ground', layer: 'shortMedium',
    description: 'Counter-rocket and short-range interceptor system. Only engages threats heading for defended areas.',
    rangeKm: 70, altitudeKm: 10, unitCostUsdM: 50, killRate: kr(0.8, 0.75, 0.7, 0.9, 0.1), reactionSec: 6,
    radar: { name: 'EL/M-2084', band: 'S', rangeKm: 100 }, magazine: 60, reloadHours: 3,
    sources: [{ name: 'Rafael Advanced Defense Systems, Iron Dome information' }],
  },
  {
    id: 'camm', name: 'CAMM (Sky Sabre)', origin: 'United Kingdom', domain: 'ground', layer: 'shortMedium',
    description: 'Soft-launched CAMM missiles with a Giraffe radar; good against fast, low threats.',
    rangeKm: 25, altitudeKm: 10, unitCostUsdM: 100, killRate: kr(0.85, 0.85, 0.8, 0.2, 0), reactionSec: 6,
    radar: { name: 'Giraffe AMB', band: 'C', rangeKm: 120 }, magazine: 24, reloadHours: 4,
    sources: [{ name: 'British Army, Land Ceptor (Sky Sabre) equipment page', url: 'https://www.army.mod.uk/learn-and-explore/equipment/artillery-and-air-defence/land-ceptor/' }],
  },
  {
    id: 'spyder-mr', name: 'SPYDER-MR', origin: 'Israel', domain: 'ground', layer: 'shortMedium',
    description: 'Truck-launched Python and Derby missiles with an EL/M-2084 radar.',
    rangeKm: 35, altitudeKm: 16, unitCostUsdM: 120, killRate: kr(0.8, 0.8, 0.8, 0.1, 0), reactionSec: 7,
    radar: { name: 'EL/M-2084', band: 'S', rangeKm: 250 }, magazine: 24, reloadHours: 4,
    sources: [{ name: 'Rafael Advanced Defense Systems, SPYDER information' }],
  },
  {
    id: 'barak-mx', name: 'Barak MX', origin: 'Israel', domain: 'ground', layer: 'shortMedium',
    description: 'Modular system that mixes 35, 70 and 150 km interceptors from one launcher. Medium-range set here.',
    rangeKm: 70, altitudeKm: 20, unitCostUsdM: 200, killRate: kr(0.8, 0.85, 0.85, 0.3, 0.3), reactionSec: 7,
    radar: { name: 'EL/M-2084', band: 'S', rangeKm: 250 }, magazine: 24, reloadHours: 4,
    sources: [{ name: 'Israel Aerospace Industries, Barak MX product page', url: 'https://www.iai.co.il/product/barak-mx-naval/' }, { name: 'Israel Aerospace Industries, Barak ER product page', url: 'https://www.iai.co.il/p/barak-er' }],
  },
  {
    id: 'km-sam', name: 'KM-SAM (Cheongung II)', origin: 'South Korea', domain: 'ground', layer: 'shortMedium',
    description: 'Medium-range system with hit-to-kill capability against aircraft and ballistic missiles.',
    rangeKm: 40, altitudeKm: 15, unitCostUsdM: 150, killRate: kr(0.75, 0.8, 0.8, 0.2, 0.4), reactionSec: 8,
    radar: { name: 'Multi-function radar', band: 'X', rangeKm: 100 }, magazine: 32, reloadHours: 5,
    sources: [{ name: 'Republic of Korea Defense Acquisition Program Administration statements' }],
  },

  // ── LONG RANGE ───────────────────────────────────────────────────────
  {
    id: 'patriot-pac3', name: 'Patriot PAC-3 MSE', origin: 'United States', domain: 'ground', layer: 'long',
    description: 'Hit-to-kill interceptors against ballistic missiles, cruise missiles and aircraft.',
    rangeKm: 60, altitudeKm: 30, unitCostUsdM: 1100, killRate: kr(0.7, 0.8, 0.85, 0.3, 0.75), reactionSec: 9,
    radar: { name: 'AN/MPQ-65', band: 'C', rangeKm: 150 }, magazine: 48, reloadHours: 6,
    sources: [{ name: 'Lockheed Martin, PAC-3 MSE product card', url: 'https://www.lockheedmartin.com/content/dam/lockheed-martin/mfc/pc/meads/mfc-pac-3-mse-pc.pdf' }],
  },
  {
    id: 'samp-t-ng', name: 'SAMP/T NG', origin: 'France / Italy', domain: 'ground', layer: 'long',
    description: 'Aster 30 B1NT interceptors with a 360° AESA radar; covers air and ballistic threats.',
    rangeKm: 150, altitudeKm: 25, unitCostUsdM: 550, killRate: kr(0.7, 0.8, 0.85, 0.2, 0.7), reactionSec: 8,
    radar: { name: 'Ground Fire 300', band: 'S', rangeKm: 400 }, magazine: 32, reloadHours: 6,
    sources: [{ name: 'Eurosam, Aster 30 B1NT long-range firing press release (2025)', url: 'https://eurosam.com/wp-content/uploads/2025/07/2025-07-31_Press_Release-Aster_30_B1NT_long_range_firing-VFinale.pdf' }],
  },
  {
    id: 'davids-sling', name: "David's Sling", origin: 'Israel / United States', domain: 'ground', layer: 'long',
    description: 'Stunner interceptors for heavy rockets, cruise missiles and short-range ballistic missiles.',
    rangeKm: 300, altitudeKm: 15, unitCostUsdM: 300, killRate: kr(0.75, 0.8, 0.85, 0.85, 0.65), reactionSec: 8,
    radar: { name: 'EL/M-2084', band: 'S', rangeKm: 470 }, magazine: 24, reloadHours: 6,
    sources: [{ name: "Rafael Advanced Defense Systems, David's Sling information" }],
  },
  {
    id: 'arrow-2', name: 'Arrow 2', origin: 'Israel / United States', domain: 'ground', layer: 'long',
    description: 'Upper-atmosphere interceptor against ballistic missiles, cued by the Green Pine radar.',
    rangeKm: 150, altitudeKm: 50, unitCostUsdM: 500, killRate: kr(0, 0, 0, 0, 0.8), reactionSec: 10,
    radar: { name: 'Green Pine', band: 'L', rangeKm: 500 }, magazine: 24, reloadHours: 8,
    sources: [{ name: 'Israel Aerospace Industries, Arrow weapon system information' }],
  },

  // ── UPPER TIER ───────────────────────────────────────────────────────
  {
    id: 'thaad', name: 'THAAD', origin: 'United States', domain: 'ground', layer: 'upper',
    description: 'Terminal High Altitude Area Defense: hit-to-kill interceptors against ballistic missiles only.',
    rangeKm: 200, altitudeKm: 150, unitCostUsdM: 1100, killRate: kr(0, 0, 0, 0, 0.9), reactionSec: 10,
    radar: { name: 'AN/TPY-2', band: 'X', rangeKm: 1000 }, magazine: 48, reloadHours: 8,
    sources: [{ name: 'Lockheed Martin, THAAD product information' }],
  },
  {
    id: 'arrow-3', name: 'Arrow 3', origin: 'Israel / United States', domain: 'ground', layer: 'upper',
    description: 'Exo-atmospheric interceptor that destroys ballistic missiles in space.',
    rangeKm: 2400, altitudeKm: 100, unitCostUsdM: 700, killRate: kr(0, 0, 0, 0, 0.85), reactionSec: 12,
    radar: { name: 'Super Green Pine', band: 'L', rangeKm: 900 }, magazine: 24, reloadHours: 10,
    sources: [{ name: 'Israel Aerospace Industries, Arrow 3 information' }],
  },

  // ── SEA ──────────────────────────────────────────────────────────────
  {
    id: 'aegis-sm6', name: 'Aegis destroyer (SM-2 / SM-6)', origin: 'United States', domain: 'sea', layer: 'long',
    description: 'Guided-missile destroyer defending a wide area against aircraft and cruise missiles.',
    rangeKm: 240, altitudeKm: 30, unitCostUsdM: 2200, killRate: kr(0.7, 0.85, 0.9, 0.2, 0.6), reactionSec: 8,
    radar: { name: 'AN/SPY-1D', band: 'S', rangeKm: 320 }, magazine: 40, reloadHours: 24,
    sources: [{ name: 'RTX (Raytheon), Standard Missile-6 product information' }],
  },
  {
    id: 'aegis-sm3', name: 'Aegis BMD destroyer (SM-3)', origin: 'United States', domain: 'sea', layer: 'upper',
    description: 'Destroyer carrying SM-3 interceptors that hit ballistic missiles above the atmosphere.',
    rangeKm: 1200, altitudeKm: 1000, unitCostUsdM: 2200, killRate: kr(0, 0, 0, 0, 0.85), reactionSec: 12,
    radar: { name: 'AN/SPY-1D', band: 'S', rangeKm: 320 }, magazine: 8, reloadHours: 24,
    sources: [{ name: 'RTX (Raytheon), SM-3 Block IIA full-rate production release (2024)' }],
  },
  {
    id: 'type-45', name: 'Type 45 destroyer (Sea Viper)', origin: 'United Kingdom', domain: 'sea', layer: 'long',
    description: 'Air defense destroyer with Aster 15 and Aster 30 missiles and the SAMPSON radar.',
    rangeKm: 120, altitudeKm: 20, unitCostUsdM: 1300, killRate: kr(0.75, 0.85, 0.9, 0.2, 0.3), reactionSec: 7,
    radar: { name: 'SAMPSON', band: 'S', rangeKm: 400 }, magazine: 48, reloadHours: 24,
    sources: [{ name: 'Royal Navy, Daring class (Type 45) page', url: 'https://www.royalnavy.mod.uk/equipment/ships/daring-class' }, { name: 'UK Government, Royal Navy fires Sea Viper from Type 45 destroyer', url: 'https://gov.uk/government/news/royal-navy-fires-sea-viper-from-type-45-destroyer' }],
  },
];

export const EQUIPMENT_MAP = new Map(EQUIPMENT.map((e) => [e.id, e]));

/** True if the system can engage at least one threat class. */
export function isEffector(spec: EquipmentSpec): boolean {
  return Object.values(spec.killRate).some((k) => k > 0);
}

/**
 * Deployment cost in game credits. Real unit costs span four orders of magnitude, so they are compressed with a
 * power curve (a game choice) so cheap systems stay worth buying and expensive ones stay affordable.
 */
export function equipmentCost(spec: EquipmentSpec): number {
  const { creditsScale, costExponent, minCost, rangeCostKm, rangeCostCapKm, rangeCostExponent } = TACTICAL_CONFIG;
  const exp = isEffector(spec) ? rangeCostExponent.effector : rangeCostExponent.sensor;
  const rangeFactor = (1 + Math.min(spec.rangeKm, rangeCostCapKm) / rangeCostKm) ** exp;
  return Math.max(minCost, Math.round(creditsScale * spec.unitCostUsdM ** costExponent * rangeFactor));
}

/** Hourly upkeep in game credits once deployed. */
export function equipmentUpkeep(spec: EquipmentSpec): number {
  return Math.max(0.01, Math.round(equipmentCost(spec) * TACTICAL_CONFIG.upkeepRate * 100) / 100);
}
