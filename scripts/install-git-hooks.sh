#!/usr/bin/env bash
# Point this clone's Git hooks at the tracked secret and attribution guards.
# A different, existing hook directory is preserved: replacing it would
# disable hooks this installer does not own. A configured directory that no
# longer exists (such as the removed .beads/hooks) is replaced.
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo "ERROR: usage: $0" >&2
  exit 2
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
REPO_ROOT=$(cd "$REPO_ROOT" && pwd -P)
FALLBACK_HOOKS="scripts/git-hooks"

for hook in pre-commit commit-msg; do
  if [ ! -f "$REPO_ROOT/$FALLBACK_HOOKS/$hook" ] || [ -L "$REPO_ROOT/$FALLBACK_HOOKS/$hook" ]; then
    echo "ERROR: $FALLBACK_HOOKS/$hook must be a regular, non-symlink guard" >&2
    exit 1
  fi
done

if current=$(git -C "$REPO_ROOT" config --get core.hooksPath); then
  :
else
  status=$?
  if [ "$status" -ne 1 ]; then
    echo "ERROR: cannot read core.hooksPath" >&2
    exit "$status"
  fi
fi

resolved_current=""
if [ -n "$current" ]; then
  case "$current" in
    /*|[A-Za-z]:[\\/]*) resolved_current="$current" ;;
    *) resolved_current="$REPO_ROOT/$current" ;;
  esac
fi

chmod +x "$REPO_ROOT/$FALLBACK_HOOKS/pre-commit" "$REPO_ROOT/$FALLBACK_HOOKS/commit-msg"

if [ -n "$resolved_current" ] && [ -d "$resolved_current" ] \
   && [ "$resolved_current" != "$REPO_ROOT/$FALLBACK_HOOKS" ]; then
  echo "KEEP core.hooksPath -> $current"
  echo "  replacing it would disable hooks this installer does not own."
  missing=""
  not_exec=""
  for hook in pre-commit commit-msg; do
    if [ ! -e "$resolved_current/$hook" ]; then
      missing="$missing $hook"
    elif [ ! -x "$resolved_current/$hook" ]; then
      not_exec="$not_exec $hook"
    fi
  done
  if [ -n "$missing" ]; then
    echo "  WARNING missing hook(s):$missing; those guards are NOT running." >&2
    echo "  Add a shim that execs $FALLBACK_HOOKS/<hook>." >&2
  fi
  if [ -n "$not_exec" ]; then
    echo "  WARNING non-executable hook(s):$not_exec; Git will NOT run them." >&2
    echo "  Fix with: chmod +x $resolved_current/<hook>" >&2
  fi
else
  git -C "$REPO_ROOT" config core.hooksPath "$FALLBACK_HOOKS"
  echo "OK core.hooksPath -> $FALLBACK_HOOKS"
fi

# Clones configured before Beads was removed still name its JSONL merge
# driver, whose script no longer exists. Drop that stale section.
if git -C "$REPO_ROOT" config --get-regexp '^merge\.beads-jsonl\.' >/dev/null 2>&1; then
  git -C "$REPO_ROOT" config --remove-section merge.beads-jsonl
  echo "REMOVED stale merge.beads-jsonl driver config"
fi
