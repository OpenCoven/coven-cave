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

test("probe helper omits stored hub credentials for candidate URLs", async () => {
  const previous = process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;
  process.env.COVEN_CAVE_HUB_ACCESS_TOKEN = "stored-secret";
  try {
    let authorization: string | undefined;
    await probeDaemonUrl("http://candidate.tailnet:8787", async (target) => {
      authorization = target.mode === "hub" ? target.accessToken : undefined;
      return { ok: true, status: 200, data: { ok: true } };
    });
    assert.equal(authorization, undefined);
  } finally {
    if (previous === undefined) delete process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;
    else process.env.COVEN_CAVE_HUB_ACCESS_TOKEN = previous;
  }
});

test("probe helper keeps an explicitly supplied candidate token", async () => {
  const previous = process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;
  process.env.COVEN_CAVE_HUB_ACCESS_TOKEN = "stored-secret";
  try {
    let authorization: string | undefined;
    await probeDaemonUrl(
      "http://candidate.tailnet:8787?coven_access_token=explicit-secret",
      async (target) => {
        authorization = target.mode === "hub" ? target.accessToken : undefined;
        return { ok: true, status: 200, data: { ok: true } };
      },
    );
    assert.equal(authorization, "explicit-secret");
  } finally {
    if (previous === undefined) delete process.env.COVEN_CAVE_HUB_ACCESS_TOKEN;
    else process.env.COVEN_CAVE_HUB_ACCESS_TOKEN = previous;
  }
});

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
assert.match(route, /export const runtime = "nodejs"/);
assert.match(route, /export const dynamic = "force-dynamic"/);
assert.match(route, /probeDaemonUrl\(url\)/);
assert.match(route, /invalid hub URL/);
