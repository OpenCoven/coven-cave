// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GITHUB_REVIEW_BODY_MAX_LENGTH,
  validateGitHubReviewBody,
} from "../../../../lib/github-review.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "review route should use the shared installation-agnostic token resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "review route should keep the owner/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "review is a write — it must 401 without a PAT");
assert.match(
  source,
  /typeof data\?\.message === "string" \? data\.message/,
  "review passes GitHub's own error message through verbatim",
);
assert.doesNotMatch(source, /:\s*token\b/, "review route must not return token material");

console.log("github-review-route.test.ts OK");
assert.match(source, /new Set\(\["APPROVE", "REQUEST_CHANGES", "COMMENT"\]\)/, "review events are allow-listed");
assert.match(source, /event !== "APPROVE" && !text/, "non-approve reviews require a body");
assert.match(source, /validateGitHubReviewBody/, "oversized review bodies fail before GitHub dispatch");

const exactBody = validateGitHubReviewBody("x".repeat(GITHUB_REVIEW_BODY_MAX_LENGTH));
assert.equal(exactBody.ok, true, "the exact review body boundary is accepted");
const oversizedBody = validateGitHubReviewBody("x".repeat(GITHUB_REVIEW_BODY_MAX_LENGTH + 1));
assert.equal(oversizedBody.ok, false, "an over-limit review body is refused");
assert.equal(
  oversizedBody.ok ? null : oversizedBody.error,
  `review body must be at most ${GITHUB_REVIEW_BODY_MAX_LENGTH} characters`,
);

const home = mkdtempSync(join(tmpdir(), "cave-review-head-"));
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = join(home, "cave");
process.env.GITHUB_PAT = "test-only-never-dispatched";
const realFetch = globalThis.fetch;
const { POST } = await import("./route.ts");
test.after(() => {
  globalThis.fetch = realFetch;
  rmSync(home, { recursive: true, force: true });
});

test("a verdict is attached to the head that was actually reviewed", async () => {
  const payloads: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 1, state: "APPROVED" });
  };
  const headSha = "a".repeat(40);
  const result = await POST(new Request("http://localhost/api/github/review", {
    method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, event: "APPROVE", body: "Reviewed this change.", headSha }),
  }));
  assert.equal((await result.json()).ok, true);
  assert.deepEqual(payloads, [{ event: "APPROVE", body: "Reviewed this change.", commit_id: headSha }]);
});

test("malformed explicit review heads fail before dispatch and omission remains compatible", async () => {
  const payloads: unknown[] = [];
  globalThis.fetch = async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 1, state: "APPROVED" });
  };
  for (const headSha of [null, "", "not-a-sha", 123]) {
    const result = await POST(new Request("http://localhost/api/github/review", {
      method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, event: "APPROVE", headSha }),
    }));
    assert.equal(result.status, 400);
  }
  assert.deepEqual(payloads, []);
  const legacy = await POST(new Request("http://localhost/api/github/review", {
    method: "POST", body: JSON.stringify({ repo: "o/r", number: 7, event: "APPROVE" }),
  }));
  assert.equal((await legacy.json()).ok, true);
  assert.deepEqual(payloads, [{ event: "APPROVE" }]);
});
