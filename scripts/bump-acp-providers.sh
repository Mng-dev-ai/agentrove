#!/usr/bin/env bash
# Pins every ACP provider CLI (Claude Code, claude-agent-acp, codex-acp, Codex, Copilot,
# OpenCode, Cursor, Antigravity, Grok) in scripts/acp-providers.env to its latest release.
set -euo pipefail

cd "$(dirname "$0")/.."

MANIFEST=scripts/acp-providers.env
DESKTOP_BUILD=desktop/run_build.mjs
KEYS=(
  CLAUDE_CODE_VERSION
  CLAUDE_AGENT_ACP_VERSION
  CODEX_ACP_VERSION
  CODEX_VERSION
  COPILOT_VERSION
  OPENCODE_VERSION
  CURSOR_VERSION
  ANTIGRAVITY_VERSION
  GROK_VERSION
)

for key in "${KEYS[@]}"; do
  if ! grep -q "^${key}=" "$MANIFEST"; then
    echo "$MANIFEST has no ${key} pin" >&2
    exit 1
  fi
done

MIN_NODE=$(sed -nE "s/^const NODE_VERSION = '([^']+)';/\1/p" "$DESKTOP_BUILD")

latest_npm() {
  local pkg=$1 version engines
  version=$(npm view "$pkg" version)
  engines=$(npm view "$pkg@$version" engines.node)
  if [ -n "$engines" ] && ! npx --yes semver -r "$engines" "$MIN_NODE" >/dev/null; then
    echo "$pkg@$version requires node $engines but $DESKTOP_BUILD pins $MIN_NODE" >&2
    return 1
  fi
  echo "$version"
}

pin() {
  local key=$1 version=$2
  # The image builds source the manifest as shell, so only version characters may reach it.
  if ! [[ $version =~ ^[0-9][0-9A-Za-z.-]*$ ]]; then
    echo "refusing to pin ${key} to '${version:0:80}'" >&2
    exit 1
  fi
  sed -i -E "s/^${key}=.*/${key}=${version}/" "$MANIFEST"
  if ! grep -qxF "${key}=${version}" "$MANIFEST"; then
    echo "failed to pin ${key} in $MANIFEST" >&2
    exit 1
  fi
}

pin_npm() {
  local key=$1 pkg=$2 version
  version=$(latest_npm "$pkg")
  pin "$key" "$version"
}

pin_npm CLAUDE_CODE_VERSION @anthropic-ai/claude-code
pin_npm CLAUDE_AGENT_ACP_VERSION @agentclientprotocol/claude-agent-acp
pin_npm CODEX_ACP_VERSION @agentclientprotocol/codex-acp
pin_npm CODEX_VERSION @openai/codex
pin_npm COPILOT_VERSION @github/copilot
pin_npm OPENCODE_VERSION @opencode/cli

cursor_install=$(curl -fsSL https://cursor.com/install)
cursor=$(grep -m1 -oE 'downloads\.cursor\.com/lab/[^/]+' <<<"$cursor_install" | cut -d/ -f3)
pin CURSOR_VERSION "$cursor"

antigravity=$(curl -fsSL https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json \
  | jq -er '.agents[] | select(.id == "antigravity-acp") | .version')
pin ANTIGRAVITY_VERSION "$antigravity"

grok=$(curl -fsSL https://x.ai/cli/stable)
if ! [[ $grok =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "x.ai/cli/stable returned a non-semver version: ${grok:0:80}" >&2
  exit 1
fi
pin GROK_VERSION "$grok"
