#!/bin/sh
set -eu

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8787}"
export HOST PORT

./stop.sh >/dev/null 2>&1 || true

nohup ./start.sh >> codex-web.log 2>> codex-web.err.log < /dev/null &
pid="$!"
echo "$pid" > codex-web.pid

sleep 2

if ! kill -0 "$pid" 2>/dev/null; then
  echo "Codex Web failed to start. See codex-web.log and codex-web.err.log." >&2
  exit 1
fi

echo "Codex Web started with PID $pid"
echo "Local URL: http://127.0.0.1:$PORT"

if command -v ifconfig >/dev/null 2>&1; then
  ifconfig | awk -v port="$PORT" '
    /^[a-z0-9]+:/{iface=$1; sub(":","",iface)}
    /inet / && $2 !~ /^127\./ && ($2 ~ /^10\./ || $2 ~ /^192\.168\./ || $2 ~ /^172\.(1[6-9]|2[0-9]|3[0-1])\./) {
      print "LAN URL: http://" $2 ":" port " (" iface ")"
    }
  '
fi
