// @ts-nocheck
import assert from "node:assert/strict";
import {
  MAX_RUN_STEPS,
  MAX_RUN_STEPS_BYTES,
  resolveRunSource,
  resolveWipe,
  validateSteps,
} from "./run-history-guards.ts";

// --- validateSteps: bounds the forgeable/oversized steps array ---

{
  const r = validateSteps(undefined);
  assert.deepEqual(r, { ok: true, steps: [] }, "non-array coerces to empty (backwards compatible)");
}
{
  const r = validateSteps("not-an-array");
  assert.deepEqual(r, { ok: true, steps: [] }, "string coerces to empty");
}
{
  const steps = [{ id: "a", status: "succeeded" }];
  const r = validateSteps(steps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps, steps, "small valid arrays pass through unchanged");
}
{
  const tooMany = Array.from({ length: MAX_RUN_STEPS + 1 }, (_, i) => ({ id: String(i) }));
  const r = validateSteps(tooMany);
  assert.equal(r.ok, false, "count over cap is rejected");
  assert.match(r.error, /too many steps/);
}
{
  const atCap = Array.from({ length: MAX_RUN_STEPS }, (_, i) => ({ id: String(i) }));
  const r = validateSteps(atCap);
  assert.equal(r.ok, true, "exactly at the count cap is allowed");
}
{
  // One huge step exceeding the byte cap even though the count is tiny.
  const huge = [{ id: "x", detail: "z".repeat(MAX_RUN_STEPS_BYTES + 10) }];
  const r = validateSteps(huge);
  assert.equal(r.ok, false, "byte size over cap is rejected");
  assert.match(r.error, /too large/);
}

// --- resolveRunSource: only token-bearing loopback may claim daemon ---

function reqWith(headers) {
  return new Request("http://127.0.0.1/api/flows/runs", { headers });
}

{
  // No sidecar token configured; loopback host => isLocalOrigin true.
  const prev = process.env.COVEN_CAVE_AUTH_TOKEN;
  delete process.env.COVEN_CAVE_AUTH_TOKEN;
  const daemonReq = reqWith({ host: "127.0.0.1" });
  assert.equal(resolveRunSource(daemonReq, "daemon"), "daemon", "loopback may claim daemon in tokenless dev");
  assert.equal(resolveRunSource(daemonReq, "cave"), "cave", "explicit cave stays cave");
  assert.equal(resolveRunSource(daemonReq, undefined), "cave", "unspecified source defaults to cave");

  // Mobile-access header => isLocalOrigin false => daemon claim denied.
  const mobileReq = reqWith({ host: "127.0.0.1", "x-coven-cave-mobile-access": "1" });
  assert.equal(resolveRunSource(mobileReq, "daemon"), "cave", "mobile/tailnet cannot forge daemon provenance");

  if (prev === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = prev;
}

// --- resolveWipe: full wipe requires ?all=1 ---

{
  const scoped = resolveWipe("flow-1", new URLSearchParams(""));
  assert.deepEqual(scoped, { ok: true, scopeId: "flow-1" }, "scoped clear by id is always allowed");
}
{
  const bare = resolveWipe(undefined, new URLSearchParams(""));
  assert.equal(bare.ok, false, "bare full wipe without ?all=1 is rejected");
  assert.match(bare.error, /requires \?all=1/);
}
{
  const confirmed = resolveWipe(undefined, new URLSearchParams("all=1"));
  assert.deepEqual(confirmed, { ok: true, scopeId: undefined }, "?all=1 authorizes the full wipe");
}

console.log("run-history-guards.test.ts: ok");
