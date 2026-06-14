#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.0.1}"
APP_NAME="CovenCave"
BUILD_DIR="src-tauri/target/release/bundle"
DMG_DIR="release"
DMG_PATH="$DMG_DIR/${APP_NAME}-v${VERSION}.dmg"
# Use the SHA1 hash because the keychain has two identities sharing the
# "Developer ID Application: Soul Protocol LLC (9LR8Z8UQ9X)" display name
# and codesign refuses to disambiguate by name.
SIGNING_IDENTITY="${SIGNING_IDENTITY:-EE732DF3F48D7535561AF54D3FFFC4B44DAF3E7F}"
NOTARY_KEY_FILE="${NOTARY_KEY_FILE:-${APPLE_API_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_3822D8Z5XFI0.p8}}"
NOTARY_KEY_ID="${NOTARY_KEY_ID:-${APPLE_API_KEY:-3822D8Z5XFI0}}"
NOTARY_ISSUER="${NOTARY_ISSUER:-${APPLE_API_ISSUER:-}}"
NOTARY_APPLE_ID="${NOTARY_APPLE_ID:-${APPLE_ID:-}}"
NOTARY_APPLE_PASSWORD="${NOTARY_APPLE_PASSWORD:-${APPLE_PASSWORD:-}}"
NOTARY_TEAM_ID="${NOTARY_TEAM_ID:-${APPLE_TEAM_ID:-}}"
NODE_ENTITLEMENTS="src-tauri/entitlements/node.plist"

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}
require_file() {
  [ -f "$1" ] || { echo "Missing required file: $1" >&2; exit 1; }
}
require_value() {
  local value="$1"
  local label="${2:-required value}"
  [ -n "$value" ] || { echo "Missing required value: $label" >&2; exit 1; }
}
print_notary_log() {
  local submission_id="$1"

  if [ -z "$submission_id" ]; then
    echo "==> Notary submission id unavailable; cannot fetch Apple rejection log" >&2
    return 0
  fi

  echo "==> Fetching Apple notary log for submission $submission_id"
  set +e
  if [ "$NOTARY_AUTH_MODE" = "apple-id" ]; then
    xcrun notarytool log "$submission_id" \
      --apple-id "$NOTARY_APPLE_ID" \
      --password "$NOTARY_APPLE_PASSWORD" \
      --team-id "$NOTARY_TEAM_ID"
  else
    xcrun notarytool log "$submission_id" \
      --key "$NOTARY_KEY_FILE" \
      --key-id "$NOTARY_KEY_ID" \
      --issuer "$NOTARY_ISSUER"
  fi
  local log_status=$?
  set -e

  if [ "$log_status" -ne 0 ]; then
    echo "==> Could not fetch Apple notary log (exit $log_status)" >&2
  fi
}
run_notary_submit() {
  local output
  local submit_status
  local submission_id

  output=$(mktemp)
  set +e
  if [ "$NOTARY_AUTH_MODE" = "apple-id" ]; then
    xcrun notarytool submit "$DMG_PATH" \
      --apple-id "$NOTARY_APPLE_ID" \
      --password "$NOTARY_APPLE_PASSWORD" \
      --team-id "$NOTARY_TEAM_ID" \
      --no-s3-acceleration \
      --verbose \
      --wait 2>&1 | tee "$output"
    submit_status=${PIPESTATUS[0]}
  else
    xcrun notarytool submit "$DMG_PATH" \
      --key "$NOTARY_KEY_FILE" \
      --key-id "$NOTARY_KEY_ID" \
      --issuer "$NOTARY_ISSUER" \
      --no-s3-acceleration \
      --verbose \
      --wait 2>&1 | tee "$output"
    submit_status=${PIPESTATUS[0]}
  fi
  set -e

  submission_id=$(awk '/^[[:space:]]*id:/ { print $2; exit }' "$output")
  if [ "$submit_status" -ne 0 ]; then
    print_notary_log "$submission_id"
    rm -f "$output"
    exit "$submit_status"
  fi
  if grep -Eq "Submission in terminal status: Invalid|Current status: Invalid|^[[:space:]]*status:[[:space:]]*Invalid" "$output"; then
    print_notary_log "$submission_id"
    rm -f "$output"
    exit 1
  fi
  if ! grep -Eq "Submission in terminal status: Accepted|Received new status: Accepted|^[[:space:]]*status:[[:space:]]*Accepted" "$output"; then
    echo "Notary submission did not report Accepted; refusing to staple." >&2
    print_notary_log "$submission_id"
    rm -f "$output"
    exit 1
  fi
  rm -f "$output"
}
cleanup_dmg_artifacts() {
  local mount

  rm -f "$DMG_PATH"

  while IFS= read -r mount; do
    [ -n "$mount" ] || continue
    echo "    detaching stale DMG mount: $mount"
    hdiutil detach "$mount" -force >/dev/null 2>&1 || true
  done < <(
    hdiutil info 2>/dev/null |
      awk -v app="$APP_NAME" '$NF ~ ("^/Volumes/" app) { print $NF }'
  )
}
create_dmg_with_retry() {
  local attempt
  local max_attempts=4
  local output
  local status

  for attempt in $(seq 1 "$max_attempts"); do
    output=$(mktemp)
    cleanup_dmg_artifacts
    set +e
    hdiutil create \
      -volname "${APP_NAME}" \
      -srcfolder "$DMG_STAGE" \
      -ov \
      -format UDZO \
      "$DMG_PATH" >"$output" 2>&1
    status=$?
    set -e

    if [ "$status" -eq 0 ]; then
      rm -f "$output"
      return 0
    fi

    echo "    hdiutil create failed on attempt ${attempt}/${max_attempts}:"
    cat "$output"
    if ! grep -qi "Resource busy" "$output" || [ "$attempt" -eq "$max_attempts" ]; then
      rm -f "$output"
      return "$status"
    fi

    rm -f "$output"
    sleep "$((attempt * 3))"
  done

  return 1
}

require_tool pnpm
require_tool codesign
require_tool xcrun
require_tool hdiutil
require_tool spctl
require_tool shasum
require_tool openssl
require_file "$NODE_ENTITLEMENTS"

if [ -n "$NOTARY_APPLE_ID" ] && [ -n "$NOTARY_APPLE_PASSWORD" ] && [ -n "$NOTARY_TEAM_ID" ]; then
  NOTARY_AUTH_MODE="apple-id"
elif [ -n "$NOTARY_KEY_FILE" ] && [ -n "$NOTARY_KEY_ID" ] && [ -n "$NOTARY_ISSUER" ]; then
  NOTARY_AUTH_MODE="api-key"
else
  echo "Missing notarization credentials. Provide APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID; or APPLE_API_KEY_PATH, APPLE_API_KEY, and APPLE_API_ISSUER." >&2
  exit 1
fi

if [ "$NOTARY_AUTH_MODE" = "api-key" ]; then
  require_file "$NOTARY_KEY_FILE"
  echo "==> Validating App Store Connect API key"
  openssl pkey -in "$NOTARY_KEY_FILE" -noout -check >/dev/null
fi

echo "==> Using notarytool auth mode: $NOTARY_AUTH_MODE"
echo "==> Using notarytool: $(xcrun --find notarytool)"
xcrun notarytool --version

echo "==> Building CovenCave v${VERSION}"
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"

echo "==> Running pnpm tauri build"
# Build the .app only (--bundles app). The DMG is assembled below by the
# release script using hdiutil so we're not dependent on Tauri's
# bundle_dmg.sh which requires a background image and can fail on version
# mismatches between the generated script and the installed create-dmg.
# Keep App Store Connect credentials out of this subprocess so Tauri does not
# take its built-in notarization path before this script assembles the DMG.
env \
  -u APPLE_API_KEY \
  -u APPLE_API_KEY_PATH \
  -u APPLE_API_ISSUER \
  -u APPLE_ID \
  -u APPLE_PASSWORD \
  -u APPLE_TEAM_ID \
  -u NOTARY_KEY_FILE \
  -u NOTARY_KEY_ID \
  -u NOTARY_ISSUER \
  -u NOTARY_APPLE_ID \
  -u NOTARY_APPLE_PASSWORD \
  -u NOTARY_TEAM_ID \
  APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" \
  pnpm tauri build --bundles app

APP_PATH=$(find "$BUILD_DIR/macos" -name "${APP_NAME}.app" -type d -maxdepth 2 | head -n1)
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "App bundle not found under $BUILD_DIR/macos" >&2
  exit 1
fi
echo "    found: $APP_PATH"

# Users without system Node depend entirely on the bundled runtime — a DMG
# missing it would install fine and then fatal-exit on launch. Fail the
# release instead of shipping that.
require_file "$APP_PATH/Contents/Resources/resources/node/bin/node"
echo "    bundled Node runtime present"

echo "==> Signing every native binary inside the bundle"
# Apple deprecated --deep; sign inner native binaries explicitly so each one
# gets a hardened runtime + secure timestamp before we seal the envelope.
# Find: shared libs (.dylib), Node native modules (.node), node-pty's
# spawn-helper Mach-O files, and any nested executable files that aren't
# already symlinks, including the bundled Node runtime staged for the sidecar.
NATIVE_FILES_TMP=$(mktemp)
find "$APP_PATH" \
  \( -name "*.dylib" -o -name "*.so" -o -name "*.node" -o -name "spawn-helper" -o -perm +111 \) \
  -type f -print > "$NATIVE_FILES_TMP"
NATIVE_COUNT=$(wc -l < "$NATIVE_FILES_TMP" | tr -d ' ')
echo "    found $NATIVE_COUNT native files"
while IFS= read -r f; do
  if [ "$f" = "$APP_PATH/Contents/Resources/resources/node/bin/node" ]; then
    codesign --force --options runtime --timestamp \
      --entitlements "$NODE_ENTITLEMENTS" \
      --sign "$SIGNING_IDENTITY" "$f" >/dev/null 2>&1 || {
        echo "    ! failed to sign bundled Node with entitlements: $f" >&2
      }
  else
    codesign --force --options runtime --timestamp \
      --sign "$SIGNING_IDENTITY" "$f" >/dev/null 2>&1 || {
        echo "    ! failed to sign: $f" >&2
      }
  fi
done < "$NATIVE_FILES_TMP"
rm "$NATIVE_FILES_TMP"

echo "==> Sealing the .app envelope"
codesign --force --options runtime --timestamp \
  --sign "$SIGNING_IDENTITY" "$APP_PATH"

echo "==> Verifying signature"
codesign -vvv "$APP_PATH" 2>&1 | tail -n 5

echo "==> Packaging DMG with Applications shortcut"
# Stage the .app and a symlink to /Applications so the DMG window shows the
# canonical "drag CovenCave to Applications" install flow. Without this users
# tend to double-click the .app inside the mounted DMG, which causes macOS to
# AppTranslocate the bundle into a sandbox path.
DMG_STAGE=$(mktemp -d -t covencave-dmg)
trap 'rm -rf "$DMG_STAGE"' EXIT
cp -R "$APP_PATH" "$DMG_STAGE/"
ln -s /Applications "$DMG_STAGE/Applications"
create_dmg_with_retry

echo "==> Signing DMG container"
codesign --force --timestamp \
  --sign "$SIGNING_IDENTITY" "$DMG_PATH"

echo "==> Submitting DMG for notarization"
run_notary_submit

echo "==> Stapling notarization ticket"
xcrun stapler staple "$DMG_PATH"
xcrun stapler staple "$APP_PATH"

echo "==> Verifying Gatekeeper acceptance"
spctl -a -vvv "$APP_PATH"

if ! spctl -a -vvv "$APP_PATH" 2>&1 | grep -q "Notarized Developer ID"; then
  echo "Gatekeeper verification failed: app is not accepted as a notarized Developer ID app" >&2
  exit 1
fi

echo ""
echo "Release built: $DMG_PATH"
SHA=$(shasum -a 256 "$DMG_PATH" | cut -d ' ' -f1)
echo "SHA256: $SHA"

# Maintain a SHA256SUMS file alongside the artifacts so the README's
# "SHA256 checksums for all artifacts" promise is automatic. Each entry
# uses the shasum-default format (`<hash>  <filename>`) so callers can
# verify with `cd release && shasum -a 256 -c SHA256SUMS`.
SUMS_PATH="$DMG_DIR/SHA256SUMS"
DMG_BASENAME=$(basename "$DMG_PATH")
if [ -f "$SUMS_PATH" ]; then
  # Replace the entry for this artifact in place; append if absent.
  TMP_PATH=$(mktemp)
  grep -v "  $DMG_BASENAME$" "$SUMS_PATH" > "$TMP_PATH" || true
  echo "$SHA  $DMG_BASENAME" >> "$TMP_PATH"
  sort "$TMP_PATH" > "$SUMS_PATH"
  rm "$TMP_PATH"
else
  echo "$SHA  $DMG_BASENAME" > "$SUMS_PATH"
fi
echo "Wrote checksum entry to $SUMS_PATH"

# ── Updater artifact (desktop auto-update) ───────────────────────────────
# Tauri's build-time .app.tar.gz predates this script's manual re-sign +
# notarization, so regenerate it from the FINAL stapled .app and sign it with
# the updater key. The Tauri updater verifies the minisign signature; the
# installed app must still pass Gatekeeper, which only the notarized bundle
# does. Non-fatal by design: a failure here must never sink a release — the
# DMG is the source of truth and the app falls back to manual download.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo ""
  echo "==> Building signed updater artifact (.app.tar.gz)"
  UPDATER_TARBALL="$DMG_DIR/CovenCave.app.tar.gz"
  if tar -czf "$UPDATER_TARBALL" -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")"; then
    if pnpm exec tauri signer sign "$UPDATER_TARBALL"; then
      echo "    wrote $UPDATER_TARBALL (+ .sig)"
    else
      echo "    ! updater signing failed; skipping updater artifact" >&2
      rm -f "$UPDATER_TARBALL"
    fi
  else
    echo "    ! updater tarball creation failed; skipping" >&2
  fi
else
  echo "==> TAURI_SIGNING_PRIVATE_KEY unset; skipping updater artifact"
fi

echo ""
echo "Signature:"
codesign -d --verbose=2 "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Identifier|Timestamp"
