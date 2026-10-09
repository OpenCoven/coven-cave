#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_ROOT="$ROOT/apps/ios/CovenCave"
DERIVED_DATA="${DERIVED_DATA:-$IOS_ROOT/build}"
BUNDLE_ID="ai.opencoven.cave"

command -v xcodegen >/dev/null 2>&1 || {
  echo "[ios] missing xcodegen (brew install xcodegen)" >&2
  exit 1
}

devices_json="$(xcrun simctl list devices available -j)"
if [[ -n "${SIMULATOR_NAME:-}" ]]; then
  udid="$(printf '%s' "$devices_json" \
    | jq -r --arg name "$SIMULATOR_NAME" '.devices[][] | select(.name == $name) | .udid' \
    | head -1)"
  [[ -n "$udid" ]] || {
    echo "[ios] simulator not found: $SIMULATOR_NAME" >&2
    exit 1
  }
else
  if ! udid="$(printf '%s' "$devices_json" | node "$ROOT/scripts/ios-select-simulator.mjs")"; then
    echo "[ios] no available iPhone simulator; set SIMULATOR_NAME to an installed model or install an iOS 18+ runtime" >&2
    exit 1
  fi
  SIMULATOR_NAME="$(printf '%s' "$devices_json" \
    | jq -r --arg udid "$udid" '.devices[][] | select(.udid == $udid) | .name' \
    | head -1)"
fi
echo "[ios] using simulator: $SIMULATOR_NAME ($udid)"

# Via the wrapper, never `xcodegen generate` directly: the web bundles are
# gitignored, and a scan that runs before they exist produces a project without
# them (cave-d8ma3).
"$ROOT/scripts/ios-xcodegen.sh"

cd "$IOS_ROOT"
xcodebuild \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination "platform=iOS Simulator,id=$udid" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl boot "$udid" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$DERIVED_DATA/Build/Products/Debug-iphonesimulator/CovenCave.app"
xcrun simctl launch "$udid" "$BUNDLE_ID"
