#!/usr/bin/env bash
# Comprehensive CovenCave app uninstaller.
#
# Dry-run by default. Pass --execute to actually remove app artifacts.
# Pass --with-coven-home only when you also want to remove daemon/user data.
# Pass --copy-diagnostics to copy a support-ready report after the run.

set -euo pipefail

APP_NAME="CovenCave"
APP_ID="ai.opencoven.cave"
LEGACY_APP_ID="com.opencoven.cave"
EXECUTE=0
WITH_COVEN_HOME=0
COPY_DIAGNOSTICS=0
DIAGNOSTICS_FILE="${COVEN_CAVE_UNINSTALL_DIAGNOSTICS:-}"
UNINSTALL_STEP_TIMEOUT_SECONDS="${UNINSTALL_STEP_TIMEOUT_SECONDS:-8}"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/uninstall-app.sh [--execute] [--with-coven-home] [--copy-diagnostics] [--diagnostics PATH]

Default mode is a dry run.

Removes CovenCave application artifacts:
  - installed app bundles / desktop entries
  - Tauri app support, cache, WebKit, preferences, saved state
  - CovenCave sidecar logs
  - mobile Tailscale runner state
  - known launch-agent entries and plists

By default this preserves ~/.coven because it contains OpenCoven daemon data
such as familiars, sessions, memory, and project state. Add --with-coven-home
to remove it too.

Diagnostics are always written. If an uninstall step hangs, the step is killed
after UNINSTALL_STEP_TIMEOUT_SECONDS (default: 8) and the timeout is recorded.
Use --copy-diagnostics to copy the report to your clipboard for support.
USAGE
}

while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --execute) EXECUTE=1 ;;
    --with-coven-home) WITH_COVEN_HOME=1 ;;
    --copy-diagnostics) COPY_DIAGNOSTICS=1 ;;
    --diagnostics)
      shift
      if [[ $# -eq 0 || -z "${1:-}" ]]; then
        echo "--diagnostics requires a path" >&2
        exit 2
      fi
      DIAGNOSTICS_FILE="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$DIAGNOSTICS_FILE" ]]; then
  DIAGNOSTICS_FILE="${TMPDIR:-/tmp}/covencave-uninstall-diagnostics-$(date +%Y%m%d-%H%M%S).log"
fi
mkdir -p "$(dirname "$DIAGNOSTICS_FILE")"
: >"$DIAGNOSTICS_FILE"

log() {
  printf '%s\n' "$*"
  printf '%s\n' "$*" >>"$DIAGNOSTICS_FILE"
}

format_command() {
  local out=""
  local part
  for part in "$@"; do
    printf -v part '%q' "$part"
    out="${out}${out:+ }${part}"
  done
  printf '%s' "$out"
}

run_bounded() {
  local command_text
  command_text="$(format_command "$@")"
  log "RUN: $command_text"

  "$@" >>"$DIAGNOSTICS_FILE" 2>&1 &
  local pid=$!
  local start
  start="$(date +%s)"
  local now

  while kill -0 "$pid" 2>/dev/null; do
    now="$(date +%s)"
    if (( now - start >= UNINSTALL_STEP_TIMEOUT_SECONDS )); then
      log "command timed out after ${UNINSTALL_STEP_TIMEOUT_SECONDS}s: $command_text"
      kill "$pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 0.1
  done

  local status=0
  if wait "$pid"; then
    status=0
  else
    status=$?
  fi
  log "EXIT ${status}: $command_text"
  return "$status"
}

run() {
  if [[ "$EXECUTE" == "1" ]]; then
    run_bounded "$@"
  else
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    printf 'DRY-RUN:' >>"$DIAGNOSTICS_FILE"
    printf ' %q' "$@" >>"$DIAGNOSTICS_FILE"
    printf '\n' >>"$DIAGNOSTICS_FILE"
  fi
}

copy_diagnostics() {
  if [[ ! -s "$DIAGNOSTICS_FILE" ]]; then
    log "Diagnostics file is empty: $DIAGNOSTICS_FILE"
    return 1
  fi

  local helper
  if command -v pbcopy >/dev/null 2>&1; then
    helper="$(command -v pbcopy)"
    run_bounded bash -c 'cat "$1" | "$2"' _ "$DIAGNOSTICS_FILE" "$helper" || return 1
  elif command -v clip.exe >/dev/null 2>&1; then
    helper="$(command -v clip.exe)"
    run_bounded bash -c 'cat "$1" | "$2"' _ "$DIAGNOSTICS_FILE" "$helper" || return 1
  elif command -v wl-copy >/dev/null 2>&1; then
    helper="$(command -v wl-copy)"
    run_bounded bash -c 'cat "$1" | "$2"' _ "$DIAGNOSTICS_FILE" "$helper" || return 1
  elif command -v xclip >/dev/null 2>&1; then
    helper="$(command -v xclip)"
    run_bounded bash -c 'cat "$1" | "$2" -selection clipboard' _ "$DIAGNOSTICS_FILE" "$helper" || return 1
  elif command -v xsel >/dev/null 2>&1; then
    helper="$(command -v xsel)"
    run_bounded bash -c 'cat "$1" | "$2" --clipboard --input' _ "$DIAGNOSTICS_FILE" "$helper" || return 1
  else
    log "No clipboard helper found. Copy diagnostics manually from: $DIAGNOSTICS_FILE"
    return 1
  fi

  log "Diagnostics copied to clipboard."
}

remove_path() {
  local target="$1"
  [[ -n "$target" ]] || return 0
  if [[ -e "$target" || -L "$target" ]]; then
    run rm -rf "$target" || log "warning: failed or timed out removing $target"
  else
    log "skip missing: $target"
  fi
}

forget_launch_agent() {
  local label="$1"
  local plist="$2"

  if command -v launchctl >/dev/null 2>&1; then
    run launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    run launchctl remove "$label" 2>/dev/null || true
  fi
  remove_path "$plist"
}

remove_macos_artifacts() {
  local home="$HOME"
  log "Uninstalling macOS CovenCave artifacts..."

  local app_paths="${COVEN_CAVE_UNINSTALL_APP_PATHS:-/Applications/${APP_NAME}.app:${home}/Applications/${APP_NAME}.app}"
  local app_path
  while IFS= read -r app_path; do
    remove_path "$app_path"
  done < <(printf '%s' "$app_paths" | tr ':' '\n')

  remove_path "${home}/Library/Application Support/${APP_ID}"
  remove_path "${home}/Library/Application Support/${APP_NAME}"
  remove_path "${home}/Library/Caches/${APP_ID}"
  remove_path "${home}/Library/Caches/${APP_NAME}"
  remove_path "${home}/Library/WebKit/${APP_ID}"
  remove_path "${home}/Library/HTTPStorages/${APP_ID}"
  remove_path "${home}/Library/Saved Application State/${APP_ID}.savedState"
  remove_path "${home}/Library/Preferences/${APP_ID}.plist"
  remove_path "${home}/Library/Preferences/${LEGACY_APP_ID}.plist"
  remove_path "${home}/Library/Logs/${APP_NAME}"

  forget_launch_agent "$APP_ID" "${home}/Library/LaunchAgents/${APP_ID}.plist"
  forget_launch_agent "$LEGACY_APP_ID" "${home}/Library/LaunchAgents/${LEGACY_APP_ID}.plist"
  forget_launch_agent "com.opencoven.CovenCave" "${home}/Library/LaunchAgents/com.opencoven.CovenCave.plist"
}

remove_linux_artifacts() {
  local home="$HOME"
  local data_home="${XDG_DATA_HOME:-${home}/.local/share}"
  local config_home="${XDG_CONFIG_HOME:-${home}/.config}"
  local cache_home="${XDG_CACHE_HOME:-${home}/.cache}"
  log "Uninstalling Linux CovenCave artifacts..."

  remove_path "${data_home}/applications/${APP_ID}.desktop"
  remove_path "${data_home}/applications/${APP_NAME}.desktop"
  remove_path "${data_home}/icons/hicolor/32x32/apps/${APP_ID}.png"
  remove_path "${data_home}/icons/hicolor/128x128/apps/${APP_ID}.png"
  remove_path "${data_home}/${APP_ID}"
  remove_path "${data_home}/${APP_NAME}"
  remove_path "${config_home}/${APP_ID}"
  remove_path "${config_home}/${APP_NAME}"
  remove_path "${cache_home}/${APP_ID}"
  remove_path "${cache_home}/${APP_NAME}"
}

remove_windows_artifacts() {
  log "Uninstalling Windows CovenCave artifacts..."

  local local_appdata="${LOCALAPPDATA:-}"
  local appdata="${APPDATA:-}"
  local programdata="${PROGRAMDATA:-}"
  local userprofile="${USERPROFILE:-}"

  if [[ -n "$local_appdata" ]]; then
    remove_path "${local_appdata}/Programs/${APP_NAME}"
    remove_path "${local_appdata}/${APP_ID}"
  else
    log "skip: LOCALAPPDATA is not set"
  fi

  if [[ -n "$appdata" ]]; then
    remove_path "${appdata}/${APP_ID}"
    remove_path "${appdata}/${APP_NAME}"
  else
    log "skip: APPDATA is not set"
  fi

  if [[ -n "$programdata" ]]; then
    remove_path "${programdata}/Microsoft/Windows/Start Menu/Programs/${APP_NAME}.lnk"
  else
    log "skip: PROGRAMDATA is not set"
  fi

  if [[ -n "$userprofile" ]]; then
    remove_path "${userprofile}/Desktop/${APP_NAME}.lnk"
  else
    log "skip: USERPROFILE is not set"
  fi
}

remove_shared_artifacts() {
  local home="$HOME"
  local state_home="${XDG_STATE_HOME:-${home}/.local/state}"

  remove_path "${state_home}/coven-cave"
  remove_path "${TMPDIR:-/tmp}/covencave-webview-probe.log"
  remove_path "${TMPDIR:-/tmp}/coven-cave-attachments"

  if [[ "$WITH_COVEN_HOME" == "1" ]]; then
    remove_path "${COVEN_HOME:-${home}/.coven}"
  else
    log "preserve: ${COVEN_HOME:-${home}/.coven} (pass --with-coven-home to remove daemon/user data)"
  fi
}

if [[ "$EXECUTE" == "1" ]]; then
  log "Running CovenCave uninstall."
else
  log "Dry run. Re-run with --execute to remove these artifacts."
fi
log "Diagnostics: $DIAGNOSTICS_FILE"
log "Mode: execute=$EXECUTE with_coven_home=$WITH_COVEN_HOME timeout=${UNINSTALL_STEP_TIMEOUT_SECONDS}s ostype=${OSTYPE:-unknown}"

case "${OSTYPE:-}" in
  darwin*) remove_macos_artifacts ;;
  linux*) remove_linux_artifacts ;;
  msys*|cygwin*|win32*) remove_windows_artifacts ;;
  *)
    log "Unknown platform '${OSTYPE:-unknown}'; running shared cleanup only."
    ;;
esac

remove_shared_artifacts

if [[ "$EXECUTE" == "1" ]]; then
  log "CovenCave uninstall complete."
else
  log "Dry run complete; no files were removed."
fi

if [[ "$COPY_DIAGNOSTICS" == "1" ]]; then
  copy_diagnostics || true
fi
