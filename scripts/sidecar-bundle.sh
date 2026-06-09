#!/usr/bin/env bash
# Build + assemble the Next.js standalone server with a flat, complete
# node_modules so it can boot from inside the Tauri .app bundle without any
# pnpm symlink magic. Output: src-tauri/resources/server/.
#
# Mobile-Tauri builds: skip entirely. iOS and Android sandboxes can't spawn
# a child Node.js process, the resulting IPA / APK would balloon by ~100MB
# of `node_modules`, and the daemon model on mobile is "point at the user's
# home Tailscale daemon" anyway — see docs/mobile-tailscale.md. Tauri sets
# `TAURI_PLATFORM` for us during `tauri ios build` / `tauri android build`,
# so a simple branch on that variable is enough.
set -euo pipefail

case "${TAURI_PLATFORM:-}" in
  ios|android)
    echo "==> sidecar-bundle.sh: skipping for mobile target ($TAURI_PLATFORM)"
    echo "    mobile-Tauri builds rely on the user's remote Tailscale daemon;"
    echo "    no bundled Node sidecar is shipped. See docs/mobile-tailscale.md."
    exit 0
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/server"
BUNDLED_NODE_DIR="$ROOT/src-tauri/resources/node"
STATIC="$ROOT/.next/static"
PUBLIC="$ROOT/public"
NPM_STAGE="$ROOT/.next/sidecar-npm-stage"

echo "==> next build"
(cd "$ROOT" && pnpm build) >&2

echo "==> staging Node runtime for bundled sidecar"
if [ "${OS:-}" = "Windows_NT" ]; then
  NODE_BIN="$(command -v node.exe || command -v node || true)"
  NODE_NAME="node.exe"
else
  NODE_BIN="$(command -v node || true)"
  NODE_NAME="node"
fi
if [ -z "$NODE_BIN" ] || [ ! -f "$NODE_BIN" ]; then
  echo "ERROR: node binary not found; release sidecar cannot boot without a bundled runtime" >&2
  exit 1
fi
rm -rf "$BUNDLED_NODE_DIR"
mkdir -p "$BUNDLED_NODE_DIR/bin"
cp "$NODE_BIN" "$BUNDLED_NODE_DIR/bin/$NODE_NAME"
chmod +x "$BUNDLED_NODE_DIR/bin/$NODE_NAME" 2>/dev/null || true
printf "generated at release build time\n" > "$BUNDLED_NODE_DIR/placeholder.txt"

STANDALONE="$ROOT/.next/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "ERROR: $STANDALONE/server.js missing after build" >&2
  exit 1
fi

# Next.js + pnpm leaves a node_modules full of pnpm-style broken symlinks
# (.pnpm/* paths) that don't survive the copy into the .app bundle. Install
# production deps cleanly via npm in a staging dir using the standalone's
# package.json, then we'll splice that node_modules in.
echo "==> installing prod deps with npm in staging dir"
rm -rf "$NPM_STAGE"
mkdir -p "$NPM_STAGE"
cp "$STANDALONE/package.json" "$NPM_STAGE/package.json"
(
  cd "$NPM_STAGE" && npm install --omit=dev --no-audit --no-fund \
    --no-package-lock --ignore-scripts
) >&2

echo "==> copying standalone tree → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
printf "generated at release build time\n" > "$DEST/placeholder.txt"
# Skip the standalone's broken pnpm-style node_modules; we'll bring in the
# fresh npm one instead.
(cd "$STANDALONE" && find . -mindepth 1 -maxdepth 1 ! -name node_modules \
   -exec cp -a {} "$DEST/" \;)

echo "==> grafting fresh node_modules → $DEST/node_modules"
cp -a "$NPM_STAGE/node_modules" "$DEST/node_modules"

# But Next.js's compiled server.js requires the standalone's own internal
# next package layout. Merge any package the standalone shipped that npm
# didn't reinstall (rare, but cheap to do).
if [ -d "$STANDALONE/node_modules" ]; then
  echo "==> backfilling any pnpm-only packages from standalone"
  (cd "$STANDALONE/node_modules" && find . -maxdepth 2 -mindepth 1 -type d \
     ! -path "./.pnpm*" -print0 2>/dev/null \
     | while IFS= read -r -d '' pkg; do
        rel="${pkg#./}"
        if [ ! -e "$DEST/node_modules/$rel" ]; then
          mkdir -p "$DEST/node_modules/$(dirname "$rel")"
          cp -aL "$STANDALONE/node_modules/$rel" \
            "$DEST/node_modules/$rel" 2>/dev/null || true
        fi
      done)
fi

if [ -d "$STATIC" ]; then
  mkdir -p "$DEST/.next/static"
  echo "==> copying .next/static → $DEST/.next/static"
  cp -a "$STATIC/." "$DEST/.next/static/"
fi

# Next.js + pnpm also drops symlinks under .next/node_modules/ that point at
# ../../node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> (e.g. shiki,
# oniguruma-to-es). After we swap in the npm-flat top-level node_modules
# above, those symlinks dangle, and Tauri's resource glob rejects the bundle
# with `resource path doesn't exist`. Resolve each into a real directory.
if [ -d "$DEST/.next/node_modules" ]; then
  echo "==> resolving dangling pnpm symlinks in .next/node_modules"
  while IFS= read -r link; do
    # Only patch dangling symlinks (non-dangling ones are fine as-is).
    if [ -e "$link" ]; then
      continue
    fi
    # Strip the trailing -<16hex> webpack-content-hash suffix
    pkg="$(basename "$link" | sed -E 's/-[a-f0-9]{16}$//')"
    src=""
    if [ -d "$NPM_STAGE/node_modules/$pkg" ]; then
      src="$NPM_STAGE/node_modules/$pkg"
    elif [ -d "$ROOT/node_modules/$pkg" ]; then
      src="$ROOT/node_modules/$pkg"
    fi
    if [ -n "$src" ] && [ -d "$src" ]; then
      rm -f "$link"
      cp -aL "$src" "$link"
      echo "    resolved $(basename "$link") ← $pkg"
    else
      echo "    ! could not resolve $(basename "$link") (pkg=$pkg)" >&2
    fi
  done < <(find "$DEST/.next/node_modules" -mindepth 1 -maxdepth 1 -type l)
fi

if [ -d "$PUBLIC" ]; then
  mkdir -p "$DEST/public"
  echo "==> copying public/ → $DEST/public"
  cp -a "$PUBLIC/." "$DEST/public/"
fi

# Sanity check
for must in node_modules/@next/env node_modules/@swc/helpers/_; do
  if [ ! -e "$DEST/$must" ]; then
    echo "==> ! bundle still missing $must — sidecar will not boot" >&2
    exit 1
  fi
done

rm -rf "$NPM_STAGE"
echo "==> sidecar bundle ready ($(du -sh "$DEST" | cut -f1))"
