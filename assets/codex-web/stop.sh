#!/bin/sh
set -eu

cd "$(dirname "$0")"

PORT="${PORT:-8787}"

if [ -f codex-web.pid ]; then
  pid="$(cat codex-web.pid 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
  rm -f codex-web.pid
fi

if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done
  fi
fi

if command -v screen >/dev/null 2>&1; then
  screen -S codex-web -X quit >/dev/null 2>&1 || true
fi

echo "Codex Web stopped"
