#!/usr/bin/env bash
# Generate CovenCave.xcodeproj — the ONLY supported way to run xcodegen here.
#
# Resources/{markdown.html,terminal.html,markdown.css} are gitignored build
# artifacts. `xcodegen generate` SCANS the source directory, so on a fresh
# clone — where those files do not exist yet — they never enter the resource
# build phase. project.yml regenerates them in preBuildScripts, but that runs
# at BUILD time (after the scan) and is deliberately non-fatal so a machine
# without node still builds against the Swift fallbacks.
#
# The result was an archive that succeeded with no warning and shipped an app
# rendering assistant replies blank and a dead terminal (cave-d8ma3, hit while
# cutting v0.2.3 from a clean clone). The README documented the right order;
# nothing enforced it.
#
# So: build the bundles, PROVE they exist, then scan. A missing bundle exits
# non-zero here rather than warning, because this is the last point where the
# failure is still visible.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_ROOT="$ROOT/apps/ios/CovenCave"
RESOURCES="$IOS_ROOT/CovenCave/Resources"

command -v xcodegen >/dev/null 2>&1 || {
  echo "[ios] missing xcodegen (brew install xcodegen)" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || {
  echo "[ios] missing node — cannot build the web bundles the app embeds." >&2
  echo "[ios] Generating the project without them ships a blank markdown view" >&2
  echo "[ios] and a dead terminal, so this is fatal here (cave-d8ma3)." >&2
  exit 1
}

echo "[ios] building web bundles"
if ! ( cd "$ROOT" && node scripts/build-ios-markdown.mjs && node scripts/build-ios-terminal.mjs ); then
  echo "" >&2
  echo "[ios] web bundle generation failed." >&2
  echo "[ios] The generators inline vendored assets from node_modules (xterm's" >&2
  echo "[ios] CSS, the markdown/mermaid bundle), so a checkout that has not run" >&2
  echo "[ios] 'pnpm install' fails here with a missing-module error." >&2
  echo "[ios] Run 'pnpm install' at the repo root, then re-run this script." >&2
  exit 1
fi

# The generators can succeed while writing nothing useful; check the artifacts
# themselves, not the exit code, since the exit code is what fooled us before.
missing=()
for resource in markdown.html terminal.html markdown.css; do
  [ -s "$RESOURCES/$resource" ] || missing+=("$resource")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "[ios] web bundles missing or empty after generation: ${missing[*]}" >&2
  echo "[ios] refusing to run xcodegen — a scan now would produce a project" >&2
  echo "[ios] without these resources, and the build would silently succeed." >&2
  exit 1
fi

echo "[ios] generating project"
cd "$IOS_ROOT"
xcodegen generate
