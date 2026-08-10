/**
 * AFS (agent filesystem) wire shapes and the pure logic behind Cave's
 * filesystem pane — bead cave-je2q9, tracked upstream as coven-gr1.
 *
 * Cave reads AFS exclusively through the daemon's `/api/v1/afs/*` routes. It
 * holds no SQLite handle on a delta and reimplements no diff or overlay
 * logic, so the Rust authority boundary in
 * `specs/coven-agent-fs/DESIGN.md` §6 applies unchanged. Everything here is
 * either a shape the daemon owns or a decision about how to *present* what it
 * returned.
 */

/** Capability flags from `GET /api/v1/health`. */
export type AfsCapabilities = {
  /** AFS routes exist at all. When false the pane does not render. */
  afs: boolean;
  /** A mount backend name, or false when none is available. */
  afsMount: string | false;
  /** Whether the daemon can materialize a delta into a git branch. */
  afsCommit: boolean;
  /** Whether commit accepts the side-effect-free `dryRun` contract. */
  afsCommitDryRun: boolean;
};

export type AfsChangeKind = "added" | "modified" | "deleted";

/** `"recorded"` when a provenance row explains the change, else `"unknown"`. */
export type AfsAttribution = "recorded" | "unknown";

export type AfsChange = {
  path: string;
  change: AfsChangeKind;
  bytes: number;
  attribution: AfsAttribution;
  ino?: number | null;
  baseIno?: number | null;
  mode?: number | null;
};

export type AfsChangeCounts = {
  added: number;
  modified: number;
  deleted: number;
  bytes: number;
};

export type AfsDiff = {
  changes: AfsChange[];
  counts: AfsChangeCounts;
  /** The daemon truncated the change set; never render a silently short diff. */
  truncated: boolean;
};

export type AfsFileDiff = {
  path: string;
  patch: string;
  truncated: boolean;
  binary: boolean;
};

/** Reject legacy list-diff payloads before the patch surface dereferences them. */
export function readAfsFileDiff(payload: unknown): AfsFileDiff | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  return typeof value.path === "string"
    && typeof value.patch === "string"
    && typeof value.truncated === "boolean"
    && typeof value.binary === "boolean"
    ? {
        path: value.path,
        patch: value.patch,
        truncated: value.truncated,
        binary: value.binary,
      }
    : null;
}

export type AfsTimelineToolCall = {
  id: number;
  name: string;
  parameters: string | null;
  result: string | null;
  error: string | null;
  startedAt: number;
  completedAt: number;
  durationMs: number;
};

export type AfsTimelineEntry = {
  seq: number;
  op: string;
  path: string;
  toPath?: string | null;
  bytes: number;
  at: number;
  sessionId?: string | null;
  familiarId?: string | null;
  beadId?: string | null;
  turn?: number | null;
  toolCallId?: number | null;
  toolCall: AfsTimelineToolCall | null;
};

export type AfsTimeline = {
  entries: AfsTimelineEntry[];
  nextCursor?: number | null;
  hasMore: boolean;
};

export type AfsSession = {
  id: string;
  name?: string | null;
  state: "open" | "committing" | "committed" | "discarded" | string;
  base: { fingerprint: string; commit?: string | null; files: number; skipped: number };
  binding: {
    sessionId?: string | null;
    familiarId?: string | null;
    beadId?: string | null;
  };
  changes: AfsChangeCounts;
};

/** Daemon-owned result from `afs.session.commit` with `dryRun: true`. */
export type AfsCommitPreview = {
  id: string;
  branch: string;
  worktreePath: string;
  provenanceHighWater: number;
  counts: AfsChangeCounts;
  files: number;
  dryRun: true;
  wouldCommit: true;
};

export type AfsCommitResult = {
  id: string;
  branch: string;
  commit: string;
  worktreePath: string;
  provenanceHighWater: number;
  state: string;
  counts: AfsChangeCounts;
};

export function readAfsCommitPreview(payload: unknown): AfsCommitPreview | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const counts = value.counts;
  if (!counts || typeof counts !== "object") return null;
  const countValue = counts as Record<string, unknown>;
  if (
    typeof value.id !== "string"
    || typeof value.branch !== "string"
    || typeof value.worktreePath !== "string"
    || typeof value.provenanceHighWater !== "number"
    || typeof value.files !== "number"
    || value.dryRun !== true
    || value.wouldCommit !== true
    || typeof countValue.added !== "number"
    || typeof countValue.modified !== "number"
    || typeof countValue.deleted !== "number"
    || typeof countValue.bytes !== "number"
  ) {
    return null;
  }

  return {
    id: value.id,
    branch: value.branch,
    worktreePath: value.worktreePath,
    provenanceHighWater: value.provenanceHighWater,
    files: value.files,
    dryRun: true,
    wouldCommit: true,
    counts: {
      added: countValue.added,
      modified: countValue.modified,
      deleted: countValue.deleted,
      bytes: countValue.bytes,
    },
  };
}

export function readAfsCommitResult(payload: unknown): AfsCommitResult | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const counts = value.counts;
  if (!counts || typeof counts !== "object") return null;
  const countValue = counts as Record<string, unknown>;
  if (
    typeof value.id !== "string"
    || typeof value.branch !== "string"
    || typeof value.commit !== "string"
    || value.commit.length === 0
    || typeof value.worktreePath !== "string"
    || typeof value.provenanceHighWater !== "number"
    || typeof value.state !== "string"
    || typeof countValue.added !== "number"
    || typeof countValue.modified !== "number"
    || typeof countValue.deleted !== "number"
    || typeof countValue.bytes !== "number"
  ) {
    return null;
  }
  return {
    id: value.id,
    branch: value.branch,
    commit: value.commit,
    worktreePath: value.worktreePath,
    provenanceHighWater: value.provenanceHighWater,
    state: value.state,
    counts: {
      added: countValue.added,
      modified: countValue.modified,
      deleted: countValue.deleted,
      bytes: countValue.bytes,
    },
  };
}

/**
 * Read capabilities defensively.
 *
 * Cave and the daemon ship on decoupled versions (#4450), so a daemon with no
 * AFS support at all is a normal state, not an error — it simply reports
 * nothing, and every flag reads false.
 */
export function readAfsCapabilities(payload: unknown): AfsCapabilities {
  const caps =
    payload && typeof payload === "object"
      ? ((payload as { capabilities?: Record<string, unknown> }).capabilities ?? {})
      : {};
  const mount = caps.afsMount;
  return {
    afs: caps.afs === true,
    afsMount: typeof mount === "string" && mount.length > 0 ? mount : false,
    afsCommit: caps.afsCommit === true,
    afsCommitDryRun: caps.afsCommitDryRun === true,
  };
}

/**
 * Find the AFS delta bound to a Cave session.
 *
 * Most Cave sessions have no delta — AFS is opt-in per session — so absence is
 * the common case and must not read as a failure. Discarded deltas are
 * ignored: they are audit records, not live working state.
 */
export function afsSessionForCovenSession(
  sessions: readonly AfsSession[],
  covenSessionId: string,
): AfsSession | null {
  if (!covenSessionId) return null;
  const live = sessions.filter(
    (session) => session.binding.sessionId === covenSessionId && session.state !== "discarded",
  );
  if (live.length === 0) return null;
  // An open delta is the one an operator can still act on; prefer it over a
  // committed one from an earlier round on the same session.
  return live.find((session) => session.state === "open") ?? live[0];
}

export type CommitAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

/**
 * Whether the Commit action can run, and if not, why — in the operator's
 * words rather than a bare disabled control.
 */
export function commitAvailability(
  capabilities: AfsCapabilities,
  session: Pick<AfsSession, "state" | "changes"> | null,
): CommitAvailability {
  if (!capabilities.afsCommit) {
    return {
      enabled: false,
      reason:
        "This daemon does not support commit materialization (health reports afsCommit: false). Upgrade the daemon to enable it.",
    };
  }
  if (!session) {
    return { enabled: false, reason: "This session has no agent filesystem delta." };
  }
  if (session.state !== "open") {
    return {
      enabled: false,
      reason: `The delta is ${session.state}; commit requires an open session.`,
    };
  }
  if (changeTotal(session.changes) === 0) {
    return { enabled: false, reason: "No changes to materialize." };
  }
  return { enabled: true };
}

export type MountAvailability = { enabled: false; reason: string } | { enabled: true; backend: string };

/** Mount controls are shown but disabled when no backend is advertised. */
export function mountAvailability(capabilities: AfsCapabilities): MountAvailability {
  if (capabilities.afsMount === false) {
    return {
      enabled: false,
      reason: "No mount backend is available on this platform (health reports afsMount: false).",
    };
  }
  return { enabled: true, backend: capabilities.afsMount };
}

/** File-count total. Deliberately excludes bytes, which is a separate axis. */
export function changeTotal(counts: AfsChangeCounts): number {
  return counts.added + counts.modified + counts.deleted;
}

/** Default branch the daemon would pick, mirroring DESIGN.md §5 step 3. */
export function defaultCommitBranch(session: Pick<AfsSession, "id" | "name">): string {
  return `afs/${session.name && session.name.length > 0 ? session.name : session.id}`;
}

/** Unattributed changes are marked, never hidden (DESIGN.md §4.4). */
export function unattributedPaths(diff: Pick<AfsDiff, "changes">): string[] {
  return diff.changes.filter((change) => change.attribution === "unknown").map((change) => change.path);
}

const POSIX_FILE_TYPE_MASK = 0o170000;
const POSIX_REGULAR_FILE = 0o100000;

/**
 * Exclude nodes the change ledger identifies as directories or symlinks.
 *
 * Deleted entries do not carry mode metadata, so the daemon remains the
 * authority for those paths and may still return `afs.path_not_file`.
 */
export function isSelectableFileChange(change: AfsChange): boolean {
  return change.mode == null || (change.mode & POSIX_FILE_TYPE_MASK) === POSIX_REGULAR_FILE;
}

export type TimelineTurn = {
  /** null groups every entry the daemon could not bind to a turn. */
  turn: number | null;
  entries: AfsTimelineEntry[];
};

/**
 * Group timeline entries by turn, preserving daemon order within each group.
 *
 * Entries with no turn are kept in their own trailing group rather than
 * dropped: an operation nobody can account for is exactly what an audit
 * timeline exists to show.
 */
export function groupTimelineByTurn(entries: readonly AfsTimelineEntry[]): TimelineTurn[] {
  const groups: TimelineTurn[] = [];
  const index = new Map<number | null, TimelineTurn>();
  for (const entry of entries) {
    const turn = typeof entry.turn === "number" ? entry.turn : null;
    let group = index.get(turn);
    if (!group) {
      group = { turn, entries: [] };
      index.set(turn, group);
      groups.push(group);
    }

    group.entries.push(entry);
  }
  // Unbound entries sort last; bound turns keep first-seen order.
  return groups.sort((left, right) => {
    if (left.turn === right.turn) return 0;
    if (left.turn === null) return 1;
    if (right.turn === null) return -1;
    return left.turn - right.turn;
  });
}

/** Merge cursor pages by the daemon's stable sequence, keeping the newest row. */
export function mergeTimelinePages(current: AfsTimeline, incoming: AfsTimeline): AfsTimeline {
  const entries = new Map<number, AfsTimelineEntry>();
  for (const entry of current.entries) entries.set(entry.seq, entry);
  for (const entry of incoming.entries) entries.set(entry.seq, entry);
  return {
    entries: [...entries.values()].sort((left, right) => left.seq - right.seq),
    nextCursor: incoming.nextCursor,
    hasMore: incoming.hasMore,
  };
}

/** A tree node for the Changes pane. */
export type AfsTreeNode = {
  name: string;
  path: string;
  children: AfsTreeNode[];
  change: AfsChange | null;
};

/**
 * Build a directory tree from flat change paths.
 *
 * Directories are synthesized from the paths themselves; the daemon reports
 * files, and git does not track empty directories.
 */
export function buildChangeTree(changes: readonly AfsChange[]): AfsTreeNode[] {
  const root: AfsTreeNode = { name: "", path: "", children: [], change: null };
  for (const change of changes) {
    const parts = change.path.split("/").filter((part) => part.length > 0);
    let node = root;
    parts.forEach((part, depth) => {
      const path = `/${parts.slice(0, depth + 1).join("/")}`;
      let next = node.children.find((child) => child.name === part);
      if (!next) {
        next = { name: part, path, children: [], change: null };
        node.children.push(next);
      }
      if (depth === parts.length - 1) next.change = change;
      node = next;
    });
  }
  sortTree(root.children);
  return root.children;
}

function sortTree(nodes: AfsTreeNode[]): void {
  nodes.sort((left, right) => {
    const leftIsDir = left.children.length > 0;
    const rightIsDir = right.children.length > 0;
    if (leftIsDir !== rightIsDir) return leftIsDir ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortTree(node.children);
}
