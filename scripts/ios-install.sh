#!/usr/bin/env bash
# Build, sign, and install the Tauri iOS app on a connected iPhone in one step.
# The team is passed via tauri's -c config override (the APPLE_DEVELOPMENT_TEAM env
# var alone doesn't reach tauri's generated ExportOptions.plist), so it stays out of
# the committed config and each dev signs as themselves.
set -euo pipefail

: "${APPLE_DEVELOPMENT_TEAM:?Set APPLE_DEVELOPMENT_TEAM (your Apple Team ID) before running}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../frontend"

# 1. Build + sign + export a standalone IPA.
( cd "$FRONTEND_DIR" && npm run ios:build -- --export-method debugging \
    -c "{\"bundle\":{\"iOS\":{\"developmentTeam\":\"$APPLE_DEVELOPMENT_TEAM\"}}}" )

IPA="$(ls -t "$FRONTEND_DIR"/src-tauri/gen/apple/build/*/*.ipa 2>/dev/null | head -1 || true)"
[ -n "$IPA" ] || { echo "error: no .ipa produced under src-tauri/gen/apple/build" >&2; exit 1; }

# 2. Resolve the first connected physical device (skips the Mac and simulators) and install.
DEVICE_ID="$(xcrun xctrace list devices 2>/dev/null \
  | awk '/== Devices ==/{f=1;next} /== Simulators ==/{f=0} f' \
  | grep -iE 'iphone|ipad' | head -1 \
  | sed -E 's/.*\(([0-9A-Fa-f-]+)\)$/\1/')" || true
[ -n "$DEVICE_ID" ] || { echo "error: no iPhone/iPad connected" >&2; exit 1; }

echo "Installing $(basename "$IPA") on device $DEVICE_ID ..."
xcrun devicectl device install app --device "$DEVICE_ID" "$IPA"
echo "Done — launch Agentrove on the device."
