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
const defaultedPin = await board.createCard({
  title: "Undefined pin defaults",
  primaryBlockerPinned: undefined,
});
assert.equal(defaultedPin.primaryBlockerPinned, false);
await assert.rejects(
  board.updateCard(malformedPinTarget.id, {
    primaryBlockerPinned: "false" as never,
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("primary_blocker_invalid"));
    return true;
  },
);
const undefinedPinPatch = await board.updateCard(malformedPinTarget.id, {
  primaryBlockerPinned: undefined,
});
assert.equal(undefinedPinPatch?.primaryBlockerPinned, false);
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
    nextStep: { ...humanNextStep, summary: "  " },
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("blocked_requires_next_step"));
    return true;
  },
);

const resolvedHumanBlocker = {
  ...blocker,
  state: "resolved" as const,
  resolvedAt: new Date().toISOString(),
  resolvedBy: "cody",
  evidence: "Maintainer chose the implementation",
};
const readyBlocked = await board.updateCard(
  blocked.id,
  { dependencies: [resolvedHumanBlocker] },
  { actor: "cody" },
);
assert.ok(readyBlocked);
assert.equal(readyBlocked.status, "blocked", "resolution does not move the card out of Blocked");
assert.equal(readyBlocked.primaryBlockerId, null, "the resolved final primary is cleared");
assert.deepEqual(readyBlocked.nextStep, humanNextStep, "a human-authored next step is preserved");
assert.equal(orchestration.deriveReadiness(readyBlocked, (await board.loadBoard()).cards), "ready");
assert.deepEqual(readyBlocked.orchestrationAudit, [{
  taskId: blocked.id,
  resolvedDependencyId: blocker.id,
  previousNextStep: humanNextStep,
  nextStep: humanNextStep,
  at: readyBlocked.updatedAt,
  actor: "cody",
}]);

const settledUpdatedAt = readyBlocked.updatedAt;
const repeatedResolution = await board.updateCard(
  blocked.id,
  { dependencies: [resolvedHumanBlocker] },
  { actor: "cody" },
);
assert.equal(repeatedResolution?.updatedAt, settledUpdatedAt, "repeat resolution is a storage no-op");
assert.equal(repeatedResolution?.orchestrationAudit?.length, 1, "repeat resolution does not duplicate audit");

await new Promise((resolve) => setTimeout(resolve, 2));
const reorderedRepeat = await board.updateCard(
  blocked.id,
  {
    dependencies: [{
      evidence: resolvedHumanBlocker.evidence,
      resolvedBy: resolvedHumanBlocker.resolvedBy,
      resolvedAt: "2099-01-01T00:00:00.000Z",
      createdAt: resolvedHumanBlocker.createdAt,
      origin: resolvedHumanBlocker.origin,
      state: resolvedHumanBlocker.state,
      label: resolvedHumanBlocker.label,
      kind: resolvedHumanBlocker.kind,
      id: resolvedHumanBlocker.id,
    }],
  },
  { actor: "cody" },
);
assert.equal(
  reorderedRepeat?.updatedAt,
  settledUpdatedAt,
  "repeat resolution ignores regenerated resolution timestamps and property order",
);
assert.equal(reorderedRepeat?.orchestrationAudit?.length, 1);

const editedReadyBlocked = await board.updateCard(blocked.id, {
  notes: "Ready for an explicit move out of Blocked",
});
assert.equal(editedReadyBlocked?.notes, "Ready for an explicit move out of Blocked");
assert.equal(
  orchestration.deriveReadiness(editedReadyBlocked, (await board.loadBoard()).cards),
  "ready",
  "a persisted ready-blocked card remains editable",
);

const primaryDependency = {
  id: "system-primary",
  kind: "service" as const,
  label: "Restore the build service",
  ref: "svc:build",
  state: "unresolved" as const,
  origin: "system" as const,
  createdAt: now,
};
const secondaryDependency = {
  id: "system-secondary",
  kind: "github" as const,
  label: "Merge the follow-up pull request",
  ref: "OpenCoven/coven-cave#9999",
  state: "unresolved" as const,
  origin: "system" as const,
  createdAt: now,
};
const systemNextStep = {
  summary: primaryDependency.label,
  requiresApproval: false,
  origin: "system" as const,
  updatedAt: now,
};
const promotable = await board.createCard({
  title: "Promote blockers deterministically",
  status: "blocked",
  dependencies: [primaryDependency, secondaryDependency],
  primaryBlockerId: primaryDependency.id,
  nextStep: systemNextStep,
});
const promoted = await board.updateCard(
  promotable.id,
  {
    dependencies: [
      {
        ...primaryDependency,
        state: "resolved",
        resolvedAt: new Date().toISOString(),
        resolvedBy: "cody",
        evidence: "Build service health check passed",
      },
      secondaryDependency,
    ],
  },
  { automated: true, actor: "cody" },
);
assert.ok(promoted);
assert.equal(promoted.primaryBlockerId, secondaryDependency.id, "array order chooses the next primary");
assert.equal(promoted.nextStep?.summary, secondaryDependency.label, "the derived next step follows the promoted blocker");
assert.equal(promoted.nextStep?.origin, "system");
assert.deepEqual(promoted.orchestrationAudit?.[0], {
  taskId: promotable.id,
  resolvedDependencyId: primaryDependency.id,
  previousNextStep: systemNextStep,
  nextStep: promoted.nextStep,
  at: promoted.updatedAt,
  actor: "cody",
});

const pinnedPromotion = await board.createCard({
  title: "Pinned primary stays operator-controlled",
  status: "blocked",
  dependencies: [
    { ...primaryDependency, id: "pinned-promotion-primary" },
    { ...secondaryDependency, id: "pinned-promotion-secondary" },
  ],
  primaryBlockerId: "pinned-promotion-primary",
  primaryBlockerPinned: true,
  nextStep: systemNextStep,
});
await assert.rejects(
  board.updateCard(pinnedPromotion.id, {
    dependencies: [
      {
        ...primaryDependency,
        id: "pinned-promotion-primary",
        state: "resolved",
        resolvedAt: new Date().toISOString(),
        evidence: "Operator resolved the service",
      },
      { ...secondaryDependency, id: "pinned-promotion-secondary" },
    ],
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("blocked_requires_primary"));
    return true;
  },
);
const stillPinned = (await board.loadBoard()).cards.find((card) => card.id === pinnedPromotion.id);
assert.equal(stillPinned?.primaryBlockerId, "pinned-promotion-primary");
assert.equal(stillPinned?.dependencies?.[0]?.state, "unresolved", "a rejected pinned resolution is not saved");
assert.equal(stillPinned?.orchestrationAudit?.length, 0);

const deletedUpstream = await board.createCard({ title: "Upstream task to delete" });
const taskDependency = {
  id: "deleted-task-dependency",
  kind: "task" as const,
  label: "Finish the upstream task",
  taskId: deletedUpstream.id,
  state: "unresolved" as const,
  origin: "human" as const,
  createdAt: now,
};
const dependent = await board.createCard({
  title: "Repair references after deletion",
  status: "blocked",
  dependencies: [taskDependency, secondaryDependency],
  primaryBlockerId: taskDependency.id,
  nextStep: {
    summary: taskDependency.label,
    requiresApproval: false,
    origin: "system",
    updatedAt: now,
  },
});
assert.equal(await board.deleteCard(deletedUpstream.id, { actor: "cody" }), "deleted");
const repairedDependent = (await board.loadBoard()).cards.find((card) => card.id === dependent.id);
assert.ok(repairedDependent);
assert.equal(
  repairedDependent.dependencies?.some(
    (dependency) => dependency.kind === "task" && dependency.taskId === deletedUpstream.id,
  ),
  false,
  "deletion leaves no dangling task edge",
);
assert.equal(repairedDependent.primaryBlockerId, secondaryDependency.id);
assert.equal(repairedDependent.nextStep?.summary, secondaryDependency.label);
assert.equal(repairedDependent.orchestrationAudit?.at(-1)?.resolvedDependencyId, taskDependency.id);
assert.equal(repairedDependent.orchestrationAudit?.at(-1)?.actor, "cody");

const soleUpstream = await board.createCard({ title: "Only upstream task" });
const soleDependency = {
  ...taskDependency,
  id: "sole-task-dependency",
  taskId: soleUpstream.id,
};
const soleDependent = await board.createCard({
  title: "Stay blocked for explicit unblocking",
  status: "blocked",
  dependencies: [soleDependency],
  primaryBlockerId: soleDependency.id,
  nextStep: {
    summary: soleDependency.label,
    requiresApproval: false,
    origin: "system",
    updatedAt: now,
  },
});
assert.equal(await board.deleteCard(soleUpstream.id, { actor: "cody" }), "deleted");
const readyAfterDelete = (await board.loadBoard()).cards.find((card) => card.id === soleDependent.id);
assert.ok(readyAfterDelete);
assert.equal(readyAfterDelete.status, "blocked");
assert.equal(readyAfterDelete.primaryBlockerId, null);
assert.equal(orchestration.deriveReadiness(readyAfterDelete, (await board.loadBoard()).cards), "ready");
assert.equal(
  readyAfterDelete.dependencies?.some(
    (dependency) => dependency.kind === "task" && dependency.taskId === soleUpstream.id,
  ),
  false,
);
assert.deepEqual(
  orchestration.repairRecommendations(readyAfterDelete, (await board.loadBoard()).cards)
    .map((recommendation) => recommendation.code),
  ["blocked_requires_dependency"],
  "ready-blocked cards recommend unblocking without asking for a new next step",
);

const legacyUpstream = await board.createCard({ title: "Legacy upstream task" });
const legacyDependentBase = await board.createCard({ title: "Legacy dependent task" });
const beforeLegacySeed = await board.loadBoard();
await board.saveBoard({
  version: beforeLegacySeed.version,
  cards: beforeLegacySeed.cards.map((card) =>
    card.id === legacyDependentBase.id
      ? {
          ...card,
          status: "blocked",
          lifecycle: "failed",
          dependencies: [
            {
              ...taskDependency,
              id: "legacy-task-dependency",
              taskId: legacyUpstream.id,
            },
            {
              ...secondaryDependency,
              id: "legacy-resolved-without-evidence",
              state: "resolved",
            },
          ],
          primaryBlockerId: null,
          nextStep: null,
        }
      : card),
});
assert.equal(
  await board.deleteCard(legacyUpstream.id, { actor: "cody" }),
  "deleted",
  "pre-existing legacy errors do not block dangling-edge cleanup",
);
const repairedLegacy = (await board.loadBoard()).cards.find(
  (card) => card.id === legacyDependentBase.id,
);
assert.equal(
  repairedLegacy?.dependencies?.some(
    (dependency) => dependency.kind === "task" && dependency.taskId === legacyUpstream.id,
  ),
  false,
);

const malformedUpstream = await board.createCard({ title: "Malformed dependency upstream" });
const malformedObjectCard = await board.createCard({ title: "Non-array legacy dependencies" });
const malformedEntryCard = await board.createCard({ title: "Mixed legacy dependencies" });
const beforeMalformedSeed = await board.loadBoard();
await board.saveBoard({
  version: beforeMalformedSeed.version,
  cards: beforeMalformedSeed.cards.map((card) => {
    if (card.id === malformedObjectCard.id) {
      return { ...card, dependencies: { broken: true } as never };
    }
    if (card.id === malformedEntryCard.id) {
      return {
        ...card,
        dependencies: [
          null,
          {
            ...taskDependency,
            id: "mixed-legacy-task-dependency",
            taskId: malformedUpstream.id,
          },
        ] as never,
      };
    }
    return card;
  }),
});
assert.equal(
  await board.deleteCard(malformedUpstream.id, { actor: "cody" }),
  "deleted",
  "malformed legacy dependency payloads cannot crash deletion",
);
const repairedMalformed = (await board.loadBoard()).cards.find(
  (card) => card.id === malformedEntryCard.id,
);
assert.equal(
  Array.isArray(repairedMalformed?.dependencies) &&
    repairedMalformed.dependencies.some(
      (dependency) =>
        dependency?.kind === "task" && dependency.taskId === malformedUpstream.id,
    ),
  false,
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
