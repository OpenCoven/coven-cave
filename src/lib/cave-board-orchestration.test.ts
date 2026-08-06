import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-orchestration-"));
process.env.HOME = tmpHome;

const board = await import("./cave-board.ts");
const now = new Date().toISOString();

function errorCodes(error: unknown): string[] {
  assert.ok(error instanceof board.OrchestrationValidationError);
  return error.errors.map((entry) => entry.code);
}

await assert.rejects(
  board.createCard({ title: "Invalid blocked task", status: "blocked" }),
  (error) => {
    assert.deepEqual(
      new Set(errorCodes(error)),
      new Set(["blocked_without_dependency", "blocked_without_primary", "blocked_without_next_step"]),
    );
    return true;
  },
);

const blocker = {
  id: "human-blocker",
  kind: "human" as const,
  label: "Maintainer decision",
  state: "unresolved" as const,
  origin: "human" as const,
  createdAt: now,
};
const humanNextStep = {
  summary: "Ask the maintainer to choose an approach",
  requiresApproval: true,
  origin: "human" as const,
  updatedAt: now,
};
const blocked = await board.createCard({
  title: "Valid blocked task",
  status: "blocked",
  dependencies: [blocker],
  primaryBlockerId: blocker.id,
  nextStep: humanNextStep,
});
assert.equal(blocked.needsHuman, true, "approval-gated next steps set needsHuman");

await assert.rejects(
  board.updateCard(blocked.id, { dependencies: [] }, { automated: true }),
  (error) => {
    const codes = errorCodes(error);
    assert.ok(codes.includes("dependency_authorship"), "automation cannot remove human dependencies");
    assert.ok(codes.includes("blocked_without_dependency"), "projected blocked state is validated");
    return true;
  },
);

const running = await board.createCard({ title: "Failing run", status: "in-progress" });
await board.updateCard(running.id, { lifecycle: "dispatched" });
const failed = await board.transitionCard(running.id, { to: "failed", reason: "Tests failed" });
assert.equal(failed?.status, "blocked");
assert.equal(failed?.needsHuman, true);
assert.equal(failed?.nextStep?.origin, "system");
assert.equal(failed?.nextStep?.requiresApproval, true);
const failureBlocker = failed?.dependencies?.find((entry) => entry.id === failed.primaryBlockerId);
assert.equal(failureBlocker?.kind, "execution");
assert.equal(failureBlocker?.origin, "system");
assert.match(failureBlocker?.label ?? "", /Tests failed/);

const cancelledRun = await board.createCard({ title: "Cancelled run", status: "in-progress" });
await board.updateCard(cancelledRun.id, { lifecycle: "dispatched" });
const cancelled = await board.transitionCard(cancelledRun.id, {
  to: "cancelled",
  reason: "Stopped by operator",
});
assert.equal(cancelled?.status, "blocked");
assert.equal(cancelled?.dependencies?.find((entry) => entry.id === cancelled.primaryBlockerId)?.kind, "execution");
assert.equal(cancelled?.nextStep?.summary, "Review the failed run and choose retry or repair");

const humanRun = await board.createCard({
  title: "Preserve human direction",
  status: "in-progress",
  nextStep: humanNextStep,
});
await board.updateCard(humanRun.id, { lifecycle: "dispatched" });
const humanFailed = await board.transitionCard(humanRun.id, { to: "failed" });
assert.deepEqual(humanFailed?.nextStep, humanNextStep, "lifecycle automation preserves human next steps");

console.log("cave-board-orchestration.test.ts OK");
