# Missile Defense Simulator v0.1 — Global Integrated Defense

[![Tests](https://github.com/NationalPanda17/missile-defense-simulator/actions/workflows/test.yml/badge.svg)](https://github.com/NationalPanda17/missile-defense-simulator/actions/workflows/test.yml)

A browser-based strategy game. You command a fictional defense network that spans four
domains (Space, Air, Sea and Ground) across seven strategic regions. You manage readiness,
communications, unreliable intelligence and scarce resources through a four-phase campaign
with dynamic events.

The world is fictional: its countries, network assets, sites and scenarios are invented, and
no scenario recreates a real attack. The tactical layer's equipment catalog uses real air
defense systems, with figures taken only from official public manufacturer or government
statements, or made up for the game where none exist. No classified or leaked information
is used.

## Quick start

Requirements: **Node.js 22+** (CI tests Node 22 and 24; developed on Node 26) and npm. PostgreSQL is optional. If you
don't have it, the project runs a real PostgreSQL server from `node_modules` for you.

```bash
cd missile-defense-simulator
npm install
npm run dev:full
```

`dev:full` starts three things: a local PostgreSQL on port 5433 (data kept in `./.pgdata`),
the persistence API on port 8787, and the game on http://localhost:5173. Press Ctrl+C to stop
all three.

To run the game without the backend, use `npm run dev`. Saves then stay in the browser, and
the top bar shows **LOCAL ONLY**.

| Command | Purpose |
| --- | --- |
| `npm run dev:full` | Embedded PostgreSQL + API (watch mode) + Vite client, all in one terminal |
| `npm run dev` | Client only (browser saves only) |
| `npm run db:start` | Embedded PostgreSQL only, on :5433 |
| `npm run server` | API only, in watch mode (uses `DATABASE_URL`) |
| `npm run build` | Type-check client and server, then build the client into `dist/` |
| `npm start` | Production: one process that serves the API and `dist/` on `PORT` (default 8787) |
| `npm test` | Engine tests plus API and auth integration tests against a throwaway PostgreSQL (CI: `.github/workflows/test.yml`) |
| `npm run user:reset-password -- <username>` | Operator tool: issue a temporary password and sign the user out everywhere |
| `npm run typecheck` | TypeScript only |

### Using your own PostgreSQL

```bash
export DATABASE_URL=postgres://user:pass@host:5432/mds
npm run build && npm start
```

The server applies migrations from `server/migrations/` on startup. Set `PORT` to change the
listening port. Set `SERVE_STATIC=0` to serve the API only.

| Env var | Default | Used by |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://mds:mds@localhost:5433/mds` | server |
| `PORT` | `8787` | server |
| `SERVE_STATIC` | serve `dist/` if it exists | server |
| `API_PORT` | `8787` | Vite dev proxy for `/api` |
| `PGPORT` / `PGDATA_DIR` | `5433` / `.pgdata` | embedded dev database |
| `COOKIE_SECURE` | `1` when `NODE_ENV=production`, else `0` | server: adds `Secure` to the session cookie (requires HTTPS) |
| `TRUST_PROXY` | `0` | server: set `1` behind a reverse proxy so rate limits use `X-Forwarded-For` |
| `TEST_DATABASE_URL` | unset (tests boot a temp embedded DB) | `npm test` |

The test suite truncates the `players` table in its database, so never point
`TEST_DATABASE_URL` at a database you care about.

Fonts load from Google Fonts and fall back to system fonts when offline.

## How to play

1. Pick a mode on the start screen: **Campaign** (240h, four phases), **Crisis** (96h, starts
   mid-disaster), **Training** (guided), or **Sandbox** (configure everything in the Scenario
   Editor).
2. Read the **briefing**, then choose *Assume command*. The clock starts.
3. Watch the **Active Events** list (right). Open an event to see its confidence, impact,
   decision window and management responses (cost, duration and success chance).
   - Confidence is low? **Task confirmation** (15 cr) to confirm or expose a spurious report.
   - Confident? **Execute** a response.
   - **Monitor** buys time once. **Dismiss** closes a report, but genuine events keep
     developing out of sight.
4. Keep assets serviced: overdue maintenance makes decay 2.5x faster. Crews limit how much work
   can run at the same time.
5. Invest for the long term: hardening, network resilience, crews, recruitment, modernization.
6. **Tactical defense (campaign).** Each briefing forecasts the regions where threat waves will
   strike. In the briefing's *Deploy defenses* step, place real air defense systems on each
   region's 600 × 400 km theater map: long-range systems where their rings cover most sites,
   point defense at the most important ones, and sensors to see threats early. During the phase,
   watch waves play out in the **Tactical Theater** (X) and resupply systems that run low.
   Threat protection is 15% of the campaign score.

   Pick a **tactical scenario** on the campaign card: *Standard*, *Coastal Saturation* (drone
   swarms), *Long Night* (many cruise-missile waves), *High Arc* (ballistic-heavy) or *Thin
   Budget*. **Customize…** opens a builder for wave count and size, threat mix, forecast regions,
   surprise chance, false tracks and defense budget, with a per-phase preview. Scenarios export
   and import as versioned JSON files.
7. At the end, the **After-Action Review** scores your command and explains what helped and
   what hurt.

### Controls

| Key | Action |
| --- | --- |
| Space | Pause / resume |
| 1–4 | Speed 1x / 2x / 4x / 8x |
| T | Advance one turn (6h). Turn mode stops the real-time clock |
| G S A M D | Global · Space · Air · Maritime · Ground |
| X | Tactical Theater (campaign) |
| I C L F | Intelligence · Communications · Logistics · Infrastructure |
| P E R | Campaign · Scenario editor · After-action review |
| B | Toggle the bottom timeline/log panel |
| Ctrl/⌘+S | Quick-save to slot 1 |
| ? | Help |

The tactical layer is on in campaigns. To play a campaign without it, open the game with
`?tactical=0` (remembered in that browser; `?tactical=1` turns it back on).

On the map, scroll to zoom, drag to pan and click a region to open its regional command panel.
Click an asset to inspect, maintain or redeploy it. **Layers & Legend** toggles domain layers,
infrastructure, the comms network, sensor coverage, events and history, and switches the region
overlay metric.

## Accounts and saving

**Guests** can play right away. Their saves stay in the browser (an autosave, three slots,
and JSON export/import).

**Signed-in commanders** also get server storage. Choose **Sign in** in the top bar or on
the start screen, then create an account (username plus a password of at least 10
characters). Signing in adds:

- **Server saves:** an autosave plus slots 1–3 on the Campaign Management page (P). The
  server autosave updates every 12 simulated hours and at each phase change, and runs
  straight after you sign in.
- **Service Record:** every campaign run, with phase, server-computed score, grade and
  phase objective results.
- **Account window** (click your name in the top bar): change callsign, change password
  (signs out your other devices), sign out, sign out other devices, or delete the account
  and all its server data.

If this browser saved to the server before accounts existed, your first account
automatically adopts those campaigns. Browser saves keep working whether you're signed in,
signed out, or the server is down. The top bar shows your username, **SIGN IN** or
**LOCAL ONLY**.

There is no email, so there's no self-service password reset. Whoever runs the server
can issue a temporary password:

```bash
npm run user:reset-password -- <username>
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, codebase rules, content guidelines and the pull request workflow.

## Project structure

```
missile-defense-simulator/
├── index.html
├── package.json / vite.config.ts / tailwind.config.js / tsconfig.json
├── docs/ARCHITECTURE.md          Simulation + persistence architecture, extension guide
├── server/                       Node persistence API (node:http + pg)
│   ├── index.ts                  Entry: connect, migrate, listen, serve dist/, purge sessions
│   ├── app.ts                    Routes, auth gate, CSRF checks, validation, static files
│   ├── auth.ts                   scrypt hashing, sessions, cookies, rate limiting
│   ├── repo.ts                   All SQL (players, campaigns, saves, phase results)
│   ├── db.ts                     Pool + forward-only migration runner
│   └── migrations/               001_init.sql (campaigns, saves), 002_auth.sql (users, sessions)
├── scripts/
│   ├── dev-db.ts                 Embedded PostgreSQL for local dev
│   ├── dev-full.ts               DB + API + client in one command
│   └── reset-password.ts         Operator password reset
├── tests/
│   ├── engine.test.ts            Headless engine tests (Vitest)
│   └── server.test.ts            API + auth integration tests against real PostgreSQL
└── src/
    ├── main.tsx                  React entry point
    ├── index.css                 Tailwind layers, theme components, animations
    ├── engine/                   Pure TypeScript simulation — no React, no DOM
    │   ├── types.ts              Data model (assets, regions, events, state…)
    │   ├── config.ts             All tunable rules: dependencies, rates, costs, phases, scoring weights
    │   ├── world.ts              Fictional world seed + scenario/mode construction
    │   ├── rng.ts                Deterministic, serializable RNG
    │   ├── metrics.ts            Derived metrics + cross-domain dependency model
    │   ├── events.ts             Event template library + generation
    │   ├── engine.ts             The hourly tick: assets, events, projects, economy, phases
    │   ├── actions.ts            Player commands (validate → cost → mutate → log)
    │   ├── scoring.ts            Objectives, score breakdown, lessons learned
    │   ├── persistence.ts        Save/load/export
    │   ├── equipment.ts          Tactical layer: real air defense equipment catalog
    │   ├── tactical.ts           Tactical layer: theaters, waves, resolution, helpers
    │   ├── scenarios.ts          Tactical scenario presets, limits, export/import
    │   └── index.ts
    ├── shared/api.ts             Types shared by the API and its client
    ├── store/simStore.ts         Real-time loop, autosave + server sync, toasts; React binding
    ├── store/remote.ts           Fetch client for the persistence API
    └── ui/
        ├── App.tsx               Layout, routing, keyboard shortcuts
        ├── Account.tsx           Sign in / create account / account management
        ├── uiState.tsx           UI-only state (view, selection, layers)
        ├── Shell.tsx             Top bar, left nav, right sidebar, bottom panel
        ├── Modals.tsx            Event investigation, asset inspection, briefing, start screen, tutorial
        ├── components/ui.tsx     Panels, bars, gauges, line charts, sparklines, modal, tabs
        ├── map/                  SVG geospatial display + stylized region geometry
        └── views/                Global ops, domain dashboards, staff views, campaign, editor, AAR
```

## Status of the v0.1 checklist

All 20 mandatory v0.1 features are implemented and playable: dashboard, interactive map,
7 regions, 4 domain panels, readiness indicators, resource pool, network health, event queue,
command actions, clock, pause/resume, speed control, event generation, persistent event
states, command history, resource expenditure, scoring, save/load, reset and AAR.

Persistent campaigns run on a Node/PostgreSQL service with user accounts.

Not yet built (roadmap): email verification and self-service password reset, multi-scenario
campaign trees, and MapLibre vector basemaps. The SVG map is used because it needs no tile server.
