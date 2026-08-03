#!/usr/bin/env bash
# Point this clone's git hooks at scripts/git-hooks so the tracked
# pre-commit secret scanner runs locally.
#
# Idempotent. Run once per fresh clone:
#     scripts/install-git-hooks.sh
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOKS_DIR="$REPO_ROOT/scripts/git-hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "scripts/git-hooks not found — run from a coven-cave clone" >&2
  exit 1
fi

chmod +x "$HOOKS_DIR"/* 2>/dev/null || true
git -C "$REPO_ROOT" config core.hooksPath scripts/git-hooks

echo "OK core.hooksPath -> scripts/git-hooks"
echo "  installed hooks: $(ls "$HOOKS_DIR" | xargs)"

# cave-1poit: register the .beads/interactions.jsonl merge driver named in
# .gitattributes. A merge driver's implementation lives in git config, which is
# per-clone and cannot be committed, so this has to be installed rather than
# checked in. Until it is, git falls back to the default text merge — a
# divergent append conflicts loudly instead of silently duplicating records,
# which is the correct direction to fail.
git -C "$REPO_ROOT" config merge.beads-jsonl.name \
  "union .beads/interactions.jsonl by record id (cave-1poit)"
git -C "$REPO_ROOT" config merge.beads-jsonl.driver \
  "node scripts/beads-jsonl-merge-driver.mjs %O %A %B"

echo "OK merge.beads-jsonl -> scripts/beads-jsonl-merge-driver.mjs"
