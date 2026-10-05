/**
 * The changes panel's outbound work, kept outside React (#5745).
 *
 * The commit message, the post-commit "Create PR" entry point and the PR's
 * title and body used to be the panel's own state. The panel unmounts off its
 * rail tab, on the narrow steps and behind the full PR reader, so a half-typed
 * message vanished, and so did Create PR after a commit, leaving the desk with
 * no way to open the PR it had just committed for.
 *
 * A commit or a Create PR in flight, and its failure, live here too (#5756):
 * kept in the panel, they were lost when the rail changed tab mid-request, so
 * Commit came back enabled while the first commit was still running, and a
 * failure that landed after the tab change was never shown.
 *
 * Entries are keyed by the host's choice: the Coding Desk keys by session, so
 * a late git enrichment that moves the panel to another root keeps the draft;
 * other hosts key by project root.
 */

export type ChangesOutboundCommit = {
  sha: string;
  /** The full commit id. Create PR names it, so the PR is the reviewed commit. */
  headOid: string;
  branch: string;
  onDefaultBranch: boolean;
};

/**
 * A commit the client stopped waiting for (#5795). Behind the repository lock
 * it can land after the answer was given up on, on a new `cave/` branch, and
 * nothing offered Create PR for it. What it was sent with, so a later change
 * list can tell whether it landed.
 */
export type ChangesOutboundTimedOutCommit = {
  message: string;
  /** The branch it was sent from, as the last change list named it. */
  branch: string | null;
  /** The files it was sent to commit, at the versions reviewed. */
  files: { path: string; changeVersion: string }[];
  /** When the client gave up, ms since the epoch. */
  at: number;
};

/** How long a timed-out commit is watched for (#5795). */
export const TIMED_OUT_COMMIT_WATCH_MS = 10 * 60_000;

/**
 * Did a commit the client gave up on land (#5795)? Told from the change list
 * alone, since nothing else says: none of the files it was sent for is still
 * changed at the version reviewed, and the branch is the one it was sent from
 * or a new `cave/` branch, which is where a commit from the default branch
 * goes. The branch it landed on, and whether it is new; null while it can't
 * be told.
 */
export function timedOutCommitLanded(
  sent: ChangesOutboundTimedOutCommit,
  now: { branch: string | null | undefined; files: readonly { path: string; changeVersion?: string }[] },
): { branch: string; newBranch: boolean } | null {
  if (sent.files.length === 0) return null;
  const still = new Set(now.files.map((file) => `${file.path}\0${file.changeVersion ?? ""}`));
  if (sent.files.some((file) => still.has(`${file.path}\0${file.changeVersion}`))) return null;
  const branch = now.branch ?? "";
  if (!branch || branch === "HEAD") return null;
  if (sent.branch && branch === sent.branch) return { branch, newBranch: false };
  if (branch !== sent.branch && branch.startsWith("cave/")) return { branch, newBranch: true };
  return null;
}

export type ChangesOutbound = {
  commitMessage: string;
  postCommit: ChangesOutboundCommit | null;
  prOpen: boolean;
  prTitle: string;
  prBody: string;
  prUrl: string | null;
  /** Create PR found a pull request already open for the branch (#5795). */
  prExisted: boolean;
  /** The request in flight, if any. */
  pending: "commit" | "create-pr" | null;
  /** Why the last commit or Create PR failed. */
  error: { action: string; message: string } | null;
  /** What went wrong after the last commit landed (#5795): a hook after it
   *  that was cut off, say. Kept until dismissed or the next commit. */
  commitWarning: string | null;
  /** A commit the client stopped waiting for, watched for in case it lands. */
  timedOutCommit: ChangesOutboundTimedOutCommit | null;
};

export const EMPTY_CHANGES_OUTBOUND: ChangesOutbound = Object.freeze({
  commitMessage: "",
  postCommit: null,
  prOpen: false,
  prTitle: "",
  prBody: "",
  prUrl: null,
  prExisted: false,
  pending: null,
  error: null,
  commitWarning: null,
  timedOutCommit: null,
}) as ChangesOutbound;

export const CHANGES_OUTBOUND_LIMIT = 24;

export function createChangesOutboundStore(limit = CHANGES_OUTBOUND_LIMIT) {
  const entries = new Map<string, ChangesOutbound>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const isEmpty = (entry: ChangesOutbound) =>
    !entry.commitMessage && !entry.postCommit && !entry.prOpen && !entry.prTitle && !entry.prBody && !entry.prUrl &&
    !entry.pending && !entry.error && !entry.commitWarning && !entry.timedOutCommit;

  return {
    get(key: string | null | undefined): ChangesOutbound {
      return (key && entries.get(key)) || EMPTY_CHANGES_OUTBOUND;
    },
    patch(key: string, change: Partial<ChangesOutbound>) {
      const next = { ...(entries.get(key) ?? EMPTY_CHANGES_OUTBOUND), ...change };
      entries.delete(key);
      if (isEmpty(next)) {
        emit();
        return;
      }
      entries.set(key, next);
      // Oldest first, but never an entry with a request still in flight.
      for (const [oldKey, entry] of entries) {
        if (entries.size <= limit) break;
        if (!entry.pending) entries.delete(oldKey);
      }
      emit();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const changesOutbound = createChangesOutboundStore();
