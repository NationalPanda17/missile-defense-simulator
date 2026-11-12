# Plan: Tactical Defense Layer

Status: all six stages built. Inspired by the deployment-and-waves style of airdefense.dev. No code, data or art
is copied from it; only general game ideas are borrowed.

## Goal

Add a hands-on tactical layer to the campaign without losing what makes this game distinct: running a network.
Before each campaign phase you spend a budget to deploy real-world air defense equipment into a theater. During
the phase, waves of incoming threats test that deployment. How well it holds depends on both where you placed
things and how well you have run the network (readiness, maintenance, comms, intel quality).

## Decisions already made

| Topic | Decision |
| --- | --- |
| World | Stays fictional. The seven regions stay as they are. Theater sites (cities, ports, power plants) are fictional and never placed on real facilities. |
| Equipment | **Real-world systems** with name, role, tier, range, cost, and detailed performance figures (kill rates, reaction times, radar specs). Figures come only from official public statements by manufacturers or governments. Where none exists, the game makes up a plausible value. Never classified or leaked information. |
| Scenarios | Fictional only. No scenario recreates, is named after, or is dated to a real attack. |
| Placement | A deployment step inside the campaign, in the briefing before each phase. No separate mode. |
| Modes | **Campaign only.** Crisis stays as it is. The one exception: the Training Academy's two tactical lessons and its certification exercise turn the layer on with scripted waves, to teach it. |
| Threats | Threat **waves** of generic classes, resolved by game math that uses the real equipment figures as inputs. |

## What changes in the project rules

`CONTRIBUTING.md` currently bans real equipment and "interception logic". It becomes:

- **Allowed:** real air defense systems by name, with range, role or tier, cost, threat suitability, and
  detailed performance data (kill rates, reaction times, radar specs). Figures come from official public
  statements by manufacturers or governments, or are made up for the game when no such statement exists.
- **Not allowed:** classified or leaked information of any kind, locations of real facilities, and recreations of
  real attacks or conflicts.
- Tactical outcomes come from game math (coverage, readiness, stock, RNG) that uses the real figures as inputs.

The README disclaimer is updated to match.

## Equipment catalog (first pass)

One data file, `src/engine/equipment.ts`, holds every entry with its sources. Costs convert to credits at a fixed
rate. A per-entry balance multiplier may compress the cost spread so cheap systems stay useful. That multiplier is a
game choice and is labelled as such.

About 35 systems in the first pass:

| Layer | Systems |
| --- | --- |
| Detection, ground | Saab Giraffe 4A, Thales Ground Master 200 and 400, AN/MPQ-64 Sentinel, Hensoldt TRML-4D, AN/TPY-2, passive RF detector (generic), acoustic sensor network (generic) |
| Detection, air | E-7 Wedgetail, E-2D Hawkeye, Saab GlobalEye |
| Counter-drone and point defense | ZU-23-2, Gepard, Skynex, Stinger team, Avenger, Coyote, electronic jammer (generic), high-power microwave (generic) |
| Directed energy | Iron Beam |
| Short to medium range | NASAMS, IRIS-T SLM, Iron Dome, CAMM / Sky Sabre, SPYDER, Barak MX, KM-SAM (Cheongung) |
| Long range | Patriot PAC-3 MSE, SAMP/T NG, David's Sling, Arrow 2 |
| Upper tier | THAAD, Arrow 3 |
| Sea | Aegis destroyer (SM-2 / SM-6), Aegis BMD destroyer (SM-3), Type 45 destroyer (Sea Viper) |

Each entry has: `id`, `name`, `origin` (country of manufacture, display only), `domain`, `layer`, `rangeKm`,
`altitudeKm`, `costCredits`, `upkeep`, `suitability` per threat class, `killRate` per threat class, `reactionSec`,
`radar` (type, band, detection range), `magazine` (ready interceptors per unit), `reloadHours`, and `sources[]`
(links to the official manufacturer or government pages used, for maintainers only; not shown in the game).

**Data sourcing:** use official public statements from manufacturers and governments only. Never use classified
or leaked material. Where no official figure exists (often the case for kill rates), pick a plausible value for
the game. Figures are not labelled by source in the game.

Threat classes are generic: **slow drone**, **fast drone**, **cruise missile**, **rocket**, **ballistic missile**.
No real missile or drone types are named.

## Theater view

Real ranges (2–200 km) are invisible on the world map, so each region gets a theater: a stylized 600 × 400 km
local map with 6–10 fictional sites. Each site has a type (city, port, power, comms, command) and a value.

- Clicking a region on the world map opens its theater.
- In deployment you drag equipment onto the theater. Coverage rings are drawn at the system's range, and a
  coverage heat map shows the gaps.
- Theaters are generated from the campaign seed, so the same seed gives the same theater.

## Engine changes (`src/engine/`)

1. **Types:** `Theater`, `Site`, `Deployment`, `ThreatWave`, `Track`. Deployed equipment becomes an `Asset` with a new
   role `defense`, so the existing condition, maintenance, upkeep and transit systems apply with no special cases.
2. **Commands:** `deploy`, `relocate`, `withdraw` and `resupply` (refill magazines using logistics and credits).
   They go through the same validation and spend logging as every other command.
3. **Waves:** each phase defines a wave profile (count, threat-class mix, target preference, timing). Waves are
   generated from the seeded RNG and scale with the existing adaptive difficulty director.
4. **Resolution:** each track crosses the theater toward a site. Every system it passes within range of gets a
   chance to stop it:
   `killRate × availability (condition, readiness, comms) × detection quality × stock available`.
   Reaction time sets how many chances a system gets while the track is in range, and radar detection range sets
   how early it is spotted. Each attempt uses magazine stock. A track that gets through damages the site's value
   and the region's infrastructure and stability.
5. **Management tie-ins:**
   - Poor comms or low awareness weakens the detection bonus, so tracks get through more often.
   - False reports (existing intel system) can trigger wasted interceptor spend on phantom tracks.
   - Overdue maintenance drops availability.
   - Empty magazines need `resupply`, which competes with everything else for credits and logistics.
6. **Saves:** `SimState.tactical` is optional, and every load path fills in an empty tactical state when it's
   missing. `SAVE_VERSION` stays at 1, so old saves and server data keep loading with no migration (the repo's
   own rule for state changes). The server's `stateShapeError` validates the new field when present.

## UI changes (`src/ui/`)

- **Briefing:** a new *Deploy* step with the theater map, the equipment catalog (filterable by layer), budget
  remaining, and a coverage summary per site.
- **During a phase:** a *Theater* tab beside Global Operations. It shows wave tracks moving, stock levels per
  system, and a live stats panel (stopped, leaked, stock used, credits spent).
- **Global map:** a small per-region badge for tactical status (protected / thin / exposed).
- **After-action report:** a tactical section covering sites lost, coverage gaps, stock efficiency, and the best and
  worst value systems.

## Scoring

A new **protection** component (site value preserved) joins `SCORE_WEIGHTS`. Weights are rebalanced so the
existing components keep their relative importance. Efficiency also counts interceptors spent on phantom tracks
and stock that was never used. The server keeps recomputing the score itself, as it does today.

## Scenario builder and export

- Built-in fictional presets: a theater plus a budget and wave profile, e.g. *Coastal Saturation*,
  *Long Night*, *Thin Budget*.
- Custom setups: save, export and import as JSON with a version number, through the same paths as save files.

## Delivery in stages

Each stage is its own PR with tests, and the game stays playable after every one.

| # | Stage | Done when |
| --- | --- | --- |
| 1 | Rules and data | CONTRIBUTING/README updated, equipment catalog, types, optional tactical state with load defaults, tests for old saves and catalog completeness |
| 2 | Engine | Theaters, deployment commands, waves, resolution, magazines. Tests: determinism, and a balance check that a sensible deployment beats no deployment on several seeds (on protection). Ships behind `TACTICAL_CONFIG.enabledInCampaign`, off until stage 3 |
| 3 | Deployment UI | Briefing Deploy step with theater map, rings, heat map and budget. Preview with `?tactical=1`; the flag stays off for everyone else until stage 5 makes tactical spending pay off |
| 4 | In-phase UI | Theater tab, live tracks, stats panel, world map badges |
| 5 | Scoring and AAR | Protection component, rebalanced weights so tactical spending pays off, tactical AAR section, server scoring updated. Turns the feature flag on |
| 6 | Scenarios | Presets, builder, export/import |

## Resolved questions

- Equipment list: expanded to about 35 systems. More can be added later by appending catalog entries.
- Modes: campaign only.
