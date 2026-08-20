import assert from "node:assert/strict";

import {
  buildBoardAgenticContext,
  validateBoardAgenticRecommendation,
} from "./board-agentic-enhance.ts";
import { isAutoApplyAllowed, type AgenticRecommendation } from "./agentic-recommendations.ts";
import type { Card, TaskDependency, TaskNextStep } from "./cave-board-types.ts";

const now = "2026-08-19T14:00:00.000Z";

function dependency(
  id: string,
  overrides: Partial<TaskDependency> = {},
): TaskDependency {
  return {
    id,
    kind: "external",
    label: `Resolve ${id}`,
    state: "unresolved",
    origin: "enhance",
    createdAt: now,
    ...overrides,
  };
}

function nextStep(overrides: Partial<TaskNextStep> = {}): TaskNextStep {
  return {
    summary: "Review the proposed task change",
    requiresApproval: false,
    origin: "enhance",
    updatedAt: now,
    ...overrides,
  };
}

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: `Task ${id}`,
    notes: "",
    status: "backlog",
    priority: "medium",
    familiarId: null,
    sessionId: null,
    cwd: null,
    links: [],
    github: [],
    asana: [],
    labels: [],
    createdAt: now,
    updatedAt: now,
    lifecycle: "queued",
    lifecycleAt: now,
    retryCount: 0,
    maxRetries: 2,
    steps: [],
    dependencies: [],
    primaryBlockerId: null,
    primaryBlockerPinned: false,
    nextStep: null,
    orchestrationAudit: [],
    ...overrides,
  };
}

function recommendation(
  target: Card,
  cards: Card[],
  overrides: Partial<AgenticRecommendation> = {},
): AgenticRecommendation {
  return {
    id: "proposal-1",
    surface: "board",
    kind: "dependency",
    payload: {
      cardId: target.id,
      patch: {},
    },
    rationale: "The task needs a verified blocker.",
    inferredGoal: "Make the task ready for review.",
    rankReasons: ["It resolves the active task's missing context."],
    evidenceRefs: [{ id: `task:${target.id}`, kind: "task", label: target.title }],
    contextFingerprint: buildBoardAgenticContext(target, cards).fingerprint,
    verification: { status: "proposal", checks: [] },
    application: { mode: "review", requiresApproval: true, reversible: false },
    ...overrides,
  };
}

const humanDependency = dependency("human-dependency", { origin: "human" });
const humanStep = nextStep({
  summary: "Ask the maintainer to choose an approach",
  requiresApproval: true,
  origin: "human",
});
const humanAuthored = card("human-authored", {
  status: "blocked",
  dependencies: [humanDependency],
  primaryBlockerId: humanDependency.id,
  nextStep: humanStep,
});
const humanProposal = recommendation(humanAuthored, [humanAuthored], {
  payload: {
    cardId: humanAuthored.id,
    patch: {
      dependencies: [dependency("replacement")],
      primaryBlockerId: "replacement",
      nextStep: nextStep(),
    },
  },
});
const humanResult = validateBoardAgenticRecommendation(humanAuthored, [humanAuthored], humanProposal);
assert.equal(humanResult.status, "blocked");
assert.ok(
  humanResult.errors.some((error) => error.code === "dependency_authorship"),
  "human dependencies remain proposals rather than being replaced",
);
assert.ok(
  humanResult.errors.some((error) => error.code === "next_step_authorship"),
  "human next steps remain proposals rather than being replaced",
);

const upstream = card("upstream", {
  dependencies: [dependency("upstream-needs-target", {
    kind: "task",
    taskId: "target",
  })],
});
const target = card("target");
const cyclicProposal = recommendation(target, [target, upstream], {
  payload: {
    cardId: target.id,
    patch: {
      dependencies: [dependency("target-needs-upstream", {
        kind: "task",
        taskId: upstream.id,
      })],
    },
  },
});
const cyclicResult = validateBoardAgenticRecommendation(target, [target, upstream], cyclicProposal);
assert.equal(cyclicResult.status, "blocked");
assert.ok(cyclicResult.errors.some((error) => error.code === "dependency_cycle"));

const danglingProposal = recommendation(target, [target], {
  payload: {
    cardId: target.id,
    patch: {
      dependencies: [dependency("missing-task", {
        kind: "task",
        taskId: "not-on-this-board",
      })],
    },
  },
});
const danglingResult = validateBoardAgenticRecommendation(target, [target], danglingProposal);
assert.equal(danglingResult.status, "blocked");
assert.ok(danglingResult.errors.some((error) => error.code === "dependency_dangling"));

const legacyBlocked = card("legacy-blocked", { status: "blocked" });
const repairDependency = dependency("repair-dependency");
const repairStep = nextStep({ requiresApproval: true });
const repairProposal = recommendation(legacyBlocked, [legacyBlocked], {
  payload: {
    cardId: legacyBlocked.id,
    patch: {
      dependencies: [repairDependency],
      primaryBlockerId: repairDependency.id,
      nextStep: repairStep,
    },
  },
});
const repairResult = validateBoardAgenticRecommendation(legacyBlocked, [legacyBlocked], repairProposal);
assert.equal(repairResult.status, "proposal", "valid legacy repairs remain review proposals");
assert.equal(repairResult.needsHuman, true, "approval-gated repairs request human attention");
assert.equal(repairResult.recommendation.application.requiresApproval, true);
assert.equal(repairResult.recommendation.application.mode, "review");

const githubCard = card("github-card", {
  links: ["https://github.com/OpenCoven/coven-cave/issues/42/"],
  github: [{
    id: "github:issue:opencoven/coven-cave:42",
    kind: "issue",
    repo: "OpenCoven/coven-cave",
    number: 42,
    title: "Issue 42",
    url: "https://github.com/OpenCoven/coven-cave/issues/42/",
    labels: [],
  }],
});
const normalization = recommendation(githubCard, [githubCard], {
  id: "normalize-github-reference",
  kind: "canonicalize-reference",
  payload: {
    referenceId: "github:issue:opencoven/coven-cave:42",
    canonicalUrl: "https://github.com/OpenCoven/coven-cave/issues/42",
  },
  evidenceRefs: [{
    id: "OpenCoven/coven-cave#42",
    kind: "github",
    label: "Issue 42",
  }],
});
const normalizationResult = validateBoardAgenticRecommendation(githubCard, [githubCard], normalization);
assert.equal(normalizationResult.status, "verified");
assert.equal(isAutoApplyAllowed(normalizationResult.recommendation), true);
assert.equal(
  normalizationResult.patch?.github?.[0]?.url,
  "https://github.com/OpenCoven/coven-cave/issues/42",
  "only the exact resolved GitHub reference may be normalized",
);

const stale = recommendation(target, [target], {
  contextFingerprint: "ctx-v1-00000000000000000000000000000000",
});
const staleResult = validateBoardAgenticRecommendation(target, [target], stale);
assert.equal(staleResult.status, "blocked");
assert.ok(staleResult.errors.some((error) => error.code === "stale_context"));

const denseCards = Array.from({ length: 64 }, (_, cardIndex) => card(`dense-card-${cardIndex}`, {
  dependencies: Array.from(
    { length: 128 },
    (_, dependencyIndex) => dependency(`dense-${cardIndex}-${dependencyIndex}`),
  ),
}));
assert.doesNotThrow(
  () => buildBoardAgenticContext(denseCards[0]!, denseCards),
  "the advertised 64-card bounded context must remain fingerprintable at maximum dependency density",
);

const clearPrimary = card("clear-primary", {
  dependencies: [dependency("existing-primary")],
  primaryBlockerId: "existing-primary",
});
const clearPrimaryResult = validateBoardAgenticRecommendation(
  clearPrimary,
  [clearPrimary],
  recommendation(clearPrimary, [clearPrimary], {
    payload: {
      cardId: clearPrimary.id,
      patch: {
        dependencies: [],
        primaryBlockerId: null,
      },
    },
  }),
);
assert.equal(clearPrimaryResult.status, "proposal");
assert.deepEqual(clearPrimaryResult.patch, {
  dependencies: [],
  primaryBlockerId: null,
});

const boundedCards = Array.from({ length: 65 }, (_, index) => card(`bounded-${String(index).padStart(2, "0")}`));
const boundedTarget = boundedCards[0]!;
const omittedEvidence = boundedCards[64]!;
const boundedFingerprint = buildBoardAgenticContext(boundedTarget, boundedCards).fingerprint;
const changedOmittedEvidence = { ...omittedEvidence, notes: "Changed outside the bounded graph." };
assert.equal(
  buildBoardAgenticContext(boundedTarget, [...boundedCards.slice(0, 64), changedOmittedEvidence]).fingerprint,
  boundedFingerprint,
  "omitted cards do not contribute to the bounded context fingerprint",
);
const omittedEvidenceResult = validateBoardAgenticRecommendation(
  boundedTarget,
  boundedCards,
  recommendation(boundedTarget, boundedCards, {
    evidenceRefs: [{ id: `task:${omittedEvidence.id}`, kind: "task", label: omittedEvidence.title }],
  }),
);
assert.equal(omittedEvidenceResult.status, "blocked");
assert.ok(
  omittedEvidenceResult.errors.some((entry) => entry.code === "evidence_unresolved"),
  "a proposal cannot cite a card outside the bounded context it was fingerprinted against",
);

const dependencyLimitCard = card("dependency-limit", {
  dependencies: Array.from({ length: 129 }, (_, index) => dependency(`dependency-${index + 1}`)),
});
const dependencyLimitResult = validateBoardAgenticRecommendation(
  dependencyLimitCard,
  [dependencyLimitCard],
  recommendation(dependencyLimitCard, [dependencyLimitCard], {
    evidenceRefs: [{
      id: "dependency:dependency-129",
      kind: "dependency",
      label: "Dependency 129",
    }],
    payload: {
      cardId: dependencyLimitCard.id,
      patch: { notes: "Use the hidden dependency as evidence." },
    },
  }),
);
assert.equal(dependencyLimitResult.status, "blocked");
assert.ok(dependencyLimitResult.errors.some((entry) => entry.code === "evidence_unresolved"));

const githubLimitCard = card("github-limit", {
  links: Array.from(
    { length: 33 },
    (_, index) => `https://github.com/OpenCoven/coven-cave/issues/${index + 1}`,
  ),
  github: Array.from({ length: 33 }, (_, index) => ({
    id: `github:issue:opencoven/coven-cave:${index + 1}`,
    kind: "issue" as const,
    repo: "OpenCoven/coven-cave",
    number: index + 1,
    title: `Issue ${index + 1}`,
    url: `https://github.com/OpenCoven/coven-cave/issues/${index + 1}`,
    labels: [],
  })),
});
const githubLimitResult = validateBoardAgenticRecommendation(
  githubLimitCard,
  [githubLimitCard],
  recommendation(githubLimitCard, [githubLimitCard], {
    evidenceRefs: [{
      id: "OpenCoven/coven-cave#33",
      kind: "github",
      label: "Issue 33",
    }],
    payload: {
      cardId: githubLimitCard.id,
      patch: { notes: "Use the hidden GitHub item as evidence." },
    },
  }),
);
assert.equal(githubLimitResult.status, "blocked");
assert.ok(githubLimitResult.errors.some((entry) => entry.code === "evidence_unresolved"));

const noteContext = buildBoardAgenticContext(target, [target]);
const changedNotes = { ...target, notes: "The verified acceptance condition changed." };
assert.notEqual(
  buildBoardAgenticContext(changedNotes, [changedNotes]).fingerprint,
  noteContext.fingerprint,
  "meaningful task prose changes invalidate a generated proposal",
);

console.log("board-agentic-enhance.test.ts: ok");
