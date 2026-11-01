// POST /api/github/merge under every upstream anomaly (#6359).
//
// Two shapes of call. With a reviewed head the route first reads the PR to
// prove the head has not moved, and under anomaly it is that read that
// fails: the merge is never attempted, so nothing lands while GitHub is
// unreadable. Without a head (legacy callers) the PUT itself is driven
// through the matrix; success requires GitHub's own `merged: true`, so a
// torn, empty or drifted 200 is refused. The deleteBranch tidy is the one
// place the route is designed to say "the merge landed, the rest failed":
// a landed merge is never turned into an `ok: false` a caller might retry.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-merge-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_0123456789abcdef";
process.env.GITHUB_PAT = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGE_SHA = "c".repeat(40);

/** Per-path fault the healthy handler can model (the harness degrades a whole upstream). */
let refDeleteAnswer: () => Response = () => new Response(null, { status: 204 });

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`);
  if (request.method === "GET" && url.pathname === "/repos/o/r/pulls/7") {
    return Response.json({ head: { sha: HEAD, ref: "feat/x", repo: { full_name: "o/r" } }, base: { sha: BASE, ref: "main" } });
  }
  if (request.method === "PUT" && url.pathname === "/repos/o/r/pulls/7/merge") {
    const sent = (await request.json()) as { merge_method: string; sha?: string };
    assert.equal(sent.merge_method, "squash");
    return Response.json({ merged: true, sha: MERGE_SHA, message: "Pull Request successfully merged" });
  }
  if (request.method === "DELETE" && url.pathname === "/repos/o/r/git/refs/heads/feat/x") {
    return refDeleteAnswer();
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const merge = (extra: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/github/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r", number: 7, method: "squash", ...extra }),
    }),
  );

const failsWith = (status: number, error: string) => (outcome: MatrixOutcome) => {
  expectErrorStatus(status)(outcome, { kind: "http", status });
  assert.equal((outcome.body as { error: string }).error, error);
};
const timesOut = (outcome: MatrixOutcome) => {
  expectErrorStatus(502)(outcome, { kind: "timeout" });
  assert.match((outcome.body as { error: string }).error, /timeout/i);
};
const merged = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true, merged: true, sha: MERGE_SHA, branchDeleted: false, branchDeleteError: null });
};

test("POST /api/github/merge with a reviewed head across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => merge({ headSha: HEAD }),
    healthy: (outcome) => {
      merged(outcome);
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET", "PUT"], "the head is checked before the merge");
      assert.equal(JSON.parse(harness.calls("github")[1].body ?? "{}").sha, HEAD, "the reviewed head rides GitHub's atomic guard");
    },
    degraded: {
      "http-500": failsWith(502, "github error (500)"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "github error (401)"),
      "rate-limit": failsWith(502, "github error (429)"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      // The revision read parses the body without a guard; the SyntaxError
      // is caught by the route and reported as a 502, not thrown.
      "malformed-json": expectErrorStatus(502),
      "empty-body": expectErrorStatus(502),
      "schema-drift": failsWith(502, "Pull request revision is unavailable."),
    },
    beforeHeal: () => {
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET"], "an unreadable PR means no merge is attempted");
    },
  });
});

test("POST /api/github/merge without a head (legacy caller) across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: () => merge(),
    healthy: (outcome) => {
      merged(outcome);
      assert.deepEqual(harness.calls("github").map((call) => call.method), ["PUT"], "no head, no revision read");
    },
    degraded: {
      "http-500": failsWith(502, "Internal Server Error"),
      "http-502": failsWith(502, "github error (502)"),
      "auth-revoked": failsWith(502, "Bad credentials"),
      "rate-limit": failsWith(502, "API rate limit exceeded"),
      timeout: timesOut,
      network: failsWith(502, "fetch failed"),
      // Merging needs GitHub's own `merged: true`; a 200 without it is refused.
      "malformed-json": failsWith(502, "github error (200)"),
      "empty-body": failsWith(502, "github error (200)"),
      "schema-drift": failsWith(502, "github error (200)"),
    },
  });
});

test("a moved head is a 409 and the merge is never sent", async () => {
  harness.reset();
  const response = await merge({ headSha: "d".repeat(40) });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /revision changed/i);
  assert.deepEqual(harness.calls("github").map((call) => call.method), ["GET"]);
});

test("GitHub's 405/409 merge refusal passes its reason through as a 502", async () => {
  harness.inject("github", { kind: "http", status: 405, body: { message: "Required status check \"Frontend build\" is expected." } });
  const response = await merge();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "Required status check \"Frontend build\" is expected." });
  harness.heal("github");
});

test("a landed merge whose branch tidy fails is still ok: true (the designed unknown-outcome split)", async () => {
  refDeleteAnswer = () => Response.json({ message: "Reference does not exist" }, { status: 422 });
  try {
    const body = await (await merge({ deleteBranch: true })).json();
    assert.deepEqual(body, { ok: true, merged: true, sha: MERGE_SHA, branchDeleted: false, branchDeleteError: "Reference does not exist" });
  } finally {
    refDeleteAnswer = () => new Response(null, { status: 204 });
  }
  const tidy = await (await merge({ deleteBranch: true })).json();
  assert.deepEqual(tidy, { ok: true, merged: true, sha: MERGE_SHA, branchDeleted: true, branchDeleteError: null });
});

test("a 404 on the ref delete is 'already gone', the requested end state", async () => {
  refDeleteAnswer = () => Response.json({ message: "Not Found" }, { status: 404 });
  try {
    const body = await (await merge({ deleteBranch: true })).json();
    assert.equal(body.branchDeleted, true);
  } finally {
    refDeleteAnswer = () => new Response(null, { status: 204 });
  }
});

test("a stalled socket on the merge PUT itself is a plain failure (a retry re-sends the merge)", async () => {
  // Unlike the branch tidy, the PUT has no "may have landed" answer; GitHub's
  // sha guard and its own idempotence are the only protection against a retry.
  harness.inject("github", { kind: "timeout" });
  const body = await (await merge({ headSha: HEAD })).json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(JSON.stringify(body), /unknown|may have/i);
  harness.heal("github");
});

test("the merge calls carry no deadline (finding, not a contract)", async () => {
  assert.ok(harness.calls("github").length >= 1);
  assert.ok(harness.calls("github").every((call) => call.hasDeadline === false));
});
