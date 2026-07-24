#!/usr/bin/env bash
# Stage a pinned whisper.cpp runtime beside the desktop sidecar. The output is
# a release resource, not part of the Next.js server archive: Windows keeps
# its DLLs adjacent to whisper-cli.exe and macOS signs the nested executable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/whisper"
VERSION="v1.9.1"
RELEASE_URL="https://github.com/ggml-org/whisper.cpp/releases/download/$VERSION"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/coven-whisper-runtime.XXXXXX")"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

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
  local archive="$WORK/whisper.tar.gz"
  download_verified \
    "$RELEASE_URL/whisper-bin-ubuntu-x64.tar.gz" \
    "f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5" \
    "$archive"
  tar -xzf "$archive" -C "$WORK"
  local source="$WORK/whisper-bin-ubuntu-x64"
  cp -L "$source/whisper-cli" "$DEST/whisper-cli"
  find "$source" -maxdepth 1 -type f \( -name 'libwhisper.so*' -o -name 'libggml*.so*' \) -exec cp -L {} "$DEST/" \;
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
}

stage_macos() {
  # whisper.cpp does not publish a macOS CLI archive. Build the exact immutable
  # release commit on the matching release host; release.sh then signs it.
  local source="$WORK/whisper.cpp"
  command -v cmake >/dev/null 2>&1 || { echo "ERROR: cmake is required to build bundled Whisper on macOS" >&2; exit 1; }
  git init -q "$source"
  git -C "$source" remote add origin https://github.com/ggml-org/whisper.cpp.git
  git -C "$source" fetch -q --depth 1 origin f049fff95a089aa9969deb009cdd4892b3e74916
  git -C "$source" checkout -q --detach FETCH_HEAD
  test "$(git -C "$source" rev-parse HEAD)" = "f049fff95a089aa9969deb009cdd4892b3e74916"
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
  find "$source/build/bin" -maxdepth 1 -type f -name '*.dylib' -exec cp {} "$DEST/" \;
  install_name_tool -add_rpath '@loader_path' "$DEST/whisper-cli"
  chmod 755 "$DEST/whisper-cli"
}

rm -rf "$DEST"
mkdir -p "$DEST"

case "$(uname -s)" in
  Linux) stage_linux ;;
  Darwin) stage_macos ;;
  MINGW*|MSYS*|CYGWIN*) stage_windows ;;
  *) echo "ERROR: no bundled Whisper runtime for $(uname -s)" >&2; exit 1 ;;
esac

echo "==> bundled whisper.cpp $VERSION ($(find "$DEST" -maxdepth 1 -type f | wc -l | tr -d ' ') files)"
