import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const route = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
const githubView = readFileSync(fileURLToPath(new URL("../../../../components/github-view.tsx", import.meta.url)), "utf8");

assert.match(
  route,
  /is:pr\+is:open\+author:\$\{login\}/,
  "authored PR search should include private repos when a PAT is configured",
);
assert.match(
  route,
  /is:pr\+is:open\+review-requested:\$\{login\}/,
  "review-requested PR search should include private repos when a PAT is configured",
);
assert.match(
  route,
  /is:issue\+is:open\+assignee:\$\{login\}/,
  "assigned issue search should include private repos when a PAT is configured",
);
assert.match(
  route,
  /\/user\/orgs\?per_page=100/,
  "authenticated activity should include the account's organization memberships",
);
assert.match(
  route,
  /organizations,\r?\n\s*collections,\r?\n\s*items,/,
  "activity responses should expose memberships separately from open activity items",
);
assert.match(
  route,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token"/,
  "activity should use the shared token resolver for every supported installation harness",
);
assert.match(
  route,
  /const storedToken = resolveGitHubToken\(\)/,
  "activity should resolve the token through the shared installation-agnostic resolver",
);
assert.match(
  route,
  /nextGitHubPagePath\(res\.headers\.get\("link"\)\)/,
  "organization memberships should follow GitHub pagination",
);
assert.match(
  route,
  /GITHUB_ACTIVITY_PAGE_SIZE/,
  "activity searches should share an explicit bounded page size",
);
assert.equal(
  [...route.matchAll(/per_page=\$\{GITHUB_ACTIVITY_PAGE_SIZE\}/g)].length,
  1,
  "the shared activity search helper should apply the expanded page size",
);
assert.equal(
  [...route.matchAll(/await fetchActivitySearch\(/g)].length,
  3,
  "authored PRs, review requests, and assigned issues should each use the bounded search helper",
);
assert.match(
  route,
  /total_count/,
  "activity search metadata should preserve GitHub's total result count",
);
assert.match(
  route,
  /incomplete_results/,
  "activity search metadata should preserve GitHub's incomplete-results signal",
);
assert.match(
  route,
  /activityCollectionFailure/,
  "failed activity categories should return explicit failure metadata",
);
assert.match(
  route,
  /if \(!login && patInvalid\)/,
  "an invalid launcher token without a stored username should still render the rejected-token state",
);
assert.match(
  route,
  /if \(!login && identityFailure\)/,
  "identity lookup failures should not masquerade as an unconfigured GitHub account",
);
assert.match(
  route,
  /retryAfter/,
  "GitHub rate-limit responses should preserve Retry-After metadata",
);
assert.match(
  route,
  /identityFailure\.rateLimited \? 429 : 502/,
  "primary and secondary rate limits should use a recoverable rate-limit response",
);
assert.match(
  route,
  /collections,\r?\n\s*items,/,
  "activity responses should expose per-category completeness metadata",
);
assert.doesNotMatch(
  route,
  /catch \{ \/\* non-fatal \*\/ \}/,
  "activity searches should not silently collapse failures to empty categories",
);
assert.doesNotMatch(
  route,
  /is:(?:pr|issue)\+is:open\+is:public/,
  "GitHub activity searches should not force public-only visibility",
);
assert.doesNotMatch(
  githubView,
  /public repos only/,
  "GitHub surface should not claim authenticated GitHub is public-only",
);
assert.match(
  githubView,
  /\.\.\.filtered\.map\(\(i\) => orgOf\(i\.repo\)\)/,
  "organization options derive from the orgs present in the current table rows, not from every membership",
);
assert.match(
  githubView,
  /arrayContentEqual\(prev\.organizations, nextActivity\.organizations\)/,
  "activity refreshes should retain changed organization memberships even when items are unchanged",
);
