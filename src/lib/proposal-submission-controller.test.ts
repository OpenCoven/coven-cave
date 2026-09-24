import assert from "node:assert/strict";
import test from "node:test";
import { ProposalSubmissionController, SUBMISSION_MARKER, parseSubmissionResponse } from "./proposal-submission-controller.ts";
const input = { familiarId: "sage", target: "notes/file.md", contents: "private text" };
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
test("pending submissions are single-flight across subscribers and cannot be reset", async () => {
  const data = storage();
  const controller = new ProposalSubmissionController(data);
  controller.hydrate();
  const pending = Promise.withResolvers<{ kind: "applied" }>();
  let calls = 0;
  const first = controller.submit(input, async () => { calls++; return pending.promise; });
  assert.equal(controller.getSnapshot().phase, "pending");
  assert.equal(await controller.submit(input, async () => { calls++; return { kind: "applied" }; }), false);
  assert.equal(controller.reset(), false);
  assert.deepEqual([...data.values], [[SUBMISSION_MARKER, "1"]]);
  const remounted = new ProposalSubmissionController(data);
  remounted.hydrate();
  assert.deepEqual(remounted.getSnapshot().outcome, { kind: "unknown" });
  pending.resolve({ kind: "applied" });
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.deepEqual(controller.getSnapshot().outcome, { kind: "applied" });
  assert.equal(data.values.size, 0);
});
test("lost outcomes survive reload until explicit reconciliation", async () => {
  const data = storage();
  const controller = new ProposalSubmissionController(data);
  controller.hydrate();
  await controller.submit(input, async () => { throw new Error("lost"); });
  const reloaded = new ProposalSubmissionController(data);
  reloaded.hydrate();
  assert.deepEqual(reloaded.getSnapshot().outcome, { kind: "unknown" });
  assert.equal(await reloaded.submit(input, async () => { throw new Error("must not send"); }), false);
  reloaded.hydrate();
  assert.equal(data.getItem(SUBMISSION_MARKER), "1");
  assert.equal(reloaded.reset(), true);
  assert.equal(reloaded.getSnapshot().phase, "idle");
  assert.equal(data.values.size, 0);
});
test("storage failure refuses before forwarding", async () => {
  let calls = 0;
  const controller = new ProposalSubmissionController({ ...storage(), setItem() { throw new Error("quota"); } });
  controller.hydrate();
  assert.equal(await controller.submit(input, async () => { calls++; return { kind: "applied" }; }), false);
  assert.equal(calls, 0);
  assert.deepEqual(controller.getSnapshot().outcome, { kind: "unavailable" });
});
test("HTTP failure and malformed outcomes cannot render applied or reflected content", () => {
  assert.deepEqual(parseSubmissionResponse(503, { kind: "applied" }), { kind: "unknown" });
  assert.deepEqual(parseSubmissionResponse(200, { kind: "new_variant", message: "secret" }), { kind: "unknown" });
  assert.deepEqual(parseSubmissionResponse(200, { kind: "staged", proposalId: "<secret>" }), { kind: "unknown" });
  assert.deepEqual(parseSubmissionResponse(200, { kind: "applied", message: "secret" }), { kind: "applied" });
});
