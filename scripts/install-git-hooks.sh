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

echo "✓ core.hooksPath -> scripts/git-hooks"
echo "  installed hooks: $(ls "$HOOKS_DIR" | xargs)"
