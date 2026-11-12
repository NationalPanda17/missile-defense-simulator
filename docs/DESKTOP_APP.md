# The desktop app

The desktop app is the easiest way to play with **accounts and server saves** on your own computer. It contains
the game, its save server and a small database. You don't need Node.js or a terminal: install it and open it like any other app.

## Download

Open the repository's **Releases** page on GitHub and download the file for your computer:

| Computer | File |
| --- | --- |
| Mac (Apple silicon) | `Missile-Defense-Simulator-…-mac-arm64.dmg` |
| Windows | `Missile-Defense-Simulator-…-win-x64.exe` |
| Linux | `Missile-Defense-Simulator-…-linux-x86_64.AppImage` |

## First launch

The app is not code-signed (signing needs a paid developer certificate), so the first launch needs one extra step.

**Mac**
1. Open the `.dmg` and drag **Missile Defense Simulator** into **Applications**.
2. In Applications, **right-click** (or Control-click) the app and choose **Open**, then **Open** again.
   On newer macOS versions, if there is no Open button: try to open it once, then go to
   **System Settings → Privacy & Security** and click **Open Anyway**.

**Windows**
1. Run the `.exe` installer. If **"Windows protected your PC"** appears, click **More info → Run anyway**.
2. Choose where to install and finish. Start it from the Start menu.

**Linux**
1. Make the file runnable: right-click → Properties → Permissions → *Allow executing file as program*
   (or `chmod +x Missile-Defense-Simulator-*.AppImage`).
2. Double-click it.

After that it opens normally. The first start takes a few seconds while it sets up its database.

## Using it

- Create an account from the **Sign in** button in the top bar. Server saves, campaign history, Training Academy
  progress and drill bests are kept in the app.
- Only one copy runs at a time; opening it again brings the open window to the front.
- Links to guides and GitHub open in your normal web browser.

## Updates

When a newer version is published, the app shows a **"Version … is available"** notice with a **Download** button
that opens the release page. Download and install it over the old one: your accounts and saves are kept (they live
outside the app, see below). The app checks GitHub at most once every six hours, and only reads the latest release's
version number. **Not now** hides the notice until the next version.

## Where your data lives

| Computer | Folder |
| --- | --- |
| Mac | `~/Library/Application Support/Missile Defense Simulator/pgdata` |
| Windows | `%APPDATA%\Missile Defense Simulator\pgdata` |
| Linux | `~/.config/Missile Defense Simulator/pgdata` |

To back it up, quit the app and copy that folder. Uninstalling the app does not delete it.

## Building it yourself

```bash
npm ci
npm run desktop:dist
```

The installers appear in `release/`. Each platform's app has to be built on that platform (the database programs
inside are platform-specific). The **Desktop app** workflow in GitHub Actions builds all three; push a tag like
`v0.2.0` to attach them to a release.

## Publishing a new version (maintainers)

1. Merge your changes to `main` as usual. The browser version on GitHub Pages updates by itself.
2. Raise `version` in `package.json` (for example `0.1.0` → `0.2.0`), commit it, and push a matching tag:
   `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Desktop app** workflow builds the installers and attaches them to the `v0.2.0` release.
4. Desktop players see the update notice the next time they open the app.
