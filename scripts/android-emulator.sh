#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW_PREFIX="${HOMEBREW_PREFIX:-$(brew --prefix 2>/dev/null || true)}"
DEFAULT_ANDROID_HOME="${BREW_PREFIX:+$BREW_PREFIX/share/android-commandlinetools}"
DEFAULT_ANDROID_HOME="${DEFAULT_ANDROID_HOME:-$HOME/Library/Android/sdk}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$DEFAULT_ANDROID_HOME}}"
ANDROID_SDK_ROOT="$ANDROID_HOME"
DEFAULT_JAVA_HOME="${BREW_PREFIX:+$BREW_PREFIX/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
if [[ -z "$DEFAULT_JAVA_HOME" || ! -x "$DEFAULT_JAVA_HOME/bin/java" ]]; then
  DEFAULT_JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
fi
JAVA_HOME="${JAVA_HOME:-$DEFAULT_JAVA_HOME}"
AVD_NAME="${AVD_NAME:-Coven_Cave_API_35}"
case "$(uname -m)" in
  arm64) DEFAULT_ANDROID_ABI="arm64-v8a" ;;
  x86_64) DEFAULT_ANDROID_ABI="x86_64" ;;
  *)
    echo "[android] unsupported host architecture: $(uname -m)" >&2
    exit 1
    ;;
esac
SYSTEM_IMAGE="${SYSTEM_IMAGE:-system-images;android-35;google_apis;$DEFAULT_ANDROID_ABI}"

export ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[android] missing $1" >&2
    echo "[android] install Homebrew android-commandlinetools and OpenJDK 21 first" >&2
    exit 1
  }
}

doctor() {
  for tool in java sdkmanager avdmanager adb emulator; do require "$tool"; done
  echo "[android] JAVA_HOME=$JAVA_HOME"
  echo "[android] ANDROID_HOME=$ANDROID_HOME"
  echo "[android] AVD_NAME=$AVD_NAME"
  adb devices -l
}

setup() {
  for tool in java sdkmanager avdmanager; do require "$tool"; done
  echo "[android] JAVA_HOME=$JAVA_HOME"
  echo "[android] ANDROID_HOME=$ANDROID_HOME"
  (yes || true) | sdkmanager --licenses >/dev/null
  sdkmanager \
    "platform-tools" \
    "emulator" \
    "platforms;android-35" \
    "build-tools;35.0.0" \
    "ndk;27.0.11902837" \
    "$SYSTEM_IMAGE"
  if ! avdmanager list avd | grep -Fq "Name: $AVD_NAME"; then
    printf 'no\n' | avdmanager create avd \
      --force \
      --name "$AVD_NAME" \
      --package "$SYSTEM_IMAGE" \
      --device pixel_8
  fi
  (cd "$ROOT" && pnpm exec tauri android init)
}

start() {
  doctor
  if ! adb devices | grep -q '^emulator-.*[[:space:]]device$'; then
    nohup emulator -avd "$AVD_NAME" -no-snapshot -no-boot-anim \
      >"${TMPDIR:-/tmp}/coven-cave-android-emulator.log" 2>&1 &
  fi
  adb wait-for-device
  for _ in {1..120}; do
    [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
    sleep 2
  done
  [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]
  adb devices -l
}

dev() {
  start
  local port
  for port in {3000..3010}; do
    if ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  done
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[android] no free port in 3000..3010" >&2
    exit 1
  fi
  cd "$ROOT"
  exec pnpm exec tauri android dev --no-watch --config \
    "{\"build\":{\"devUrl\":\"http://127.0.0.1:$port\",\"beforeDevCommand\":\"PORT=$port pnpm dev\"}}"
}

case "${1:-doctor}" in
  doctor) doctor ;;
  setup) setup ;;
  start) start ;;
  dev) dev ;;
  *)
    echo "usage: $0 {doctor|setup|start|dev}" >&2
    exit 2
    ;;
esac
