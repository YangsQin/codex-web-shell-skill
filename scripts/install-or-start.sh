#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: install-or-start.sh [target-dir]

Environment:
  HOST        Bind host. Defaults to 0.0.0.0 for LAN access.
  PORT        HTTP port. Defaults to 8787.
  CODEX_BIN   Optional path to codex executable.
  CODEX_NODE  Optional path to node executable.
  NO_START=1  Copy/update files without starting the server.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
skill_dir="$(dirname "$script_dir")"
source_dir="$skill_dir/assets/codex-web"
target_dir="${1:-$HOME/codex-web}"

mkdir -p "$target_dir"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'codex-web.log' \
    --exclude 'codex-web.err.log' \
    --exclude 'codex-web.pid' \
    "$source_dir/" "$target_dir/"
else
  find "$target_dir" -mindepth 1 \
    ! -name 'codex-web.log' \
    ! -name 'codex-web.err.log' \
    ! -name 'codex-web.pid' \
    -exec rm -rf {} +
  cp -R "$source_dir/." "$target_dir/"
  rm -f "$target_dir/codex-web.log" "$target_dir/codex-web.err.log" "$target_dir/codex-web.pid"
fi
chmod +x "$target_dir/start.sh" "$target_dir/start-background.sh" "$target_dir/stop.sh"

echo "Installed Codex Web Shell to: $target_dir"

if [ "${NO_START:-}" = "1" ]; then
  exit 0
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8787}"
export HOST PORT

cd "$target_dir"
./start-background.sh
echo "Log: $target_dir/codex-web.log"
