import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-view-data.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("./github-view.tsx", import.meta.url), "utf8");
assert.match(source, /export function useFamiliars/, "GitHub familiar loading has a dedicated data boundary");
assert.match(source, /export function useCards/, "linked board-card loading has a dedicated data boundary");
assert.match(source, /export const KIND_ORDER/, "GitHub activity ordering remains centralized");
assert.match(source, /export function linkedCardsForItem/, "task linking preserves URL and id matching");
assert.match(source, /collections: ActivityCollections/, "activity data includes per-category completeness metadata");
assert.match(
  view,
  /activityCompletenessNotice\(activity\.collections,\s*\{\s*includeUnavailable:\s*!activity\.patInvalid\s*\}\)/,
  "rejected-token copy suppresses only the redundant unavailable-token notice",
);
assert.match(view, /role="status" className="gh-completeness-notice"/, "partial activity renders as visible status chrome");
assert.match(
  view,
  /activityRetryAfterSeconds\(nextActivity\.collections\)/,
  "GitHub polling derives its cooldown from Retry-After metadata",
);
assert.match(
  view,
  /schedulePoll\(Math\.max\(basePollMs,\s*retryDelayMs\)\)/,
  "automatic polling never runs before GitHub's Retry-After deadline",
);
assert.match(
  view,
  /if \(timerRef\.current !== null\) window\.clearTimeout\(timerRef\.current\);[\s\S]{0,240}?timerRef\.current = null;[\s\S]{0,120}?fetchActivity\(true, true\)/,
  "poll scheduling replaces the prior timer and clears its id before fetching",
);
assert.match(
  view,
  /surfaceWarmupRetryAfterSeconds\(e\)/,
  "top-level GitHub backpressure preserves its retry delay",
);
assert.match(
  view,
  /mergeFailedActivityItems\(prev\.items,\s*nextActivity\.items,\s*nextActivity\.collections\)/,
  "failed activity categories retain their last-loaded rows in the main GitHub view",
);
assert.match(
  view,
  /prev\.login === nextActivity\.login/,
  "failed-category retention must never carry rows across GitHub account changes",
);
assert.match(
  view,
  /error && activity[\s\S]{0,500}?Showing last loaded activity/,
  "top-level refresh failures stay visible without hiding previously loaded activity",
);
assert.match(
  view,
  /nextActivity\.retryAfterSeconds/,
  "check-enrichment cooldowns delay the next GitHub poll",
);
assert.match(
  view,
  /disabled=\{retryBlocked\}/,
  "manual completeness retries remain disabled during GitHub's cooldown",
);
assert.match(
  view,
  /countLabels=\{countLabels\}/,
  "detail counts receive completeness-aware labels",
);
assert.match(
  view,
  /activityIncomplete\s*\?\s*`No loaded items match/,
  "filtered empty copy does not claim to have searched omitted activity",
);
assert.match(
  view,
  /completenessNotice \? \([\s\S]{0,500}?headline="GitHub activity is incomplete"/,
  "an empty partial response must not render as a trustworthy nothing-open state",
);
assert.ok(
  view.indexOf(") : completenessNotice ? (") < view.indexOf(") : activity?.patInvalid ? ("),
  "non-token failures and truncation must remain visible when a PAT is also rejected",
);
