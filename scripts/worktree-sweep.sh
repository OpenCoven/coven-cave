#!/bin/bash
# Scheduled worktree lifecycle sweep.
#
# Runs the lifecycle tool directly. The tool owns the retirement guard rails:
# cooldown, dirty-state and live-process checks, retention proof, the maintenance
# fence, and the bounded retirement count. Do not put an unattended LLM between
# this wrapper and that policy: lifecycle inventory contains untrusted text from
# filenames and repository metadata.
#
# Machine-specific wiring — the launchd plist and, on macOS, an app bundle that
# holds the Full Disk Access grant — stays out of the repo.
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
# is a live sweep of the whole repository, not a scoped one. Set SWEEP_REPO
# deliberately when invoking it outside the scheduled primary checkout.
REPO="${SWEEP_REPO:-$(cd "$script_dir/.." && pwd -P)}"
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

cd "$REPO" || { echo "[sweep] ABORT: cannot cd to $REPO"; exit 1; }

# A scheduler does not source a login profile.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[sweep] ABORT: pnpm not on PATH"
  exit 1
fi

# Filesystem-permission preflight. On macOS a scheduled job gets no access to a
# protected directory (~/Documents and friends) unless the launching binary has
# been granted it. Without this check the symptom is subtle: `cd` succeeds, then
# every git call fails and the lifecycle command runs against an empty view of
# the repository — which looks exactly like "nothing to retire".
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "[sweep] ABORT: cannot read the git repository at $REPO."
  echo "[sweep] On macOS this is usually a Full Disk Access gap: scheduled jobs"
  echo "[sweep] get no access to protected folders. Grant it to whatever binary"
  echo "[sweep] the scheduler launches, then rerun."
  notify "Worktree sweep FAILED" "Cannot read the repo — the sweep is doing nothing."
  exit 1
fi

# Refresh remote-tracking refs BEFORE the lifecycle tool builds its inventory.
#
# The inventory compares refs/remotes/origin/main against the authoritative ref
# on the remote, and a mismatch is a probe error stamped on EVERY unit, which
# pushes all of them out of the retirable lanes. So one stale tracking ref
# degrades the whole sweep to a no-op — and to a no-op that reads as healthy,
# because "no change (39 -> 39)" looks exactly like a sweep with nothing to do.
#
# This was not an occasional race. The wrapper never fetched, so it read
# whatever tracking refs the checkout happened to hold, and on a repository
# this busy those go stale within minutes of any human `git pull <refspec>` —
# which moves refs/heads/main without necessarily syncing the tracking ref.
# Four consecutive scheduled runs on 2026-08-11 retired nothing with units
# sitting past their cooldowns, and a single `git fetch --prune origin` fixed
# it immediately.
#
# Deliberately a fetch and NOT a fast-forward of local main: other sessions
# share this checkout, and moving their branch under them is not the scheduled
# job's business. Only the tracking ref has to be current.
#
# Tags come along on purpose — `--prune` drops stale remote-tracking branches,
# but retention proof reads pushed archive tags, so this must not use
# --no-tags or --prune-tags.
echo "[sweep] fetching remote-tracking refs from origin"
fetch_failed=""
if ! git fetch --prune --quiet origin; then
  fetch_failed=1
  echo "[sweep] WARNING: git fetch failed. The inventory will compare a stale"
  echo "[sweep] tracking ref against the remote and is likely to stamp a probe"
  echo "[sweep] error on every unit, retiring nothing. Treat any 'no change'"
  echo "[sweep] below as unproven rather than as a clean sweep."
fi
echo "[sweep] main: local $(git rev-parse --short refs/heads/main 2>/dev/null), tracking $(git rev-parse --short refs/remotes/origin/main 2>/dev/null)"

before=$(git worktree list | wc -l | tr -d ' ')
echo "[sweep] repo: $REPO"
echo "[sweep] repo HEAD: $(git rev-parse --short HEAD 2>/dev/null) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "[sweep] registered worktrees: $before"
echo "[sweep] --- lifecycle apply output follows ---"
# The lifecycle command performs its own complete inventory and retires only
# cleanup-ready units. The explicit override is audited by the command; the
# local maintenance plane remains enforced. Keep the blast radius bounded.
pnpm beads:worktrees:apply --allow-unenforced-planes --max-retire 3
status=$?

after=$(git worktree list | wc -l | tr -d ' ')
echo "[sweep] --- lifecycle apply exited with status $status ---"
echo "[sweep] worktrees remaining: $after"

# Count the worktrees here rather than trusting command output — a
# retirement is a filesystem fact, not a claim.
# A non-zero exit always notifies, including incomplete inventory caused by a
# transient GitHub failure. It must never look like a successful no-op.
if [[ "$status" -ne 0 ]]; then
  notify "Worktree sweep errored" "Lifecycle apply exited $status. Check the log."
elif [[ "$after" -lt "$before" ]]; then
  notify "Worktree sweep: $(( before - after )) retired" \
    "$before -> $after worktrees. Log: $LOG"
elif [[ -n "$fetch_failed" ]]; then
  # A no-op after a failed fetch is the exact state this wrapper used to report
  # as healthy: the tool exits 0 having refused every unit over a tracking ref
  # nothing refreshed. Say so, because silence here is indistinguishable from a
  # sweep that genuinely had nothing to do.
  echo "[sweep] no change ($before -> $after) but the fetch failed; result is unproven"
  notify "Worktree sweep: result unproven" \
    "git fetch failed, so nothing was retired on possibly stale refs. Log: $LOG"
else
  echo "[sweep] no change ($before -> $after); no notification sent"
fi

echo "[sweep] end $(date -Iseconds)"
exit "$status"
