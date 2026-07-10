# Agentrove

Self-hosted AI coding workspace for running Claude Code, Codex, Copilot, Cursor, Grok, and OpenCode agents from one interface.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Discord](https://img.shields.io/badge/Discord-5865F2.svg?logo=discord&logoColor=white)](https://discord.gg/HvkJU8dcBA)

> Agentrove is under active development. Expect breaking changes between releases.

![Chat Interface](screenshots/chat-interface.jpeg)

## What It Does

- Runs Claude, Codex, Copilot, Cursor, Grok, and OpenCode through ACP adapters.
- Gives each workspace its own Docker or host sandbox.
- Combines chat, code editor, terminal, file tree, diffs, secrets, and git tools in one workspace.
- Supports workspaces from empty folders, git clones, existing local folders, or GitHub repositories.
- Streams agent sessions with cancellation, permission prompts, queued follow-up messages, file mentions, slash commands, and attachments.
- Includes sub-threads, pinned chats, worktree mode, personas, custom instructions, environment variables, and installed agent skills.
- Provides GitHub-assisted repository browsing, pull request review, PR creation, reviewer selection, and git branch/commit/push/pull helpers.
- Ships as a Docker web app, a macOS desktop app, and a native iOS app.

## Quick Start

Requirements:

- Docker
- Docker Compose

```bash
git clone https://github.com/Mng-dev-ai/agentrove.git
cd agentrove
cp .env.example .env
```

Set `SECRET_KEY` in `.env`:

```bash
openssl rand -hex 32
```

Start Agentrove:

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

## Desktop

Agentrove also has a macOS desktop app built with Tauri. It starts a bundled Python backend sidecar on an available `127.0.0.1` port and connects the frontend to it at launch.

- Download the latest Apple Silicon build from [Releases](https://github.com/Mng-dev-ai/agentrove/releases/latest).
- Build from source:

```bash
cd frontend
npm install
npm run desktop:dev
```

## Mobile (iOS)

Agentrove also builds a native iOS app with Tauri. Since iOS can't run the local
backend sidecar, the app is a thin client: it talks to an Agentrove instance you
already host (your Docker or production deployment), reachable from the phone over
`https`/`wss`. Because the project is open source, you build and sign it yourself —
nothing is hardcoded to anyone else's server.

Requirements: macOS with Xcode (plus its iOS SDK and Simulator), the Rust iOS
targets (`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`), and CocoaPods.

Point the app at your instance:

```bash
cd frontend
cp .env.mobile.example .env.mobile   # then set your https/wss URLs
npm install
```

Run in the simulator:

```bash
npm run ios:dev
```

Install on your own iPhone with a free Apple ID — no paid developer account needed
(the app must be re-signed every 7 days):

1. `npm run tauri ios init` generates the Xcode project (first run only).
2. Open `frontend/src-tauri/gen/apple/*.xcodeproj` in Xcode once, pick your Team
   under **Signing & Capabilities**, and connect your iPhone (Xcode needs to
   register the device and create the provisioning profile).
3. On the phone, enable Developer Mode (**Settings → Privacy & Security**), then
   after the first install trust the certificate under
   **Settings → General → VPN & Device Management**.

Build a standalone `.ipa` and install it on the connected iPhone. The easiest path
is the bundled helper, which builds, signs, exports, and installs in one step. It
reads your team from `APPLE_DEVELOPMENT_TEAM` (so nothing is hardcoded to anyone
else's team) and auto-detects the connected device:

```bash
export APPLE_DEVELOPMENT_TEAM=<YOUR_TEAM_ID>   # find it in Xcode → Signing & Capabilities
cd frontend
npm run ios:install
```

Or run the steps yourself. The `-c` flag injects the team into both the build
signing and the IPA export, so it stays out of the committed config:

```bash
npm run ios:build -- --export-method debugging \
  -c '{"bundle":{"iOS":{"developmentTeam":"<YOUR_TEAM_ID>"}}}'
# -> src-tauri/gen/apple/build/arm64/Agentrove.ipa

xcrun devicectl list devices   # find your device id
xcrun devicectl device install app --device <DEVICE_ID> \
  src-tauri/gen/apple/build/arm64/Agentrove.ipa
```

To update the app later, re-run `npm run ios:install` — the standalone build runs on
the phone without keeping a Mac connected.

## Production

For a single-host Docker deployment:

```bash
SECRET_KEY=$(openssl rand -hex 32) \
SERVICE_FQDN_WEB_80=https://yourdomain.com \
APP_URL=https://yourdomain.com \
ALLOWED_ORIGINS=https://yourdomain.com \
docker compose -f docker-compose-production.yml up -d --build
```

## Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS, Monaco, xterm.js
- Backend: FastAPI, SQLAlchemy, SQLite, Redis
- Runtime: ACP, Docker or host sandboxes, Tauri desktop sidecar

## Community

Join the [Discord server](https://discord.gg/HvkJU8dcBA).

## Contributing

Contributions and feedback are welcome.

## License

Apache 2.0. See [LICENSE](LICENSE).
