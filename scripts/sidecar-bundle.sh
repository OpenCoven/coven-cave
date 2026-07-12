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
SERVER_ARCHIVE="$ROOT/src-tauri/resources/server.tar.gz"
SERVER_MANIFEST="$ROOT/src-tauri/resources/server-manifest.json"
STATIC="$ROOT/.next/static"
PUBLIC="$ROOT/public"
PNPM_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/coven-cave-sidecar-pnpm.XXXXXX")"
trap 'rm -rf "$PNPM_STAGE"' EXIT
FORBIDDEN_RUNTIME_ROOTS=(
  .agents
  .beads
  .claude
  .codex
  apps
  automations
  docs
  screenshots
  scripts
  src
  tests
)
ALLOWED_RUNTIME_ROOTS=(
  .next
  assets
  marketplace
  node_modules
  public
  workflows
)
ALLOWED_RUNTIME_FILES=(
  package.json
  server.js
  server.mjs
  vault.yaml
)

copy_runtime_tree() {
  local source="$1"
  local relative="$2"
  if [ ! -d "$source" ]; then
    echo "ERROR: required runtime tree missing: $source" >&2
    exit 1
  fi
  rm -rf "$DEST/$relative"
  mkdir -p "$DEST/$relative"
  cp -aL "$source/." "$DEST/$relative/"
  echo "==> copied explicit runtime tree $relative/"
}

copy_runtime_file() {
  local source="$1"
  local relative="$2"
  if [ ! -f "$source" ]; then
    echo "ERROR: required runtime file missing: $source" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$DEST/$relative")"
  cp "$source" "$DEST/$relative"
  echo "==> copied explicit runtime file $relative"
}

assert_runtime_layout() {
  local link forbidden entry name allowed candidate
  link="$(find "$DEST" -type l -print -quit)"
  if [ -n "$link" ]; then
    echo "ERROR: sidecar runtime must be self-contained; symlink remains: $link" >&2
    exit 1
  fi
  for forbidden in "${FORBIDDEN_RUNTIME_ROOTS[@]}"; do
    if [ -e "$DEST/$forbidden" ]; then
      echo "ERROR: repository-only path leaked into sidecar runtime: $forbidden" >&2
      exit 1
    fi
  done
  while IFS= read -r -d '' entry; do
    name="$(basename "$entry")"
    allowed=0
    if [ -d "$entry" ]; then
      for candidate in "${ALLOWED_RUNTIME_ROOTS[@]}"; do
        [ "$name" = "$candidate" ] && allowed=1
      done
    elif [ -f "$entry" ]; then
      for candidate in "${ALLOWED_RUNTIME_FILES[@]}"; do
        [ "$name" = "$candidate" ] && allowed=1
      done
    fi
    if [ "$allowed" != "1" ]; then
      echo "ERROR: unexpected top-level sidecar runtime entry: $name" >&2
      exit 1
    fi
  done < <(find "$DEST" -mindepth 1 -maxdepth 1 -print0)
}

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
    "$dest/node_modules/playwright-core"

  find "$dest" -type f \( \
    -name '*.map' -o \
    -name '*.d.ts' -o \
    -name '*.d.ts.map' \
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
  chmod u+rw "$dest_dir/lib/$lib_name" 2>/dev/null || true
  chmod +r "$dest_dir/lib/$lib_name" 2>/dev/null || true
  echo "==> bundled Node shared runtime $lib_name"
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
chmod u+rw "$BUNDLED_NODE_DIR/bin/$NODE_NAME" 2>/dev/null || true
chmod +x "$BUNDLED_NODE_DIR/bin/$NODE_NAME" 2>/dev/null || true
copy_node_shared_runtime "$NODE_BIN" "$BUNDLED_NODE_DIR"
"$BUNDLED_NODE_DIR/bin/$NODE_NAME" -e "process.exit(0)" >/dev/null
printf "generated at release build time\n" > "$BUNDLED_NODE_DIR/placeholder.txt"

# Deploy the dedicated runtime workspace package from the already-installed,
# frozen workspace graph. This keeps browser-only root dependencies out of the
# sidecar while preserving the committed pnpm lockfile as the integrity source.
echo "==> deploying allowlisted sidecar runtime from workspace lockfile"
pnpm --dir "$ROOT" \
  --prefer-offline \
  --config.node-linker=hoisted \
  --filter @opencoven/cave-sidecar-runtime \
  --prod deploy "$PNPM_STAGE" >&2
prune_foreign_native_packages "$PNPM_STAGE/node_modules"
fix_node_pty_spawn_helpers "$PNPM_STAGE/node_modules"

echo "==> copying standalone tree → $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
# The dedicated runtime package owns externals, and explicit data copies below
# own non-code assets. Only the compiled Next tree and its two launch metadata
# files are accepted from NFT output; this prevents broad dynamic traces from
# copying repository roots or test/build files into the installer.
copy_runtime_tree "$STANDALONE/.next" ".next"
copy_runtime_file "$STANDALONE/package.json" "package.json"
copy_runtime_file "$STANDALONE/server.js" "server.js"

echo "==> grafting allowlisted node_modules → $DEST/node_modules"
cp -aL "$PNPM_STAGE/node_modules" "$DEST/node_modules"
rm -rf "$DEST/node_modules/.pnpm"
prune_foreign_native_packages "$DEST/node_modules"
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

if [ -d "$STATIC" ]; then
  mkdir -p "$DEST/.next/static"
  echo "==> copying .next/static → $DEST/.next/static"
  cp -a "$STATIC/." "$DEST/.next/static/"
fi

copy_runtime_tree "$ROOT/marketplace" "marketplace"
copy_runtime_tree "$ROOT/workflows" "workflows"
copy_runtime_tree "$ROOT/assets" "assets"
copy_runtime_tree "$PUBLIC" "public"
copy_runtime_file "$ROOT/vault.yaml" "vault.yaml"

prune_sidecar_nonruntime_files "$DEST"
assert_runtime_layout

# Sanity check
for must in node_modules/@next/env node_modules/@swc/helpers/_; do
  if [ ! -e "$DEST/$must" ]; then
    echo "==> ! bundle still missing $must — sidecar will not boot" >&2
    exit 1
  fi
done

# Load every external/custom-server dependency from the final root, using the
# bundled Node executable that users receive rather than the build-shell Node.
if ! (cd "$DEST" && "$BUNDLED_NODE_DIR/bin/$NODE_NAME" --input-type=module -e '
  import { createRequire } from "node:module";
  const require = createRequire(new URL("./server.mjs", import.meta.url));
  for (const id of [
    "next",
    "node-pty",
    "sharp",
    "@next/env",
    "@swc/helpers/_/_interop_require_default",
    "ws",
  ]) require(id);
') >&2 2>&1; then
  echo "==> ! an allowlisted dependency failed to load from the sidecar runtime" >&2
  exit 1
fi

node "$ROOT/scripts/sidecar-archive.mjs" "$DEST" "$SERVER_ARCHIVE" "$SERVER_MANIFEST"

echo "==> sidecar bundle ready ($(du -sh "$DEST" | cut -f1))"
