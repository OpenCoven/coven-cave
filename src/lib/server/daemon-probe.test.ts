import assert from "node:assert/strict";
import test from "node:test";
import { daemonHealthRequest } from "./daemon-health-request.ts";
import { probeDaemonUrl } from "./daemon-probe.ts";
import { HUB_ACCESS_TOKEN_KEY } from "../hub-access-token.ts";

test("reports a reachable healthy hub with latency", async () => {
  const result = await probeDaemonUrl("server.tailnet:8787", {
    call: async (target, request) => {
      assert.equal(target.mode, "hub");
      assert.equal(target.url, "http://server.tailnet:8787");
      assert.deepEqual(request, daemonHealthRequest());
      return { ok: true, status: 200, data: { ok: true } };
    },
    now: () => 42,
  });
  assert.deepEqual(result, { ok: true, reachable: true, status: 200, latencyMs: 0 });
});

test("classifies unauthorized hubs that answered", async () => {
  const result = await probeDaemonUrl("http://server.tailnet:8787", {
    call: async () => ({
      ok: false,
      status: 401,
      data: null,
      error: "unauthorized",
    }),
    now: () => 10,
  });
  assert.deepEqual(result, {
    ok: true,
    reachable: false,
    status: 401,
    latencyMs: 0,
    reason: "hub unauthorized: unauthorized",
  });
});

test("treats explicit unhealthy health payloads as answered but unreachable", async () => {
  const result = await probeDaemonUrl("http://server.tailnet:8787", {
    call: async () => ({
      ok: true,
      status: 200,
      data: { ok: false },
    }),
    now: () => 10,
  });
  assert.deepEqual(result, {
    ok: true,
    reachable: false,
    status: 200,
    latencyMs: 0,
    reason: "hub unhealthy: http 200",
  });
});

test("preserves legacy healthy payloads without ok", async () => {
  const result = await probeDaemonUrl("http://server.tailnet:8787", {
    call: async () => ({
      ok: true,
      status: 200,
      data: { apiVersion: "1" },
    }),
    now: () => 10,
  });
  assert.deepEqual(result, {
    ok: true,
    reachable: true,
    status: 200,
    latencyMs: 0,
  });
});

test("classifies transport failures as unreachable", async () => {
  const result = await probeDaemonUrl("http://server.tailnet:8787", {
    call: async () => ({
      ok: false,
      status: 0,
      data: null,
      error: "daemon timeout",
    }),
    now: () => 100,
  });
  assert.deepEqual(result, {
    ok: true,
    reachable: false,
    status: 0,
    latencyMs: 0,
    reason: "hub unreachable: daemon timeout",
  });
});

test("never forwards the process-wide credential to an ad-hoc probe origin", async () => {
  const previous = process.env[HUB_ACCESS_TOKEN_KEY];
  process.env[HUB_ACCESS_TOKEN_KEY] = "global-secret";
  try {
    await probeDaemonUrl("https://attacker.example.test:8443", async (target) => {
      assert.equal(target.mode, "hub");
      assert.equal(target.accessToken, undefined);
      return { ok: true, status: 200, data: { ok: true } };
    });
  } finally {
    if (previous === undefined) delete process.env[HUB_ACCESS_TOKEN_KEY];
    else process.env[HUB_ACCESS_TOKEN_KEY] = previous;
  }
});
