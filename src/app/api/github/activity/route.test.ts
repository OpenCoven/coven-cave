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
  /Authenticated — private repos included/,
  "authenticated GitHub auth chip should make private repo visibility explicit",
);
