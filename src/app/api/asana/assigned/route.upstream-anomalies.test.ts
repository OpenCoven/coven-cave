// GET /api/asana/assigned under every upstream anomaly (#6359).
//
// Two upstream calls per answer — identity, then tasks per workspace — and
// three distinct degraded contracts: a revoked PAT is a 200 with
// `patInvalid` so the UI offers reconnect; an outage, rate limit, stalled
// socket or dead network is a 502 with no items; an unreadable body is an
// empty but configured answer. None of them may throw, echo the token, or
// keep answering from the failure once Asana is back.
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("asana-assigned-anomalies");
const PAT = "asana-testonly-never-dispatched-1234567890";
process.env.ASANA_PAT = PAT;

const harness = installUpstreamAnomalyFetch();
const { GET } = await import("./route.ts");
test.after(() => {
  harness.restore();
  home.cleanup();
});

harness.healthy("asana", (request) => {
  const url = new URL(request.url);
  assert.equal(request.headers.get("authorization"), `Bearer ${PAT}`);
  if (url.pathname === "/api/1.0/users/me") {
    return Response.json({ data: { gid: "u1", name: "Val", workspaces: [{ gid: "w1", name: "Coven" }] } });
  }
  if (url.pathname === "/api/1.0/tasks") {
    assert.equal(url.searchParams.get("workspace"), "w1");
    return Response.json({
      data: [
        { gid: "t1", name: "Ship the suite", completed: false, due_on: "2026-11-02", modified_at: "2026-11-01T08:00:00Z", permalink_url: "https://app.asana.com/0/w1/t1" },
        { gid: "t2", name: "Already done", completed: true, modified_at: "2026-10-01T08:00:00Z" },
      ],
    });
  }
  return Response.json({ errors: [{ message: "Not Found" }] }, { status: 404 });
});

const read = () => GET(new NextRequest("http://localhost/api/asana/assigned"));

const emptyButConfigured = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { ok: true, items: [], configured: true, assigned: true });
};

test("GET /api/asana/assigned across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "asana",
    secrets: [PAT],
    invoke: read,
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      const body = outcome.body as { ok: boolean; configured: boolean; items: Array<{ gid: string; title: string; workspaceGid: string }> };
      assert.equal(body.ok, true);
      assert.equal(body.configured, true);
      assert.deepEqual(body.items.map((item) => item.gid), ["t1"], "completed tasks are filtered out");
      assert.equal(body.items[0].workspaceGid, "w1");
    },
    degraded: {
      "auth-revoked": (outcome) => {
        assert.equal(outcome.status, 200, "a revoked token is a reconnect prompt, not an error page");
        const body = outcome.body as { ok: boolean; patInvalid: boolean; configured: boolean; items: unknown[] };
        assert.equal(body.ok, false);
        assert.equal(body.patInvalid, true);
        assert.equal(body.configured, true);
        assert.deepEqual(body.items, []);
      },
      "http-500": expectErrorStatus(502),
      "http-502": expectErrorStatus(502),
      "rate-limit": expectErrorStatus(502),
      timeout: expectErrorStatus(502),
      network: expectErrorStatus(502),
      "malformed-json": emptyButConfigured,
      "empty-body": emptyButConfigured,
      "schema-drift": emptyButConfigured,
    },
  });
});

test("without a token the route answers unconfigured without touching Asana", async () => {
  delete process.env.ASANA_PAT;
  harness.reset();
  try {
    const body = await (await read()).json();
    assert.deepEqual(body, { ok: true, items: [], configured: false });
    assert.equal(harness.calls().length, 0);
  } finally {
    process.env.ASANA_PAT = PAT;
  }
});
