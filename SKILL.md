---
name: codex-web-shell
description: Install, start, update, package, or troubleshoot a browser-based local Codex web shell that wraps `codex app-server`, supports working-directory selection, resuming the latest local Codex thread for a directory, chat turns, streamed events, approvals, Codex login, mobile layout, and LAN access from other computers. Use when a user wants to turn local Codex into a webpage, deploy it on a local IP, prepare the skill for GitHub distribution, or reuse that setup on another computer.
---

# Codex Web Shell

Use this skill to create or operate a local browser UI for Codex. The bundled template is a small Node.js app that starts `codex app-server` over stdio, exposes a browser chat UI, resumes the most recent local thread for a selected working directory, and listens on `0.0.0.0` by default so other devices on the same LAN can connect.

## Quick Start

1. Pick an install directory. Default to `$HOME/codex-web` unless the user names another path.
2. Run:

```bash
<skill-dir>/scripts/install-or-start.sh <target-dir>
```

3. Report the printed local URL and LAN URL.
4. If the page opens but model turns cannot start, tell the user to open the left sidebar and use `API 设置 > 登录 Codex`.

## Useful Operations

- Install or update without starting:

```bash
NO_START=1 <skill-dir>/scripts/install-or-start.sh <target-dir>
```

- Start manually from an installed directory:

```bash
HOST=0.0.0.0 PORT=8787 ./start.sh
```

- Start in the background from an installed directory:

```bash
HOST=0.0.0.0 PORT=8787 ./start-background.sh
```

- Stop a background server:

```bash
./stop.sh
```

- Restrict to this computer only:

```bash
HOST=127.0.0.1 PORT=8787 ./start.sh
```

- Use explicit binaries on another machine:

```bash
CODEX_BIN="$(command -v codex)" CODEX_NODE="$(command -v node)" ./start.sh
```

## Verification

After changes, verify the app with:

```bash
node --check server.js
node -e "new Function(require('fs').readFileSync('public/app.js', 'utf8'))"
curl -fsS http://127.0.0.1:${PORT:-8787}/api/status
```

For LAN deployment, also test a private IP URL from the same host and tell the user to open the same URL on another computer:

```bash
curl -fsS http://<lan-ip>:${PORT:-8787}/api/status
```

## Notes

- The web shell starts its own `codex app-server`; it may not inherit a desktop app's private auth. Authentication belongs in the web shell's left sidebar.
- LAN access exposes a tool that can read files, run commands, and edit projects. Keep it on trusted local networks, VPN, SSH tunnel, Tailscale, or ZeroTier. Do not expose it directly to the public internet.
- Directory attach uses `thread/list` and `thread/resume` from `codex app-server`; if no history exists for that exact `cwd`, it starts a new thread.
- The bundled template lives in `assets/codex-web/`. Patch that template first when improving the reusable skill, then reinstall or restart the target copy.
