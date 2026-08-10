// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { probeDaemonUrl } from "../../../../lib/server/daemon-probe.ts";

test("probe helper accepts a stubbed daemon caller for route-level outcomes", async () => {
  const result = await probeDaemonUrl("http://hub.tailnet:8787", async () => ({
    ok: false,
    status: 503,
    data: null,
    error: "maintenance",
  }), () => 5);
  assert.equal(result.reachable, false);
  assert.equal(result.reason, "hub unhealthy: maintenance");
});

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(route, /export const runtime = "nodejs"/);
assert.match(route, /export const dynamic = "force-dynamic"/);
assert.match(
  route,
  /probeDaemonUrl\(url, undefined, Date\.now, diagnostics\)/,
  "the route passes its correlation context into the health probe",
);
assert.match(route, /invalid hub URL/);
