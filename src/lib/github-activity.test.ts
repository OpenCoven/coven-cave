import assert from "node:assert/strict";
import {
  activityCountLabel,
  activityCollectionsComplete,
  activityCollectionsEqual,
  activityCompletenessNotice,
  activityCollectionFailure,
  activityCollectionFromSearch,
  activityCollectionUnavailable,
  activityRetryAfterSeconds,
  githubApiFailure,
  mergeFailedActivityItems,
} from "./github-activity.ts";

const complete = activityCollectionFromSearch({
  shown: 12,
  total: 12,
  githubIncomplete: false,
});
assert.deepEqual(complete, {
  status: "complete",
  shown: 12,
  total: 12,
  hasMore: false,
  incomplete: false,
  githubIncomplete: false,
});

const truncated = activityCollectionFromSearch({
  shown: 100,
  total: 143,
  githubIncomplete: false,
});
assert.deepEqual(truncated, {
  status: "truncated",
  shown: 100,
  total: 143,
  hasMore: true,
  incomplete: true,
  githubIncomplete: false,
});

const githubIncomplete = activityCollectionFromSearch({
  shown: 8,
  total: 8,
  githubIncomplete: true,
});
assert.deepEqual(githubIncomplete, {
  status: "incomplete",
  shown: 8,
  total: 8,
  hasMore: false,
  incomplete: true,
  githubIncomplete: true,
});

const truncatedAndIncomplete = activityCollectionFromSearch({
  shown: 100,
  total: 143,
  githubIncomplete: true,
});
assert.deepEqual(truncatedAndIncomplete, {
  status: "truncated",
  shown: 100,
  total: 143,
  hasMore: true,
  incomplete: true,
  githubIncomplete: true,
});

const failed = activityCollectionFailure("GitHub rate limit reached.");
assert.deepEqual(failed, {
  status: "failed",
  shown: 0,
  total: null,
  hasMore: false,
  incomplete: true,
  githubIncomplete: false,
  error: "GitHub rate limit reached.",
});

const unavailable = activityCollectionUnavailable();
assert.deepEqual(unavailable, {
  status: "unavailable",
  shown: 0,
  total: null,
  hasMore: false,
  incomplete: true,
  githubIncomplete: false,
});

assert.equal(
  activityCompletenessNotice({
    authored: truncated,
    reviewRequests: failed,
    assignedIssues: githubIncomplete,
  }),
  "Couldn't load review requests. GitHub rate limit reached. Showing latest 100 of 143 authored pull requests. GitHub marked assigned issues incomplete.",
);
assert.equal(
  activityCompletenessNotice({
    authored: complete,
    reviewRequests: unavailable,
    assignedIssues: complete,
  }),
  "Review requests aren't loaded without a GitHub token.",
);
assert.equal(
  activityCompletenessNotice(
    {
      authored: complete,
      reviewRequests: unavailable,
      assignedIssues: complete,
    },
    { includeUnavailable: false },
  ),
  null,
  "a rejected-token message can suppress the redundant token-unavailable notice",
);
assert.equal(
  activityCompletenessNotice({
    authored: complete,
    reviewRequests: complete,
    assignedIssues: complete,
  }),
  null,
);
assert.equal(
  activityCompletenessNotice({
    authored: truncatedAndIncomplete,
    reviewRequests: complete,
    assignedIssues: complete,
  }),
  "Showing latest 100 of 143 authored pull requests. GitHub marked authored pull requests incomplete.",
);
assert.equal(
  activityCollectionsEqual(
    { authored: complete, reviewRequests: complete, assignedIssues: complete },
    { authored: complete, reviewRequests: complete, assignedIssues: complete },
  ),
  true,
);
assert.equal(
  activityCollectionsEqual(
    { authored: complete, reviewRequests: complete, assignedIssues: complete },
    { authored: truncated, reviewRequests: complete, assignedIssues: complete },
  ),
  false,
  "activity refreshes must retain changed completeness metadata even when rows are unchanged",
);
assert.equal(
  activityCollectionsComplete({
    authored: complete,
    reviewRequests: complete,
    assignedIssues: complete,
  }),
  true,
);
assert.equal(
  activityCollectionsComplete({
    authored: complete,
    reviewRequests: failed,
    assignedIssues: complete,
  }),
  false,
);
assert.equal(
  activityRetryAfterSeconds({
    authored: activityCollectionFailure("Slow down.", 600),
    reviewRequests: activityCollectionFailure("Slow down.", 30),
    assignedIssues: complete,
  }),
  600,
  "polling must honor the longest category Retry-After value",
);

assert.deepEqual(
  githubApiFailure({ status: 429, remaining: 8, retryAfter: "60" }),
  {
    message: "GitHub rate limit reached. Try again in 60 seconds.",
    rateLimited: true,
    retryAfterSeconds: 60,
  },
);
assert.deepEqual(
  githubApiFailure({ status: 403, remaining: 42, retryAfter: "30" }),
  {
    message: "GitHub rate limit reached. Try again in 30 seconds.",
    rateLimited: true,
    retryAfterSeconds: 30,
  },
  "secondary rate limits can retain core quota while still returning Retry-After",
);
assert.deepEqual(
  githubApiFailure({
    status: 403,
    remaining: 42,
    retryAfter: null,
    responseMessage: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
  }),
  {
    message: "GitHub rate limit reached. Try again in 60 seconds.",
    rateLimited: true,
    retryAfterSeconds: 60,
  },
  "secondary limits without headers should use GitHub's documented minimum cooldown",
);
assert.deepEqual(
  githubApiFailure({ status: 401, remaining: -1, retryAfter: null }),
  {
    message: "GitHub rejected the configured token.",
    rateLimited: false,
    retryAfterSeconds: null,
  },
);

const primaryRateLimit = githubApiFailure({
  status: 403,
  remaining: 0,
  retryAfter: null,
  rateLimitReset: String(Math.floor(Date.now() / 1000) + 60),
});
assert.equal(primaryRateLimit.rateLimited, true);
assert.ok(
  (primaryRateLimit.retryAfterSeconds ?? 0) >= 50,
  "a primary rate limit delays the next poll until GitHub's reset time",
);
assert.deepEqual(
  githubApiFailure({ status: 429, remaining: 42, retryAfter: null }),
  {
    message: "GitHub rate limit reached. Try again in 60 seconds.",
    rateLimited: true,
    retryAfterSeconds: 60,
  },
  "headerless 429 responses use a bounded fallback cooldown",
);
assert.equal(activityCountLabel(12, complete), "12");
assert.equal(activityCountLabel(100, truncated), "100+");
assert.equal(activityCountLabel(0, failed), "—");

const previousItems = [
  { id: "pr-old", kind: "pr" as const },
  { id: "review-old", kind: "review_request" as const },
  { id: "issue-old", kind: "issue" as const },
];
const incomingItems = [
  { id: "review-new", kind: "review_request" as const },
  { id: "issue-new", kind: "issue" as const },
];
assert.deepEqual(
  mergeFailedActivityItems(previousItems, incomingItems, {
    authored: failed,
    reviewRequests: complete,
    assignedIssues: complete,
  }),
  [
    ...incomingItems,
    previousItems[0],
  ],
  "failed categories retain their last-loaded rows while successful categories refresh",
);

console.log("github-activity.test.ts: ok");
