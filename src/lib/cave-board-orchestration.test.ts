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
  board.updateCard(legacy.id, { dependencies: [] }),
  (error) => {
    assert.ok(
      errorCodes(error).includes("blocked_requires_dependency"),
      "an unchanged dependency patch still enforces the blocked contract",
    );
    return true;
  },
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
  board.updateCard(blocked.id, { dependencies: [null] as never }),
  (error) => {
    assert.ok(
      errorCodes(error).includes("dependency_invalid"),
      "malformed dependency patches reach structured validation before promotion",
    );
    return true;
  },
);
await assert.rejects(
  board.updateCard(blocked.id, {
    dependencies: [...(blocked.dependencies ?? []), null] as never,
  }),
  (error) => {
    assert.ok(
      errorCodes(error).includes("dependency_invalid"),
      "malformed entries cannot hide behind repeat-resolution detection",
    );
    return true;
  },
);

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

const approvalPrimary = {
  ...primaryDependency,
  id: "approval-primary",
  kind: "human" as const,
  label: "Approve the deployment approach",
};
const nonApprovalSecondary = {
  ...secondaryDependency,
  id: "non-approval-secondary",
  kind: "service" as const,
  label: "Restore the deployment service",
};
const approvalPromotion = await board.createCard({
  title: "Clear resolved approval attention",
  status: "blocked",
  dependencies: [approvalPrimary, nonApprovalSecondary],
  primaryBlockerId: approvalPrimary.id,
  nextStep: {
    summary: approvalPrimary.label,
    requiresApproval: true,
    origin: "system",
    updatedAt: now,
  },
});
assert.equal(approvalPromotion.needsHuman, true);
const approvalResolved = await board.updateCard(approvalPromotion.id, {
  dependencies: [
    {
      ...approvalPrimary,
      state: "resolved",
      resolvedAt: new Date().toISOString(),
      evidence: "Maintainer approved the approach",
    },
    nonApprovalSecondary,
  ],
});
assert.equal(approvalResolved?.primaryBlockerId, nonApprovalSecondary.id);
assert.equal(approvalResolved?.nextStep?.requiresApproval, false);
assert.equal(
  approvalResolved?.needsHuman,
  false,
  "promotion clears attention derived from a resolved approval-gated step",
);

const preservedAttention = await board.createCard({
  title: "Preserve independent human attention",
  status: "blocked",
  dependencies: [
    { ...approvalPrimary, id: "attention-primary" },
    { ...nonApprovalSecondary, id: "attention-secondary" },
  ],
  primaryBlockerId: "attention-primary",
  nextStep: {
    summary: approvalPrimary.label,
    requiresApproval: true,
    origin: "system",
    updatedAt: now,
  },
});
const attentionResolved = await board.updateCard(preservedAttention.id, {
  dependencies: [
    {
      ...approvalPrimary,
      id: "attention-primary",
      state: "resolved",
      resolvedAt: new Date().toISOString(),
      evidence: "Approval recorded",
    },
    { ...nonApprovalSecondary, id: "attention-secondary" },
  ],
  needsHuman: true,
});
assert.equal(
  attentionResolved?.needsHuman,
  true,
  "an explicit independent attention flag survives approval-step promotion",
);

const auditOverwriteAttempt = await board.updateCard(promotable.id, {
  orchestrationAudit: [],
});
assert.equal(
  auditOverwriteAttempt?.orchestrationAudit?.length,
  1,
  "callers cannot replace the append-only promotion audit",
);

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
const deletionSecondary = {
  ...secondaryDependency,
  id: "deletion-human-secondary",
  kind: "human" as const,
  label: "Ask the maintainer to approve the fallback",
  ref: null,
};
const dependent = await board.createCard({
  title: "Repair references after deletion",
  status: "blocked",
  dependencies: [taskDependency, deletionSecondary],
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
assert.equal(repairedDependent.primaryBlockerId, deletionSecondary.id);
assert.equal(repairedDependent.nextStep?.summary, deletionSecondary.label);
assert.equal(
  repairedDependent.needsHuman,
  true,
  "deletion-promoted approval blockers stay visible in the Decisions queue",
);
assert.equal(repairedDependent.orchestrationAudit?.at(-1)?.resolvedDependencyId, taskDependency.id);
assert.equal(repairedDependent.orchestrationAudit?.at(-1)?.actor, "cody");
assert.equal(
  repairedDependent.primaryBlockerPinned,
  false,
  "an unpinned card stays unpinned through deletion repair",
);

// Deletion repair must not quietly revoke an operator pin. The pinned
// dependency did not resolve — the card it pointed at was deleted — so the pin
// carries onto whatever replaces it, and it keeps *working*: a later resolution
// of that replacement is still refused instead of auto-promoting past it.
const pinnedUpstream = await board.createCard({ title: "Upstream under a pinned blocker" });
const pinnedTaskDependency = {
  ...taskDependency,
  id: "pinned-deletion-primary",
  taskId: pinnedUpstream.id,
};
const pinnedReplacement = {
  ...deletionSecondary,
  id: "pinned-deletion-replacement",
  label: "Ask the maintainer for the pinned fallback",
};
const pinnedTertiary = {
  ...deletionSecondary,
  id: "pinned-deletion-tertiary",
  label: "Never promote past the pin",
};
const pinnedDependent = await board.createCard({
  title: "Preserve the pin through deletion repair",
  status: "blocked",
  dependencies: [pinnedTaskDependency, pinnedReplacement, pinnedTertiary],
  primaryBlockerId: pinnedTaskDependency.id,
  primaryBlockerPinned: true,
  nextStep: {
    summary: pinnedTaskDependency.label,
    requiresApproval: false,
    origin: "system",
    updatedAt: now,
  },
});
assert.equal(pinnedDependent.primaryBlockerPinned, true, "the pin is stored before deletion");
assert.equal(await board.deleteCard(pinnedUpstream.id, { actor: "cody" }), "deleted");
const repairedPinned = (await board.loadBoard()).cards.find((card) => card.id === pinnedDependent.id);
assert.ok(repairedPinned);
assert.equal(
  repairedPinned.primaryBlockerId,
  pinnedReplacement.id,
  "deletion repair repoints the primary blocker at the next unresolved dependency",
);
assert.equal(
  repairedPinned.primaryBlockerPinned,
  true,
  "the operator pin survives deletion repair onto the replacement blocker",
);
// The pin is only real if promotion still skips this card. Resolving the
// replacement leaves a blocked card with a settled primary, which is exactly
// what an unpinned card would promote away from.
await assert.rejects(
  board.updateCard(pinnedDependent.id, {
    dependencies: [
      repairedPinned.dependencies![0],
      {
        ...pinnedReplacement,
        state: "resolved",
        resolvedAt: new Date().toISOString(),
        evidence: "Maintainer approved the fallback",
      },
      pinnedTertiary,
    ],
  }),
  (error) => {
    assert.ok(errorCodes(error).includes("blocked_requires_primary"));
    return true;
  },
  "a preserved pin still freezes promotion after deletion repair",
);
const pinnedAfterResolve = (await board.loadBoard()).cards.find((card) => card.id === pinnedDependent.id);
assert.equal(pinnedAfterResolve?.primaryBlockerId, pinnedReplacement.id);
assert.equal(pinnedAfterResolve?.primaryBlockerPinned, true);
assert.equal(
  pinnedAfterResolve?.dependencies?.find((dependency) => dependency.id === pinnedReplacement.id)?.state,
  "unresolved",
  "the refused resolution is not saved",
);

// Nothing left to point at means nothing left to pin: the pin clears rather
// than dangling over a null primary blocker.
const pinnedSoleUpstream = await board.createCard({ title: "Only upstream under a pin" });
const pinnedSoleDependent = await board.createCard({
  title: "Clear the pin when no blocker replaces it",
  status: "blocked",
  dependencies: [{ ...taskDependency, id: "pinned-sole-dependency", taskId: pinnedSoleUpstream.id }],
  primaryBlockerId: "pinned-sole-dependency",
  primaryBlockerPinned: true,
  nextStep: {
    summary: taskDependency.label,
    requiresApproval: false,
    origin: "system",
    updatedAt: now,
  },
});
assert.equal(await board.deleteCard(pinnedSoleUpstream.id, { actor: "cody" }), "deleted");
const repairedPinnedSole = (await board.loadBoard()).cards.find(
  (card) => card.id === pinnedSoleDependent.id,
);
assert.equal(repairedPinnedSole?.primaryBlockerId, null);
assert.equal(
  repairedPinnedSole?.primaryBlockerPinned,
  false,
  "a pin over no remaining blocker clears instead of dangling",
);

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
        primaryBlockerId: "mixed-legacy-task-dependency",
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

// ── #6562: "someone retries or repairs" clears the failure blocker ──────────
// (docs/orchestration-ready-tasks.md). Retry used to leave the system
// execution dependency unresolved and its approval-bound next step in place,
// so the retried task could never be dispatched again.
const retried = await board.transitionCard(running.id, { to: "queued", retry: true });
assert.equal(retried?.lifecycle, "queued");
assert.equal(retried?.retryCount, running.maxRetries + 1);
const retriedBlocker = retried?.dependencies?.find((entry) => entry.id === failureBlocker?.id);
assert.equal(retriedBlocker?.state, "resolved", "retry resolves the system failure blocker");
assert.match(retriedBlocker?.evidence ?? "", /^Retried at /);
assert.ok(retriedBlocker?.resolvedAt, "the resolution is timestamped");
assert.equal(retried?.nextStep, null, "retry clears the system's review-the-failure step");
assert.equal(retried?.primaryBlockerId, null, "no primary blocker points at a resolved failure");
assert.equal(retried?.needsHuman, false);
assert.equal(orchestration.deriveReadiness(retried!, (await board.loadBoard()).cards), "ready");
const redispatched = await board.transitionCard(running.id, { to: "dispatched" });
assert.equal(redispatched?.lifecycle, "dispatched", "a retried task can be dispatched again");

const requeued = await board.transitionCard(cancelledRun.id, { to: "queued" });
const requeuedBlocker = requeued?.dependencies?.find((entry) => entry.kind === "execution");
assert.equal(requeuedBlocker?.state, "resolved", "re-queue resolves the cancellation blocker too");
assert.match(requeuedBlocker?.evidence ?? "", /^Re-queued at /);
assert.equal(requeued?.nextStep, null);
assert.equal(requeued?.retryCount, cancelled?.retryCount, "a re-queue is not counted as a retry");

const humanRetried = await board.transitionCard(humanRun.id, { to: "queued", retry: true });
assert.deepEqual(humanRetried?.nextStep, humanActionStep, "retry keeps a human next step");

const pinnedRetried = await board.transitionCard(pinnedFailure.id, { to: "queued", retry: true });
assert.equal(pinnedRetried?.primaryBlockerId, pinnedBlocker.id, "retry keeps a pinned blocker that is still unresolved");
assert.equal(pinnedRetried?.primaryBlockerPinned, true);
assert.equal(
  pinnedRetried?.dependencies?.find((entry) => entry.id === pinnedBlocker.id)?.state,
  pinnedBlocker.state,
  "retry never resolves a blocker it didn't synthesize",
);
assert.ok(
  pinnedRetried?.dependencies?.filter((entry) => entry.kind === "execution").every((entry) => entry.state === "resolved"),
);

// ── #6562: a launch refusal that needs a person is recorded on the card,
// once, and the confirmation that clears it resolves it everywhere.
const folderRef = "project-folder:proj-nova";
const launchA = await board.createCard({ title: "Launch blocked A" });
const launchB = await board.createCard({ title: "Launch blocked B" });
const blockedA = await board.recordLaunchBlocker(launchA.id, {
  ref: folderRef,
  kind: "human",
  label: "Confirm Nova’s folder so this task can start",
});
assert.equal(blockedA?.lifecycle, "queued", "recording a launch blocker never changes the lifecycle");
assert.equal(blockedA?.status, launchA.status);
const recorded = blockedA?.dependencies?.filter((entry) => entry.ref === folderRef) ?? [];
assert.equal(recorded.length, 1);
assert.equal(recorded[0].origin, "system");
assert.equal(recorded[0].state, "unresolved");
assert.equal(orchestration.deriveReadiness(blockedA!, (await board.loadBoard()).cards), "waiting");
const again = await board.recordLaunchBlocker(launchA.id, {
  ref: folderRef,
  kind: "human",
  label: "Confirm Nova’s folder so this task can start",
});
assert.equal(again?.dependencies?.filter((entry) => entry.ref === folderRef).length, 1, "a repeated refusal is not duplicated");
await board.recordLaunchBlocker(launchB.id, {
  ref: folderRef,
  kind: "human",
  label: "Confirm Nova’s folder so this task can start",
});
const resolvedIds = await board.resolveLaunchBlockers(folderRef, "Nova’s folder was confirmed");
assert.deepEqual(resolvedIds.sort(), [launchA.id, launchB.id].sort());
for (const id of [launchA.id, launchB.id]) {
  const after = (await board.loadBoard()).cards.find((card) => card.id === id)!;
  const dep = after.dependencies?.find((entry) => entry.ref === folderRef);
  assert.equal(dep?.state, "resolved");
  assert.equal(dep?.evidence, "Nova’s folder was confirmed");
  assert.equal(orchestration.deriveReadiness(after, (await board.loadBoard()).cards), "ready");
}
assert.deepEqual(await board.resolveLaunchBlockers(folderRef, "again"), [], "resolving twice touches nothing");
const humanRef = await board.createCard({
  title: "Human-written blocker with the same ref",
  dependencies: [{ ...blocker, id: "human-folder", ref: folderRef }],
});
assert.deepEqual(await board.resolveLaunchBlockers(folderRef, "confirmed"), [], "a human-written blocker is never resolved by automation");
assert.equal(
  (await board.loadBoard()).cards.find((card) => card.id === humanRef.id)?.dependencies?.[0]?.state,
  "unresolved",
);

// ── #6562 review: dispatch only a ready, triaged task, decided in the lock ──
const dispatchable = await board.createCard({ title: "Ready to dispatch" });
const notYet = await board.transitionCard(dispatchable.id, { to: "dispatched", onlyIf: () => false });
assert.equal(notYet?.lifecycle, "queued", "a false guard returns the card unchanged");
assert.equal(board.readyToDispatch(dispatchable, (await board.loadBoard()).cards), true);
const inboxTask = await board.createCard({ title: "Untriaged", status: "inbox" });
assert.equal(inboxTask.status, "inbox");
assert.equal(board.readyToDispatch(inboxTask, (await board.loadBoard()).cards), false, "an Inbox task is not dispatched by opening its chat");
const approvalTask = await board.createCard({ title: "Needs approval", nextStep: humanNextStep });
assert.equal(board.readyToDispatch(approvalTask, (await board.loadBoard()).cards), false, "a pending approval blocks dispatch");
const waitingTask = await board.createCard({ title: "Waiting", dependencies: [{ ...blocker, id: "waiting-dep" }] });
assert.equal(board.readyToDispatch(waitingTask, (await board.loadBoard()).cards), false, "a task that waits on something is not dispatched");
// The guard sees the latest card: a blocker added after a stale check still wins.
const raced = await board.createCard({ title: "Raced" });
const staleCheck = board.readyToDispatch(raced, (await board.loadBoard()).cards);
await board.updateCard(raced.id, { dependencies: [{ ...blocker, id: "raced-dep" }] });
assert.equal(staleCheck, true);
const racedResult = await board.transitionCard(raced.id, { to: "dispatched", onlyIf: board.readyToDispatch });
assert.equal(racedResult?.lifecycle, "queued", "the in-lock guard sees the blocker added after the stale check");
const dispatchedNow = await board.transitionCard(dispatchable.id, { to: "dispatched", onlyIf: board.readyToDispatch });
assert.equal(dispatchedNow?.lifecycle, "dispatched");

// ── #6562 review: retry keeps the step for a blocker that is still open ─────
const humanDep = { ...blocker, id: "still-open" };
const mixed = await board.createCard({
  title: "Fails while also waiting on a person",
  dependencies: [humanDep],
  primaryBlockerId: humanDep.id,
  primaryBlockerPinned: true,
  status: "blocked",
  nextStep: { summary: humanDep.label, requiresApproval: true, origin: "system", updatedAt: now },
});
await board.transitionCard(mixed.id, { to: "cancelled", reason: "Stopped" });
const mixedRetried = await board.transitionCard(mixed.id, { to: "queued" });
assert.equal(mixedRetried?.dependencies?.find((d) => d.id === humanDep.id)?.state, "unresolved", "the person's blocker stays open");
assert.equal(mixedRetried?.primaryBlockerId, humanDep.id);
assert.equal(mixedRetried?.nextStep?.summary, humanDep.label, "the open blocker's step is restored, not dropped");
assert.notEqual(mixedRetried?.nextStep?.summary, "Review the failed run and choose retry or repair");
assert.equal(mixedRetried?.needsHuman, mixedRetried?.nextStep?.requiresApproval === true, "needsHuman follows the remaining step");

// ── #6562 review: a launch blocker on a settled Blocked card becomes primary ─
const settlingDep = { ...blocker, id: "settling" };
const toSettle = await board.createCard({
  title: "Blocked with settled blockers",
  dependencies: [settlingDep],
  primaryBlockerId: settlingDep.id,
  status: "blocked",
  nextStep: { summary: settlingDep.label, requiresApproval: true, origin: "system", updatedAt: now },
});
// Resolving the only blocker leaves the card Blocked with no open primary.
const settledBlocked = await board.updateCard(toSettle.id, {
  dependencies: [{ ...settlingDep, state: "resolved", evidence: "done", resolvedAt: now, resolvedBy: "cody" }],
});
assert.equal(settledBlocked?.status, "blocked");
assert.equal(settledBlocked?.primaryBlockerId, null);
const recordedOnBlocked = await board.recordLaunchBlocker(settledBlocked.id, {
  ref: "project-folder:proj-settled", kind: "human", label: "Confirm Settled’s folder so this task can start",
});
const added = recordedOnBlocked?.dependencies?.find((d) => d.ref === "project-folder:proj-settled");
assert.ok(added, "the blocker is recorded instead of being rejected by the blocked contract");
assert.equal(recordedOnBlocked?.primaryBlockerId, added.id);
assert.equal(recordedOnBlocked?.nextStep?.summary, added.label);
assert.equal(recordedOnBlocked?.needsHuman, true);

// ── #6562 review: moving a task to another project settles the old folder ──
const moving = await board.createCard({ title: "Moves project" });
await board.updateCard(moving.id, { projectId: "proj-old" }).catch(() => null);
const beforeMove = (await board.loadBoard()).cards.find((c) => c.id === moving.id);
if (beforeMove?.projectId === "proj-old") {
  await board.recordLaunchBlocker(moving.id, { ref: "project-folder:proj-old", kind: "human", label: "Confirm Old’s folder so this task can start" });
  const moved = await board.updateCard(moving.id, { projectId: null });
  const oldDep = moved?.dependencies?.find((d) => d.ref === "project-folder:proj-old");
  assert.equal(oldDep?.state, "resolved", "the old project's folder no longer blocks the task");
  assert.match(oldDep?.evidence ?? "", /^Task moved to another project at /);
  assert.equal(orchestration.deriveReadiness(moved!, (await board.loadBoard()).cards), "ready");
} else {
  assert.fail(`the test fixture could not assign a project: ${JSON.stringify(beforeMove?.projectId)}`);
}

console.log("cave-board-orchestration.test.ts OK");
