#!/usr/bin/env bash
# Build, sign, and install the Tauri iOS app on a connected iPhone in one step.
# The team is passed via tauri's -c config override (the APPLE_DEVELOPMENT_TEAM env
# var alone doesn't reach tauri's generated ExportOptions.plist), so it stays out of
# the committed config and each dev signs as themselves.
set -euo pipefail

# cargo lives under ~/.cargo/bin but isn't always on a non-interactive PATH (npm scripts).
command -v cargo >/dev/null 2>&1 || export PATH="$HOME/.cargo/bin:$PATH"

# Default the team to this dev's own signing identity (the cert's OU is the Team ID), so a
# plain `npm run ios:install` works without exporting anything. Override via the env var.
if [ -z "${APPLE_DEVELOPMENT_TEAM:-}" ]; then
  APPLE_DEVELOPMENT_TEAM="$(security find-certificate -a -c 'Apple Development' -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | tr ',/' '\n\n' | sed -nE 's/^[[:space:]]*OU[[:space:]]*=[[:space:]]*([A-Z0-9]+).*/\1/p' | head -1)"
fi
[ -n "$APPLE_DEVELOPMENT_TEAM" ] || { echo "error: no Apple Development signing identity found; set APPLE_DEVELOPMENT_TEAM" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../frontend"

# Resolve the first connected physical iPhone/iPad before building. devicectl, not xctrace:
# xctrace can list a paired, wired device as offline.
DEVICE_ID="$(xcrun devicectl list devices 2>/dev/null \
  | awk '/physical/ && /[[:space:]]available[[:space:]]/ && /iPhone|iPad/ {for (i = 1; i < NF; i++) if ($(i+1) == "(UDID)") {print $i; exit}}')" || true
[ -n "$DEVICE_ID" ] || { echo "error: no iPhone/iPad connected (plug it in via USB, unlock it, and trust this Mac)" >&2; exit 1; }

APP_ID="$APPLE_DEVELOPMENT_TEAM.$(plutil -extract identifier raw "$FRONTEND_DIR/src-tauri/tauri.conf.json")"

# Push needs the aps-environment entitlement, which free (personal) teams can't sign, so it's
# opt-in. Set or clear it on every run so the entitlements file always matches this build.
ENTITLEMENTS="$FRONTEND_DIR/src-tauri/gen/apple/agentrove-desktop_iOS/agentrove-desktop_iOS.entitlements"
if [ "${AGENTROVE_IOS_PUSH:-}" = "1" ]; then
  plutil -replace aps-environment -string development "$ENTITLEMENTS"
else
  plutil -remove aps-environment "$ENTITLEMENTS" 2>/dev/null || true
fi

has_device_profile() {
  local now f p
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  p="$(mktemp)"
  for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision \
           "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$f" ] && security cms -D -i "$f" >"$p" 2>/dev/null || continue
    [ "$(plutil -extract Entitlements.application-identifier raw "$p" 2>/dev/null)" = "$APP_ID" ] || continue
    [[ "$(plutil -extract ExpirationDate raw "$p")" > "$now" ]] || continue
    # A profile made before push was enabled lacks the entitlement and can't sign a push build.
    if [ "${AGENTROVE_IOS_PUSH:-}" = "1" ]; then
      plutil -extract Entitlements.aps-environment raw "$p" >/dev/null 2>&1 || continue
    fi
    plutil -extract ProvisionedDevices xml1 -o - "$p" 2>/dev/null | grep -q "<string>$DEVICE_ID</string>" \
      && { rm -f "$p"; return 0; }
  done
  rm -f "$p"
  return 1
}

# tauri's xcodebuild targets a generic destination without -allowProvisioningDeviceRegistration, so it
# can't register a new device or provision for it. Building against the device directly does both during
# signing; the build itself then stops at the "Build Rust Code" phase, which needs a running tauri CLI.
if ! has_device_profile; then
  echo "Registering device $DEVICE_ID and creating a provisioning profile for $APP_ID ..."
  REGISTER_LOG="$(mktemp)"
  xcodebuild build -project "$FRONTEND_DIR/src-tauri/gen/apple/agentrove-desktop.xcodeproj" \
    -scheme agentrove-desktop_iOS -configuration debug -destination "id=$DEVICE_ID" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" >"$REGISTER_LOG" 2>&1 || true
  has_device_profile || { grep -E 'error:' "$REGISTER_LOG" >&2; echo "error: device registration failed (full log: $REGISTER_LOG)" >&2; exit 1; }
fi

# Build + sign + export a standalone IPA.
# Xcode 27's SwiftPM gives @_cdecl exports local visibility in release Swift builds, so the
# Rust link fails; swift-rs builds Swift in debug config whenever cargo debuginfo is on.
( cd "$FRONTEND_DIR" && CARGO_PROFILE_RELEASE_DEBUG=line-tables-only npm run ios:build -- --export-method debugging \
    -c "{\"bundle\":{\"iOS\":{\"developmentTeam\":\"$APPLE_DEVELOPMENT_TEAM\"}}}" )

IPA="$(ls -t "$FRONTEND_DIR"/src-tauri/gen/apple/build/*/*.ipa 2>/dev/null | head -1 || true)"
[ -n "$IPA" ] || { echo "error: no .ipa produced under src-tauri/gen/apple/build" >&2; exit 1; }

# Install.
echo "Installing $(basename "$IPA") on device $DEVICE_ID ..."
# The first contact can hit a transient connection reset when the device is locked/asleep — retry once.
xcrun devicectl device install app --device "$DEVICE_ID" "$IPA" \
  || { sleep 3; xcrun devicectl device install app --device "$DEVICE_ID" "$IPA"; }
echo "Done — launch Agentrove on the device."
