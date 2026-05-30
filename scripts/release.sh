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
NOTARY_KEY_FILE="${NOTARY_KEY_FILE:-$HOME/.appstoreconnect/private_keys/AuthKey_3822D8Z5XFI0.p8}"
NOTARY_KEY_ID="${NOTARY_KEY_ID:-3822D8Z5XFI0}"

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 1; }
}
require_file() {
  [ -f "$1" ] || { echo "Missing required file: $1" >&2; exit 1; }
}

require_tool pnpm
require_tool codesign
require_tool xcrun
require_tool hdiutil
require_tool spctl
require_tool shasum
require_file "$NOTARY_KEY_FILE"

echo "==> Building CovenCave v${VERSION}"
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"

echo "==> Running pnpm tauri build"
APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" pnpm tauri build

APP_PATH=$(find "$BUILD_DIR/macos" -name "${APP_NAME}.app" -type d -maxdepth 2 | head -n1)
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "App bundle not found under $BUILD_DIR/macos" >&2
  exit 1
fi
echo "    found: $APP_PATH"

echo "==> Signing every native binary inside the bundle"
# Apple deprecated --deep; sign inner native binaries explicitly so each one
# gets a hardened runtime + secure timestamp before we seal the envelope.
# Find: shared libs (.dylib), Node native modules (.node), and any nested
# executables that aren't already symlinks.
NATIVE_FILES_TMP=$(mktemp)
find "$APP_PATH" \( -name "*.dylib" -o -name "*.so" -o -name "*.node" \) \
  -type f -print > "$NATIVE_FILES_TMP"
NATIVE_COUNT=$(wc -l < "$NATIVE_FILES_TMP" | tr -d ' ')
echo "    found $NATIVE_COUNT native files"
while IFS= read -r f; do
  codesign --force --options runtime --timestamp \
    --sign "$SIGNING_IDENTITY" "$f" >/dev/null 2>&1 || {
      echo "    ! failed to sign: $f" >&2
    }
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
hdiutil create -volname "${APP_NAME}" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH" >/dev/null

echo "==> Submitting DMG for notarization"
xcrun notarytool submit "$DMG_PATH" \
  --key "$NOTARY_KEY_FILE" \
  --key-id "$NOTARY_KEY_ID" \
  --wait

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
echo ""
echo "Signature:"
codesign -d --verbose=2 "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Identifier|Timestamp"
