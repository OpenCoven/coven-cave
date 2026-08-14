export type CanonicalMemoryVerificationState =
  | "verified"
  | "needs-review"
  | "degraded"
  | "unknown"
  | "unavailable";

export type CanonicalMemoryErrorCode =
  | "local_access_required"
  | "local_daemon_required"
  | "daemon_update_required"
  | "canonical_memory_unavailable"
  | "invalid_daemon_payload"
  | "invalid_memory_id"
  | "memory_not_found";

export type CanonicalMemorySource = {
  kind: string;
  label: string;
};

export type CanonicalMemorySummary = {
  id: string;
  familiarId: string;
  title: string;
  updatedAt: string;
  relativeUpdatedAt: string;
  excerpt: string;
  source: CanonicalMemorySource;
  privacy: {
    classification: string | null;
    revealRequired: boolean | null;
  };
  verification: {
    state: CanonicalMemoryVerificationState;
  };
};

export type CanonicalMemoryOverview = {
  generatedAt: string;
  totals: {
    entries: number;
    familiars: number;
    verified: number;
    needsReview: number;
    unknown: number;
  };
  lastUpdatedAt: string | null;
  capabilities: {
    detail: boolean;
    verification: boolean;
    attestationMetadata: boolean;
    supersessionHistory: boolean;
    mutations: boolean;
  };
  verification: {
    state: CanonicalMemoryVerificationState;
    checkedAt: string;
    manifest: string | null;
    index: string | null;
    issues: string[];
  };
};

export type CanonicalMemoryDetail = {
  id: string;
  familiarId: string;
  title: string;
  updatedAt: string;
  source: CanonicalMemorySource;
  content: string;
  contentFormat: "markdown";
  privacy: {
    classification: string | null;
    revealRequired: boolean | null;
    reason: string;
  };
  verification: {
    state: CanonicalMemoryVerificationState;
    reason: string;
  };
  attestationMetadata: { fieldCount: number } | null;
  supersession: {
    supersedes: string | null;
    supersededBy: string | null;
  };
};

export type CanonicalMemoryListResponse =
  | { ok: true; entries: CanonicalMemorySummary[] }
  | { ok: false; code: CanonicalMemoryErrorCode };

export type CanonicalMemoryOverviewResponse =
  | { ok: true; overview: CanonicalMemoryOverview }
  | { ok: false; code: CanonicalMemoryErrorCode };

export type CanonicalMemoryDetailResponse =
  | { ok: true; entry: CanonicalMemoryDetail }
  | { ok: false; code: CanonicalMemoryErrorCode };

export type PendingCanonicalMemorySelection = {
  id: string;
  familiarId: string;
};

/**
 * Familiar-roster loads are last-request-wins. Callers increment their
 * generation before starting a load and consult this guard before publishing
 * any result, error, or settled state.
 */
export function isLatestFamiliarRosterRequest(
  requestGeneration: number,
  latestGeneration: number,
): boolean {
  return requestGeneration === latestGeneration;
}

export function canonicalMemorySelectionRowId(
  selection: PendingCanonicalMemorySelection,
): `coven:${string}` {
  return `coven:${selection.id}`;
}

export function isCanonicalMemorySelectionApplied(input: {
  pending: PendingCanonicalMemorySelection;
  familiarId: string;
  selectedRowId: string | null;
  selectedMemoryId: string | null;
}): boolean {
  return (
    input.familiarId === input.pending.familiarId &&
    input.selectedRowId === canonicalMemorySelectionRowId(input.pending) &&
    input.selectedMemoryId === input.pending.id
  );
}

/**
 * Acknowledgements are bound to the pending object from the render that
 * created their callback. Identity keeps a late acknowledgement from clearing
 * a newer repeat navigation to the same globally unique memory ID.
 */
export function acknowledgePendingCanonicalMemorySelection(
  current: PendingCanonicalMemorySelection | null,
  expected: PendingCanonicalMemorySelection | null,
  appliedId: string,
): PendingCanonicalMemorySelection | null {
  return current &&
    expected &&
    current === expected &&
    current.id === appliedId
    ? null
    : current;
}

/**
 * Terminal roster rejection is identity-bound for the same reason as an
 * acknowledgement: a late callback for an older navigation must not clear a
 * newer object, even when both objects carry the same memory ID.
 */
export function rejectPendingCanonicalMemorySelection(
  current: PendingCanonicalMemorySelection | null,
  expected: PendingCanonicalMemorySelection,
): PendingCanonicalMemorySelection | null {
  return current === expected ? null : current;
}

/**
 * A roster response may authorize terminal "familiar unavailable" handling
 * only when its request started for the exact selection that is still
 * pending. The request-generation gate prevents older roster responses from
 * reaching this helper; the identity check additionally protects selection
 * changes between the current request's start and publication.
 */
export function reconcilePendingCanonicalRosterSettlement(input: {
  settled: PendingCanonicalMemorySelection | null;
  current: PendingCanonicalMemorySelection | null;
  startedFor: PendingCanonicalMemorySelection | null;
  succeeded: boolean;
}): PendingCanonicalMemorySelection | null {
  const { settled, current, startedFor, succeeded } = input;
  if (succeeded) {
    return startedFor && current === startedFor ? startedFor : null;
  }
  if (startedFor && current === startedFor) {
    return null;
  }
  return settled === current ? settled : null;
}
