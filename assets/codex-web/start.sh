#!/bin/sh
set -eu

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8787}"
export HOST PORT

if [ -n "${CODEX_NODE:-}" ]; then
  exec "$CODEX_NODE" server.js
fi

for candidate in \
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
  "$HOME/Library/Caches/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
do
  if [ -x "$candidate" ]; then
    exec "$candidate" server.js
  fi
done

exec node server.js
