#!/usr/bin/env bash
# Install this clone's local git configuration: the hook path and the
# .beads/*.jsonl merge driver. Neither can be committed — both live in
# .git/config, which is per-clone.
#
# Idempotent. Run once per fresh clone:
#     scripts/install-git-hooks.sh
#
# cave-7g7py: this script used to set core.hooksPath unconditionally. Clones
# point it at .beads/hooks (bd sets it there), and .beads/hooks holds strictly
# more than scripts/git-hooks — beads' post-checkout/post-merge/pre-push/
# prepare-commit-msg, plus the duplicate-id guard from #4231 that
# scripts/git-hooks/pre-commit does not carry. Overwriting the path therefore
# DISABLED all of those. The script advertised as the way to activate the
# duplicate-prevention merge driver was removing the duplicate-detection hook
# in the same breath.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
FALLBACK_HOOKS="scripts/git-hooks"

if [ ! -d "$REPO_ROOT/$FALLBACK_HOOKS" ]; then
  echo "$FALLBACK_HOOKS not found — run from a coven-cave clone" >&2
  exit 1
fi

# Git GUI clients may launch merge drivers with a minimal PATH that cannot
# resolve the Node selected by the developer's shell. Persist that executable
# now rather than relying on the future Git process to find `node` by name.
NODE_EXECUTABLE=$(command -v node 2>/dev/null || true)
if [ -z "$NODE_EXECUTABLE" ] || [ ! -x "$NODE_EXECUTABLE" ]; then
  echo "could not resolve an executable Node.js binary — install Node or add it to PATH" >&2
  exit 1
fi
case "$NODE_EXECUTABLE" in
  /*) ;;
  *)
    node_dir=${NODE_EXECUTABLE%/*}
    node_name=${NODE_EXECUTABLE##*/}
    if [ "$node_dir" = "$NODE_EXECUTABLE" ]; then
      node_dir=.
    fi
    NODE_EXECUTABLE="$(cd "$node_dir" && pwd -P)/$node_name"
    ;;
esac

# Quote one argv token for the shell Git uses to execute a merge driver.
# Single quotes preserve spaces on macOS/Linux and in Git for Windows' shell;
# embedded apostrophes are closed, escaped, and reopened.
shell_quote() {
  local value=$1
  value=${value//\'/\'\\\'\'}
  printf "'%s'" "$value"
}

chmod +x "$REPO_ROOT/$FALLBACK_HOOKS"/* 2>/dev/null || true
chmod +x "$REPO_ROOT/.beads/hooks"/* 2>/dev/null || true

current=$(git -C "$REPO_ROOT" config --get core.hooksPath || true)

# Compare resolved paths: bd writes an ABSOLUTE hooksPath, so a string compare
# against ".beads/hooks" would miss it and clobber the very thing this guard
# exists to protect.
resolved_current=""
if [ -n "$current" ]; then
  case "$current" in
    /*) resolved_current="$current" ;;
    *)  resolved_current="$REPO_ROOT/$current" ;;
  esac
fi

if [ -n "$resolved_current" ] && [ -d "$resolved_current" ] \
   && [ "$resolved_current" != "$REPO_ROOT/$FALLBACK_HOOKS" ]; then
  echo "KEEP core.hooksPath -> $current"
  echo "  left alone: it already points at a hook directory, and replacing it"
  echo "  would silently disable every hook living there (cave-7g7py)."
  echo "  hooks present: $(ls "$resolved_current" 2>/dev/null | xargs)"
  # -x, not -e: git only runs a hook that is EXECUTABLE. A present but
  # non-executable file is exactly the silent no-op this script exists to
  # surface, so treat it as a distinct, louder case rather than "fine".
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
    echo "  WARNING missing hook(s):$missing — those guards are NOT running." >&2
    echo "  Add a shim in that directory that execs $FALLBACK_HOOKS/<hook>." >&2
  fi
  if [ -n "$not_exec" ]; then
    echo "  WARNING non-executable hook(s):$not_exec — present but git will NOT run them." >&2
    echo "  Fix with: chmod +x $resolved_current/<hook>" >&2
  fi
else
  git -C "$REPO_ROOT" config core.hooksPath "$FALLBACK_HOOKS"
  echo "OK core.hooksPath -> $FALLBACK_HOOKS"
  echo "  installed hooks: $(ls "$REPO_ROOT/$FALLBACK_HOOKS" | xargs)"
fi

# cave-1poit: register the .beads/interactions.jsonl merge driver named in
# .gitattributes. Runs unconditionally — it is independent of the hook path,
# and the hook decision above must never determine whether the driver gets
# installed. Until it is registered git falls back to the default text merge:
# a divergent append conflicts loudly instead of silently duplicating records,
# which is the correct direction to fail.
git -C "$REPO_ROOT" config merge.beads-jsonl.name \
  "union .beads/interactions.jsonl by record id (cave-1poit)"
# %O/%A/%B are quoted as defence in depth. Measured behaviour is that git
# substitutes relative, space-free temp names, so this is not load-bearing —
# see the note in scripts/beads-jsonl-merge-driver.mjs before "fixing" it.
quoted_node=$(shell_quote "$NODE_EXECUTABLE")
quoted_driver=$(shell_quote "scripts/beads-jsonl-merge-driver.mjs")
git -C "$REPO_ROOT" config merge.beads-jsonl.driver \
  "$quoted_node $quoted_driver \"%O\" \"%A\" \"%B\""

echo "OK merge.beads-jsonl -> $NODE_EXECUTABLE scripts/beads-jsonl-merge-driver.mjs"
