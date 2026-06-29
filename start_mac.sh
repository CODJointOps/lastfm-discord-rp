#!/usr/bin/env bash
# Start the Last.fm Discord RPC under PM2 on macOS.
set -e
cd "$(dirname "$0")"
git pull || true
npm install --no-audit --no-fund
node_modules/.bin/pm2 start ecosystem.config.js
node_modules/.bin/pm2 save
echo "Started. View logs: node_modules/.bin/pm2 logs lastfm-discord-rp"
