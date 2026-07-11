#!/usr/bin/env bash
# Build + assemble the Next.js standalone server from its emitted file traces
# plus Cave's explicit runtime data. macOS/Linux package the expanded tree;
# Windows packages a bounded archive that the launcher expands into its
# versioned local runtime cache.
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
WINDOWS_ARCHIVE_DIR="$ROOT/src-tauri/resources/server-archive"
WINDOWS_ARCHIVE="$WINDOWS_ARCHIVE_DIR/server.tar.gz"
WINDOWS_ARCHIVE_MANIFEST="$WINDOWS_ARCHIVE_DIR/manifest.json"
WINDOWS_ARCHIVE_TEMP="$WINDOWS_ARCHIVE_DIR/.server.tar.gz.$$.tmp"
WINDOWS_ARCHIVE_MANIFEST_TEMP="$WINDOWS_ARCHIVE_DIR/.manifest.json.$$.tmp"
BUNDLED_NODE_DIR="$ROOT/src-tauri/resources/node"
PNPM_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/coven-cave-sidecar-pnpm.XXXXXX")"
cleanup_staging() {
  rm -rf "$PNPM_STAGE"
  rm -f "$WINDOWS_ARCHIVE_TEMP" "$WINDOWS_ARCHIVE_MANIFEST_TEMP"
}
trap cleanup_staging EXIT

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

  local platform arch libc target next_pkg sharp_pkg sharp_vips_pkg node_pty_prebuild SIDECAR_SUPPORTED
  platform="$(node -p "process.platform")"
  arch="$(node -p "process.arch")"
  libc=""
  if [ "$platform" = "linux" ]; then
    libc="$(node -p "process.report?.getReport?.().header?.glibcVersionRuntime ? 'gnu' : 'musl'")"
  fi

  # Single source of truth for the native target mapping, shared with the
  # cross-environment conformance suite (scripts/sidecar-target.mjs). Keeps the
  # release prune from ever drifting from what the tests assert per-OS.
  SIDECAR_SUPPORTED=0
  eval "$(node "$ROOT/scripts/sidecar-target.mjs" --sh "$platform" "$arch" "$libc")"
  if [ "$SIDECAR_SUPPORTED" != "1" ]; then
    echo "==> sidecar native prune: unsupported platform $platform/$arch; leaving native packages intact"
    return 0
  fi

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
    "$dest/node_modules/playwright-core" \
    "$dest/node_modules/node-pty/deps" \
    "$dest/node_modules/node-pty/scripts" \
    "$dest/node_modules/node-pty/src" \
    "$dest/node_modules/node-pty/typings"

  find "$dest" -type f \( \
    -name '*.map' -o \
    -name '*.d.ts' -o \
    -name '*.d.ts.map' -o \
    -name '*.pdb' -o \
    -name '*.test.js' \
  \) -delete
}

copy_node_shared_runtime() {
  local node_bin="$1"
  local dest_dir="$2"
  local lib_ref=""

  case "$(uname -s)" in
    Darwin)
      if command -v otool >/dev/null 2>&1; then
        lib_ref="$(otool -L "$node_bin" | awk '/libnode.*\.dylib/ {print $1; exit}')"
      fi
      ;;
    Linux)
      if command -v ldd >/dev/null 2>&1; then
        lib_ref="$(ldd "$node_bin" | awk '/libnode.*\.so/ {print $3; exit}')"
      fi
      ;;
  esac

  if [ -z "$lib_ref" ]; then
    return 0
  fi

  local lib_name="${lib_ref##*/}"
  local lib_path=""
  if [ -f "$lib_ref" ]; then
    lib_path="$lib_ref"
  else
    local dir
    for dir in \
      "$(dirname "$node_bin")" \
      "$(dirname "$node_bin")/../lib" \
      "$(dirname "$node_bin")/../../lib" \
      "$(dirname "$node_bin")/../../../lib"; do
      if [ -f "$dir/$lib_name" ]; then
        lib_path="$(cd "$dir" && pwd -P)/$lib_name"
        break
      fi
    done
  fi

  if [ -z "$lib_path" ]; then
    echo "ERROR: node runtime depends on $lib_ref, but the library could not be found" >&2
    exit 1
  fi

  mkdir -p "$dest_dir/lib"
  cp "$lib_path" "$dest_dir/lib/$lib_name"
  chmod +r "$dest_dir/lib/$lib_name" 2>/dev/null || true
  echo "==> bundled Node shared runtime $lib_name"
}

write_windows_sidecar_archive() {
  mkdir -p "$WINDOWS_ARCHIVE_DIR"
  # A killed prior build must not leave unbounded staging files. Final archive
  # and manifest paths remain untouched until the replacement passes all
  # integrity and size gates.
  find "$WINDOWS_ARCHIVE_DIR" -maxdepth 1 -type f -mmin +1440 \( \
    -name '.server.tar.gz.*.tmp' -o \
    -name '.manifest.json.*.tmp' \
  \) -delete

  # The standalone output can retain valid pnpm symlinks. Materialize those
  # few links in place instead of copying the entire 500+ MiB tree a second
  # time. The manifest and runtime both reject any link that survives.
  while IFS= read -r -d '' link; do
    if [ ! -e "$link" ]; then
      echo "ERROR: dangling sidecar symlink cannot be archived: $link" >&2
      exit 1
    fi
    materialized="${link}.materialized.$$"
    cp -aL "$link" "$materialized"
    rm -f "$link"
    mv "$materialized" "$link"
  done < <(find "$DEST" -type l -print0)

  echo "==> archiving Windows sidecar -> $WINDOWS_ARCHIVE_TEMP"
  if [ "$(uname -s)" = "Darwin" ]; then
    COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs \
      -czf "$WINDOWS_ARCHIVE_TEMP" -C "$DEST" .
  else
    tar -czf "$WINDOWS_ARCHIVE_TEMP" -C "$DEST" .
  fi

  node "$ROOT/scripts/sidecar-archive-manifest.mjs" --publish \
    "$DEST" "$WINDOWS_ARCHIVE_TEMP" \
    "$WINDOWS_ARCHIVE" "$WINDOWS_ARCHIVE_MANIFEST" \
    "$WINDOWS_ARCHIVE_MANIFEST_TEMP"

  # Keep the expanded tree out of the Windows build workspace as a second
  # guard against accidentally reintroducing thousands of WiX components.
  rm -rf "$DEST"
  mkdir -p "$DEST"
  printf "generated at release build time\n" > "$DEST/placeholder.txt"
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
copy_node_shared_runtime "$NODE_BIN" "$BUNDLED_NODE_DIR"
"$BUNDLED_NODE_DIR/bin/$NODE_NAME" -e "process.exit(0)" >/dev/null
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

echo "==> assembling traced sidecar runtime → $DEST"
node "$ROOT/scripts/sidecar-runtime-closure.mjs" \
  "$ROOT" "$STANDALONE" "$PNPM_STAGE/node_modules" "$DEST"

echo "==> pruning sidecar runtime for the release target"
prune_foreign_native_packages "$DEST/node_modules"
fix_node_pty_spawn_helpers "$DEST/node_modules"

prune_sidecar_nonruntime_files "$DEST"
node "$ROOT/scripts/sidecar-runtime-closure.mjs" --verify "$DEST"

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

if [ "${TAURI_PLATFORM:-}" = "windows" ] || [ "${OS:-}" = "Windows_NT" ]; then
  write_windows_sidecar_archive
fi

echo "==> sidecar bundle ready ($(du -sh "$DEST" | cut -f1))"
