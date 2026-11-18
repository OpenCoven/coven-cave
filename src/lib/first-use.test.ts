import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceFirstUse, createFirstUseState, createQuickStartState, parseFirstUseState, resolveFirstUseContext } from "./first-use.ts";

const defaults = { projectId: "project-a", familiarIds: ["nova", "sage"], actingFamiliarId: "nova" };
const snapshot = {
  projectIds: ["project-a", "project-b"],
  familiarIds: ["nova", "sage", "moss"],
  eligibleFamiliarIds: ["nova", "sage"],
  runtimeAvailable: true,
};

test("short setup reaches real work without inventing practice or running a model", () => {
  const fresh = createQuickStartState();
  assert.equal(fresh.version, 2);
  assert.equal(fresh.step, "assistant");
  const chosen = advanceFirstUse(fresh, { kind: "choose-assistant", familiarId: "nova" });
  assert.equal(chosen.step, "project");
  assert.equal(chosen.setupFamiliarId, "nova");
  const complete = advanceFirstUse(chosen, { kind: "finish-setup", defaults, permissionMode: "read" }, "2026-11-13T00:00:00.000Z");
  assert.equal(complete.step, "complete");
  assert.equal(complete.completedAt, "2026-11-13T00:00:00.000Z");
  assert.deepEqual(complete.practice, fresh.practice, "setup is not verified fictional practice");
  assert.deepEqual(parseFirstUseState(JSON.parse(JSON.stringify(complete))).defaults, defaults);
});

test("short setup requires an explicit access choice and the selected actor", () => {
  const chosen = advanceFirstUse(createQuickStartState(), { kind: "choose-assistant", familiarId: "nova" });
  assert.throws(() => advanceFirstUse(chosen, { kind: "finish-setup", defaults } as never), /access/i);
  assert.throws(() => advanceFirstUse(chosen, { kind: "finish-setup", defaults: { ...defaults, actingFamiliarId: "sage" }, permissionMode: "full" }), /familiar|actor/i);
  assert.throws(() => parseFirstUseState({ ...chosen, step: "complete", completedAt: "2026-11-13T00:00:00Z" }));
  assert.equal(advanceFirstUse(chosen, { kind: "finish-setup", defaults, permissionMode: "full" }).permissionMode, "full");
});

test("interrupted legacy progress retains context and practice history when entering short setup", () => {
  let legacy = advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" });
  legacy = advanceFirstUse(legacy, { kind: "context", defaults });
  legacy = advanceFirstUse(legacy, { kind: "review-access" });
  legacy = advanceFirstUse(legacy, { kind: "hold-approval" });
  const short = advanceFirstUse(legacy, { kind: "choose-assistant", familiarId: "nova" });
  assert.equal(short.version, 2);
  assert.deepEqual(short.defaults, defaults);
  assert.deepEqual(short.practice, legacy.practice);
  assert.equal(short.completedAt, null);
  assert.equal(short.step, "project");
});

test("fresh and existing installations require choices beyond installation or dismissal", () => {
  const state = createFirstUseState();
  assert.equal(state.step, "outcome");
  assert.equal(state.completedAt, null);
  assert.equal(state.defaults, null);
  assert.throws(() => advanceFirstUse(state, { kind: "verify", evidence: "result-and-check" }), /step/i);
  assert.throws(() => parseFirstUseState({ ...state, step: "complete" }));
});

test("the practice resumes with its actual choices and requires approval, Stop, retry and evidence", () => {
  let state = advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" });
  state = advanceFirstUse(state, { kind: "context", defaults });
  state = parseFirstUseState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.step, "access");
  assert.deepEqual(state.defaults, defaults);
  assert.throws(() => advanceFirstUse(state, { kind: "approve" }), /step/i);
  state = advanceFirstUse(state, { kind: "review-access" });
  assert.throws(() => advanceFirstUse(state, { kind: "approve" }), /review/i);
  state = advanceFirstUse(state, { kind: "hold-approval" });
  assert.equal(state.step, "approval");
  state = advanceFirstUse(state, { kind: "approve" });
  assert.throws(() => advanceFirstUse(state, { kind: "retry" }), /stop/i);
  state = advanceFirstUse(state, { kind: "stop" });
  state = advanceFirstUse(state, { kind: "retry" });
  assert.equal(state.step, "verify");
  assert.throws(() => advanceFirstUse(state, { kind: "verify", evidence: "said-done" }), /evidence/i);
  state = advanceFirstUse(state, { kind: "verify", evidence: "result-and-check" }, "2026-11-11T12:00:00.000Z");
  assert.equal(state.completedAt, "2026-11-11T12:00:00.000Z");
  assert.equal(parseFirstUseState(state).step, "complete");
});

test("malformed or empty configured scope never becomes all eligible", () => {
  for (const bad of [null, {}, { ...defaults, familiarIds: [] }, { ...defaults, actingFamiliarId: "moss" }]) {
    assert.throws(() => advanceFirstUse(
      advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "inspect" }),
      { kind: "context", defaults: bad } as never,
    ));
  }
  assert.throws(() => parseFirstUseState({ ...createFirstUseState(), version: 99 }), /version/i);
});

test("new launches use concrete defaults and explicit context retains precedence", () => {
  assert.deepEqual(resolveFirstUseContext({ defaults, ...snapshot }), { kind: "ready", context: defaults });
  const explicit = { projectId: "project-b", familiarIds: ["sage"], actingFamiliarId: "sage" };
  assert.deepEqual(resolveFirstUseContext({ defaults, explicit, ...snapshot }), { kind: "ready", context: explicit });
});

test("missing, deleted and partially revoked defaults retain identities for repair", () => {
  const missing = resolveFirstUseContext({ defaults: null, ...snapshot });
  assert.equal(missing.kind, "repair");
  for (const delta of [
    { projectIds: ["project-b"] },
    { familiarIds: ["sage", "moss"] },
    { eligibleFamiliarIds: ["nova"] },
    { eligibleFamiliarIds: [] },
    { runtimeAvailable: false },
  ]) {
    const result = resolveFirstUseContext({ defaults, ...snapshot, ...delta });
    assert.equal(result.kind, "repair");
    assert.deepEqual(result.context, defaults);
  }
});

test("an invalid explicit context never silently substitutes defaults or another actor", () => {
  const explicit = { projectId: "deleted", familiarIds: ["gone"], actingFamiliarId: "gone" };
  const result = resolveFirstUseContext({ defaults, explicit, ...snapshot });
  assert.equal(result.kind, "repair");
  assert.deepEqual(result.context, explicit);
});

test("interrupted practice can repair context without retaining the former context’s practice approval", () => {
  let state = advanceFirstUse(createFirstUseState(), { kind: "outcome", outcome: "plan" });
  state = advanceFirstUse(state, { kind: "context", defaults });
  state = advanceFirstUse(state, { kind: "review-access" });
  state = advanceFirstUse(state, { kind: "hold-approval" });
  const repaired = advanceFirstUse(state, { kind: "context", defaults: { ...defaults, actingFamiliarId: "sage" } });
  assert.equal(repaired.step, "access");
  assert.equal(repaired.practice.approvalHeld, false);
  assert.equal(repaired.defaults?.actingFamiliarId, "sage");
});
