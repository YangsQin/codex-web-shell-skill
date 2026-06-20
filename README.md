# Codex Web Shell Skill

`codex-web-shell` is a Codex skill that installs and runs a local browser UI for Codex. It wraps `codex app-server`, provides a clean chat interface, supports working-directory selection, resumes the most recent Codex thread for a directory, streams agent feedback, handles approval prompts, and exposes the UI on a LAN address.

## What It Includes

- `SKILL.md`: Codex skill instructions and trigger metadata.
- `agents/openai.yaml`: Codex UI metadata.
- `scripts/install-or-start.sh`: Installs the bundled web shell into a target directory and starts it.
- `assets/codex-web/`: The Node.js web shell template.

## Install Locally

Clone or copy this repository into a Codex skill location:

```bash
mkdir -p ~/.codex/skills
cp -R codex-web-shell-skill ~/.codex/skills/codex-web-shell
```

If you publish this repository to GitHub, another machine can install it with:

```bash
git clone https://github.com/<owner>/<repo>.git ~/.codex/skills/codex-web-shell
```

Then ask Codex to use `$codex-web-shell`, or run the installer directly:

```bash
~/.codex/skills/codex-web-shell/scripts/install-or-start.sh ~/codex-web
```

The default server listens on:

```text
0.0.0.0:8787
```

That makes it available on this computer at `http://127.0.0.1:8787` and on the same LAN at `http://<your-lan-ip>:8787`.

## Requirements

- Codex installed as either the macOS app or CLI.
- Node.js 18 or newer. The starter prefers Codex's bundled Node when present.
- A trusted local network if using LAN access.

## Security

This web shell can drive Codex, which can read files, run commands, and edit projects. Keep it on trusted local networks, VPN, SSH tunnel, Tailscale, or ZeroTier. Do not expose it directly to the public internet.

## Development Checks

From `assets/codex-web/`:

```bash
node --check server.js
node -e "new Function(require('fs').readFileSync('public/app.js', 'utf8'))"
sh -n start.sh start-background.sh stop.sh
```

Validate the skill:

```bash
python3 /path/to/skill-creator/scripts/quick_validate.py .
```
