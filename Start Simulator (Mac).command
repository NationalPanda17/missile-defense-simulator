#!/bin/bash
# Double-click this file to start the Missile Defense Simulator with its local save server.
# First run: installs what the game needs (a few minutes). Leave this window open while you play;
# close it (or press Control+C) to stop.
cd "$(dirname "$0")" || exit 1
clear
echo "=================================================="
echo "  Missile Defense Simulator - local server"
echo "=================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed yet."
  echo "Install it from https://nodejs.org (the 'LTS' version), then double-click this file again."
  open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "Press Return to close this window."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Your Node.js is version $(node -v), but version 22 or newer is needed."
  echo "Install the 'LTS' version from https://nodejs.org, then double-click this file again."
  open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "Press Return to close this window."
  exit 1
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "First-time setup: installing what the game needs. This can take a few minutes..."
  echo
  if ! npm install; then
    echo
    echo "Setup did not finish. Check your internet connection and try again."
    read -r -p "Press Return to close this window."
    exit 1
  fi
  echo
fi

echo "Starting the game and its save server..."
echo "Your browser will open at http://localhost:5173 in a few seconds."
echo "Keep this window open while you play. Close it to stop."
echo
( sleep 8; open "http://localhost:5173" ) &
npm run dev:full
