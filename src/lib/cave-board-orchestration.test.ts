import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-orchestration-"));
process.env.HOME = tmpHome;
process.env.COVEN_CAVE_HOME = tmpHome;

const legacyUpdatedAt = "2026-08-01T12:00:00.000Z";
await mkdir(tmpHome, { recursive: true });
await writeFile(
  path.join(tmpHome, "board.json"),
  JSON.stringify({
    version: 1,
    cards: [{
      id: "legacy-blocked",
      title: "Legacy blocked task",
      notes: "",
      status: "blocked",
      priority: "medium",
      familiarId: null,
      sessionId: null,
      cwd: null,
      links: [],
      github: [],
      asana: [],
      labels: [],
      createdAt: legacyUpdatedAt,
      updatedAt: legacyUpdatedAt,
    }],
  }),
);

const board = await import("./cave-board.ts");
const orchestration = await import("./task-orchestration.ts");
const now = new Date().toISOString();

function errorCodes(error: unknown): string[] {
  assert.ok(error instanceof board.OrchestrationValidationError);
  return error.errors.map((entry) => entry.code);
}

const initial = await board.loadBoard();
const legacy = initial.cards.find((card) => card.id === "legacy-blocked");
assert.ok(legacy, "legacy blocked cards load without throwing");
assert.deepEqual(legacy.dependencies, [], "legacy cards backfill an empty dependency list");
assert.equal(legacy.primaryBlockerId, null, "legacy cards backfill a null primary blocker");
assert.equal(legacy.primaryBlockerPinned, false, "legacy cards backfill an unpinned blocker");
assert.equal(legacy.nextStep, null, "legacy cards backfill a null next step");
assert.equal(orchestration.deriveReadiness(legacy, initial.cards), "incomplete");
assert.ok(
  orchestration.repairRecommendations(legacy, initial.cards).length >= 2,
  "legacy cards expose concrete repair recommendations",
);

await assert.rejects(
  board.createCard({ title: "Invalid blocked task", status: "blocked" }),
  (error) => {
    assert.deepEqual(
      new Set(errorCodes(error)),
      new Set([
        "blocked_requires_dependency",
        "blocked_requires_next_step",
      ]),
    );
    return true;
  },
);

await assert.rejects(
  board.createCard({
    title: "Malformed dependency payload",
    dependencies: [null] as never,
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("dependency_invalid"));
    return true;
  },
);

const malformedPinTarget = await board.createCard({ title: "Malformed pin target" });
await assert.rejects(
  board.updateCard(malformedPinTarget.id, {
    primaryBlockerPinned: "false" as never,
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("primary_blocker_invalid"));
    return true;
  },
);
await assert.rejects(
  board.updateCard(malformedPinTarget.id, {
    primaryBlockerPinned: null as never,
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("primary_blocker_invalid"));
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
    assert.ok(codes.includes("blocked_requires_dependency"), "projected blocked state is validated");
    return true;
  },
);

await assert.rejects(
  board.updateCard(blocked.id, {
    dependencies: [{ ...blocker, state: "resolved", evidence: "Decision recorded" }],
  }),
  (error) => {
    const codes = errorCodes(error);
    assert.ok(codes.includes("blocked_requires_dependency"));
    assert.ok(codes.includes("blocked_requires_primary"));
    return true;
  },
);

await assert.rejects(
  board.updateCard(blocked.id, {
    nextStep: { ...humanNextStep, summary: "  " },
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("blocked_requires_next_step"));
    return true;
  },
);

const enhanceTarget = await board.createCard({ title: "Enhance target" });
await assert.rejects(
  board.updateCard(enhanceTarget.id, { status: "blocked" }, { automated: true }),
  (error) => {
    const codes = errorCodes(error);
    assert.ok(codes.includes("blocked_requires_dependency"));
    assert.ok(codes.includes("blocked_requires_next_step"));
    return true;
  },
);

const normalizedStatus = await board.createCard({ title: "Normalize status writes" });
const normalizedDone = await board.updateCard(normalizedStatus.id, { status: "done" });
assert.equal(normalizedDone?.lifecycle, "completed", "status writes derive lifecycle under the lock");

const approvalGate = await board.createCard({
  title: "Approval-gated dispatch",
  nextStep: humanNextStep,
});
assert.equal(approvalGate.needsHuman, true);
await assert.rejects(
  board.transitionCard(approvalGate.id, { to: "dispatched" }),
  (error) => {
    assert.deepEqual(errorCodes(error), ["next_step_requires_approval"]);
    return true;
  },
);
await board.updateCard(approvalGate.id, {
  nextStep: { ...humanNextStep, requiresApproval: false },
});
const approvedDispatch = await board.transitionCard(approvalGate.id, { to: "dispatched" });
assert.equal(approvedDispatch?.lifecycle, "dispatched");

const running = await board.createCard({ title: "Failing run" });
await board.updateCard(running.id, { retryCount: running.maxRetries });
await board.transitionCard(running.id, { to: "dispatched" });
const failed = await board.transitionCard(running.id, { to: "failed", reason: "Tests failed" });
assert.equal(failed?.status, "blocked");
assert.equal(failed?.needsHuman, true);
assert.equal(failed?.nextStep?.origin, "system");
assert.equal(failed?.nextStep?.requiresApproval, true);
const failureBlocker = failed?.dependencies?.find((entry) => entry.id === failed.primaryBlockerId);
assert.equal(failureBlocker?.kind, "execution");
assert.equal(failureBlocker?.origin, "system");
assert.match(failureBlocker?.label ?? "", /Tests failed/);

const cancelledRun = await board.createCard({ title: "Cancelled run" });
await board.transitionCard(cancelledRun.id, { to: "dispatched" });
const cancelled = await board.transitionCard(cancelledRun.id, {
  to: "cancelled",
  reason: "Stopped by operator",
});
assert.equal(cancelled?.status, "blocked");
assert.equal(cancelled?.dependencies?.find((entry) => entry.id === cancelled.primaryBlockerId)?.kind, "execution");
assert.equal(cancelled?.nextStep?.summary, "Review the failed run and choose retry or repair");

const humanRun = await board.createCard({
  title: "Preserve human direction",
});
await board.transitionCard(humanRun.id, { to: "dispatched" });
const humanActionStep = { ...humanNextStep, requiresApproval: false };
await board.updateCard(humanRun.id, { nextStep: humanActionStep });
const humanFailed = await board.transitionCard(humanRun.id, { to: "failed" });
assert.deepEqual(humanFailed?.nextStep, humanActionStep, "lifecycle automation preserves human next steps");

const pinnedBlocker = {
  ...blocker,
  id: "pinned-primary",
  createdAt: new Date(Date.now() + 1).toISOString(),
};
const pinnedFailure = await board.createCard({
  title: "Preserve pinned failure blocker",
  dependencies: [pinnedBlocker],
  primaryBlockerId: pinnedBlocker.id,
  primaryBlockerPinned: true,
});
await board.transitionCard(pinnedFailure.id, { to: "dispatched" });
const pinnedFailed = await board.transitionCard(pinnedFailure.id, { to: "failed" });
assert.equal(pinnedFailed?.primaryBlockerId, pinnedBlocker.id);
assert.equal(pinnedFailed?.primaryBlockerPinned, true);
assert.ok(
  pinnedFailed?.dependencies?.some((dependency) => dependency.kind === "execution"),
  "failure still records its execution dependency behind a pinned primary",
);

const pinnedCancellation = await board.createCard({
  title: "Preserve pinned cancellation blocker",
  dependencies: [{ ...pinnedBlocker, id: "pinned-cancellation" }],
  primaryBlockerId: "pinned-cancellation",
  primaryBlockerPinned: true,
});
const pinnedCancelled = await board.transitionCard(pinnedCancellation.id, {
  to: "cancelled",
});
assert.equal(pinnedCancelled?.primaryBlockerId, "pinned-cancellation");
assert.equal(pinnedCancelled?.primaryBlockerPinned, true);

console.log("cave-board-orchestration.test.ts OK");
