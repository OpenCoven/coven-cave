#!/usr/bin/env bash
# Copy the Next.js standalone server into src-tauri/resources/server/ so
# the Tauri bundle can ship it alongside the .app. Run after `next build`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.next/standalone"
STATIC="$ROOT/.next/static"
PUBLIC="$ROOT/public"
DEST="$ROOT/src-tauri/resources/server"

if [ ! -f "$SRC/server.js" ]; then
  echo "==> running pnpm build to produce standalone output"
  (cd "$ROOT" && pnpm build)
fi

if [ ! -f "$SRC/server.js" ]; then
  echo "ERROR: $SRC/server.js still missing after build" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
echo "==> copying standalone server → $DEST"
cp -a "$SRC/." "$DEST/"

if [ -d "$STATIC" ]; then
  mkdir -p "$DEST/.next/static"
  echo "==> copying .next/static → $DEST/.next/static"
  cp -a "$STATIC/." "$DEST/.next/static/"
fi

if [ -d "$PUBLIC" ]; then
  mkdir -p "$DEST/public"
  echo "==> copying public/ → $DEST/public"
  cp -a "$PUBLIC/." "$DEST/public/"
fi

# Next.js's tracer misses runtime-required packages loaded via its own
# require-hook (e.g. @swc/helpers/_/_interop_require_default). Force-copy
# the package out of the source node_modules as a safety net even if
# outputFileTracingIncludes catches it.
copy_runtime_dep() {
  local PKG="$1"
  local SRC_PKG="$ROOT/node_modules/$PKG"
  if [ ! -d "$SRC_PKG" ]; then
    # pnpm hoists into .pnpm/<pkg>@<ver>/node_modules/<pkg>
    SRC_PKG=$(find "$ROOT/node_modules/.pnpm" -maxdepth 3 -type d -path "*/$PKG" 2>/dev/null | head -n1)
  fi
  if [ -d "$SRC_PKG" ]; then
    mkdir -p "$DEST/node_modules/$PKG"
    cp -a "$SRC_PKG/." "$DEST/node_modules/$PKG/"
    echo "==> ensured runtime dep: $PKG"
  else
    echo "==> ! could not locate runtime dep: $PKG" >&2
  fi
}
copy_runtime_dep "@swc/helpers"

echo "==> sidecar bundle ready"
