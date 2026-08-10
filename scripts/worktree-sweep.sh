#!/bin/bash
# Scheduled worktree lifecycle sweep.
#
# Drives a real agent rather than scripting `git worktree remove` directly, and
# that is deliberate. Deciding whether a worktree is retirable needs judgement
# the guard rails encode: is the unit in cooldown, does it hold uncommitted
# work, is another live session sitting in it, are its commits reachable from
# any remote ref. A blind script removing `cleanup-ready` units would sooner or
# later destroy live work — which is what happened on 2026-07-03.
#
# The agent's instructions live in worktree-sweep-prompt.md beside this file.
# Both are versioned here rather than only on one machine, because the prompt
# carries the retirement discipline (the --max-retire bound, why a held gate is
# not a reason to fall back to hand-retirement) and that reasoning is worth
# more than the twenty lines of shell around it. See cave-6qzo0.
#
# Machine-specific wiring — the launchd plist and, on macOS, an app bundle that
# holds the Full Disk Access grant — stays out of the repo. See the header of
# worktree-sweep-prompt.md for what that wiring has to provide.
#
# Environment:
#   SWEEP_LOG   override the log path (default: $HOME/.claude/logs/…)
#   SWEEP_REPO  override the repository root (default: this script's checkout)

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Derive the checkout from the script's own location so this works from any
# clone. An explicit override still wins, for a scheduler that copies the
# script elsewhere.
#
# Note this resolves to the *containing* checkout, so invoking the copy inside a
# linked worktree targets that worktree — and `git worktree list` there still
# enumerates every unit in the repository. The scheduled job is pinned to the
# primary checkout, which is what you want; running it by hand from a worktree
# is a live sweep of the whole repository, not a scoped one. Use --dry-run
# semantics by reading the prompt first, or set SWEEP_REPO deliberately.
REPO="${SWEEP_REPO:-$(cd "$script_dir/.." && pwd -P)}"
PROMPT_FILE="$script_dir/worktree-sweep-prompt.md"
LOG="${SWEEP_LOG:-$HOME/.claude/logs/coven-cave-worktree-sweep.log}"
# Keyed by checkout, so two clones on one machine cannot block each other.
LOCK="/tmp/worktree-sweep-$(printf '%s' "$REPO" | shasum | cut -c1-12).lock"

mkdir -p "$(dirname "$LOG")"

# Rotate BEFORE the redirect below. Rotating afterwards would be a no-op that
# looks like it worked: the shell's already-open fd follows the moved inode, so
# every subsequent line lands in the rotated file and the "current" log stays
# empty.
if [[ -f "$LOG" ]] && [[ $(wc -c <"$LOG") -gt 1048576 ]]; then
  mv "$LOG" "$LOG.1"
  rotated=1
fi

exec >>"$LOG" 2>&1
[[ -n "${rotated:-}" ]] && echo "[sweep] rotated previous log to $(basename "$LOG").1"

# Desktop notification, macOS only and best-effort. Deliberately NOT fired on
# the common case: a sweep that correctly retires nothing is the normal outcome,
# and a daily "nothing happened" banner is how a notification earns itself being
# ignored. Only a real retirement or a genuine failure interrupts anyone.
notify() {
  command -v osascript >/dev/null 2>&1 || return 0
  local title="$1" msg="$2"
  osascript -e "display notification \"${msg//\"/\\\"}\" with title \"${title//\"/\\\"}\"" \
    >/dev/null 2>&1 || echo "[sweep] (notification failed; continuing)"
}

echo "=============================================================="
echo "[sweep] start $(date -Iseconds)"

# The lock records its owner's pid, because a bare mkdir lock is a silent-failure
# trap: if a run is SIGKILLed, or the machine sleeps mid-sweep, the EXIT trap
# never fires, the directory persists, and every future run exits 0 saying
# "another sweep holds the lock" — no error, no sweep, forever. A stale lock must
# therefore be reclaimable, and reclaiming it must be loud.
if ! mkdir "$LOCK" 2>/dev/null; then
  owner=$(cat "$LOCK/pid" 2>/dev/null || echo "")
  if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
    echo "[sweep] a live sweep (pid $owner) holds $LOCK; exiting without action"
    exit 0
  fi
  echo "[sweep] STALE lock at $LOCK (owner pid '${owner:-unknown}' is not running) — reclaiming"
  rm -rf "$LOCK"
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "[sweep] ABORT: could not reclaim $LOCK"
    notify "Worktree sweep FAILED" "Could not reclaim a stale lock; the sweep is not running."
    exit 1
  fi
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK" 2>/dev/null' EXIT

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "[sweep] ABORT: prompt file missing at $PROMPT_FILE"
  exit 1
fi
cd "$REPO" || { echo "[sweep] ABORT: cannot cd to $REPO"; exit 1; }

# A scheduler does not source a login profile.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if ! command -v claude >/dev/null 2>&1; then
  echo "[sweep] ABORT: claude CLI not on PATH"
  exit 1
fi

# Filesystem-permission preflight. On macOS a scheduled job gets no access to a
# protected directory (~/Documents and friends) unless the launching binary has
# been granted it. Without this check the symptom is subtle: `cd` succeeds, then
# every git call fails and the agent runs against an empty view of the
# repository — which looks exactly like "nothing to retire".
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[sweep] ABORT: cannot read the git repository at $REPO."
  echo "[sweep] On macOS this is usually a Full Disk Access gap: scheduled jobs"
  echo "[sweep] get no access to protected folders. Grant it to whatever binary"
  echo "[sweep] the scheduler launches, then rerun."
  notify "Worktree sweep FAILED" "Cannot read the repo — the sweep is doing nothing."
  exit 1
fi

before=$(git worktree list | wc -l | tr -d ' ')
echo "[sweep] repo: $REPO"
echo "[sweep] repo HEAD: $(git rev-parse --short HEAD 2>/dev/null) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "[sweep] registered worktrees: $before"
echo "[sweep] --- agent output follows ---"
# Byte offset of the agent's output, so its report can be inspected afterwards
# without teeing (stdout is already redirected to the log).
agent_offset=$(wc -c <"$LOG")

# Tools are scoped deliberately: no Write, no Edit. This job inspects, retires
# worktrees, and closes beads. It has no business editing source files.
claude -p "$(cat "$PROMPT_FILE")" \
  --allowed-tools "Bash,Read,Grep,Glob" \
  --output-format text
status=$?

after=$(git worktree list | wc -l | tr -d ' ')
echo "[sweep] --- agent exited with status $status ---"
echo "[sweep] worktrees remaining: $after"

# A run that never assessed anything must not read as one that assessed and
# found nothing. Both leave the worktree count unchanged, so without this the
# log line and the (absent) notification are identical — which is how a quota
# deferral looked like a clean sweep on 2026-08-10T15:10.
deferred=""
if tail -c "+$((agent_offset + 1))" "$LOG" | grep -q "^SWEEP DEFERRED"; then
  deferred="$(tail -c "+$((agent_offset + 1))" "$LOG" | grep -m1 "^SWEEP DEFERRED")"
fi

# Count the worktrees here rather than trusting the agent's summary — a
# retirement is a filesystem fact, not a claim.
if [[ -n "$deferred" ]]; then
  echo "[sweep] DEFERRED — the patrol did not run: $deferred"
  echo "[sweep] this run assessed nothing; the next scheduled sweep is the retry"
elif [[ "$status" -ne 0 ]]; then
  notify "Worktree sweep errored" "Agent exited $status. Check the log."
elif [[ "$after" -lt "$before" ]]; then
  notify "Worktree sweep: $(( before - after )) retired" \
    "$before -> $after worktrees. Log: $LOG"
else
  echo "[sweep] no change ($before -> $after); no notification sent"
fi

echo "[sweep] end $(date -Iseconds)"
exit "$status"
