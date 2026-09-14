#!/usr/bin/env bash
# Configure this clone's Git guards and frozen-JSONL merge driver.
# A different hook directory is preserved unless --retire-beads explicitly
# selects the unchanged legacy hooks shipped in this checkout's HEAD.
set -euo pipefail

retire_beads=false
case "$#" in
  0) ;;
  1)
    if [ "$1" != "--retire-beads" ]; then
      echo "ERROR: unknown option: $1; usage: $0 [--retire-beads]" >&2
      exit 2
    fi
    retire_beads=true
    ;;
  *)
    echo "ERROR: usage: $0 [--retire-beads]" >&2
    exit 2
    ;;
esac

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

retiring=false
if [ "$retire_beads" = true ] && [ -n "$resolved_current" ] \
   && [ "$resolved_current" != "$REPO_ROOT/$FALLBACK_HOOKS" ]; then
  # Linked worktrees share config with the primary checkout, whose absolute
  # .beads/hooks path may still be selected.
  common_git=$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)
  primary_root=$(cd "$common_git/.." && pwd -P)
  if [ ! -d "$resolved_current" ] || [ -L "$resolved_current" ]; then
    echo "ERROR: --retire-beads refuses a missing or symlink hook directory: $current" >&2
    exit 2
  fi
  resolved_current=$(cd "$resolved_current" && pwd -P)
  if [ "$resolved_current" != "$REPO_ROOT/.beads/hooks" ] \
     && [ "$resolved_current" != "$primary_root/.beads/hooks" ]; then
    echo "ERROR: --retire-beads refuses an unrecognized hook directory: $current" >&2
    exit 2
  fi
  shopt -s nullglob dotglob
  for file in "$resolved_current"/*; do
    hook=$(basename "$file")
    case "$hook" in
      pre-commit|commit-msg|post-checkout|post-merge|pre-push|prepare-commit-msg) ;;
      *)
        echo "ERROR: custom hook entry would be disabled: $file; leaving hooks unchanged" >&2
        exit 2
        ;;
    esac
    if [ ! -f "$file" ] || [ -L "$file" ]; then
      echo "ERROR: custom hook entry is not a regular file: $file" >&2
      exit 2
    fi
    if ! expected=$(git -C "$REPO_ROOT" rev-parse --verify "HEAD:.beads/hooks/$hook"); then
      echo "ERROR: no committed legacy hook to compare: $hook" >&2
      exit 2
    fi
    actual=$(git -C "$REPO_ROOT" hash-object -- "$file")
    if [ "$actual" != "$expected" ]; then
      echo "ERROR: modified legacy hook would be disabled: $file; leaving hooks unchanged" >&2
      exit 2
    fi
  done
  retiring=true
fi

# Resolve a real executable before changing config. GitHub Desktop's minimal
# PATH cannot reliably find a bare node; functions and aliases are not binaries.
node_bin=$(command -v node || true)
if [ -n "$node_bin" ] && [ ! -f "$node_bin" ]; then
  node_bin=""
fi
if [ -n "$node_bin" ]; then
  case "$node_bin" in
    /*) ;;
    *) node_bin=$(cd "$(dirname "$node_bin")" && pwd)/$(basename "$node_bin") ;;
  esac
fi
if [ -z "$node_bin" ] || [ ! -x "$node_bin" ]; then
  echo "ERROR: node not found as an executable file; cannot install a GUI-safe merge driver" >&2
  exit 1
fi

chmod +x "$REPO_ROOT/$FALLBACK_HOOKS/pre-commit" "$REPO_ROOT/$FALLBACK_HOOKS/commit-msg"

if [ "$retiring" = false ] && [ -n "$resolved_current" ] \
   && [ -d "$resolved_current" ] && [ "$resolved_current" != "$REPO_ROOT/$FALLBACK_HOOKS" ]; then
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
  if [ "$retiring" = true ]; then
    echo "RETIRE recognized Beads hooks -> $FALLBACK_HOOKS (legacy files retained)"
  else
    echo "OK core.hooksPath -> $FALLBACK_HOOKS"
  fi
fi

# Preserve the pure merge driver for frozen data. It never invokes Beads or Dolt.
git -C "$REPO_ROOT" config merge.beads-jsonl.name \
  "union .beads/interactions.jsonl by record id (cave-1poit)"
git -C "$REPO_ROOT" config merge.beads-jsonl.driver \
  "\"$node_bin\" scripts/beads-jsonl-merge-driver.mjs \"%O\" \"%A\" \"%B\""
echo "OK merge.beads-jsonl -> scripts/beads-jsonl-merge-driver.mjs ($node_bin)"
