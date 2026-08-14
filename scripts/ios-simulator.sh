#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_ROOT="$ROOT/apps/ios/CovenCave"
SIMULATOR_NAME="${SIMULATOR_NAME:-iPhone 16 Pro}"
DERIVED_DATA="${DERIVED_DATA:-$IOS_ROOT/build}"
BUNDLE_ID="ai.opencoven.cave"

command -v xcodegen >/dev/null 2>&1 || {
  echo "[ios] missing xcodegen (brew install xcodegen)" >&2
  exit 1
}

udid="$(xcrun simctl list devices available -j \
  | jq -r --arg name "$SIMULATOR_NAME" '.devices[][] | select(.name == $name) | .udid' \
  | head -1)"
[[ -n "$udid" ]] || {
  echo "[ios] simulator not found: $SIMULATOR_NAME" >&2
  exit 1
}

# Via the wrapper, never `xcodegen generate` directly: the web bundles are
# gitignored, and a scan that runs before they exist produces a project without
# them (cave-d8ma3).
"$ROOT/scripts/ios-xcodegen.sh"

cd "$IOS_ROOT"
xcodebuild \
  -project CovenCave.xcodeproj \
  -scheme CovenCave \
  -destination "platform=iOS Simulator,name=$SIMULATOR_NAME" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl boot "$udid" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$DERIVED_DATA/Build/Products/Debug-iphonesimulator/CovenCave.app"
xcrun simctl launch "$udid" "$BUNDLE_ID"
