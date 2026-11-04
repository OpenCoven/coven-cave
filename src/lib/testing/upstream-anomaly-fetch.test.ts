// The harness is only worth trusting if its own switches are honest: a fault
// injected between two calls must land on the next call and nothing before it,
// a heal must take effect at once, an undeclared host must be refused and
// remembered, and a stalled call must honour the caller's deadline rather than
// the harness ceiling.
import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDARD_UPSTREAM_ANOMALIES,
  assertNoSecretLeak,
  installUpstreamAnomalyFetch,
} from "./upstream-anomaly-fetch.ts";
import { captureOutcome, runUpstreamAnomalyMatrix } from "./upstream-anomaly-matrix.ts";

const originalFetch = globalThis.fetch;

test("switching an anomaly live lands on the next call and heals on the next", async () => {
  const harness = installUpstreamAnomalyFetch();
  try {
    harness.healthy("github", () => Response.json({ login: "octocat" }));
    assert.equal((await (await fetch("https://api.github.com/user")).json()).login, "octocat");

    harness.inject("github", { kind: "http", status: 503 });
    assert.equal((await fetch("https://api.github.com/user")).status, 503);

    harness.heal("github");
    assert.equal((await fetch("https://api.github.com/user")).status, 200);

    const calls = harness.calls("github");
    assert.deepEqual(calls.map((call) => call.anomaly?.kind ?? "healthy"), ["healthy", "http", "healthy"]);
    harness.assertAllDeclared();
  } finally {
    harness.restore();
  }
  assert.equal(globalThis.fetch, originalFetch, "restore puts the previous fetch back");
});

test("an undeclared host is refused like a dead socket and remembered", async () => {
  const harness = installUpstreamAnomalyFetch();
  try {
    await assert.rejects(fetch("https://api.unlisted.example/v1"), (error: Error) => error instanceof TypeError && /undeclared upstream/.test(error.message));
    await assert.rejects(fetch("/api/board"), TypeError, "a relative URL is not an upstream either");
    assert.equal(harness.undeclared().length, 2);
    assert.throws(() => harness.assertAllDeclared(), /undeclared upstream: GET https:\/\/api\.unlisted\.example\/v1/);
  } finally {
    harness.restore();
  }
});

test("a declared upstream without a healthy handler is refused and reported", async () => {
  const harness = installUpstreamAnomalyFetch();
  try {
    await assert.rejects(fetch("https://api.elevenlabs.io/v1/models"), /no healthy handler registered for "elevenlabs"/);
    assert.equal(harness.unhandled().length, 1);
    assert.throws(() => harness.assertAllDeclared(), /no healthy handler for "elevenlabs"/);
  } finally {
    harness.restore();
  }
});

test("timeout honours the caller's own abort before the harness ceiling", async () => {
  const harness = installUpstreamAnomalyFetch({ hangMs: 5_000 });
  try {
    harness.inject("github", { kind: "timeout" });
    const controller = new AbortController();
    const pending = fetch("https://api.github.com/user", { signal: controller.signal });
    controller.abort(new DOMException("caller gave up", "AbortError"));
    await assert.rejects(pending, (error: DOMException) => error.name === "AbortError" && error.message === "caller gave up");
    assert.equal(harness.calls("github")[0]?.hasDeadline, true);
  } finally {
    harness.restore();
  }
});

test("timeout rejects an unbounded caller at the harness ceiling with a TimeoutError", async () => {
  const harness = installUpstreamAnomalyFetch({ hangMs: 10 });
  try {
    harness.inject("github", { kind: "timeout" });
    const started = Date.now();
    await assert.rejects(fetch("https://api.github.com/user"), (error: DOMException) => error.name === "TimeoutError");
    assert.ok(Date.now() - started < 1_000, "the ceiling is small so an unbounded route still fails fast under test");
    assert.equal(harness.calls("github")[0]?.hasDeadline, false, "the record shows the caller set no deadline");
  } finally {
    harness.restore();
  }
});

test("every standard anomaly produces the documented wire shape", async () => {
  const harness = installUpstreamAnomalyFetch({ hangMs: 5 });
  try {
    harness.healthy("asana", () => Response.json({ data: { gid: "1" } }));
    const url = "https://app.asana.com/api/1.0/users/me";
    const seen: string[] = [];
    for (const { name, anomaly } of STANDARD_UPSTREAM_ANOMALIES) {
      harness.inject("asana", anomaly);
      try {
        const response = await fetch(url);
        const text = await response.text();
        if (name === "malformed-json") assert.throws(() => JSON.parse(text));
        if (name === "empty-body") assert.equal(text, "");
        if (name === "schema-drift") assert.equal(JSON.parse(text).unexpected, true);
        if (name === "rate-limit") {
          assert.equal(response.status, 429);
          assert.equal(response.headers.get("retry-after"), "7");
          assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
        }
        if (name === "auth-revoked") assert.equal(response.status, 401);
        if (name === "http-500") assert.equal(response.status, 500);
        if (name === "http-502") assert.equal(response.headers.get("content-type"), "text/html");
        seen.push(`${name}:${response.status}`);
      } catch (error) {
        assert.ok(name === "timeout" || name === "network", `${name} should answer, not throw: ${String(error)}`);
        seen.push(`${name}:threw`);
      }
    }
    assert.equal(seen.length, STANDARD_UPSTREAM_ANOMALIES.length);
    harness.heal();
    assert.equal((await fetch(url)).status, 200, "heal() with no id heals everything");
  } finally {
    harness.restore();
  }
});

test("slow answers after its delay and can chain into another anomaly", async () => {
  const harness = installUpstreamAnomalyFetch();
  try {
    harness.healthy("sorsa", () => Response.json({ ok: true }));
    harness.inject("sorsa", { kind: "slow", delayMs: 5 });
    assert.equal((await fetch("https://api.sorsa.io/v3/article")).status, 200);
    harness.inject("sorsa", { kind: "slow", delayMs: 5, then: { kind: "http", status: 504 } });
    assert.equal((await fetch("https://api.sorsa.io/v3/article")).status, 504);
  } finally {
    harness.restore();
  }
});

test("calls record method, headers and body so a test can prove what was sent", async () => {
  const harness = installUpstreamAnomalyFetch();
  try {
    harness.healthy("openai", () => Response.json({ data: [] }));
    await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer sk-test", "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "a cat" }),
    });
    const [call] = harness.calls("openai");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, "Bearer sk-test");
    assert.equal(JSON.parse(call.body ?? "{}").prompt, "a cat");
    harness.reset();
    assert.equal(harness.calls().length, 0);
  } finally {
    harness.restore();
  }
});

test("assertNoSecretLeak catches a credential anywhere in the text", () => {
  assert.doesNotThrow(() => assertNoSecretLeak('{"ok":false}', ["ghp_secret"], "x"));
  assert.throws(() => assertNoSecretLeak('{"error":"bad token ghp_secret"}', ["ghp_secret"], "x"), /leaked a credential/);
});

test("the matrix runner fails a caller that remembers an outage past the heal", async (t) => {
  const harness = installUpstreamAnomalyFetch({ hangMs: 5 });
  t.after(() => harness.restore());
  harness.healthy("huggingface", () => Response.json({ title: "paper" }));

  // A caller with a sticky failure: once it sees one bad answer it never asks again.
  let poisoned = false;
  const stickyCaller = async () => {
    if (poisoned) return Response.json({ ok: false, error: "cached failure" }, { status: 502 });
    try {
      const res = await fetch("https://huggingface.co/api/papers/1");
      if (!res.ok) {
        poisoned = true;
        return Response.json({ ok: false }, { status: 502 });
      }
      return Response.json({ ok: true, title: (await res.json()).title });
    } catch {
      poisoned = true;
      return Response.json({ ok: false }, { status: 502 });
    }
  };

  const outcome = await captureOutcome(stickyCaller);
  assert.equal(outcome.status, 200);
  assert.equal((outcome.body as { title: string }).title, "paper");

  // Run the runner against the sticky caller inside a child test and expect it to fail.
  let failures = 0;
  await t.test("sticky caller under the matrix", async (inner) => {
    inner.mock.method(inner, "test", async (name: string, fn: (ctx: unknown) => Promise<void>) => {
      try {
        await fn(inner);
      } catch (error) {
        failures += 1;
        assert.match(String(error), /502 !== 200|never contacted it again/, `${name}: ${String(error)}`);
      }
    });
    await runUpstreamAnomalyMatrix(inner, {
      harness,
      id: "huggingface",
      invoke: stickyCaller,
      healthy: (o) => assert.equal(o.status, 200),
      anomalies: [STANDARD_UPSTREAM_ANOMALIES[0]],
    });
  });
  assert.ok(failures >= 1, "the matrix reported the stuck failure state");
});
