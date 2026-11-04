// The live half of the upstream suite: upstreamFetch must classify each
// answer on arrival, heal a single transient fault inside the same call for
// reads only, honour a host's Retry-After with a cooldown that half-opens and
// closes the moment a call succeeds, and publish all of it as a ledger with
// no payloads in it.
import assert from "node:assert/strict";
import test from "node:test";

import { installUpstreamAnomalyFetch } from "../testing/upstream-anomaly-fetch.ts";
import {
  UPSTREAM_COOLDOWN_HEADER,
  UPSTREAM_FAILURES_BEFORE_COOLDOWN,
  UpstreamCooldownError,
  classifyUpstreamError,
  classifyUpstreamResponse,
  parseRetryAfterMs,
  resetUpstreamHealth,
  setUpstreamClockForTests,
  upstreamFetch,
  upstreamHealth,
  upstreamHealthSnapshot,
} from "./upstream-fetch.ts";

let now = Date.UTC(2026, 0, 1);
setUpstreamClockForTests(() => now);
const harness = installUpstreamAnomalyFetch({ hangMs: 5, isolateLedger: false });
harness.healthy("github", () => Response.json({ login: "octocat" }));
const URL_USER = "https://api.github.com/user";
test.after(() => {
  harness.restore();
  setUpstreamClockForTests(null);
});
test.beforeEach(() => {
  resetUpstreamHealth();
  harness.heal();
  harness.reset();
});

test("a healthy answer is classified clean and the ledger says healthy", async () => {
  const res = await upstreamFetch("github", URL_USER);
  assert.equal(res.status, 200);
  const health = upstreamHealth("github");
  assert.equal(health.state, "healthy");
  assert.equal(health.calls, 1);
  assert.equal(health.lastSuccessAt, now);
  assert.equal(harness.calls("github")[0]?.hasDeadline, true, "every call carries a deadline");
});

test("a single 5xx on a read heals inside the call: one retry, caller sees 200", async () => {
  let first = true;
  harness.healthy("github", () => {
    if (first) {
      first = false;
      return Response.json({ message: "boom" }, { status: 503 });
    }
    return Response.json({ login: "octocat" });
  });
  const res = await upstreamFetch("github", URL_USER);
  assert.equal(res.status, 200);
  assert.equal(harness.calls("github").length, 2);
  const health = upstreamHealth("github");
  assert.equal(health.retries, 1);
  assert.equal(health.state, "healthy", "the success closed the episode at once");
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastAnomaly?.class, "server-error", "the anomaly was still recorded");
});

test("a persistent 5xx returns the last answer after the retry and marks the host degraded", async () => {
  harness.inject("github", { kind: "http", status: 500 });
  const res = await upstreamFetch("github", URL_USER);
  assert.equal(res.status, 500);
  assert.equal(harness.calls("github").length, 2);
  assert.equal(upstreamHealth("github").state, "degraded");
  assert.equal(upstreamHealth("github").consecutiveFailures, 2);
});

test("writes are never retried", async () => {
  harness.inject("github", { kind: "http", status: 502 });
  const res = await upstreamFetch("github", URL_USER, { method: "POST", body: "{}" });
  assert.equal(res.status, 502);
  assert.equal(harness.calls("github").length, 1, "a POST after an ambiguous outcome could double-post");
});

test("timeouts and dead sockets are classified, retried once on reads, then surfaced unchanged", async () => {
  harness.inject("github", { kind: "timeout" });
  await assert.rejects(upstreamFetch("github", URL_USER, {}, { timeoutMs: 20 }), (e: Error) => e.name === "TimeoutError");
  assert.equal(harness.calls("github").length, 2);
  assert.equal(upstreamHealth("github").lastAnomaly?.class, "timeout");
  harness.reset();
  harness.inject("github", { kind: "network" });
  await assert.rejects(upstreamFetch("github", URL_USER), TypeError);
  assert.equal(upstreamHealth("github").lastAnomaly?.class, "network");
});

test("the caller's own abort wins immediately and is not retried", async () => {
  harness.inject("github", { kind: "timeout" });
  const controller = new AbortController();
  const pending = upstreamFetch("github", URL_USER, { signal: controller.signal });
  controller.abort(new DOMException("caller left", "AbortError"));
  await assert.rejects(pending, (e: DOMException) => e.name === "AbortError" && e.message === "caller left");
  assert.equal(harness.calls("github").length, 1);
});

test("a short Retry-After is waited out inside the call; a long one opens a cooldown that half-opens", async () => {
  // Short: 1 s under the 2 s cap → one wait, one retry, 200.
  let limited = true;
  harness.healthy("github", () => {
    if (limited) {
      limited = false;
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    }
    return Response.json({ login: "octocat" });
  });
  assert.equal((await upstreamFetch("github", URL_USER)).status, 200);
  assert.equal(harness.calls("github").length, 2);

  // Long: 7 s over the cap → returned as-is and the host cools for 7 s.
  harness.reset();
  harness.inject("github", { kind: "rate-limit", retryAfterSeconds: 7 });
  const limitedRes = await upstreamFetch("github", URL_USER);
  assert.equal(limitedRes.status, 429);
  assert.equal(harness.calls("github").length, 1, "no retry against an explicit long Retry-After");
  const cooling = upstreamHealth("github");
  assert.equal(cooling.state, "cooling");
  assert.equal(cooling.coolingUntil, now + 7_000);

  // Inside the window: answered at once with the host's own verdict, no network.
  harness.heal("github");
  harness.reset();
  const held = await upstreamFetch("github", URL_USER);
  assert.equal(held.status, 429, "callers keep their rate-limit branch");
  assert.equal(held.headers.get("retry-after"), "7");
  assert.equal(held.headers.get(UPSTREAM_COOLDOWN_HEADER), "1");
  assert.equal(harness.calls("github").length, 0);
  assert.equal(upstreamHealth("github").failedFast, 1);
  assert.equal(upstreamHealth("github").coolingReason, "rate-limited");

  // A deliberate probe can bypass it.
  assert.equal((await upstreamFetch("github", URL_USER, {}, { honorCooldown: false })).status, 200);

  // After the window: half-open, the call goes through and a success closes it.
  resetUpstreamHealth();
  harness.inject("github", { kind: "rate-limit", retryAfterSeconds: 7 });
  await upstreamFetch("github", URL_USER);
  harness.heal("github");
  now += 7_001;
  harness.reset();
  assert.equal((await upstreamFetch("github", URL_USER)).status, 200);
  assert.equal(harness.calls("github").length, 1);
  assert.equal(upstreamHealth("github").state, "healthy");
  assert.equal(upstreamHealth("github").coolingUntil, null);
});

test("a GitHub primary rate limit (403 with no remaining budget) counts as rate-limited", () => {
  const res = new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(now / 1000) + 30) } });
  assert.equal(classifyUpstreamResponse(res), "rate-limited");
  const parsed = parseRetryAfterMs(res.headers, now);
  assert.ok(parsed !== null && Math.abs(parsed - 30_000) <= 1_000, `reset header parsed to ${parsed}`);
  assert.equal(classifyUpstreamResponse(new Response("{}", { status: 403 })), "forbidden");
  assert.equal(classifyUpstreamResponse(new Response("{}", { status: 401 })), "unauthorized");
  assert.equal(classifyUpstreamResponse(new Response("{}", { status: 404 })), "not-found");
  assert.equal(classifyUpstreamResponse(new Response("{}", { status: 422 })), "client-error");
  assert.equal(classifyUpstreamError(new DOMException("x", "TimeoutError")), "timeout");
  assert.equal(classifyUpstreamError(new TypeError("fetch failed")), "network");
});

test("repeated transport failures open a short cooldown so a dead host is not hammered", async () => {
  harness.inject("github", { kind: "network" });
  // Each read makes two attempts; the threshold is reached within the second call.
  await assert.rejects(upstreamFetch("github", URL_USER));
  await assert.rejects(upstreamFetch("github", URL_USER));
  const health = upstreamHealth("github");
  assert.ok(health.transportStreak >= UPSTREAM_FAILURES_BEFORE_COOLDOWN);
  assert.equal(health.state, "cooling");
  harness.heal("github");
  harness.reset();
  await assert.rejects(upstreamFetch("github", URL_USER), (e: Error) => e instanceof UpstreamCooldownError && e instanceof TypeError && /cooling down for 5s/.test(e.message));
  assert.equal(harness.calls("github").length, 0);
  assert.equal(upstreamHealth("github").coolingReason, "unreachable");
  now += 5_001;
  assert.equal((await upstreamFetch("github", URL_USER)).status, 200, "the first call after the cooldown heals the host");
  assert.equal(upstreamHealth("github").state, "healthy");
});

test("a host that keeps answering 5xx degrades but is never cut off — it is reachable", async () => {
  harness.inject("github", { kind: "http", status: 503 });
  for (let i = 0; i < 4; i += 1) assert.equal((await upstreamFetch("github", URL_USER)).status, 503);
  const health = upstreamHealth("github");
  assert.equal(health.state, "degraded");
  assert.equal(health.coolingUntil, null);
  assert.equal(health.transportStreak, 0);
  assert.ok(health.consecutiveFailures >= 4);
});

test("a definite 4xx is not a host fault: no retry, no degradation, still recorded", async () => {
  harness.inject("github", { kind: "auth-revoked" });
  const res = await upstreamFetch("github", URL_USER);
  assert.equal(res.status, 401);
  assert.equal(harness.calls("github").length, 1);
  const health = upstreamHealth("github");
  assert.equal(health.state, "healthy");
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.lastAnomaly?.class, "unauthorized");
});

test("the snapshot carries counters and classes only — never a URL, header, body or token", async () => {
  await upstreamFetch("github", `${URL_USER}?token=ghp_secret`, { headers: { authorization: "Bearer ghp_secret" } });
  const text = JSON.stringify(upstreamHealthSnapshot());
  assert.doesNotMatch(text, /ghp_secret|api\.github\.com|authorization/);
  assert.deepEqual(Object.keys(upstreamHealthSnapshot()), ["github"]);
});

test("a bare response-like object from an injected fetch is classified, not crashed on", async () => {
  const bare = async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response;
  const res = await upstreamFetch("github", URL_USER, {}, { fetchImpl: bare });
  assert.equal(res.status, 403);
  assert.equal(upstreamHealth("github").lastAnomaly?.class, "forbidden");
});

test("a long Retry-After is honoured in full, not shortened to the transport cooldown", async () => {
  resetUpstreamHealth();
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("{}", { status: 429, headers: { "retry-after": "120" } });
  }) as typeof fetch;
  const ask = () => upstreamFetch("github", "https://api.github.com/user", {}, { fetchImpl, retries: 0 });
  await ask();
  now += 60_001;
  await ask();
  assert.equal(calls, 1, "still cooling at 60s: the host asked for 120");
  now += 60_000;
  await ask();
  assert.equal(calls, 2, "the wait is over");
  resetUpstreamHealth();
});
