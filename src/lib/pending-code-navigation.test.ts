import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acknowledgePendingCodeNavigation,
  clearPendingCodeNavigation,
  codeTopTabForGitHubTarget,
  enqueuePendingCodeNavigation,
  getPendingCodeNavigation,
  subscribePendingCodeNavigation,
} from "./pending-code-navigation.ts";

const pr = {
  repo: "OpenCoven/coven-cave",
  number: 42,
  kind: "pr" as const,
  url: "https://github.com/OpenCoven/coven-cave/pull/42",
};
const issue = {
  repo: "OpenCoven/coven-cave",
  number: 43,
  kind: "issue" as const,
  url: "https://github.com/OpenCoven/coven-cave/issues/43",
};

test("GitHub item targets select their matching Code Workshop tabs", () => {
  assert.equal(codeTopTabForGitHubTarget(pr), "prs");
  assert.equal(codeTopTabForGitHubTarget(issue), "issues");
});

test("the newest request wins and stale acknowledgement cannot clear it", () => {
  clearPendingCodeNavigation();
  let notifications = 0;
  const unsubscribe = subscribePendingCodeNavigation(() => {
    notifications += 1;
  });
  enqueuePendingCodeNavigation({ kind: "tab", topTab: "activity", nonce: 1 });
  enqueuePendingCodeNavigation({ kind: "github-item", target: pr, nonce: 2 });
  acknowledgePendingCodeNavigation(1);
  assert.deepEqual(getPendingCodeNavigation(), { kind: "github-item", target: pr, nonce: 2 });
  assert.equal(notifications, 2);
  acknowledgePendingCodeNavigation(2);
  assert.equal(getPendingCodeNavigation(), null);
  assert.equal(notifications, 3);
  unsubscribe();
});

test("explicit clearing discards an unavailable room's unconsumed request", () => {
  clearPendingCodeNavigation();
  enqueuePendingCodeNavigation({ kind: "github-item", target: issue, nonce: 3 });
  clearPendingCodeNavigation();
  assert.equal(getPendingCodeNavigation(), null);
});
