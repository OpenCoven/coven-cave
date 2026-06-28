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
PNPM_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/coven-cave-sidecar-pnpm.XXXXXX")"
trap 'rm -rf "$PNPM_STAGE"' EXIT

fix_node_pty_spawn_helpers() {
  local base="$1"
  local prebuilds="$base/node-pty/prebuilds"
  local fixed=0

  if [ ! -d "$prebuilds" ]; then
    return 0
  fi

  while IFS= read -r -d '' helper; do
    chmod 755 "$helper"
    fixed=$((fixed + 1))
  done < <(find "$prebuilds" -path "*/darwin-*/spawn-helper" -type f -print0)

  if [ "$fixed" -gt 0 ]; then
    echo "==> fixed node-pty spawn-helper mode in $base ($fixed)"
  fi
}

prune_foreign_native_packages() {
  local base="$1"
  if [ ! -d "$base" ]; then
    return 0
  fi

  local platform arch libc target next_pkg sharp_pkg sharp_vips_pkg node_pty_prebuild
  platform="$(node -p "process.platform")"
  arch="$(node -p "process.arch")"
  libc=""
  if [ "$platform" = "linux" ]; then
    libc="$(node -p "process.report?.getReport?.().header?.glibcVersionRuntime ? 'gnu' : 'musl'")"
  fi

  case "$platform" in
    darwin)
      target="darwin-$arch"
      next_pkg="@next/swc-$target"
      sharp_pkg="@img/sharp-$target"
      sharp_vips_pkg="@img/sharp-libvips-$target"
      node_pty_prebuild="$target"
      ;;
    linux)
      target="linux-$arch"
      next_pkg="@next/swc-$target-$libc"
      sharp_pkg="@img/sharp-$target"
      sharp_vips_pkg="@img/sharp-libvips-$target"
      if [ "$libc" = "musl" ]; then
        sharp_pkg="@img/sharp-linuxmusl-$arch"
        sharp_vips_pkg="@img/sharp-libvips-linuxmusl-$arch"
      fi
      node_pty_prebuild="$target"
      ;;
    win32)
      target="win32-$arch"
      next_pkg="@next/swc-$target-msvc"
      sharp_pkg="@img/sharp-$target"
      sharp_vips_pkg=""
      node_pty_prebuild="$target"
      ;;
    *)
      echo "==> sidecar native prune: unsupported platform $platform/$arch; leaving native packages intact"
      return 0
      ;;
  esac

  echo "==> pruning sidecar native packages for $platform/$arch${libc:+/$libc}"

  local dir pkg
  for dir in "$base"/@next/swc-*; do
    [ -e "$dir" ] || continue
    pkg="@next/$(basename "$dir")"
    if [ "$pkg" != "$next_pkg" ]; then
      rm -rf "$dir"
    fi
  done

  for dir in "$base"/@img/sharp-*; do
    [ -e "$dir" ] || continue
    pkg="@img/$(basename "$dir")"
    if [ "$pkg" != "$sharp_pkg" ] && [ "$pkg" != "$sharp_vips_pkg" ]; then
      rm -rf "$dir"
    fi
  done

  if [ "$platform" != "darwin" ]; then
    rm -rf "$base/fsevents"
  fi

  if [ -d "$base/node-pty/prebuilds" ]; then
    for dir in "$base"/node-pty/prebuilds/*; do
      [ -e "$dir" ] || continue
      if [ "$(basename "$dir")" != "$node_pty_prebuild" ]; then
        rm -rf "$dir"
      fi
    done
  fi

  if [ "$platform" != "win32" ]; then
    rm -rf "$base/node-pty/third_party/conpty"
  elif [ -d "$base/node-pty/third_party/conpty" ]; then
    for dir in "$base"/node-pty/third_party/conpty/*/win10-*; do
      [ -e "$dir" ] || continue
      if [ "$(basename "$dir")" != "win10-$arch" ]; then
        rm -rf "$dir"
      fi
    done
  fi
}

prune_sidecar_nonruntime_files() {
  local dest="$1"
  if [ ! -d "$dest" ]; then
    return 0
  fi

  echo "==> pruning sidecar non-runtime files"

  # NOTE: do NOT prune node_modules/sharp or node_modules/@img here — sharp is a
  # runtime dependency of the familiar avatar route, which transcodes seeded
  # raster avatars at request time (#2010). prune_foreign_native_packages has
  # already trimmed @img down to the single build-target sharp + libvips pair,
  # so keeping them costs little and avatars actually render in the packaged app.
  rm -rf \
    "$dest/node_modules/@playwright" \
    "$dest/node_modules/@types" \
    "$dest/node_modules/playwright" \
    "$dest/node_modules/playwright-core"

  find "$dest" -type f \( \
    -name '*.map' -o \
    -name '*.d.ts' -o \
    -name '*.d.ts.map' \
  \) -delete
}

echo "==> next build"
(cd "$ROOT" && pnpm build) >&2

STANDALONE="$ROOT/.next/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "ERROR: $STANDALONE/server.js missing after build" >&2
  exit 1
fi

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

# Next.js + pnpm leaves a node_modules full of pnpm-style symlinks
# (.pnpm/* paths) that don't survive the copy into the .app bundle. Recreate
# production deps from the committed pnpm lockfile in a staging dir, then copy
# them with symlinks dereferenced so release bundles keep locked integrity data.
echo "==> installing locked prod deps with pnpm in staging dir"
cp "$ROOT/package.json" "$PNPM_STAGE/package.json"
cp "$ROOT/pnpm-lock.yaml" "$PNPM_STAGE/pnpm-lock.yaml"
if [ -f "$ROOT/.npmrc" ]; then
  cp "$ROOT/.npmrc" "$PNPM_STAGE/.npmrc"
fi
(
  cd "$PNPM_STAGE" && pnpm install --prod --frozen-lockfile \
    --config.node-linker=hoisted --ignore-scripts
) >&2
prune_foreign_native_packages "$PNPM_STAGE/node_modules"
fix_node_pty_spawn_helpers "$PNPM_STAGE/node_modules"

echo "==> copying standalone tree → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
# Skip the standalone's broken pnpm-style node_modules; we'll bring in the
# locked, dereferenced pnpm one instead.
(cd "$STANDALONE" && find . -mindepth 1 -maxdepth 1 ! -name node_modules \
   -exec cp -a {} "$DEST/" \;)

echo "==> grafting locked node_modules → $DEST/node_modules"
cp -aL "$PNPM_STAGE/node_modules" "$DEST/node_modules"
fix_node_pty_spawn_helpers "$DEST/node_modules"

# The standalone tree's server.js is Next's generated entrypoint — it serves
# the app but has no /api/pty-ws websocket bridge, so the terminal cannot
# reach a shell through the sidecar. Ship the custom server (server.ts →
# server.mjs, produced by `pnpm build:server` inside `pnpm build` above);
# the Tauri launcher prefers server.mjs when present.
echo "==> shipping custom PTY-bridge server → $DEST/server.mjs"
if [ ! -f "$ROOT/server.mjs" ]; then
  echo "ERROR: $ROOT/server.mjs missing after build — build:server should have produced it" >&2
  exit 1
fi
cp "$ROOT/server.mjs" "$DEST/server.mjs"

# But Next.js's compiled server.js can require the standalone's own internal
# next package layout. Merge any package the standalone shipped that the
# locked production install did not include (rare, but cheap to do).
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
# oniguruma-to-es). After we swap in the locked top-level node_modules
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
    if [ -d "$PNPM_STAGE/node_modules/$pkg" ]; then
      src="$PNPM_STAGE/node_modules/$pkg"
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

prune_sidecar_nonruntime_files "$DEST"

# Sanity check
for must in node_modules/@next/env node_modules/@swc/helpers/_; do
  if [ ! -e "$DEST/$must" ]; then
    echo "==> ! bundle still missing $must — sidecar will not boot" >&2
    exit 1
  fi
done

# Sharp must actually load from the bundle, or familiar raster avatars 404 in
# the packaged app (#2010). The prune keeps only the build-host-arch native
# binary, and release bundles are built on the matching host (same constraint
# as @next/swc and node-pty), so requiring it here exercises the real load
# path and fails fast if @img/sharp-<target> or libvips went missing.
if ! (cd "$DEST" && node -e "require('sharp')") >&2 2>&1; then
  echo "==> ! sharp failed to load from sidecar bundle — raster avatars will 404 (#2010)" >&2
  echo "    expected @img/sharp-<build-target> native binary under $DEST/node_modules/@img" >&2
  exit 1
fi

echo "==> sidecar bundle ready ($(du -sh "$DEST" | cut -f1))"
