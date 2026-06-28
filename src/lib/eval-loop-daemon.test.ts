import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unwrapDaemonEvalState } from "./eval-loop-daemon.ts";

describe("unwrapDaemonEvalState", () => {
  it("returns the inner state from the daemon's { ok, state } envelope", () => {
    const inner = { iterations: [{ id: "a" }], running: true, total_accepted: 2 };
    const result = unwrapDaemonEvalState({ ok: true, state: inner });
    assert.equal(result, inner);
    assert.equal((result as { iterations: unknown[] }).iterations.length, 1);
  });

  it("passes through a bare EvalLoopState (daemon that does not envelope)", () => {
    const bare = { iterations: [], running: false };
    assert.equal(unwrapDaemonEvalState(bare), bare);
  });

  it("does not unwrap a state that legitimately carries both keys", () => {
    // An EvalLoopState with an `iterations` field is the real thing even if some
    // future field is named `state`; presence of `iterations` wins.
    const stateLike = { iterations: [{ id: "x" }], state: "running" };
    assert.equal(unwrapDaemonEvalState(stateLike), stateLike);
  });

  it("is null/non-object safe", () => {
    assert.equal(unwrapDaemonEvalState(null), null);
    assert.equal(unwrapDaemonEvalState(undefined), undefined);
    assert.equal(unwrapDaemonEvalState("nope"), "nope");
    assert.deepEqual(unwrapDaemonEvalState({ ok: false }), { ok: false });
  });
});
