/**
 * Deciding whether a bead's worktree record may be cleared (cave-xbc87).
 *
 * Hand-retiring a worktree leaves the owning bead's `metadata.coven.worktree`
 * record behind, still claiming a path that no longer exists. That is not
 * cosmetic: `worktree-lifecycle-create` refuses a bead whose primary record
 * names an unregistered path, so the bead can never get another worktree
 * (reproduced 2026-08-10 on cave-58eoq.4). And because
 * `beads:worktrees:apply` is unreachable while three maintenance planes are
 * unenforced (cave-3aqvr), hand-retirement is the only route available — so
 * every retirement leaks a record.
 *
 * The repository rules are emphatic that lifecycle metadata is not to be
 * hand-edited: that record is the evidence the retirement gate reads, and
 * forging one is the bypass the guard exists to prevent (cave-l52dt). Clearing
 * a record whose worktree provably does not exist is the opposite operation —
 * it removes a false claim rather than fabricating a true-looking one — but
 * only if "provably" is enforced rather than asserted. That is this module's
 * entire job, kept pure so it can be tested exhaustively without a repository.
 *
 * The refusal is deliberately asymmetric. Clearing a record for a worktree that
 * still exists would strand a live unit outside the lifecycle system, where no
 * patrol would ever see it again. Failing to clear a genuinely dead record only
 * costs an error message. So every ambiguous case refuses.
 */

export type WorktreeRecordClearanceInput = {
  /** The bead's primary record, or null when it holds none. */
  record: { path?: unknown; branch?: unknown; disposition?: unknown } | null;
  /** Absolute paths git currently reports as registered worktrees. */
  registeredPaths: readonly string[];
  /** Whether the record's path currently exists on disk, in any form. */
  pathExistsOnDisk: boolean;
  /** Who is asking. Recorded so a cleared record is attributable. */
  owner: string;
  /** Why. Recorded for the same reason. */
  reason: string;
};

export type WorktreeRecordClearance =
  | { ok: true; clearedPath: string }
  | { ok: false; code: ClearanceRefusal; diagnostic: string };

export type ClearanceRefusal =
  | "no-record"
  | "malformed-record"
  | "worktree-still-registered"
  | "path-still-present"
  | "unattributed";

/** Normalises a path for comparison without resolving symlinks (callers pass real paths). */
function trimTrailingSeparators(value: string): string {
  return value.replace(/[/\\]+$/, "");
}

export function assessWorktreeRecordClearance(
  input: WorktreeRecordClearanceInput,
): WorktreeRecordClearance {
  const owner = typeof input.owner === "string" ? input.owner.trim() : "";
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (owner.length === 0 || reason.length === 0) {
    return {
      ok: false,
      code: "unattributed",
      diagnostic:
        "clearing a lifecycle record requires --owner and --reason: an unattributed clearance is indistinguishable from the forging this gate exists to prevent",
    };
  }

  if (input.record === null || input.record === undefined) {
    return {
      ok: false,
      code: "no-record",
      diagnostic: "this Bead holds no worktree record, so there is nothing to clear",
    };
  }

  const path = input.record.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    // A record naming no usable path cannot be proven dead — there is nothing
    // to check against git. Refusing keeps this command from becoming a way to
    // delete records that merely look inconvenient.
    return {
      ok: false,
      code: "malformed-record",
      diagnostic:
        "the record names no usable path, so its worktree cannot be proven absent; repair it deliberately rather than clearing it blindly",
    };
  }

  const recordPath = trimTrailingSeparators(path);
  const registered = input.registeredPaths.map(trimTrailingSeparators);
  if (registered.includes(recordPath)) {
    return {
      ok: false,
      code: "worktree-still-registered",
      diagnostic:
        `git still reports ${recordPath} as a registered worktree; clearing its record would strand a live unit outside the lifecycle system`,
    };
  }

  if (input.pathExistsOnDisk) {
    // Unregistered but present means something is there that git does not know
    // about — an unmanaged fallback worktree, or debris. Either way it is not
    // this command's business, and removing the record would hide it.
    return {
      ok: false,
      code: "path-still-present",
      diagnostic:
        `${recordPath} still exists on disk even though git does not register it; investigate before clearing, because the record is the only remaining pointer to it`,
    };
  }

  return { ok: true, clearedPath: recordPath };
}
