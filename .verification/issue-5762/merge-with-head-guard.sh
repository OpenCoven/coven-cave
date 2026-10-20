#!/usr/bin/env bash
set -euo pipefail
pr="$1"
export CAVE_MERGE_EXPECTED_HEAD="$2"
export CAVE_MERGE_BODY_FILE="$3"
export CAVE_MERGE_SUBJECT="$4"
export GH_REPO=OpenCoven/coven-cave
[[ "$CAVE_MERGE_EXPECTED_HEAD" =~ ^[a-f0-9]{40}$ ]]
[[ -f "$CAVE_MERGE_BODY_FILE" ]]
gh() {
  if [[ "${1:-}" == pr && "${2:-}" == merge ]]; then
    command gh "$@" --match-head-commit "$CAVE_MERGE_EXPECTED_HEAD" --subject "$CAVE_MERGE_SUBJECT" --body-file "$CAVE_MERGE_BODY_FILE"
  else
    command gh "$@"
  fi
}
export -f gh
exec bash /Users/buns/.claude/scripts/gh-merge-when-green.sh "$pr" --squash --timeout 1800
