# Hosting the game online, with accounts

The public site on GitHub Pages is browser-only: saves stay in each player's browser. To let anyone create an
account and keep campaigns, Training Academy progress and drill bests on a server, without installing anything,
run the game and its save server on a host.

Everything needed is in the repository:

| File | What it is |
| --- | --- |
| `Dockerfile` | The game and the save server in one image. Serves the game and `/api` on `$PORT` (default 8787). |
| `render.yaml` | A one-click blueprint for [Render](https://render.com): the web service plus a PostgreSQL database. |

The server applies its database migrations itself on start, so a fresh database is set up automatically.
Every pull request builds the image and tests it against a real PostgreSQL in CI, so you know the image works
before you deploy it.

## Option A: Render (simplest)

1. Sign in to Render with your GitHub account.
2. Choose **New → Blueprint** and pick the `missile-defense-simulator` repository. Render reads `render.yaml`.
3. Review the plan and click **Apply**. The first build takes a few minutes.
4. Open the service's URL (something like `https://missile-defense-simulator.onrender.com`) and create an account.

About cost: the blueprint asks for **free** plans so you can try it. Free web services sleep after a while
without visitors (the first visit then takes about a minute), and free databases are deleted after a limited
period. For anything players rely on, switch the web service and the database to paid plans in Render's dashboard
before sharing the link.

## Option B: any Docker host

Build and run the image anywhere that runs containers (Fly.io, Railway, a VPS, a home server):

```bash
docker build -t missile-defense-simulator .
docker run -p 8787:8787 -e DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME missile-defense-simulator
```

Settings (environment variables):

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. **Required.** |
| `PORT` | Port to listen on. Default `8787`. |
| `NODE_ENV=production` | Set by the image. Turns on secure (HTTPS-only) session cookies. |
| `COOKIE_SECURE` | `1` or `0` to force secure cookies on or off. Use `0` only for plain-HTTP testing. |
| `TRUST_PROXY=1` | Set when the server sits behind a proxy or load balancer that adds `X-Forwarded-For`, so login rate limits see real client addresses. |

Always serve it over **HTTPS** (every host above does this for you). Passwords are hashed with scrypt and only
hashes of session tokens are stored, but HTTPS is still what keeps logins private on the way in.

## Point the public site at it

Once the hosted version is up, tell the GitHub Pages build about it, so players who open the browser-only site
see a "Play the online version" link where server saves would be:

1. In the repository on GitHub: **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Name `ONLINE_URL`, value the hosted address, for example `https://missile-defense-simulator.onrender.com`.
3. Re-run the **Deploy to GitHub Pages** workflow (or merge anything to `main`).

## Backups and accounts

- Back up the database with your host's backup feature, or `pg_dump "$DATABASE_URL" > backup.sql`.
- Reset a player's password from a shell with access to the database:
  `DATABASE_URL=... npm run user:reset-password -- <username>` (prints a temporary password).
