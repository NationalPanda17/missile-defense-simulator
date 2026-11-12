# Simulation Architecture

The application has three layers. Dependencies point downward only.

```
 ui/ (React views, map, modals)      reads state, issues Commands
        │
 store/simStore.ts                   real-time loop, autosave, notifications
        │
 engine/ (pure TypeScript)           state model, rules, tick, commands, scoring, persistence
```

`engine/` imports nothing from React or the DOM, except a guarded `localStorage` call in
`persistence.ts`. The Node persistence service (`server/`) reuses it directly. It runs headless in Node; `tests/engine.test.ts` plays full campaigns
with scripted policies.

## State

`SimState` (`engine/types.ts`) is a single JSON-serializable object. It holds everything,
including the RNG state, so a save reproduces the run exactly. Key parts:

| Field | Meaning |
| --- | --- |
| `assets[]` | 40 fictional assets. Each has a domain, a role (`sensor`/`comms`/`support`/`command`), condition, service timer and coverage regions |
| `regions{}` | Stored: `stability` and `infrastructure`. Derived each tick: `awareness`, `comms`, `readiness` and `threatLevel` |
| `events[]` | Event instances with status, confidence, ground truth (`isGenuine`), deadline, effects, response progress and a per-event log |
| `projects[]` | Funded investments in progress |
| `credits`, `personnel`, `crews`, `resilience`, `modernization`, `logistics` | Global resources |
| `history[]` | Hourly samples for charts and the AAR |
| `commands[]` / `log[]` | Command history (with cost) and the simulation log |
| `counters` | Inputs for scoring and lessons learned (escalations, spurious responses, etc.) |
| `phases[]`, `phaseIndex` | Campaign progression |

## The tick (`engine/engine.ts`)

One tick is one simulated hour. The store calls `advance()` in real time
(`msPerHourAt1x / speed`). It also calls it on demand in turn mode (+6h).

1. **Assets**: maintenance and transit count down. Condition decays at a per-domain rate,
   ×2.5 when service is overdue and ×1.6 in storms. A drop below 20% is logged as a failure.
2. **Events**: for each live event:
   - Genuine events apply per-hour drift effects (asset decay, stability and infrastructure
     drift, personnel, credits).
   - Confidence moves toward the truth at a speed set by regional awareness.
   - Confirmation and response progress advance. A completed response rolls for success.
   - At the deadline, genuine events **escalate**. Escalation applies one-time damage scaled
     by severity, and in chain-enabled phases can spawn follow-on events. False reports simply
     lapse.
3. **Scripted** phase events fire, then a random roll may generate a new event.
4. **Projects** progress and apply their effects on completion.
5. **Economy**: income scales with average stability, minus asset upkeep. Personnel regenerates.
6. **Metrics** are recomputed (see below). Regional stability drifts toward a target set by
   readiness, awareness, infrastructure, comms and threat.
7. History is sampled, achievements checked, and the adaptive difficulty factor is updated
   every 12h.
8. At the end of the phase, objectives are evaluated and rewards granted. The game then
   enters `briefing` (next phase) or `complete`.

## Dependency model (`engine/metrics.ts`)

All weights live in `SIM_CONFIG` (`engine/config.ts`).

- **Asset availability** = condition × status factor × (1 + modernization) × (1 − domain penalty).
- **Raw domain readiness** = capability-weighted availability of the domain's assets.
- **Network health** = Σ `commsWeight[d]` × comms-asset availability of domain *d*, minus the
  global comms penalty × mitigation. Mitigation = 1 − min(0.5, resilience × 0.005).
- **Effective domain readiness** = raw × Π over dependencies (1 − w × (1 − rawDep/100)) ×
  (1 − networkWeight × (1 − network/100)).
  Example: Air depends on Space (0.25) and Ground (0.15). Degraded relay satellites therefore
  lower Air's effective readiness even when every aircraft is healthy.
- **Regional comms** blends global network health, local comms and command assets
  (including satellites covering the region), infrastructure and event comms penalties.
- **Regional awareness** = sensor coverage (each covering sensor's capability × availability ×
  the effective/raw ratio of its domain), normalized and scaled by regional comms, minus event
  awareness penalties.
- **Global readiness** = weighted mean of effective domain readiness.

## Information quality

Each report gets a hidden `isGenuine` flag. The chance it is spurious is
`phase.falseRate × (1.4 − awareness/100)`, so regions with poor coverage produce more noise.
Starting confidence depends on awareness and ground truth. Phase rules add:
- **Conflicting reports**: the reported severity becomes a range and confidence drops.
- **Delayed information**: in low-comms regions, `reportedAt` falls hours after `occurredAt`,
  and the effects run before command knows about the event.

Player tools: **confirm** (cheap, a few hours, faster with good comms) sets confidence to
≥92 or exposes the report. **Dismiss** is free, but a dismissed genuine event becomes
`hiddenLive` and still escalates.

## Events (`engine/events.ts`)

Events are **data templates** (`EventTemplate`) that define:
- category, domains, target asset filter, severity range, decision window
- `effects[]`: per-hour drift or flat penalties while active, scaled by severity
- `escalation`: one-time effects plus probabilistic follow-on spawns (event chains)
- `responses[]`: cost (credits/personnel/crews), duration, base success, and optional
  domain or network dependency
- `weight(state, region)`: generation likelihood from current conditions. For example,
  unrest weight rises as stability falls, and power faults as infrastructure falls.

**To add an event**, append a template to `TEMPLATES` and add its category to the phases
where it should appear. No engine changes are needed.

## Commands (`engine/actions.ts`)

Every player action is a `Command` passed to `execute(state, cmd)`. Each command is validated
(resources, crews, status), charged to a spend category, applied, and recorded in
`state.commands`. The UI never mutates state directly.

## Campaign and modes

`buildPhases(settings)` (`engine/world.ts`) returns the phase list for each mode. The
campaign's four phases (`CAMPAIGN_PHASES` in `config.ts`) change *complexity*, not just
event rate:

| Phase | New mechanics |
| --- | --- |
| 1 Network Establishment | Low tempo, reliable reports, no chains |
| 2 Regional Instability | Event chains, conflicting reports, unrest, comms and satellite events |
| 3 Global Crisis | Delayed information, high false-report rate, scripted solar surge and global outage, severity 4 |
| 4 Recovery | Reconstruction grant, low tempo, final evaluation |

An adaptive director scales event frequency (0.8–1.3×) based on recent readiness and
network health.

## Tactical layer (`engine/tactical.ts`, `engine/equipment.ts`)

Campaign only, behind the `TACTICAL_CONFIG.enabledInCampaign` feature flag (off until the deployment screen
ships). All tuning lives in `TACTICAL_CONFIG` (`config.ts`); real equipment figures live in `EQUIPMENT`.

- **Own RNG.** `tactical.rng` drives site generation, wave scheduling and resolution, so the management
  simulation draws the same random numbers whether the layer is on or off.
- **Theaters.** Each region has a 600 × 400 km theater with fictional sites (cities, a port, power, comms, a
  command post), generated from the seed. Sites have an importance and an integrity (0–100).
- **Deployments.** `deploy` (briefing only) places a system and creates a backing `Asset` with role `defense` and
  capability 0. That gives it condition, maintenance and upkeep for free, without moving readiness metrics.
  `relocate` (briefing only), `withdraw` (50% refund) and `resupply` (refills the magazine after `reloadHours`,
  needs logistics) complete the set.
- **Waves.** When a briefing opens, `scheduleWaves` picks forecast regions (weighted toward low stability) and
  schedules the phase's waves (`TACTICAL_CONFIG.waves`). 20% strike outside the forecast. Each wave comes from one
  axis and holds tracks of generic threat classes aimed at sites, weighted by importance.
- **Resolution** (`tickTactical`, the hour a wave arrives). Poor regional awareness adds decoy tracks. For each
  track, the path runs from its entry point to its site:
  1. Detection: any available deployment whose sensor range touches the path sees it. Unseen tracks are engaged
     at reduced quality and twice the reaction time.
  2. Systems whose range the path crosses engage, outermost first. Time in range ÷ threat speed, minus reaction
     time, sets up to 2 shots. Each shot uses stock (jammers, lasers and microwave are unlimited).
  3. Chance per shot = kill rate × availability (condition, maintenance) × detection × regional comms factor.
  4. A track that gets through lowers its site's integrity, plus the region's infrastructure and stability.
- **Stats.** `tactical.stats` counts tracks, stopped, leaked, decoys engaged, shots and site damage, for the AAR.

## Scoring (`engine/scoring.ts`)

The weighted components (`SCORE_WEIGHTS`) are readiness, network, stability, event response,
infrastructure preservation, resource efficiency, information quality and recovery, plus up
to +8 for objectives met. Efficiency penalizes **waste**: credits spent on spurious reports,
failed responses, and large idle reserves. Total spending is never rewarded.
`lessonsLearned()` turns counters into the AAR narrative.

## Persistence and accounts

```
 Browser                                       Node (server/)                          PostgreSQL
 ───────                                       ──────────────                          ──────────
 simStore ─autosave/slots─► remote.ts ─cookie─► app.ts: CSRF check → session → route ─► repo.ts / auth.ts
     │                     (mds_session,        auth.ts: scrypt, sessions, limits        users, sessions
     │                      HttpOnly)           stateShapeError() + computeScore()       players, campaigns,
     └──► localStorage (always; guests use only this)          (shared engine)           saves, phase results
```

The engine is shared code. The server imports `src/engine` to validate submitted state
(`stateShapeError`) and to **recompute the score server-side** (`computeScore`). The stored
score therefore never depends on a number the client sent.

### Schema

| Table | Migration | Purpose |
| --- | --- | --- |
| `players` | 001 | Owner of game data, plus the callsign. Exactly one per user. |
| `campaigns` | 001 | One row per run (`state.campaignId`), with summary columns (mode, seed, status, phase, hour, score, grade, components, objectives). `completed_at` is set once. |
| `saves` | 001 | `UNIQUE (player_id, slot)` with slots `auto`/`slot1`–`slot3`. The full `SimState` is stored as `jsonb`. |
| `campaign_phase_results` | 001 | One row per evaluated phase objective |
| `users` | 002 | Username (unique, case-insensitive, `[A-Za-z0-9_.-]{3,32}`), scrypt hash, `player_id` (unique), login and password-change timestamps |
| `sessions` | 002 | **SHA-256 of the token** (never the token itself), user, created, last seen, expiry, user agent |

`users.player_id` cascades from `players`. Deleting an account deletes its player, which
cascades to the user, sessions, campaigns, saves and phase results. Migrations are plain SQL
files applied in name order. Each runs in a transaction and is recorded in
`schema_migrations`, behind an advisory lock.

### Authentication design

| Concern | Implementation (`server/auth.ts`, `server/app.ts`) |
| --- | --- |
| Password storage | `scrypt` (N=2^15, r=8, p=1, 16-byte salt, 32-byte key) in `scrypt$N$r$p$salt$hash` format, so parameters can be raised later. Passwords are NFKC-normalized; comparison uses `timingSafeEqual`. |
| Password policy | 10–200 characters and must not contain the username. Long passphrases are encouraged over composition rules. |
| Sessions | 32 random bytes (base64url) in cookie `mds_session`: `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `COOKIE_SECURE`/production. Only the SHA-256 is stored. 30-day expiry, extended at most hourly while in use. Expired rows are purged hourly. |
| Logout | Deletes the session row server-side, so a copied cookie stops working. Also: *sign out other devices*. A password change revokes every other session. |
| Account enumeration | Login returns one generic error. Unknown usernames still run a scrypt verify so timing matches. Registration necessarily reveals taken usernames (409). |
| Brute force | In-memory fixed-window limits: 8 failed logins per username and 40 per IP per 15 min, 10 registrations per IP per hour. The response is `429` with `Retry-After`. Use `TRUST_PROXY=1` behind a proxy. The limiter is per process, so a multi-instance deployment needs a shared store (e.g. Redis). |
| CSRF | Cookies are `SameSite=Lax`. Every non-GET API request must send `Content-Type: application/json`, which HTML forms can't send cross-site and the server never allows through CORS. Any `Origin` header must match `Host`. |
| Authorization | Every save and campaign query is scoped to the session's `player_id`. Writing to a campaign ID owned by another player returns 403. Reading one returns 404. |
| Sensitive actions | Changing the password and deleting the account both re-check the current password. |
| Recovery | No email. `npm run user:reset-password -- <user>` sets a random temporary password and revokes that user's sessions. |
| Legacy data | At registration the client sends its pre-accounts anonymous player ID once (`claimPlayerId`). If no account owns that player yet, the new account adopts it and its campaigns. The anonymous ID is no longer accepted as a credential anywhere. |

### API

Everything except `/api/health`, `/api/auth/register`, `/api/auth/login` and
`/api/auth/logout` requires a valid session (otherwise `401`).

| Method & path | Result |
| --- | --- |
| `GET /api/health` | `{ ok, db, saveVersion }` (503 if the database is down) |
| `POST /api/auth/register {username, password, claimPlayerId?}` | 201 `{ user, claimed }` + session cookie; 400 / 409 / 429 |
| `POST /api/auth/login {username, password}` | 200 `{ user }` + session cookie; 401 / 429 |
| `POST /api/auth/logout` | 204, revokes the session and clears the cookie |
| `GET /api/auth/me` | `{ user }`: username, callsign, created, last login, active sessions |
| `POST /api/auth/password {currentPassword, newPassword}` | Revokes other sessions; 403 if the current password is wrong |
| `POST /api/auth/logout-others` | `{ revokedSessions }` |
| `DELETE /api/auth/account {password}` | 204, deletes the account and all its data |
| `PUT /api/player {callsign}` | Rename the callsign |
| `GET /api/saves` · `GET/PUT/DELETE /api/saves/:slot` | Slot summaries, `{v, state}`, validated upsert (transactional, refreshes the campaign summary), delete |
| `GET /api/campaigns` · `GET/DELETE /api/campaigns/:id` | History, detail (phase results, slots), delete with cascade |

Errors are JSON `{ error }` with status 400, 401, 403, 404, 405, 409, 413, 415, 422, 429 or
500. Bodies are capped at 8 MB (a finished campaign is about 40–60 KB). In production, the
same process serves `dist/` with SPA fallback and blocks path traversal.

### Client behaviour

- On load, the store probes `/health` then `/auth/me`. The result is **online + signed in**,
  **online + guest**, or **offline**.
- `newGame` assigns a fresh `campaignId`. Server autosave runs only when signed in,
  coalesced so at most one request is in flight and the latest state wins. Signing in pushes
  the current game immediately.
- A `401` on any call means the session ended (expired, revoked, or the password changed
  elsewhere). The client drops to guest mode with a notice and keeps saving locally.
- A network failure, or a non-JSON 5xx from the dev proxy, marks the server **offline**. The
  client re-probes every 30 seconds.

### Production checklist

Serve over HTTPS and set `NODE_ENV=production` (or `COOKIE_SECURE=1`). Set `TRUST_PROXY=1`
only when a trusted reverse proxy sets `X-Forwarded-For`. Use a managed PostgreSQL with
backups via `DATABASE_URL`. Run a single instance, or move rate limiting to a shared store,
before scaling out.

## Testing

`npm test` runs:
- a determinism check (same seed → identical outcome)
- a balance check: a simple active policy must outscore a passive one on several seeds.
  At the time of writing, passive play scores about 34 (F) and the naive active policy
  67–79 (C/B).
- command validation and cost logging
- a save/export round-trip
- API and auth integration tests (`tests/server.test.ts`, 23 tests) against real PostgreSQL.
  By default the suite boots a throwaway embedded instance in a temp directory. Set
  `TEST_DATABASE_URL` to use your own, but note that its data is truncated.
  - **Auth:** scrypt hashing, cookie flags (including `Secure`), token-hash-only storage,
    validation and case-insensitive uniqueness, generic login errors, per-user and per-IP
    rate limits, server-side logout revocation, expiry, password change revoking other
    sessions, CSRF (form content type and foreign `Origin`), one-time legacy claim, account
    deletion cascade, and callsign updates.
  - **Persistence:** validation (bad slot, version, shape, missing campaign ID), lossless
    save/load where the loaded state keeps simulating identically, user isolation (403 for
    another user's campaign ID), phase results, server-side scoring that ignores a tampered
    client score, completion recorded once, cascading deletes, and body limits.
  - **Static:** SPA fallback and path traversal.
