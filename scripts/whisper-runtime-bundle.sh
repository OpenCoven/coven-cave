#!/usr/bin/env bash
# Stage a pinned whisper.cpp runtime beside the desktop sidecar. The output is
# a release resource, not part of the Next.js server archive: Windows keeps
# its DLLs adjacent to whisper-cli.exe and macOS signs the nested executable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_DEST="$ROOT/src-tauri/resources/whisper"
VERSION="v1.9.1"
MACOS_COMMIT="f049fff95a089aa9969deb009cdd4892b3e74916"
RELEASE_URL="https://github.com/ggml-org/whisper.cpp/releases/download/$VERSION"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/coven-whisper-runtime.XXXXXX")"
STAGE_ROOT="$(mktemp -d "$ROOT/src-tauri/resources/.whisper-staging.XXXXXX")"
STAGE_DEST="$STAGE_ROOT/whisper"
RUNTIME_ID="$VERSION:$(uname -s):$(uname -m):$MACOS_COMMIT"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) WHISPER_CLI_NAME="whisper-cli.exe" ;;
  *) WHISPER_CLI_NAME="whisper-cli" ;;
esac
PREVIOUS_DEST=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  if [ -n "$PREVIOUS_DEST" ] && [ -d "$PREVIOUS_DEST" ]; then
    if [ ! -e "$LIVE_DEST" ]; then
      if ! mv "$PREVIOUS_DEST" "$LIVE_DEST"; then
        echo "ERROR: could not restore the previous bundled Whisper runtime" >&2
        status=1
      fi
    else
      if ! rm -rf "$PREVIOUS_DEST"; then
        echo "WARNING: could not remove the previous bundled Whisper runtime" >&2
      fi
    fi
  fi
  if ! rm -rf "$WORK" "$STAGE_ROOT"; then
    echo "WARNING: could not remove temporary Whisper runtime files" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

runtime_is_current() {
  [ -x "$LIVE_DEST/$WHISPER_CLI_NAME" ] || return 1
  [ -f "$LIVE_DEST/.coven-whisper-runtime-id" ] || return 1
  [ "$(cat "$LIVE_DEST/.coven-whisper-runtime-id")" = "$RUNTIME_ID" ] || return 1
  "$LIVE_DEST/$WHISPER_CLI_NAME" --version >/dev/null 2>&1
}

if [ "${COVEN_CAVE_REFRESH_WHISPER:-0}" != "1" ] && runtime_is_current; then
  echo "==> reusing bundled whisper.cpp $VERSION"
  exit 0
fi

DEST="$STAGE_DEST"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

download_verified() {
  local url="$1"
  local expected="$2"
  local output="$3"
  curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 "$url" -o "$output"
  local actual
  actual="$(sha256_file "$output")"
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: Whisper runtime checksum mismatch for $url" >&2
    echo "       expected $expected, got $actual" >&2
    exit 1
  fi
}

stage_linux() {
  local archive="$WORK/whisper.tar.gz" archive_name archive_sha source
  case "$(uname -m)" in
    x86_64|amd64)
      archive_name="whisper-bin-ubuntu-x64.tar.gz"
      archive_sha="f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5"
      ;;
    aarch64|arm64)
      archive_name="whisper-bin-ubuntu-arm64.tar.gz"
      archive_sha="e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3"
      ;;
    *)
      echo "ERROR: no bundled Whisper runtime for Linux architecture $(uname -m)" >&2
      exit 1
      ;;
  esac
  download_verified \
    "$RELEASE_URL/$archive_name" \
    "$archive_sha" \
    "$archive"
  tar -xzf "$archive" -C "$WORK"
  source="$WORK/${archive_name%.tar.gz}"
  cp -L "$source/whisper-cli" "$DEST/whisper-cli"
  # Preserve both the versioned ELF files and their SONAME links (for example
  # libwhisper.so.1 -> libwhisper.so.1.9.1). The binary requests the SONAME,
  # not necessarily the filename selected by the archive extraction order.
  find "$source" -maxdepth 1 \( -type f -o -type l \) \( -name 'libwhisper.so*' -o -name 'libggml*.so*' \) -exec cp -P {} "$DEST/" \;
  test -L "$DEST/libwhisper.so.1"
  chmod 755 "$DEST/whisper-cli"
}

stage_windows() {
  local archive="$WORK/whisper.zip"
  download_verified \
    "$RELEASE_URL/whisper-bin-x64.zip" \
    "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539" \
    "$archive"
  unzip -q "$archive" -d "$WORK/unpacked"
  local source="$WORK/unpacked/Release"
  cp "$source/whisper-cli.exe" "$DEST/whisper-cli.exe"
  cp "$source/whisper.dll" "$DEST/whisper.dll"
  find "$source" -maxdepth 1 -type f -name 'ggml*.dll' -exec cp {} "$DEST/" \;

  # whisper.cpp's official Windows build is dynamically linked to the MSVC
  # CRT/OpenMP DLLs. Ship the redistributable app-locally so a fresh Windows
  # install does not need a separate Visual C++ Redistributable install.
  local runtime_dir="" candidate dll complete
  local -a msvc_dlls=(MSVCP140.dll VCRUNTIME140.dll VCRUNTIME140_1.dll VCOMP140.dll)
  for candidate in \
    "${VCToolsRedistDir:-}/x64/Microsoft.VC143.CRT" \
    "${WINDIR:-C:/Windows}/System32"; do
    [ -d "$candidate" ] || continue
    complete=1
    for dll in "${msvc_dlls[@]}"; do
      [ -f "$candidate/$dll" ] || { complete=0; break; }
    done
    if [ "$complete" = "1" ]; then runtime_dir="$candidate"; break; fi
  done
  if [ -z "$runtime_dir" ]; then
    echo "ERROR: could not find the x64 Microsoft Visual C++ runtime for bundled Whisper" >&2
    exit 1
  fi
  for dll in "${msvc_dlls[@]}"; do cp "$runtime_dir/$dll" "$DEST/$dll"; done
}

stage_macos() {
  # whisper.cpp does not publish a macOS CLI archive. Build the exact immutable
  # release commit on the matching release host; release.sh then signs it.
  local source="$WORK/whisper.cpp"
  command -v cmake >/dev/null 2>&1 || { echo "ERROR: cmake is required to build bundled Whisper on macOS" >&2; exit 1; }
  git init -q "$source"
  git -C "$source" remote add origin https://github.com/ggml-org/whisper.cpp.git
  git -C "$source" fetch -q --depth 1 origin "$MACOS_COMMIT"
  git -C "$source" checkout -q --detach FETCH_HEAD
  test "$(git -C "$source" rev-parse HEAD)" = "$MACOS_COMMIT"
  # Keep copied dylibs discoverable after the temporary build tree disappears.
  # The release bundle co-locates them with whisper-cli, so @loader_path is
  # both relocatable and compatible with the later nested-code-signing pass.
  cmake -S "$source" -B "$source/build" \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
    -DCMAKE_BUILD_RPATH='@loader_path' \
    -DCMAKE_INSTALL_RPATH='@loader_path' \
    -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
  cmake --build "$source/build" --target whisper-cli --parallel 2
  cp "$source/build/bin/whisper-cli" "$DEST/whisper-cli"
  # Preserve the versioned dylibs and their SONAME links. whisper-cli loads
  # names such as libwhisper.1.dylib through @rpath, not just the concrete
  # versioned file, after the temporary build tree has been removed.
  find "$source/build/bin" -maxdepth 1 \( -type f -o -type l \) -name '*.dylib' -exec cp -P {} "$DEST/" \;
  chmod 755 "$DEST/whisper-cli"
}

mkdir -p "$DEST"

case "$(uname -s)" in
  Linux) stage_linux ;;
  Darwin) stage_macos ;;
  MINGW*|MSYS*|CYGWIN*) stage_windows ;;
  *) echo "ERROR: no bundled Whisper runtime for $(uname -s)" >&2; exit 1 ;;
esac

printf '%s\n' "$RUNTIME_ID" > "$DEST/.coven-whisper-runtime-id"

if [ -d "$LIVE_DEST" ]; then
  PREVIOUS_DEST="$(mktemp -d "$ROOT/src-tauri/resources/.whisper-previous.XXXXXX")"
  rmdir "$PREVIOUS_DEST"
  mv "$LIVE_DEST" "$PREVIOUS_DEST"
fi
if ! mv "$STAGE_DEST" "$LIVE_DEST"; then
  echo "ERROR: could not install bundled Whisper runtime" >&2
  exit 1
fi

echo "==> bundled whisper.cpp $VERSION ($(find "$LIVE_DEST" -maxdepth 1 -type f | wc -l | tr -d ' ') files)"
