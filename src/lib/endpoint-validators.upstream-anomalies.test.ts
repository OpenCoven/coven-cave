// checkMcpEndpoint under every upstream anomaly (#6359).
//
// The probe answers one question — is the user's remote MCP endpoint live? —
// and must never throw at a configuration form. The endpoint host is
// user-supplied, so the registry's `mcp-endpoint` entry declares no fixed
// host; the harness here runs on a one-entry registry naming the fake host.
// Classification is what the matrix pins: any HTTP answer, 401/403 included,
// is "reachable" (auth happens in-client on connect); only a transport
// failure or a stalled socket is "unreachable". No credential is involved.
import assert from "node:assert/strict";
import test from "node:test";

import { checkMcpEndpoint } from "./endpoint-validators.ts";
import type { UpstreamApiEntry } from "./server/upstream-api-registry.ts";
import { installUpstreamAnomalyFetch } from "./testing/upstream-anomaly-fetch.ts";
import { runUpstreamAnomalyMatrix, type MatrixOutcome } from "./testing/upstream-anomaly-matrix.ts";

const ENDPOINT = "https://mcp.example.test/mcp";
const registry: readonly UpstreamApiEntry[] = [
  {
    id: "mcp-endpoint",
    name: "Remote MCP endpoint",
    purpose: "Reachability probe of a user-configured remote MCP server (test host).",
    hosts: ["mcp.example.test"],
    auth: "none",
    userSupplied: true,
    callers: ["src/lib/endpoint-validators.ts"],
  },
];

const harness = installUpstreamAnomalyFetch({ registry, install: false });
test.after(() => harness.restore());

harness.healthy("mcp-endpoint", async (request) => {
  assert.equal(request.method, "POST");
  const body = JSON.parse(await request.text()) as { jsonrpc: string; method: string };
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.method, "initialize");
  return Response.json({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {} } });
});

type Check = { reachable: boolean; detail?: string; error?: string };

const live = (outcome: MatrixOutcome) => {
  const check = outcome.body as Check;
  assert.equal(check.reachable, true);
  assert.match(check.detail ?? "", /live/);
};

const reachableWithStatus = (status: number) => (outcome: MatrixOutcome) => {
  const check = outcome.body as Check;
  assert.equal(check.reachable, true, "an HTTP answer of any status proves the endpoint is up");
  assert.match(check.detail ?? "", new RegExp(`HTTP ${status}`));
};

const unreachable = (outcome: MatrixOutcome) => {
  const check = outcome.body as Check;
  assert.equal(check.reachable, false);
  assert.match(check.error ?? "", /could not reach/);
  assert.equal(check.detail, undefined);
};

test("checkMcpEndpoint across upstream anomalies", async (t) => {
  await runUpstreamAnomalyMatrix(t, {
    harness,
    id: "mcp-endpoint",
    invoke: () => checkMcpEndpoint(ENDPOINT, harness.fetch),
    healthy: live,
    degraded: {
      "http-500": reachableWithStatus(500),
      "http-502": reachableWithStatus(502),
      "auth-revoked": (outcome) => {
        const check = outcome.body as Check;
        assert.equal(check.reachable, true, "a 401 is a live endpoint that wants OAuth on connect");
        assert.match(check.detail ?? "", /sign in on connect/);
      },
      "rate-limit": reachableWithStatus(429),
      timeout: unreachable,
      network: unreachable,
      // A 2xx with any body is "live": the probe does not parse the reply.
      "malformed-json": live,
      "empty-body": live,
      "schema-drift": live,
    },
  });
});

test("a 403 classifies like a 401: reachable, sign in on connect", async () => {
  harness.inject("mcp-endpoint", { kind: "http", status: 403, body: { error: "forbidden" } });
  const check = await checkMcpEndpoint(ENDPOINT, harness.fetch);
  assert.equal(check.reachable, true);
  assert.match(check.detail ?? "", /sign in on connect/);
  harness.heal("mcp-endpoint");
});

test("the probe carries a deadline and only ever reaches the declared host", () => {
  for (const call of harness.calls()) {
    assert.equal(call.hasDeadline, true, call.url);
    assert.equal(call.host, "mcp.example.test");
  }
  harness.assertAllDeclared();
});

test("an undeclared host is refused by the harness and reads as unreachable, not a crash", async () => {
  harness.reset();
  const check = await checkMcpEndpoint("https://somewhere-else.example/mcp", harness.fetch);
  assert.equal(check.reachable, false);
  assert.equal(harness.undeclared().length, 1);
  harness.reset();
});
