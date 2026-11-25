#!/usr/bin/env bash
# Pins every ACP provider CLI (Claude Code, claude-agent-acp, codex-acp, Codex, Copilot,
# OpenCode, Cursor, Antigravity, Grok) in the Dockerfiles and desktop build to its latest release.
set -euo pipefail

cd "$(dirname "$0")/.."

DOCKERFILES=(backend/Dockerfile sandbox/docker/Dockerfile)
DESKTOP_BUILD=desktop/run_build.mjs
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

bump_npm() {
  local pkg=$1 desktop_const=${2:-} version
  version=$(latest_npm "$pkg")
  sed -i -E "s#${pkg}@[0-9][^ ]*#${pkg}@${version}#g" "${DOCKERFILES[@]}"
  if [ -n "$desktop_const" ]; then
    sed -i -E "s/^const ${desktop_const} = '[^']+';/const ${desktop_const} = '${version}';/" "$DESKTOP_BUILD"
  fi
}

bump_npm @anthropic-ai/claude-code CLAUDE_CODE_VERSION
bump_npm @agentclientprotocol/claude-agent-acp CLAUDE_AGENT_ACP_VERSION
bump_npm @agentclientprotocol/codex-acp CODEX_ACP_VERSION
bump_npm @openai/codex
bump_npm @github/copilot

opencode=$(latest_npm @opencode/cli)
sed -i -E "s#(opencode\.ai/v2/install \| bash -s -- --version )[0-9.]+#\1${opencode}#" "${DOCKERFILES[@]}"

cursor_install=$(curl -fsSL https://cursor.com/install)
cursor=$(grep -m1 -oE 'downloads\.cursor\.com/lab/[^/]+' <<<"$cursor_install" | cut -d/ -f3)
sed -i -E "s#^(\s*)v=[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9a-f]+;#\1v=${cursor};#" "${DOCKERFILES[@]}"

antigravity=$(curl -fsSL https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json \
  | jq -er '.agents[] | select(.id == "antigravity-acp") | .version')
sed -i -E "s#^(\s*)antigravity_version=[0-9]+\.[0-9]+\.[0-9]+;#\1antigravity_version=${antigravity};#" "${DOCKERFILES[@]}"

grok=$(curl -fsSL https://x.ai/cli/stable)
if ! [[ $grok =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "x.ai/cli/stable returned a non-semver version: ${grok:0:80}" >&2
  exit 1
fi
sed -i -E "s#^(\s*)grok_version=[0-9]+\.[0-9]+\.[0-9]+;#\1grok_version=${grok};#" "${DOCKERFILES[@]}"
