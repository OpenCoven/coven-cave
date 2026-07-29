export const GITHUB_ACTIVITY_PAGE_SIZE = 100;

export type ActivityCollectionStatus =
  | "complete"
  | "truncated"
  | "incomplete"
  | "failed"
  | "unavailable";

export type ActivityCollection = {
  status: ActivityCollectionStatus;
  shown: number;
  total: number | null;
  hasMore: boolean;
  incomplete: boolean;
  githubIncomplete: boolean;
  error?: string;
  retryAfterSeconds?: number;
};

export type ActivityCollections = {
  authored: ActivityCollection;
  reviewRequests: ActivityCollection;
  assignedIssues: ActivityCollection;
};

export function activityCollectionFromSearch({
  shown,
  total,
  githubIncomplete,
}: {
  shown: number;
  total: number;
  githubIncomplete: boolean;
}): ActivityCollection {
  const hasMore = total > shown;
  return {
    status: hasMore ? "truncated" : githubIncomplete ? "incomplete" : "complete",
    shown,
    total,
    hasMore,
    incomplete: hasMore || githubIncomplete,
    githubIncomplete,
  };
}

export function activityCollectionFailure(
  error: string,
  retryAfterSeconds: number | null = null,
): ActivityCollection {
  return {
    status: "failed",
    shown: 0,
    total: null,
    hasMore: false,
    incomplete: true,
    githubIncomplete: false,
    error,
    ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
  };
}

export function activityCollectionUnavailable(): ActivityCollection {
  return {
    status: "unavailable",
    shown: 0,
    total: null,
    hasMore: false,
    incomplete: true,
    githubIncomplete: false,
  };
}

export type GitHubApiFailure = {
  message: string;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
};

const GITHUB_RATE_LIMIT_RETRY_SECONDS = 60;

function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function rateLimitResetSeconds(value: string | null): number | null {
  if (!value) return null;
  const resetAtSeconds = Number(value);
  if (!Number.isFinite(resetAtSeconds)) return null;
  return Math.max(0, Math.ceil(resetAtSeconds - Date.now() / 1000));
}

export function githubApiFailure({
  status,
  remaining,
  retryAfter,
  rateLimitReset = null,
  responseMessage = null,
}: {
  status: number;
  remaining: number;
  retryAfter: string | null;
  rateLimitReset?: string | null;
  responseMessage?: string | null;
}): GitHubApiFailure {
  const secondaryRateLimit = status === 403
    && /secondary rate limit|abuse detection mechanism/i.test(responseMessage ?? "");
  const retrySeconds = retryAfterSeconds(retryAfter)
    ?? (remaining === 0 ? rateLimitResetSeconds(rateLimitReset) : null)
    ?? (status === 429 || remaining === 0 || secondaryRateLimit
      ? GITHUB_RATE_LIMIT_RETRY_SECONDS
      : null);
  const rateLimited = status === 429
    || (status === 403 && (remaining === 0 || retrySeconds !== null || secondaryRateLimit));

  if (rateLimited) {
    return {
      message: `GitHub rate limit reached.${retrySeconds === null ? "" : ` Try again in ${retrySeconds} seconds.`}`,
      rateLimited: true,
      retryAfterSeconds: retrySeconds,
    };
  }
  if (status === 401) {
    return {
      message: "GitHub rejected the configured token.",
      rateLimited: false,
      retryAfterSeconds: null,
    };
  }
  if (status === 403) {
    return {
      message: "GitHub denied the request.",
      rateLimited: false,
      retryAfterSeconds: null,
    };
  }
  if (status === 422) {
    return {
      message: "GitHub rejected the request.",
      rateLimited: false,
      retryAfterSeconds: null,
    };
  }
  if (status >= 500) {
    return {
      message: "GitHub is temporarily unavailable.",
      rateLimited: false,
      retryAfterSeconds: null,
    };
  }
  return {
    message: `GitHub request failed (${status}).`,
    rateLimited: false,
    retryAfterSeconds: null,
  };
}

const COLLECTION_LABELS: Record<keyof ActivityCollections, string> = {
  authored: "authored pull requests",
  reviewRequests: "review requests",
  assignedIssues: "assigned issues",
};

const COLLECTION_KEYS = Object.keys(COLLECTION_LABELS) as Array<keyof ActivityCollections>;

export function activityCollectionsComplete(collections: ActivityCollections): boolean {
  return COLLECTION_KEYS.every((key) => !collections[key].incomplete);
}

export function activityCountLabel(count: number, collection: ActivityCollection): string {
  if (!collection.incomplete) return String(count);
  return count > 0 ? `${count}+` : "—";
}

export function activityRetryAfterSeconds(collections: ActivityCollections): number {
  return COLLECTION_KEYS.reduce(
    (longest, key) => Math.max(longest, collections[key].retryAfterSeconds ?? 0),
    0,
  );
}

export function activityCollectionsEqual(
  left: ActivityCollections,
  right: ActivityCollections,
): boolean {
  return COLLECTION_KEYS.every((key) => {
    const a = left[key];
    const b = right[key];
    return a.status === b.status
      && a.shown === b.shown
      && a.total === b.total
      && a.hasMore === b.hasMore
      && a.incomplete === b.incomplete
      && a.githubIncomplete === b.githubIncomplete
      && a.error === b.error
      && a.retryAfterSeconds === b.retryAfterSeconds;
  });
}

type MergeableActivityItem = {
  id: string;
  kind: "pr" | "review_request" | "issue" | "notification";
};

export function mergeFailedActivityItems<T extends MergeableActivityItem>(
  previous: T[],
  incoming: T[],
  collections: ActivityCollections,
): T[] {
  const failedKinds = new Set<T["kind"]>();
  if (collections.authored.status === "failed") failedKinds.add("pr");
  if (collections.reviewRequests.status === "failed") failedKinds.add("review_request");
  if (collections.assignedIssues.status === "failed") failedKinds.add("issue");
  if (failedKinds.size === 0) return incoming;

  const incomingIds = new Set(incoming.map((item) => item.id));
  const retained = previous.filter(
    (item) => failedKinds.has(item.kind) && !incomingIds.has(item.id),
  );
  return retained.length > 0 ? [...incoming, ...retained] : incoming;
}

export function activityCompletenessNotice(
  collections: ActivityCollections,
  { includeUnavailable = true }: { includeUnavailable?: boolean } = {},
): string | null {
  const entries = COLLECTION_KEYS.map((key) => [key, collections[key]] as const);
  const parts: string[] = [];

  for (const [key, collection] of entries) {
    if (collection.status !== "failed") continue;
    parts.push(`Couldn't load ${COLLECTION_LABELS[key]}. ${collection.error ?? "GitHub search failed."}`);
  }
  if (includeUnavailable) {
    for (const [key, collection] of entries) {
      if (collection.status !== "unavailable") continue;
      const label = COLLECTION_LABELS[key];
      parts.push(`${label[0].toUpperCase()}${label.slice(1)} aren't loaded without a GitHub token.`);
    }
  }
  for (const [key, collection] of entries) {
    if (collection.status !== "truncated") continue;
    parts.push(`Showing latest ${collection.shown} of ${collection.total} ${COLLECTION_LABELS[key]}.`);
  }
  for (const [key, collection] of entries) {
    if (!collection.githubIncomplete) continue;
    parts.push(`GitHub marked ${COLLECTION_LABELS[key]} incomplete.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
