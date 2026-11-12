# Contributing to Missile Defense Simulator

Thanks for your interest in improving the simulator. This guide covers setting up the
project, the rules of the codebase, and how changes reach `main`.

## Ground rules for content

This is a **strategy and management game set in a fictional world**. The one exception is
the tactical layer's equipment catalog (`src/engine/equipment.ts`), which uses real air
defense systems.

- **World:** countries, organizations, units, sites, scenarios and the network's own assets
  stay fictional. Do not add locations of real facilities.
- **Real equipment:** real air defense systems may appear by name in the equipment catalog,
  with figures such as range, altitude, cost, kill rates, reaction times and radar specs.
- **Where figures come from:** only official public statements by manufacturers or
  governments. Where no such statement exists, make up a plausible value for the game.
  Never use classified or leaked information of any kind. List the official references
  you used in the entry's `sources`.
- **No real attacks:** no scenario, wave or event may recreate, be named after, or be dated
  to a real attack or conflict. Threats use generic classes (slow drone, fast drone, cruise
  missile, rocket, ballistic missile), not real missile or drone types.
- **Events** outside the tactical layer describe operational *management* problems
  (outages, weather, logistics, uncertain reports).

Pull requests that cross these lines will be closed, however good the code is.

## Getting set up

Requirements: **Node.js 22+** and npm. PostgreSQL is optional, because the project can run a
real PostgreSQL from `node_modules`.

```bash
git clone https://github.com/NationalPanda17/missile-defense-simulator.git
cd missile-defense-simulator
npm install
npm run dev:full      # PostgreSQL on :5433 + API on :8787 + game on http://localhost:5173
```

Use `npm run dev` for the client alone (browser saves only). To use your own database
instead, set `DATABASE_URL` and run `npm run server`. The README lists every command and
environment variable.

## Before you open a pull request

Run the same checks CI runs:

```bash
npm run build   # typechecks client and server, then builds the client
npm test        # engine tests + API/auth integration tests
```

`npm test` boots a throwaway PostgreSQL in a temp directory, so you don't need one. If you
set `TEST_DATABASE_URL`, **the suite truncates that database**, so only ever point it at a
disposable one.

For changes to the UI, also play it: start a campaign, open the views you touched, and check
the browser console. Check at a narrow (phone) width too if you changed layout.

## How the code is organized

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture. The rules that
matter most:

| Area | Rule |
| --- | --- |
| `src/engine/` | **Pure TypeScript.** No React, DOM, network or `Date.now()`/`Math.random()` in simulation logic. Use the seeded RNG in `rng.ts` so runs stay deterministic and saves replay exactly. The server imports this code too. |
| Tunable numbers | Belong in `src/engine/config.ts` (rates, costs, dependency weights, phases, score weights), not inline in logic. |
| Player actions | Go through `execute()` in `src/engine/actions.ts`: validate, charge, mutate, record. The UI never mutates `SimState` directly. |
| New events | Add a template to `TEMPLATES` in `src/engine/events.ts`, and its category to the phases where it should appear. No engine changes should be needed. |
| `SimState` shape | Changing it affects saves. Keep fields optional or provide a default when loading, and bump `SAVE_VERSION` in `persistence.ts` only if old saves truly can't load. |
| `server/` | All SQL lives in `repo.ts` / `auth.ts`. Every save/campaign query must be scoped to the session's `player_id`. |
| Database schema | Add a **new** numbered file in `server/migrations/` (e.g. `003_feature.sql`). Never edit a migration that has already been merged. |
| `src/shared/api.ts` | The single source of request/response types for client and server. |
| Dependencies | Avoid new runtime dependencies unless they clearly earn their place, and pin exact versions. |

### Tests

- Changes to engine rules should keep `tests/engine.test.ts` passing. That includes the
  balance check that an active commander outscores a passive one. If you deliberately
  rebalance, say so in the PR.
- New or changed API routes need integration tests in `tests/server.test.ts`. Use the
  `agent()` helper; it handles cookies like a browser.
- Bug fixes should come with a test that fails without the fix where practical.

### Style

TypeScript is `strict`, with `noUnusedLocals` and `noUnusedParameters` enabled; the build
fails on type errors. Match the style of the surrounding code: small functions, descriptive
names, and comments that explain *why* rather than *what*. UI colours come from the `ops`
Tailwind palette and the shared components in `src/ui/components/ui.tsx`.

## Pull request workflow

`main` is protected:

- Changes land through pull requests.
- Both CI checks, **Typecheck, build & test (Node 22.x)** and **(Node 24.x)**, must pass.
- The branch must be up to date with `main` before merging.
- Force-pushes to `main` and deleting `main` are blocked.

1. Branch from the latest `main` with a descriptive name, e.g. `feat/regional-forecasts`,
   `fix/autosave-race`, `docs/api-examples`.
2. Keep each PR focused on one change. Write the description for a reviewer: what changed,
   why, and how you verified it (commands run, screens checked).
3. PRs are **squash-merged**, so the PR title becomes the commit message on `main`. Write it
   in the imperative, e.g. "Add regional weather forecasts".
4. You can turn on **auto-merge** for your PR. It merges once checks pass. The head branch is
   deleted automatically after merging.

Commit messages inside a PR are up to you, but a short imperative summary line followed by a
blank line and details is appreciated.

## Reporting bugs and security issues

- **Bugs and ideas:** open a GitHub issue. Include steps to reproduce, the game mode, and the
  browser console or server log output. An exported save (Campaign Management → Export
  JSON) helps a lot.
- **Security vulnerabilities** in authentication, sessions or the API: please **don't open a
  public issue**. Use GitHub's **Report a vulnerability** button on the repository's
  Security tab if it's available. Otherwise, open an issue asking for a private contact,
  without any details.

## License

No license has been chosen for this project yet. Until one is added, please ask in an issue
before reusing the code elsewhere. By submitting a contribution you agree that it may be
distributed under whatever license the maintainer adopts for the project.
