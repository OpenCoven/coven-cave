// GET /api/asana/workspaces under every upstream anomaly (#6359).
//
// One upstream call — the connected user's workspaces — and two degraded
// contracts: a non-2xx or a transport failure is a 502 with no workspaces
// (`configured: true` so the Studio keeps showing the connection, `ok: false`
// so it does not show an empty picker as the truth); an unreadable body is
// an empty but ok answer. The token never appears in a body, and nothing is
// cached, so the first call after Asana recovers is live.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../../../../lib/testing/upstream-anomaly-fetch.ts";
import { expectErrorStatus, runUpstreamAnomalyMatrix, type MatrixOutcome } from "../../../../lib/testing/upstream-anomaly-matrix.ts";
import { isolateCaveHome } from "../../../../lib/testing/scratch-cave-home.ts";

const home = isolateCaveHome("asana-workspaces-anomalies");
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
    assert.equal(url.searchParams.get("opt_fields"), "workspaces.name");
    return Response.json({ data: { gid: "u1", workspaces: [{ gid: "w1", name: "Coven" }, { gid: "w2", name: "  " }] } });
  }
  return Response.json({ errors: [{ message: "Not Found" }] }, { status: 404 });
});

const emptyButOk = (outcome: MatrixOutcome) => {
  assert.equal(outcome.status, 200, outcome.text);
  assert.deepEqual(outcome.body, { ok: true, configured: true, workspaces: [] });
};

const unavailable = (outcome: MatrixOutcome, anomaly: Parameters<ReturnType<typeof expectErrorStatus>>[1]) => {
  expectErrorStatus(502)(outcome, anomaly);
  const body = outcome.body as { ok: boolean; configured: boolean; workspaces: unknown[]; error: string };
  assert.equal(body.configured, true, "an outage does not read as 'not connected'");
  assert.deepEqual(body.workspaces, []);
  assert.equal(typeof body.error, "string");
};

test("GET /api/asana/workspaces across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "asana",
    secrets: [PAT],
    invoke: () => GET(),
    healthy: (outcome) => {
      assert.equal(outcome.status, 200, outcome.text);
      assert.deepEqual(outcome.body, {
        ok: true,
        configured: true,
        workspaces: [{ gid: "w1", name: "Coven" }, { gid: "w2", name: "w2" }],
      });
    },
    degraded: {
      "http-500": unavailable,
      "http-502": unavailable,
      "auth-revoked": (outcome, anomaly) => {
        // The route has no reconnect contract of its own: a revoked token is
        // reported as the upstream status it was (see the finding in the report).
        unavailable(outcome, anomaly);
        assert.match((outcome.body as { error: string }).error, /HTTP 401/);
      },
      "rate-limit": unavailable,
      timeout: unavailable,
      network: unavailable,
      "malformed-json": emptyButOk,
      "empty-body": emptyButOk,
      "schema-drift": emptyButOk,
    },
  });
});

test("without a token the route answers unconfigured without touching Asana", async () => {
  delete process.env.ASANA_PAT;
  harness.reset();
  try {
    const body = await (await GET()).json();
    assert.deepEqual(body, { ok: true, configured: false, workspaces: [] });
    assert.equal(harness.calls().length, 0);
  } finally {
    process.env.ASANA_PAT = PAT;
  }
});
