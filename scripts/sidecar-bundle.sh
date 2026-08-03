#!/usr/bin/env bash
# Build + assemble the Next.js standalone server from its emitted file traces
# plus Cave's explicit runtime data. macOS/Linux package the expanded tree;
# Windows packages a bounded archive that the launcher expands into its
# versioned local runtime cache.
#
# Desktop-only: the Cave app ships the Node sidecar exclusively on the desktop
# Tauri targets. The mobile experience is the native Swift app under `apps/ios/`,
# which points at the user's home Tailscale daemon rather than a bundled sidecar
# (see docs/mobile-tailscale.md), so there is no mobile build path through here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/server"
WINDOWS_ARCHIVE_DIR="$ROOT/src-tauri/resources/server-archive"
WINDOWS_ARCHIVE="$WINDOWS_ARCHIVE_DIR/server.tar.zst"
WINDOWS_ARCHIVE_MANIFEST="$WINDOWS_ARCHIVE_DIR/manifest.json"
WINDOWS_ARCHIVE_TEMP="$WINDOWS_ARCHIVE_DIR/.server.tar.zst.$$.tmp"
WINDOWS_ARCHIVE_MANIFEST_TEMP="$WINDOWS_ARCHIVE_DIR/.manifest.json.$$.tmp"
BUNDLED_NODE_DIR="$ROOT/src-tauri/resources/node"
PIPER_RUNTIME_DIR="$ROOT/src-tauri/resources/piper"
KOKORO_RUNTIME_DIR="$ROOT/src-tauri/resources/kokoro"
# Use Node rather than shell-specific environment variables (such as OS) so
# Git Bash and CI build the same Windows resource layout.
BUILD_PLATFORM="$(node -p 'process.platform')"
PNPM_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/coven-cave-sidecar-pnpm.XXXXXX")"
cleanup_staging() {
  rm -rf "$PNPM_STAGE"
  rm -f "$WINDOWS_ARCHIVE_TEMP" "$WINDOWS_ARCHIVE_MANIFEST_TEMP"
}
trap cleanup_staging EXIT

bundle_piper_runtime() {
  local platform asset expected_sha archive extract_root executable runtime_root actual_sha
  local phonemize_asset phonemize_sha phonemize_archive phonemize_extract_root phonemize_lib_root mac_executable
  platform="$(node -p 'process.platform')"
  case "$platform/$(node -p 'process.arch')" in
    linux/x64)
      asset="piper_linux_x86_64.tar.gz"
      expected_sha="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
      executable="piper"
      ;;
    win32/x64)
      asset="piper_windows_amd64.zip"
      expected_sha="f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea"
      executable="piper.exe"
      ;;
    darwin/arm64)
      asset="piper_macos_aarch64.tar.gz"
      expected_sha="6b1eb03b3735946cb35216e063e7eebcc33a6bbf5dd96ec0217959bf1cdcb0cc"
      phonemize_asset="piper-phonemize_macos_aarch64.tar.gz"
      phonemize_sha="78a9c28b3c94baf6e9526b2e386ce547909abaec4f31aadd7e16b01fbfe5f322"
      executable="piper"
      ;;
    darwin/x64)
      asset="piper_macos_x64.tar.gz"
      expected_sha="ced85c0a3df13945b1e623b878a48fdc2854d5c485b4b67f62857cf551deaf8b"
      phonemize_asset="piper-phonemize_macos_x64.tar.gz"
      phonemize_sha="9ec6e300c0d012a663758bc45a097b47ee759761a3b91c7742de042af789d84b"
      executable="piper"
      ;;
    *)
      echo "ERROR: no managed Piper runtime for $platform/$(node -p 'process.arch')" >&2
      exit 1
      ;;
  esac

  archive="$PNPM_STAGE/$asset"
  extract_root="$PNPM_STAGE/piper-runtime"
  echo "==> downloading pinned Piper runtime $asset"
  curl --fail --location --retry 3 --silent --show-error \
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/$asset" \
    --output "$archive"
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
  else
    actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
  fi
  if [ "$actual_sha" != "$expected_sha" ]; then
    echo "ERROR: Piper runtime checksum mismatch for $asset" >&2
    exit 1
  fi

  rm -rf "$extract_root" "$PIPER_RUNTIME_DIR"
  mkdir -p "$extract_root" "$PIPER_RUNTIME_DIR"
  case "$asset" in
    *.zip) unzip -q "$archive" -d "$extract_root" ;;
    *.tar.gz) tar -xzf "$archive" -C "$extract_root" ;;
  esac
  runtime_root="$(dirname "$(find "$extract_root" -type f -name "$executable" -print -quit)")"
  if [ -z "$runtime_root" ] || [ ! -f "$runtime_root/$executable" ]; then
    echo "ERROR: Piper archive does not contain $executable" >&2
    exit 1
  fi
  cp -a "$runtime_root/." "$PIPER_RUNTIME_DIR/"
  chmod +x "$PIPER_RUNTIME_DIR/$executable" 2>/dev/null || true
  if [ -f "$PIPER_RUNTIME_DIR/espeak-ng" ]; then
    chmod +x "$PIPER_RUNTIME_DIR/espeak-ng"
  fi

  if [ "$platform" = "darwin" ]; then
    # Piper's pinned macOS archives omit every @rpath dylib used by piper,
    # piper_phonemize, and espeak-ng. The matching piper-phonemize release
    # contains that closure, including the compatibility-name symlinks.
    phonemize_archive="$PNPM_STAGE/$phonemize_asset"
    phonemize_extract_root="$PNPM_STAGE/piper-phonemize-runtime"
    echo "==> downloading pinned Piper phonemize runtime $phonemize_asset"
    curl --fail --location --retry 3 --silent --show-error \
      "https://github.com/rhasspy/piper-phonemize/releases/download/2023.11.14-4/$phonemize_asset" \
      --output "$phonemize_archive"
    if command -v sha256sum >/dev/null 2>&1; then
      actual_sha="$(sha256sum "$phonemize_archive" | awk '{print $1}')"
    else
      actual_sha="$(shasum -a 256 "$phonemize_archive" | awk '{print $1}')"
    fi
    if [ "$actual_sha" != "$phonemize_sha" ]; then
      echo "ERROR: Piper phonemize runtime checksum mismatch for $phonemize_asset" >&2
      exit 1
    fi

    rm -rf "$phonemize_extract_root"
    mkdir -p "$phonemize_extract_root"
    tar -xzf "$phonemize_archive" -C "$phonemize_extract_root"
    phonemize_lib_root="$(dirname "$(find "$phonemize_extract_root" -type f -name 'libpiper_phonemize.*.dylib' -print -quit)")"
    if [ -z "$phonemize_lib_root" ] || [ ! -e "$phonemize_lib_root/libespeak-ng.1.dylib" ] \
      || [ ! -e "$phonemize_lib_root/libonnxruntime.1.14.1.dylib" ] \
      || [ ! -e "$phonemize_lib_root/libpiper_phonemize.1.dylib" ]; then
      echo "ERROR: Piper phonemize archive does not contain the required macOS dylib closure" >&2
      exit 1
    fi
    cp -a "$phonemize_lib_root/"*.dylib "$PIPER_RUNTIME_DIR/"

    # The upstream executables load these libraries through @rpath but ship no
    # LC_RPATH command. Keep the relocatable closure flat and resolve it beside
    # each executable; the release pipeline signs these modified Mach-O files.
    for mac_executable in piper piper_phonemize espeak-ng; do
      if [ -f "$PIPER_RUNTIME_DIR/$mac_executable" ]; then
        chmod +x "$PIPER_RUNTIME_DIR/$mac_executable"
        install_name_tool -add_rpath @executable_path "$PIPER_RUNTIME_DIR/$mac_executable"
      fi
    done
  fi
}

# Kokoro synthesis runs through the sherpa-onnx offline TTS CLI. The upstream
# release archives ship dozens of demo binaries; stage only the offline-tts
# CLI plus the onnxruntime library it links (rpath starts with
# @loader_path/$ORIGIN, so a flat directory resolves). espeak-ng-data rides
# with the runtime — NOT the voice-model download — because Kokoro
# phonemization needs it wherever the executable lives (the Node runner passes
# --kokoro-data-dir=<dir-of-executable>/espeak-ng-data).
bundle_kokoro_runtime() {
  local platform asset expected_sha archive extract_root executable bin_root runtime_root actual_sha
  local espeak_asset espeak_sha espeak_archive
  platform="$(node -p 'process.platform')"
  case "$platform/$(node -p 'process.arch')" in
    linux/x64)
      asset="sherpa-onnx-v1.13.4-linux-x64-shared.tar.bz2"
      expected_sha="18887dc13c7d313d0e0f6c164ed31715c27c1c2c4f71acd7c0147dc84cf02514"
      executable="sherpa-onnx-offline-tts"
      ;;
    win32/x64)
      asset="sherpa-onnx-v1.13.4-win-x64-shared-MD-Release.tar.bz2"
      expected_sha="d4dacc8be5afe03f22ade4d50cfd587c03a625eaca8c41f2d99a24d3db463eab"
      executable="sherpa-onnx-offline-tts.exe"
      ;;
    darwin/arm64)
      asset="sherpa-onnx-v1.13.4-osx-arm64-shared.tar.bz2"
      expected_sha="809ab5d0c77bd8f358364a244e6ab17f2afecf9779eb9fd436fa469c3ff5375c"
      executable="sherpa-onnx-offline-tts"
      ;;
    darwin/x64)
      # Upstream publishes no x86_64-only shared archive; universal2 covers it.
      asset="sherpa-onnx-v1.13.4-osx-universal2-shared.tar.bz2"
      expected_sha="02b9b0cf30819a18c6d5cf861aebf32336cb79958ab97a2b248227059678058b"
      executable="sherpa-onnx-offline-tts"
      ;;
    *)
      echo "ERROR: no managed Kokoro (sherpa-onnx) runtime for $platform/$(node -p 'process.arch')" >&2
      exit 1
      ;;
  esac
  espeak_asset="espeak-ng-data.tar.bz2"
  espeak_sha="4135ccf82e1f40613491c0874d4945ae9e9c7840933d8e25a6f9e003d9ebf533"

  archive="$PNPM_STAGE/$asset"
  extract_root="$PNPM_STAGE/kokoro-runtime"
  echo "==> downloading pinned Kokoro (sherpa-onnx) runtime $asset"
  curl --fail --location --retry 3 --silent --show-error \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.4/$asset" \
    --output "$archive"
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
  else
    actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
  fi
  if [ "$actual_sha" != "$expected_sha" ]; then
    echo "ERROR: Kokoro runtime checksum mismatch for $asset" >&2
    exit 1
  fi

  espeak_archive="$PNPM_STAGE/$espeak_asset"
  echo "==> downloading pinned espeak-ng-data for the Kokoro runtime"
  curl --fail --location --retry 3 --silent --show-error \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$espeak_asset" \
    --output "$espeak_archive"
  if command -v sha256sum >/dev/null 2>&1; then
    actual_sha="$(sha256sum "$espeak_archive" | awk '{print $1}')"
  else
    actual_sha="$(shasum -a 256 "$espeak_archive" | awk '{print $1}')"
  fi
  if [ "$actual_sha" != "$espeak_sha" ]; then
    echo "ERROR: Kokoro espeak-ng-data checksum mismatch for $espeak_asset" >&2
    exit 1
  fi

  rm -rf "$extract_root" "$KOKORO_RUNTIME_DIR"
  mkdir -p "$extract_root" "$KOKORO_RUNTIME_DIR"
  tar -xjf "$archive" -C "$extract_root"
  bin_root="$(dirname "$(find "$extract_root" -type f -name "$executable" -print -quit)")"
  if [ -z "$bin_root" ] || [ ! -f "$bin_root/$executable" ]; then
    echo "ERROR: Kokoro archive does not contain $executable" >&2
    exit 1
  fi
  runtime_root="$(dirname "$bin_root")"
  cp "$bin_root/$executable" "$KOKORO_RUNTIME_DIR/"
  if [ "$platform" = "win32" ]; then
    # Windows resolves DLLs beside the executable; upstream stages them in bin/.
    cp "$bin_root"/*.dll "$KOKORO_RUNTIME_DIR/"
  elif [ "$platform" = "darwin" ]; then
    # The TTS CLI's only runtime link dependency is the versioned dylib
    # (LC_LOAD_DYLIB @rpath/libonnxruntime.1.27.0.dylib); the unversioned
    # sibling in the archive is a full 28MB duplicate, not a symlink.
    cp "$runtime_root"/lib/libonnxruntime.*.dylib "$KOKORO_RUNTIME_DIR/"
  else
    # DT_NEEDED references the unversioned soname; it is the only .so needed.
    cp "$runtime_root"/lib/libonnxruntime.so "$KOKORO_RUNTIME_DIR/"
  fi
  tar -xjf "$espeak_archive" -C "$KOKORO_RUNTIME_DIR"
  if [ ! -d "$KOKORO_RUNTIME_DIR/espeak-ng-data" ]; then
    echo "ERROR: espeak-ng-data did not extract beside the Kokoro executable" >&2
    exit 1
  fi
  chmod +x "$KOKORO_RUNTIME_DIR/$executable" 2>/dev/null || true
  if [ "$platform" = "darwin" ]; then
    # Upstream's ad-hoc signatures do not survive staging: the copied pages
    # fault with SIGKILL (Code Signature Invalid) on Apple silicon. Re-sign
    # cleanly here; release builds re-sign again with the real identity when
    # Tauri assembles the app.
    codesign --force -s - "$KOKORO_RUNTIME_DIR"/libonnxruntime* "$KOKORO_RUNTIME_DIR/$executable"
  fi
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
    -name '.server.tar.zst.*.tmp' -o \
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
  # The Node writer emits a canonical tar stream (byte-sorted paths, fixed
  # uid/gid/mtime/modes) and wraps it in deterministic zstd level 3. Identical payloads
  # therefore keep the same digest/cache key across release builds and hosts.
  node "$ROOT/scripts/sidecar-archive-manifest.mjs" --publish \
    "$DEST" "$WINDOWS_ARCHIVE_TEMP" \
    "$WINDOWS_ARCHIVE" "$WINDOWS_ARCHIVE_MANIFEST" \
    "$WINDOWS_ARCHIVE_MANIFEST_TEMP"
  rm -f "$WINDOWS_ARCHIVE_DIR/placeholder.txt"

  # Keep the expanded tree out of the Windows build workspace as a second
  # guard against accidentally reintroducing thousands of WiX components.
  rm -rf "$DEST"
  mkdir -p "$DEST"
  printf "generated at release build time\n" > "$DEST/placeholder.txt"
}

bundle_piper_runtime
bundle_kokoro_runtime

echo "==> next build"
(cd "$ROOT" && pnpm build) >&2

STANDALONE="$ROOT/.next/standalone"
if [ ! -f "$STANDALONE/server.js" ]; then
  echo "ERROR: $STANDALONE/server.js missing after build" >&2
  exit 1
fi

echo "==> staging Node runtime for bundled sidecar"
if [ "$BUILD_PLATFORM" = "win32" ]; then
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

echo "==> staging bundled Whisper runtime"
COVEN_CAVE_REFRESH_WHISPER=1 bash "$ROOT/scripts/whisper-runtime-bundle.sh"

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

if [ "$BUILD_PLATFORM" = "win32" ]; then
  write_windows_sidecar_archive
fi

echo "==> sidecar bundle ready ($(du -sh "$DEST" | cut -f1))"
