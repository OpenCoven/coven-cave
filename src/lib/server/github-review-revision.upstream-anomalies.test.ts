// readGitHubPullRevision / assertCurrentGitHubRevision under every upstream
// anomaly (#6359).
//
// This library's contract is a typed throw: GitHubRevisionError carries the
// status the review route should answer with. The matrix runs with `mayThrow`
// and pins the mapping — 404 and 403 pass through, every other HTTP failure
// and an unusable body become 502 — and proves the token never rides along in
// a message. It also records which failures escape as untyped errors today.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "../testing/upstream-anomaly-matrix.ts";
import { GitHubRevisionError, assertCurrentGitHubRevision, readGitHubPullRevision } from "./github-review-revision.ts";

const TOKEN = "ghp_revisiononly_never_dispatched_0f0f0f0f0f0f0f0f";
const REPO = "OpenCoven/coven-cave";
const NUMBER = 6359;
const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

// The module reads globalThis.fetch, so the harness is installed for real.
const harness = installUpstreamAnomalyFetch();
test.after(() => harness.restore());

harness.healthy("github", (request) => {
  const url = new URL(request.url);
  assert.equal(url.pathname, `/repos/${REPO}/pulls/${NUMBER}`);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  return Response.json({
    number: NUMBER,
    head: { sha: HEAD_SHA.toUpperCase(), ref: "test/issue-6359" },
    base: { sha: BASE_SHA, ref: "main" },
  });
});

const read = () => readGitHubPullRevision(REPO, NUMBER, TOKEN);

const typedStatus = (status: number, message?: RegExp) => (outcome: MatrixOutcome) => {
  assert.ok(outcome.threw instanceof GitHubRevisionError, `expected GitHubRevisionError, got ${outcome.text}`);
  assert.equal(outcome.threw.status, status);
  if (message) assert.match(outcome.threw.message, message);
};

const untyped = (name: string) => (outcome: MatrixOutcome) => {
  // Documented, not endorsed: a transport or parse failure escapes as the raw
  // error, so the route's `instanceof GitHubRevisionError` branch cannot map
  // it to a status. See the report for src/lib/server/github-review-revision.ts:19,31.
  assert.ok(outcome.threw instanceof Error, `expected a thrown error, got ${outcome.text}`);
  assert.ok(!(outcome.threw instanceof GitHubRevisionError), "this failure is not mapped to a GitHubRevisionError today");
  assert.equal(outcome.threw.name, name);
};

test("readGitHubPullRevision across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    mayThrow: true,
    invoke: read,
    healthy: (outcome) => {
      assert.deepEqual(outcome.value, { repo: REPO, number: NUMBER, headSha: HEAD_SHA, baseSha: BASE_SHA, baseRef: "main" });
    },
    degraded: {
      "http-500": typedStatus(502, /github error \(500\)/),
      "http-502": typedStatus(502, /github error \(502\)/),
      // A revoked token is 401 at GitHub; only 403 and 404 pass through, so it
      // surfaces as a 502 "github error (401)".
      "auth-revoked": typedStatus(502, /github error \(401\)/),
      "rate-limit": typedStatus(502, /github error \(429\)/),
      timeout: untyped("TimeoutError"),
      network: untyped("TypeError"),
      "malformed-json": untyped("SyntaxError"),
      "empty-body": untyped("SyntaxError"),
      // Well-formed JSON without head/base is "revision unavailable", a 502.
      "schema-drift": typedStatus(502, /revision is unavailable/),
    },
  });
});

test("404 and 403 pass through with their own status; everything else is 502", async () => {
  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  await assert.rejects(read, (error: unknown) => error instanceof GitHubRevisionError && error.status === 404 && error.message === "not_found");

  harness.inject("github", { kind: "http", status: 403, body: { message: "Resource not accessible by personal access token" } });
  await assert.rejects(read, (error: unknown) => error instanceof GitHubRevisionError && error.status === 403 && /github error \(403\)/.test(error.message));

  harness.inject("github", { kind: "rate-limit", status: 403 });
  await assert.rejects(read, (error: unknown) => error instanceof GitHubRevisionError && error.status === 403, "a primary rate limit is a 403 and passes through as one");

  harness.inject("github", { kind: "http", status: 422, body: { message: "Validation Failed" } });
  await assert.rejects(read, (error: unknown) => error instanceof GitHubRevisionError && error.status === 502);

  harness.heal("github");
  assert.equal((await read()).headSha, HEAD_SHA);
});

test("a malformed sha in an otherwise healthy answer is 'revision unavailable'", async () => {
  harness.inject("github", { kind: "schema-drift", body: { head: { sha: "not-a-sha" }, base: { sha: BASE_SHA, ref: "main" } } });
  await assert.rejects(read, (error: unknown) => error instanceof GitHubRevisionError && error.status === 502 && /unavailable/.test(error.message));
  harness.heal("github");
});

test("assertCurrentGitHubRevision: 409 when the head moved, silent when it matches, no call without a head", async () => {
  harness.reset();
  await assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, null, null);
  assert.equal(harness.calls("github").length, 0, "no reviewed head means no revision check");

  await assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, HEAD_SHA, null);
  await assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, HEAD_SHA, {
    repo: REPO, number: NUMBER, baseRef: "main", baseSha: BASE_SHA, headSha: HEAD_SHA, mergeBaseSha: BASE_SHA,
  });

  await assert.rejects(
    () => assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, "c".repeat(40), null),
    (error: unknown) => error instanceof GitHubRevisionError && error.status === 409 && /revision changed/i.test(error.message),
  );
  await assert.rejects(
    () => assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, HEAD_SHA, {
      repo: REPO, number: NUMBER, baseRef: "release", baseSha: BASE_SHA, headSha: HEAD_SHA, mergeBaseSha: BASE_SHA,
    }),
    (error: unknown) => error instanceof GitHubRevisionError && error.status === 409,
    "a moved base is a changed revision even with the same head",
  );

  // The upstream failing during the check propagates its own mapping, never a 409.
  harness.inject("github", { kind: "http", status: 500 });
  await assert.rejects(
    () => assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, HEAD_SHA, null),
    (error: unknown) => error instanceof GitHubRevisionError && error.status === 502,
  );
  harness.heal("github");
  await assertCurrentGitHubRevision(REPO, NUMBER, TOKEN, HEAD_SHA, null);
  harness.assertAllDeclared();
});

test("the revision read carries no deadline of its own", () => {
  // Documented, not endorsed: see the report for src/lib/server/github-review-revision.ts:19.
  const call = harness.calls("github").at(-1);
  assert.ok(call);
  assert.equal(call.hasDeadline, false);
});
