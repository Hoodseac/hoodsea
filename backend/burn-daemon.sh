#!/bin/bash
# Polls every 10 min, runs idempotent burn-exec.mjs, exits once burn-exec.done appears.
# Launch under pm2 with --no-autorestart so it stays stopped when finished.
cd "$(dirname "$0")"
NODE="${NODE:-node}"
echo "[burn-daemon] start $(date -u)"
while [ ! -f burn-exec.done ]; do
  "$NODE" burn-exec.mjs
  [ -f burn-exec.done ] && break
  sleep 600
done
echo "[burn-daemon] burn done, exiting $(date -u)"
