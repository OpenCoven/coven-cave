// @ts-nocheck
import assert from "node:assert/strict";

const {
  checkExecutorAvailability,
  normalizeExecutorUrl,
} = await import("./executor-status.ts");

assert.equal(
  normalizeExecutorUrl(" executor-1.tailnet:8787/ "),
  "http://executor-1.tailnet:8787",
  "executor address shorthand should normalize to an HTTP private-network target",
);

assert.equal(
  normalizeExecutorUrl("https://executor-2.tailnet:9443/"),
  "https://executor-2.tailnet:9443",
  "executor HTTPS targets should preserve their scheme",
);

{
  const calls = [];
  const statuses = await checkExecutorAvailability(
    [
      "executor-1.tailnet:8787",
      "executor-1.tailnet:8787",
      "https://executor-2.tailnet:9443/",
      "",
      "executor-3.tailnet:8787",
    ],
    {
      timeoutMs: 25,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).startsWith("http://executor-1.tailnet:8787/")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (String(url).startsWith("https://executor-2.tailnet:9443/")) {
          return new Response(JSON.stringify({ ok: false }), { status: 200 });
        }
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      },
    },
  );

  assert.deepEqual(calls, [
    "http://executor-1.tailnet:8787/api/v1/health",
    "https://executor-2.tailnet:9443/api/v1/health",
    "http://executor-3.tailnet:8787/api/v1/health",
  ]);
  assert.deepEqual(statuses, [
    {
      url: "http://executor-1.tailnet:8787",
      healthUrl: "http://executor-1.tailnet:8787/api/v1/health",
      ok: true,
      state: "available",
      detail: "executor reachable",
    },
    {
      url: "https://executor-2.tailnet:9443",
      healthUrl: "https://executor-2.tailnet:9443/api/v1/health",
      ok: false,
      state: "unreachable",
      detail: "executor reported unhealthy",
    },
    {
      url: "http://executor-3.tailnet:8787",
      healthUrl: "http://executor-3.tailnet:8787/api/v1/health",
      ok: false,
      state: "unreachable",
      detail: "executor offline",
    },
  ]);
}

console.log("executor-status.test.ts: ok");
