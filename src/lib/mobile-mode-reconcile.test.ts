import assert from "node:assert/strict";
import { test } from "node:test";

import { createMobileModeReconciler } from "./mobile-mode-reconcile.ts";

test("clean optional-unavailable responses open the circuit until a forced retry", async () => {
  let calls = 0;
  const reconcile = createMobileModeReconciler(async () => {
    calls += 1;
    return Response.json({ ok: false, unavailable: true, error: "token unavailable" });
  });

  const first = await reconcile(true);
  const skipped = await reconcile(true);
  assert.equal(first.retryBlocked, true);
  assert.equal(skipped.skipped, true);
  assert.equal(calls, 1, "automatic polls reuse the blocked result without another request");

  await reconcile(true, { force: true });
  assert.equal(calls, 2, "the explicit Retry/toggle path probes immediately");
});

test("legacy sidecar 503 responses still open the automatic-retry circuit", async () => {
  let calls = 0;
  const reconcile = createMobileModeReconciler(async () => {
    calls += 1;
    return Response.json({ ok: false, error: "token unavailable" }, { status: 503 });
  });

  assert.equal((await reconcile(true)).retryBlocked, true);
  assert.equal((await reconcile(true)).skipped, true);
  assert.equal(calls, 1);
});

test("concurrent Workspace and Settings requests share one fetch", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reconcile = createMobileModeReconciler(async () => {
    calls += 1;
    await gate;
    return Response.json({ ok: true, nativeHost: "cave.tail.test" });
  });

  const workspace = reconcile(true);
  const settings = reconcile(true);
  release();
  const [a, b] = await Promise.all([workspace, settings]);
  assert.equal(calls, 1);
  assert.equal(a.nativeHost, "cave.tail.test");
  assert.deepEqual(a, b);
});

test("unexpected failures stay visible and retryable", async () => {
  let calls = 0;
  const reconcile = createMobileModeReconciler(async () => {
    calls += 1;
    return Response.json({ ok: false, error: "unexpected" }, { status: 500 });
  });

  assert.equal((await reconcile(true)).retryBlocked, false);
  assert.equal((await reconcile(true)).retryBlocked, false);
  assert.equal(calls, 2, "500s are not hidden behind the prerequisite circuit breaker");
});

test("transport failures also remain retryable", async () => {
  let calls = 0;
  const reconcile = createMobileModeReconciler(async () => {
    calls += 1;
    throw new Error("offline");
  });

  assert.equal((await reconcile(true)).error, "offline");
  assert.equal((await reconcile(true)).error, "offline");
  assert.equal(calls, 2);
});
