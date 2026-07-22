import type { rename, symlink } from "node:fs/promises";

export type ReconciliationStrategy = "inbox" | "state" | "preferences" | "directory" | "manual";

export type CaveHomeReconciliationEntry = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
};

export type ReconciliationDecision =
  | "absent"
  | "moved"
  | "linked"
  | "managed-mirror"
  | "identical"
  | "merged"
  | "kept-canonical"
  | "recovered-legacy"
  | "unresolved"
  | "deferred";

export type MigrationJournalEntry = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
  legacyPath: string;
  canonicalPath: string;
  legacyHash?: string;
  canonicalHash?: string;
  legacyMtimeMs?: number;
  canonicalMtimeMs?: number;
  decision: ReconciliationDecision;
  compatibility?: "symlink" | "mirror";
  managedMirrorHash?: string;
  backupId?: string;
  decidedAt: string;
  summary?: string;
};

export type MigrationJournal = {
  version: 1;
  migrationVersion: 2;
  updatedAt: string;
  entries: Record<string, MigrationJournalEntry>;
};

export type CaveHomeConflictDetail = {
  legacy: string;
  next: string;
  strategy: ReconciliationStrategy;
  legacyPath: string;
  canonicalPath: string;
  legacyHash?: string;
  canonicalHash?: string;
  legacyMtimeMs?: number;
  canonicalMtimeMs?: number;
  legacySize?: number;
  canonicalSize?: number;
  state: "pending" | "unresolved" | "managed";
  summary: string;
  differences: string[];
  backupPath?: string;
  actions: Array<"merge" | "keep-canonical" | "recover-legacy" | "defer">;
};

export type CaveHomeReconciliationStatus = {
  pending: string[];
  conflicts: string[];
  migrated: boolean;
  details: CaveHomeConflictDetail[];
  backupRoot: string;
  journalPath: string;
};

export type CaveHomeReconciliationResult = {
  moved: string[];
  linked: string[];
  skipped: string[];
  merged: Array<{ legacy: string; files: number; collisions: number }>;
  backedUp: string[];
  resolved: string[];
  errors: Array<{ legacy: string; error: string }>;
  /**
   * Destructive resolutions blocked by the discard guard: the requested
   * action would replace a dramatically larger copy with a much smaller one
   * (see cave-5ax2). Retry with `confirmDiscard: true` to proceed anyway.
   */
  confirmationRequired: Array<{
    legacy: string;
    action: "keep-canonical" | "recover-legacy";
    keptBytes: number;
    discardedBytes: number;
    summary: string;
  }>;
};

export type ReconciliationAction = "merge" | "keep-canonical" | "recover-legacy" | "defer";

export type ReconciliationLockDiagnostic = {
  phase: "waiting" | "acquired" | "failed";
  durationMs: number;
  result: "pending" | "acquired" | "timeout" | "error";
  errorCode?: string;
};

export type ReconciliationOptions = {
  action?: ReconciliationAction;
  legacy?: string;
  /**
   * Explicit user acknowledgement for a keep-canonical/recover-legacy action
   * that the discard guard flagged as destroying a much larger copy.
   */
  confirmDiscard?: boolean;
  /** Test-only fault boundary. Production callers must omit it. */
  faultAt?: string;
  /** Test-only compatibility bridge override. */
  createSymlink?: typeof symlink;
  /** Test-only lock lifecycle probe. */
  lockProbe?: (event: "stale-observed" | "acquired" | "released") => void | Promise<void>;
  /** Test-only unlock rename override. */
  lockReleaseRename?: typeof rename;
  /** Test-only candidate owner-record writer override. */
  lockCandidateOwnerWrite?: (candidate: string, owner: { pid: number; token: string; startedAt: string }) => Promise<void>;
  /** Test-only candidate publication rename override. */
  lockCandidateRename?: typeof rename;
  /** Test-only stale-lock fencing rename override. */
  lockFenceRename?: typeof rename;
  /** Test-only acquisition deadline override. */
  lockTimeoutMs?: number;
  /** Test-only lock diagnostic observer. */
  lockDiagnostic?: (diagnostic: ReconciliationLockDiagnostic) => void;
  /** Test-only hook after an exclusive takeover claim is published. */
  takeoverPublishProbe?: (takeoverToken: string) => void | Promise<void>;
  /** Test-only hook before a reclaimable takeover claim is advanced. */
  takeoverRemovalProbe?: (takeover: string, takeoverToken: string | null) => void | Promise<void>;
  /** Test-only hook before a legacy path is replaced by its compatibility bridge. */
  compatibilityProbe?: (legacyPath: string) => void | Promise<void>;
  /** Test-only hook after managed-mirror canonical validation. */
  managedMirrorProbe?: (canonicalPath: string) => void | Promise<void>;
  /** Test-only hook before an explicit/automatic canonical replacement. */
  resolutionProbe?: (canonicalPath: string) => void | Promise<void>;
};
