import { createHash } from "node:crypto";
import {
  contextFingerprint,
  verifyAutoApplicableRecommendation,
  type AgenticAdapterVerificationCheck,
  type AgenticRecommendation,
} from "@/lib/agentic-recommendations";
import type {
  BoardAgenticEvidenceResolution,
  BoardAgenticPatch,
  BoardAgenticProposalError,
  BoardAgenticProposalRecord,
  Card,
  CardGitHubLink,
  TaskDependency,
  TaskNextStep,
} from "@/lib/board/cave-board-types";
import { containsSecretText } from "@/lib/secret-redaction";
import { dependenciesOf, validateOrchestration } from "@/lib/tasks/task-orchestration";
import { taskGitHubLinkFromUrl } from "@/lib/github/task-github";

const MAX_CONTEXT_TASKS = 64;
const MAX_CONTEXT_DEPENDENCIES = 128;
const MAX_CONTEXT_GITHUB_REFS = 32;
const MAX_CONTEXT_TEXT_CHARS = 320;
const MAX_TITLE_CHARS = 2_000;
const MAX_NOTES_CHARS = 8_000;
const MAX_LINKS = 64;
const MAX_GITHUB_LINKS = 32;
const MODEL_PATCH_FIELDS = new Set<keyof BoardAgenticPatch>([
  "title",
  "notes",
  "links",
  "github",
  "dependencies",
  "primaryBlockerId",
  "primaryBlockerPinned",
  "nextStep",
]);

type RawRecord = Record<string, unknown>;

export type BoardAgenticEnhanceContext = {
  fingerprint: string;
  context: {
    cardId: string;
    cardUpdatedAt: string;
    taskIds: string[];
    githubRefs: string[];
  };
  snapshot: {
    card: Record<string, unknown>;
    graph: Array<Record<string, unknown>>;
  };
};

export type BoardAgenticValidation = {
  status: "proposal" | "verified" | "blocked";
  recommendation: AgenticRecommendation;
  patch: BoardAgenticPatch | null;
  evidence: BoardAgenticEvidenceResolution[];
  errors: BoardAgenticProposalError[];
  needsHuman: boolean;
};

function isRecord(value: unknown): value is RawRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function boundedContextText(value: string): string {
  if (containsSecretText(value)) return "[redacted]";
  return value.slice(0, MAX_CONTEXT_TEXT_CHARS);
}

function githubRef(link: CardGitHubLink): string | null {
  return link.number === undefined ? null : `${link.repo}#${link.number}`;
}

function taskEvidenceId(id: string): string {
  return `task:${id}`;
}

function dependencyEvidenceId(id: string): string {
  return `dependency:${id}`;
}

function taskSnapshot(card: Card): Record<string, unknown> {
  return {
    id: card.id,
    evidenceId: taskEvidenceId(card.id),
    title: boundedContextText(card.title),
    notes: boundedContextText(card.notes),
    status: card.status,
    lifecycle: card.lifecycle,
    dependencies: dependenciesOf(card)
      .slice(0, MAX_CONTEXT_DEPENDENCIES)
      .map((dependency) => ({
        id: dependency.id,
        kind: dependency.kind,
        taskId: dependency.taskId ?? null,
        ref: dependency.ref ?? null,
        state: dependency.state,
        origin: dependency.origin,
      })),
    primaryBlockerId: card.primaryBlockerId ?? null,
    nextStep: card.nextStep
      ? {
        summary: boundedContextText(card.nextStep.summary),
        requiresApproval: card.nextStep.requiresApproval,
        origin: card.nextStep.origin,
      }
      : null,
    github: card.github.slice(0, MAX_CONTEXT_GITHUB_REFS).map((link) => ({
      id: link.id,
      ref: githubRef(link),
      kind: link.kind,
      state: link.state ?? null,
    })),
  };
}

function taskFingerprintDigest(card: Card): string {
  const stable = {
    id: card.id,
    title: card.title,
    notes: card.notes,
    status: card.status,
    lifecycle: card.lifecycle,
    updatedAt: card.updatedAt,
    dependencies: dependenciesOf(card).map((dependency) => ({
      id: dependency.id,
      kind: dependency.kind,
      label: dependency.label,
      taskId: dependency.taskId ?? null,
      ref: dependency.ref ?? null,
      url: dependency.url ?? null,
      state: dependency.state,
      origin: dependency.origin,
      evidence: dependency.evidence ?? null,
    })),
    primaryBlockerId: card.primaryBlockerId ?? null,
    primaryBlockerPinned: card.primaryBlockerPinned ?? false,
    nextStep: card.nextStep ?? null,
    github: card.github.map((link) => ({
      id: link.id,
      repo: link.repo,
      number: link.number ?? null,
      kind: link.kind,
      url: link.url,
      state: link.state ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

/** Build a deterministic, bounded context without handing raw task notes or secrets to a model. */
export function buildBoardAgenticContext(
  card: Card,
  cards: readonly Card[],
): BoardAgenticEnhanceContext {
  const related = [
    card,
    ...cards
      .filter((candidate) => candidate.id !== card.id)
      .sort((left, right) => left.id.localeCompare(right.id)),
  ].slice(0, MAX_CONTEXT_TASKS);
  const githubRefs = card.github
    .map(githubRef)
    .filter((reference): reference is string => reference !== null)
    .slice(0, MAX_CONTEXT_GITHUB_REFS);
  const snapshot = {
    card: taskSnapshot(card),
    graph: related.map(taskSnapshot),
  };
  const fingerprint = contextFingerprint({
    card: { id: card.id, digest: taskFingerprintDigest(card) },
    graph: related.map((candidate) => ({
      id: candidate.id,
      digest: taskFingerprintDigest(candidate),
    })),
  });
  return {
    fingerprint,
    context: {
      cardId: card.id,
      cardUpdatedAt: card.updatedAt,
      taskIds: related.map((candidate) => candidate.id),
      githubRefs,
    },
    snapshot,
  };
}

function error(
  code: string,
  message: string,
  field?: BoardAgenticProposalError["field"],
  dependencyId?: string,
): BoardAgenticProposalError {
  return {
    code,
    message,
    ...(field ? { field } : {}),
    ...(dependencyId ? { dependencyId } : {}),
  };
}

function resolveBoardEvidence(
  card: Card,
  recommendation: AgenticRecommendation,
  cards: readonly Card[],
): { evidence: BoardAgenticEvidenceResolution[]; errors: BoardAgenticProposalError[] } {
  const boundedTaskIds = new Set(buildBoardAgenticContext(card, cards).context.taskIds);
  const boundedCards = cards.filter((candidate) => boundedTaskIds.has(candidate.id));
  const tasks = new Map<string, Card>();
  for (const candidate of boundedCards) {
    tasks.set(candidate.id, candidate);
    tasks.set(taskEvidenceId(candidate.id), candidate);
  }
  const dependencies = new Map<string, TaskDependency>();
  for (const candidate of boundedCards) {
    for (const dependency of dependenciesOf(candidate).slice(0, MAX_CONTEXT_DEPENDENCIES)) {
      if (!dependencies.has(dependency.id)) {
        dependencies.set(dependency.id, dependency);
        dependencies.set(dependencyEvidenceId(dependency.id), dependency);
      }
    }
  }
  const github = new Map<string, CardGitHubLink>();
  for (const candidate of boundedCards) {
    for (const link of candidate.github.slice(0, MAX_CONTEXT_GITHUB_REFS)) {
      const reference = githubRef(link);
      if (reference && !github.has(reference)) github.set(reference, link);
    }
  }

  const evidence: BoardAgenticEvidenceResolution[] = [];
  const errors: BoardAgenticProposalError[] = [];
  for (const reference of recommendation.evidenceRefs) {
    if (reference.kind === "task") {
      const task = tasks.get(reference.id);
      if (task) {
        evidence.push({ ...reference, kind: "task", resolvedId: task.id });
        continue;
      }
    } else if (reference.kind === "dependency") {
      const dependency = dependencies.get(reference.id);
      if (dependency) {
        evidence.push({ ...reference, kind: "dependency", resolvedId: dependency.id });
        continue;
      }
    } else if (reference.kind === "github") {
      const link = github.get(reference.id);
      if (link) {
        evidence.push({ ...reference, kind: "github", resolvedId: link.id });
        continue;
      }
    }
    errors.push(error(
      "evidence_unresolved",
      `Evidence reference "${reference.id}" does not resolve in this Board context.`,
    ));
  }
  return { evidence, errors };
}

function modelPatch(
  card: Card,
  recommendation: AgenticRecommendation,
): { patch: BoardAgenticPatch | null; errors: BoardAgenticProposalError[] } {
  if (!isRecord(recommendation.payload) || Object.keys(recommendation.payload).length !== 2) {
    return { patch: null, errors: [error("invalid_payload", "Board proposals require a card id and patch.")] };
  }
  if (recommendation.payload.cardId !== card.id || !isRecord(recommendation.payload.patch)) {
    return { patch: null, errors: [error("invalid_payload", "The proposal must target the active Board card.")] };
  }
  const rawPatch = recommendation.payload.patch;
  const keys = Object.keys(rawPatch);
  if (
    keys.length === 0
    || keys.some((key) => !MODEL_PATCH_FIELDS.has(key as keyof BoardAgenticPatch))
  ) {
    return {
      patch: null,
      errors: [error("invalid_payload", "Board proposals may not set status, lifecycle, dispatch, or needs-human fields.")],
    };
  }

  const patch: BoardAgenticPatch = {};
  const errors: BoardAgenticProposalError[] = [];
  if ("title" in rawPatch) {
    if (typeof rawPatch.title !== "string" || !rawPatch.title.trim() || rawPatch.title.length > MAX_TITLE_CHARS) {
      errors.push(error("invalid_payload", "A proposed title must be bounded, non-empty text."));
    } else {
      patch.title = rawPatch.title.trim();
    }
  }
  if ("notes" in rawPatch) {
    if (typeof rawPatch.notes !== "string" || rawPatch.notes.length > MAX_NOTES_CHARS) {
      errors.push(error("invalid_payload", "Proposed notes must be bounded text."));
    } else {
      patch.notes = rawPatch.notes.trim();
    }
  }
  if ("links" in rawPatch) {
    if (
      !Array.isArray(rawPatch.links)
      || rawPatch.links.length > MAX_LINKS
      || !rawPatch.links.every((link) => typeof link === "string" && link.length <= MAX_NOTES_CHARS)
    ) {
      errors.push(error("invalid_payload", "Proposed links must be a bounded string list."));
    } else {
      patch.links = [...rawPatch.links] as string[];
    }
  }
  if ("github" in rawPatch) {
    if (!Array.isArray(rawPatch.github) || rawPatch.github.length > MAX_GITHUB_LINKS) {
      errors.push(error("invalid_payload", "Proposed GitHub links must be a bounded list."));
    } else {
      patch.github = rawPatch.github as CardGitHubLink[];
    }
  }
  if ("dependencies" in rawPatch) {
    if (!Array.isArray(rawPatch.dependencies)) {
      errors.push(error("dependency_invalid", "Proposed dependencies must be an array.", "dependencies"));
    } else {
      patch.dependencies = rawPatch.dependencies as TaskDependency[];
    }
  }
  if ("primaryBlockerId" in rawPatch) {
    if (rawPatch.primaryBlockerId !== null && typeof rawPatch.primaryBlockerId !== "string") {
      errors.push(error("primary_blocker_invalid", "The primary blocker must be a dependency id or null.", "primaryBlockerId"));
    } else {
      patch.primaryBlockerId = rawPatch.primaryBlockerId;
    }
  }
  if ("primaryBlockerPinned" in rawPatch) {
    if (typeof rawPatch.primaryBlockerPinned !== "boolean") {
      errors.push(error("primary_blocker_invalid", "The primary blocker pin must be true or false.", "primaryBlockerPinned"));
    } else {
      patch.primaryBlockerPinned = rawPatch.primaryBlockerPinned;
    }
  }
  if ("nextStep" in rawPatch) {
    if (rawPatch.nextStep !== null && !isRecord(rawPatch.nextStep)) {
      errors.push(error("next_step_invalid", "The next step must be complete or null.", "nextStep"));
    } else {
      patch.nextStep = rawPatch.nextStep as TaskNextStep | null;
    }
  }
  return { patch: errors.length === 0 ? patch : null, errors };
}

function canonicalGitHubUrl(link: CardGitHubLink): string | null {
  if (link.number === undefined) return null;
  const path = link.kind === "pr" ? "pull" : link.kind === "issue" ? "issues" : null;
  return path ? `https://github.com/${link.repo}/${path}/${link.number}` : null;
}

function canonicalizationPatch(
  card: Card,
  recommendation: AgenticRecommendation,
  evidence: readonly BoardAgenticEvidenceResolution[],
): { patch: BoardAgenticPatch | null; errors: BoardAgenticProposalError[] } {
  const payload = recommendation.payload as { referenceId?: unknown; canonicalUrl?: unknown };
  const link = typeof payload.referenceId === "string"
    ? card.github.find((item) => item.id === payload.referenceId)
    : undefined;
  const canonicalUrl = typeof payload.canonicalUrl === "string" ? payload.canonicalUrl : undefined;
  const expectedUrl = link ? canonicalGitHubUrl(link) : null;
  const parsed = canonicalUrl ? taskGitHubLinkFromUrl(canonicalUrl) : null;
  const exactEvidence = link && evidence.some(
    (entry) => entry.kind === "github" && entry.resolvedId === link.id,
  );
  if (
    !link
    || !canonicalUrl
    || !expectedUrl
    || canonicalUrl !== expectedUrl
    || !parsed
    || parsed.repo !== link.repo
    || parsed.number !== link.number
    || !exactEvidence
  ) {
    return {
      patch: null,
      errors: [error(
        "normalization_not_exact",
        "A Board normalization must match one exact resolved GitHub reference.",
      )],
    };
  }
  return {
    patch: {
      links: card.links.map((value) => value === link.url ? canonicalUrl : value),
      github: card.github.map((item) => item.id === link.id ? { ...item, url: canonicalUrl } : item),
    },
    errors: [],
  };
}

function withValidation(
  recommendation: AgenticRecommendation,
  status: "proposal" | "verified" | "blocked",
  checks: AgenticAdapterVerificationCheck[],
  errors: BoardAgenticProposalError[],
): AgenticRecommendation {
  if (status === "verified") {
    const verified = verifyAutoApplicableRecommendation(recommendation, checks);
    if (verified) return verified;
  }
  return {
    ...recommendation,
    verification: {
      status: status === "blocked" ? "blocked" : "proposal",
      checks: [
        ...checks,
        ...(status === "blocked"
          ? [{
            id: "board-validation",
            state: "failed" as const,
            detail: errors[0]?.message ?? "The Board proposal was blocked.",
          }]
          : []),
      ],
    },
    application: {
      mode: "review",
      requiresApproval: true,
      reversible: false,
    },
  };
}

/**
 * Resolves model output against the current Board snapshot. It never mutates a
 * card: callers persist the returned record, and accepted application must
 * revalidate through cave-board's mutators.
 */
export function validateBoardAgenticRecommendation(
  card: Card,
  cards: readonly Card[],
  recommendation: AgenticRecommendation,
): BoardAgenticValidation {
  const context = buildBoardAgenticContext(card, cards);
  const errors: BoardAgenticProposalError[] = [];
  if (recommendation.surface !== "board") {
    errors.push(error("invalid_surface", "Board Enhance only accepts Board recommendations."));
  }
  if (recommendation.contextFingerprint !== context.fingerprint) {
    errors.push(error("stale_context", "The task changed before this proposal could be verified."));
  }

  const evidenceResolution = resolveBoardEvidence(card, recommendation, cards);
  errors.push(...evidenceResolution.errors);
  const checks: AgenticAdapterVerificationCheck[] = [
    {
      id: "context-fingerprint",
      state: recommendation.contextFingerprint === context.fingerprint ? "passed" : "failed",
      detail: "The proposal fingerprint matches the current bounded Board context.",
    },
    ...evidenceResolution.evidence.map((reference) => ({
      id: `evidence-${reference.kind}-${reference.resolvedId}`,
      state: "passed" as const,
      detail: `Resolved ${reference.kind} evidence "${reference.id}" to "${reference.resolvedId}".`,
    })),
  ];

  const deterministic = recommendation.kind === "canonicalize-reference";
  const proposal = deterministic
    ? canonicalizationPatch(card, recommendation, evidenceResolution.evidence)
    : modelPatch(card, recommendation);
  errors.push(...proposal.errors);

  let candidate: Card | null = null;
  if (proposal.patch) {
    candidate = {
      ...card,
      ...proposal.patch,
      dependencies: proposal.patch.dependencies ?? card.dependencies ?? [],
      primaryBlockerId: "primaryBlockerId" in proposal.patch
        ? proposal.patch.primaryBlockerId ?? null
        : card.primaryBlockerId ?? null,
      primaryBlockerPinned: "primaryBlockerPinned" in proposal.patch
        ? proposal.patch.primaryBlockerPinned ?? false
        : card.primaryBlockerPinned ?? false,
      nextStep: "nextStep" in proposal.patch ? proposal.patch.nextStep ?? null : card.nextStep ?? null,
    };
    if (!deterministic) {
      errors.push(...validateOrchestration(candidate, {
        cards,
        previous: card,
        automated: true,
      }));
    }
  }

  const needsHuman = candidate?.nextStep?.requiresApproval === true;
  const status = errors.length > 0 ? "blocked" : deterministic ? "verified" : "proposal";
  return {
    status,
    recommendation: withValidation(recommendation, status, checks, errors),
    patch: errors.length === 0 ? proposal.patch : null,
    evidence: evidenceResolution.evidence,
    errors,
    needsHuman,
  };
}

/** Convert a fresh adapter result into the bounded persistence record owned by cave-board. */
export function boardAgenticProposalRecord(
  context: BoardAgenticEnhanceContext,
  validation: BoardAgenticValidation,
): Omit<BoardAgenticProposalRecord, "createdAt" | "updatedAt"> {
  return {
    id: validation.recommendation.id,
    recommendation: validation.recommendation,
    patch: validation.patch,
    state: validation.status === "blocked" ? "blocked" : "proposed",
    context: {
      ...context.context,
      fingerprint: context.fingerprint,
    },
    evidence: validation.evidence,
    validation: {
      status: validation.recommendation.verification.status,
      checks: validation.recommendation.verification.checks,
      errors: validation.errors,
    },
    needsHuman: validation.needsHuman,
  };
}
