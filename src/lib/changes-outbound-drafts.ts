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

export type ChangesOutbound = {
  commitMessage: string;
  postCommit: ChangesOutboundCommit | null;
  prOpen: boolean;
  prTitle: string;
  prBody: string;
  prUrl: string | null;
  /** The request in flight, if any. */
  pending: "commit" | "create-pr" | null;
  /** Why the last commit or Create PR failed. */
  error: { action: string; message: string } | null;
};

export const EMPTY_CHANGES_OUTBOUND: ChangesOutbound = Object.freeze({
  commitMessage: "",
  postCommit: null,
  prOpen: false,
  prTitle: "",
  prBody: "",
  prUrl: null,
  pending: null,
  error: null,
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
    !entry.pending && !entry.error;

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
