#!/bin/bash
# Tombstone for externally installed schedules. Refuse before any mutation.
set -euo pipefail

printf '%s\n' \
  "worktree-sweep: retired by issue #5399; no tracker or Git operation was attempted." \
  "Remove the external schedule. Use docs/workflows/github-work-tracking.md for bounded, authorized retirement." >&2
exit 2
