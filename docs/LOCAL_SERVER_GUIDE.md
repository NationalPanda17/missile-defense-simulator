# Running the simulator on your own computer (with server saves)

> **Easier option:** the [desktop app](DESKTOP_APP.md) does all of this in one download, with no Node.js needed.
> This guide is for running it from the source files instead.

This guide is for anyone, including people who have never used a terminal. It takes about 10–15 minutes the
first time. After that, starting the game is a double-click.

## What you get

The online version of the game saves only in your web browser. Running it on your own computer adds a small
**save server**:

- You can create an **account** and keep your campaigns on the server.
- Your campaigns get a **history** with scores and grades.
- Everything stays **on your computer**. Nothing is sent to the internet.

## What you need

- A Mac, or a Windows PC (64-bit; Windows on ARM laptops are not supported yet).
- An internet connection for the first setup only.
- About 1 GB of free disk space.

---

## Step 1 — Install Node.js (one time)

Node.js is a free program the simulator runs on.

1. Go to **https://nodejs.org**.
2. Click the big button for the **LTS** version (it says "Recommended for most users"). Version 22 or newer works.
3. Open the file you downloaded and click through the installer, accepting the defaults.
   - **Mac:** the file ends in `.pkg`. You may be asked for your Mac password; that's normal.
   - **Windows:** the file ends in `.msi`. If a box asks about "Tools for Native Modules", you can leave it
     unticked.
4. When it says the installation is complete, close it. You don't need to open anything.

## Step 2 — Download the simulator (one time)

1. Go to **https://github.com/NationalPanda17/missile-defense-simulator**.
2. Click the green **Code** button, then **Download ZIP**.
3. Find the downloaded file (usually in your **Downloads** folder) and open it to unzip it. You'll get a
   folder called `missile-defense-simulator-main`.
4. Move that folder somewhere easy to find, for example your **Documents** folder.

## Step 3 — Start it

Open the `missile-defense-simulator-main` folder and double-click the start file for your computer.

### On a Mac: `Start Simulator (Mac).command`

The first time, macOS may say it **can't be opened because it's from an unidentified developer**:

1. Click **Done** (or **OK**).
2. **Right-click** (or Control-click) the file and choose **Open**.
3. Click **Open** in the box that appears. You only need to do this once.

On newer macOS versions, if there's no Open button, go to **System Settings → Privacy & Security**,
scroll down to the message about the file, and click **Open Anyway**.

### On Windows: `Start Simulator (Windows).bat`

The first time, Windows may show **"Windows protected your PC"**:

1. Click **More info**.
2. Click **Run anyway**.

### What happens next

- A black (or white) text window opens. **The first time**, it installs what the game needs, which can take a
  few minutes. You'll see lots of text scroll by; that's normal.
- Then your web browser opens the game at **http://localhost:5173**. If it doesn't, open your browser and
  type that address in yourself.
- **Leave the text window open while you play.** It *is* the save server.

## Step 4 — Create your account

1. In the game, look at the top bar. Next to **Storage** you'll see a **Sign in** button.
2. Click it, choose **Create account**, pick a username and a password (at least 10 characters), and confirm.
3. The top bar now shows your username. Your game autosaves to the server while you're signed in.
4. Under **Campaign Management** (left menu, or press **P**) you'll find your server save slots and your
   campaign history.

## Stopping and starting again

- **To stop:** close the text window (or click in it and press **Control + C**).
- **To play again later:** double-click the same start file. Setup is skipped, so it starts in seconds.

## Where your saves live (and how to back them up)

Your server saves are stored in a hidden folder called `.pgdata` inside the simulator folder.

- **To back up:** copy the whole `missile-defense-simulator-main` folder somewhere safe (with the game
  stopped).
- **Don't delete** the `.pgdata` folder unless you want to erase all accounts and server saves.
- To see hidden folders: on a Mac press **Command + Shift + .** in Finder; on Windows choose
  **View → Show → Hidden items** in File Explorer.

## Updating to a newer version

1. Stop the game.
2. Download the ZIP again (Step 2) and unzip it.
3. Copy the `.pgdata` folder from your **old** folder into the **new** one, so your accounts and saves come along.
4. Start the new version with its start file. It installs any updates the first time.

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "Node.js is not installed yet" | Do Step 1, then double-click the start file again. If you just installed it, restart your computer once. |
| "version 22 or newer is needed" | Install the current **LTS** version from nodejs.org (Step 1). It replaces the old one. |
| "Setup did not finish" | Check your internet connection and double-click the start file again. |
| The browser says "can't connect" or "site can't be reached" | Wait 20 seconds and refresh the page. The first start can be slow. |
| The top bar says **LOCAL ONLY** | The save server isn't running. Make sure the text window is still open. If it closed, start it again. On the Campaign Management page, click **Retry connection**. |
| Text window shows "port … already in use" | The simulator is probably already running in another window. Close all its windows and start it once. If that doesn't help, restart your computer. |
| Forgot your password | Stop the game. In the simulator folder, open a terminal (Mac: right-click the folder → **New Terminal at Folder**; Windows: Shift + right-click inside the folder → **Open PowerShell window here**) and type `npm run user:reset-password -- yourusername`, then press Enter. It shows a temporary password. |
| Anything else | Close the text window, restart your computer, and start the game again. If it still fails, open an issue on the GitHub page and paste the last lines from the text window. |

## If double-clicking doesn't work

You can start the game by typing one line instead.

1. Open a terminal in the simulator folder:
   - **Mac:** right-click the `missile-defense-simulator-main` folder and choose **New Terminal at Folder**.
     (If you don't see it, open **Terminal** from Applications → Utilities, type `cd ` with a space after it,
     drag the folder into the window, and press Enter.)
   - **Windows:** open the folder, click in the address bar at the top, type `cmd` and press Enter.
2. Type this and press Enter:
   - **Mac:** `bash "Start Simulator (Mac).command"`
   - **Windows:** `"Start Simulator (Windows).bat"`

If that also fails, type these two lines one at a time (it's what the start file does):

```
npm install
npm run dev:full
```

Then open **http://localhost:5173** in your browser.

## For the curious: what the start file does

It checks that Node.js is installed, runs `npm install` the first time, then runs `npm run dev:full`, which
starts three things on your computer: a small PostgreSQL database (port 5433), the save server (port 8787)
and the game itself (port 5173). See the main [README](../README.md) for the developer details.
