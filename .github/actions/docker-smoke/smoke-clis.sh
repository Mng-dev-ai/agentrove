#!/usr/bin/env bash
set -euo pipefail

for cli in claude claude-agent-acp codex-acp codex copilot cursor-agent opencode grok agy-acp-server; do
  echo "== $cli ($(command -v "$cli"))"
  timeout 60 "$cli" --version </dev/null
done
