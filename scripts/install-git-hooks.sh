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
  missing=""
  for hook in pre-commit commit-msg; do
    [ -e "$resolved_current/$hook" ] || missing="$missing $hook"
  done
  if [ -n "$missing" ]; then
    echo "  WARNING missing hook(s):$missing — those guards are NOT running." >&2
    echo "  Add a shim in that directory that execs $FALLBACK_HOOKS/<hook>." >&2
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
git -C "$REPO_ROOT" config merge.beads-jsonl.driver \
  'node scripts/beads-jsonl-merge-driver.mjs "%O" "%A" "%B"'

echo "OK merge.beads-jsonl -> scripts/beads-jsonl-merge-driver.mjs"
