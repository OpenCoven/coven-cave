// POST and PATCH /api/github/issue under every upstream anomaly (#6359).
//
// Two writes, one upstream call each, both needing a PAT. A failed write is
// a 502 (403 and 404 pass through); PATCH forwards GitHub's own `message` so
// a 422 names the offending label. Neither verb caches or passes a deadline.
// The soft spot both share: a drifted 200 body is reported as a successful
// write of issue #0, since any object is accepted as the written issue.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import {
  expectErrorStatus,
  runUpstreamAnomalyMatrix,
  type DegradedExpectation,
} from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("github-issue-anomalies");
const TOKEN = "ghp_testonly_never_dispatched_issue_0123456789";
delete process.env.GITHUB_PAT;
process.env.GITHUB_TOKEN = TOKEN;

const harness = installUpstreamAnomalyFetch();
const { POST, PATCH } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("github", async (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${TOKEN}`, "the token travels as a bearer");
  assert.equal(request.headers.get("content-type"), "application/json");
  if (request.method === "POST" && url.pathname === "/repos/OpenCoven/coven-cave/issues") {
    const body = (await request.json()) as { title: string; body: string; labels?: string[] };
    assert.equal(body.title, "Ship the suite");
    assert.deepEqual(body.labels, ["bug"]);
    return Response.json(
      { number: 42, title: body.title, state: "open", html_url: "https://github.com/OpenCoven/coven-cave/issues/42" },
      { status: 201 },
    );
  }
  if (request.method === "PATCH" && url.pathname === "/repos/OpenCoven/coven-cave/issues/42") {
    const body = (await request.json()) as { state?: string; labels?: string[]; assignees?: string[] };
    assert.deepEqual(body, { state: "closed", labels: ["bug"] });
    return Response.json({
      number: 42,
      title: "Ship the suite",
      state: "closed",
      html_url: "https://github.com/OpenCoven/coven-cave/issues/42",
      labels: [{ name: "bug", color: "d73a4a" }],
      assignees: [],
    });
  }
  return Response.json({ message: "Not Found" }, { status: 404 });
});

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/github/issue", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const create = () => POST(json("POST", { repo: "OpenCoven/coven-cave", title: "Ship the suite", body: "Text", labels: ["bug"] }));
const update = () => PATCH(json("PATCH", { repo: "OpenCoven/coven-cave", number: 42, state: "closed", labels: ["bug"] }));

const errorMessage = (status: number, message: string): DegradedExpectation => (outcome, anomaly) => {
  expectErrorStatus(status)(outcome, anomaly);
  assert.equal((outcome.body as { error: string }).error, message);
};

const unreachable: DegradedExpectation = (outcome, anomaly) => {
  expectErrorStatus(502)(outcome, anomaly);
  assert.equal(typeof (outcome.body as { error: unknown }).error, "string", "the 502 says why");
};

const network: DegradedExpectation = (outcome, anomaly) => {
  unreachable(outcome, anomaly);
  assert.match((outcome.body as { error: string }).error, /fetch failed/);
};

test("POST /api/github/issue across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: create,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        issue: { number: 42, title: "Ship the suite", state: "open", htmlUrl: "https://github.com/OpenCoven/coven-cave/issues/42" },
      });
    },
    degraded: {
      "http-500": errorMessage(502, "github error (500)"),
      "http-502": errorMessage(502, "github error (502)"),
      "auth-revoked": errorMessage(502, "github error (401)"),
      "rate-limit": errorMessage(502, "github error (429)"),
      timeout: unreachable,
      network,
      "malformed-json": errorMessage(502, "github error (200)"),
      "empty-body": errorMessage(502, "github error (200)"),
      "schema-drift": (outcome) => {
        // Any object is taken as the created issue: number 0, no title.
        assert.equal(outcome.status, 200);
        assert.deepEqual(outcome.body, { ok: true, issue: { number: 0, title: "", state: "open", htmlUrl: null } });
      },
    },
  });
});

test("PATCH /api/github/issue across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "github",
    secrets: [TOKEN],
    invoke: update,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        issue: { number: 42, title: "Ship the suite", state: "closed", htmlUrl: "https://github.com/OpenCoven/coven-cave/issues/42" },
        labels: ["bug"],
      });
    },
    degraded: {
      // PATCH forwards GitHub's own message when the body carries one.
      "http-500": errorMessage(502, "Internal Server Error"),
      "http-502": errorMessage(502, "github error (502)"),
      "auth-revoked": errorMessage(502, "Bad credentials"),
      "rate-limit": errorMessage(502, "API rate limit exceeded"),
      timeout: unreachable,
      network,
      "malformed-json": errorMessage(502, "github error (200)"),
      "empty-body": errorMessage(502, "github error (200)"),
      "schema-drift": (outcome) => {
        assert.equal(outcome.status, 200);
        assert.deepEqual(outcome.body, { ok: true, issue: { number: 0, title: "", state: "open", htmlUrl: null }, labels: [] });
      },
    },
  });
});

test("a 422 names the offending label and 403/404 keep their status", async () => {
  harness.inject("github", { kind: "http", status: 422, body: { message: "Validation Failed: label 'nope' not found" } });
  const response = await update();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "Validation Failed: label 'nope' not found" });

  harness.inject("github", { kind: "http", status: 404, body: { message: "Not Found" } });
  assert.equal((await create()).status, 404);
  assert.equal((await update()).status, 404);
  harness.inject("github", { kind: "http", status: 403, body: { message: "Forbidden" } });
  assert.equal((await create()).status, 403);
  harness.heal("github");
  assert.equal((await create()).status, 200);
});

test("without a token a write is refused before GitHub is contacted", async () => {
  delete process.env.GITHUB_TOKEN;
  harness.reset();
  try {
    assert.deepEqual(await (await create()).json(), { ok: false, error: "auth_required" });
    assert.deepEqual(await (await update()).json(), { ok: false, error: "auth_required" });
    assert.equal(harness.calls().length, 0);
  } finally {
    process.env.GITHUB_TOKEN = TOKEN;
  }
});

test("a malformed request body is a 400, not a crash", async () => {
  harness.reset();
  const response = await POST(new Request("http://localhost/api/github/issue", { method: "POST", body: "{not json" }));
  assert.equal(response.status, 400);
  assert.equal(harness.calls().length, 0);
});
