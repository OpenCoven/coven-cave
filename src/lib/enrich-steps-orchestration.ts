// Enrich-steps orchestration suggestions (cave-bmcoe)
//
// The bulk Enhance route (`/api/board/enrich-steps`) refreshes a familiar's
// tasks on every run. Phase 6 extends that output so a task enrichment can
// also propose dependency, primary-blocker, and next-step changes. Those
// suggestions are governed: auto-application requires all three gates —
// grounding (every reference resolves to a live card, a reachable GitHub item,
// or a known service), structural validity (the merged card passes the full
// validator as a dry run, including cycle and dangling checks), and
// non-conflict (automation may rewrite only enhance/system records, never a
// human-authored dependency or next step). Anything failing a gate lands in
// the card's `agenticEnhance.proposals` review queue with the failed gate
// named. Model-reported confidence ranks suggestions but never authorizes a
// write.
//
// Pure functions only — no I/O — so the gate policy is testable without a
// board file and shared with the route wiring.

import type { AgenticRecommendation, AgenticVerificationCheck } from "@/lib/agentic-recommendations";
import {
  buildBoardAgenticContext,
} from "@/lib/board-agentic-enhance";
import type {
  BoardAgenticEnhanceState,
  BoardAgenticPatch,
  BoardAgenticProposalAuditEntry,
  BoardAgenticProposalError,
  BoardAgenticProposalRecord,
  Card,
  EnrichmentGateName,
  TaskDependency,
  TaskDependencyKind,
  TaskDependencyState,
  TaskNextStep,
} from "@/lib/cave-board-types";
import { dependenciesOf, validateOrchestration } from "@/lib/task-orchestration";
import { taskGitHubLinkFromUrl } from "@/lib/task-github";

export const MAX_PROPOSED_DEPENDENCIES = 8;
export const MAX_PROPOSED_STEP_SUMMARY_CHARS = 240;
const MAX_PROPOSED_LABEL_CHARS = 240;
const MAX_PROPOSED_REF_CHARS = 160;
const MAX_PROPOSED_URL_CHARS = 240;
const MAX_PROPOSED_TARGET_CHARS = 160;
const MAX_PROPOSED_CAPABILITY_CHARS = 80;
const MAX_PROPOSED_ACTOR_CHARS = 80;
const MAX_PROPOSED_INPUTS = 8;
const MAX_PROPOSED_INPUT_CHARS = 120;
const MAX_PROPOSED_RATIONALE_CHARS = 400;
const MAX_PROPOSED_ID_CHARS = 64;
const MAX_PROPOSED_PROPOSALS = 16;
const MAX_AUDIT_ENTRIES = 64;

const DEPENDENCY_KINDS = new Set<TaskDependencyKind>([
  "task",
  "github",
  "human",
  "credential",
  "service",
  "execution",
  "external",
]);
const DEPENDENCY_STATES = new Set<TaskDependencyState>(["unresolved", "resolved", "waived"]);
const DEP_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Services the grounding gate treats as reachable. A proposed service
 * dependency whose `ref` is not in this set fails grounding and lands in the
 * review queue rather than auto-applying; an operator can still apply it
 * deliberately after adding the service here.
 */
export const KNOWN_SERVICE_REFS = new Set([
  "svc:agent",
  "svc:api",
  "svc:auth",
  "svc:aws",
  "svc:build",
  "svc:cache",
  "svc:ci",
  "svc:database",
  "svc:deploy",
  "svc:docker",
  "svc:github",
  "svc:mail",
  "svc:queue",
  "svc:storage",
  "svc:tailscale",
  "svc:vercel",
  "svc:web",
]);

/** The three auto-application gates, in evaluation order. */
export const ENRICHMENT_GATES: readonly EnrichmentGateName[] = [
  "grounding",
  "structural",
  "non-conflict",
];

export type EnrichmentOrchestrationProposal = {
  dependencies?: TaskDependency[];
  primaryBlockerId?: string | null;
  primaryBlockerPinned?: boolean;
  nextStep?: TaskNextStep | null;
  /** Model-reported 0..1 confidence — ranking only, never authorization. */
  confidence?: number | null;
  rationale?: string | null;
};

export type EnrichmentGateIssue = {
  gate: EnrichmentGateName;
  code: string;
  field?: BoardAgenticProposalError["field"];
  dependencyId?: string;
  message: string;
};

export type EnrichmentGateResult = {
  proposal: EnrichmentOrchestrationProposal;
  issues: EnrichmentGateIssue[];
  gatesPassed: EnrichmentGateName[];
  gatesFailed: EnrichmentGateName[];
  /** The merged card the structural gate dry-ran. */
  candidate: Card;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Bounded 0..1 confidence. Anything else is treated as absent. */
export function cleanEnrichmentConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function cleanProposedDependency(
  value: unknown,
  existingIds: Set<string>,
  proposed: TaskDependency[],
  now: string,
): TaskDependency | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (typeof kind !== "string" || !DEPENDENCY_KINDS.has(kind as TaskDependencyKind)) return null;
  const label = typeof value.label === "string"
    ? value.label.trim().slice(0, MAX_PROPOSED_LABEL_CHARS)
    : "";
  if (!label) return null;
  const state = typeof value.state === "string"
    && DEPENDENCY_STATES.has(value.state as TaskDependencyState)
    ? value.state as TaskDependencyState
    : "unresolved";
  let id = typeof value.id === "string" && DEP_ID_RE.test(value.id.trim())
    ? value.id.trim()
    : "";
  if (id && existingIds.has(id)) id = "";
  if (!id || proposed.some((dependency) => dependency.id === id)) {
    id = crypto.randomUUID();
  }
  const taskId = optionalString(value.taskId, MAX_PROPOSED_ID_CHARS);
  const ref = optionalString(value.ref, MAX_PROPOSED_REF_CHARS);
  const url = optionalString(value.url, MAX_PROPOSED_URL_CHARS);
  return {
    id,
    kind: kind as TaskDependencyKind,
    label,
    ...(taskId !== undefined ? { taskId } : {}),
    ...(ref !== undefined ? { ref } : {}),
    ...(url !== undefined ? { url } : {}),
    state,
    // The model never authors human/system records: every proposal is an
    // enhance-origin record, which automation may rewrite on a later run.
    origin: "enhance" as const,
    createdAt: now,
  };
}

function cleanProposedNextStep(value: unknown, now: string): TaskNextStep | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const summary = typeof value.summary === "string"
    ? value.summary.trim().slice(0, MAX_PROPOSED_STEP_SUMMARY_CHARS)
    : "";
  if (!summary) return null;
  const actorFamiliarId = optionalString(value.actorFamiliarId, MAX_PROPOSED_ACTOR_CHARS);
  const capability = optionalString(value.capability, MAX_PROPOSED_CAPABILITY_CHARS);
  const target = optionalString(value.target, MAX_PROPOSED_TARGET_CHARS);
  const inputs = Array.isArray(value.inputs)
    ? value.inputs
      .filter((input): input is string => typeof input === "string")
      .map((input) => input.trim().slice(0, MAX_PROPOSED_INPUT_CHARS))
      .filter(Boolean)
      .slice(0, MAX_PROPOSED_INPUTS)
    : undefined;
  return {
    summary,
    ...(actorFamiliarId !== undefined ? { actorFamiliarId } : {}),
    ...(capability !== undefined ? { capability } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(inputs !== undefined ? { inputs } : {}),
    requiresApproval: typeof value.requiresApproval === "boolean"
      ? value.requiresApproval
      : false,
    origin: "enhance" as const,
    updatedAt: now,
  };
}

/**
 * Turns the model's raw enrichment fields into a bounded, validated
 * orchestration proposal. Shape faults (bad kind/state, missing labels) are
 * dropped here; the structural gate then catches whatever remains that would
 * not survive the full validator, so malformed suggestions still land in the
 * review queue naming their gate.
 */
export function cleanOrchestrationProposal(
  raw: unknown,
  card: Card,
  now: string,
): EnrichmentOrchestrationProposal {
  if (!isRecord(raw)) return {};
  const existingIds = new Set(dependenciesOf(card).map((dependency) => dependency.id));
  const proposed: TaskDependency[] = [];
  if (Array.isArray(raw.dependencies)) {
    for (const entry of raw.dependencies.slice(0, MAX_PROPOSED_DEPENDENCIES)) {
      const cleaned = cleanProposedDependency(entry, existingIds, proposed, now);
      if (!cleaned) continue;
      existingIds.add(cleaned.id);
      proposed.push(cleaned);
    }
  }
  const proposal: EnrichmentOrchestrationProposal = {};
  if (Array.isArray(raw.dependencies)) proposal.dependencies = proposed;
  if ("primaryBlockerId" in raw) {
    if (raw.primaryBlockerId === null) {
      proposal.primaryBlockerId = null;
    } else if (typeof raw.primaryBlockerId === "string") {
      const trimmed = raw.primaryBlockerId.trim();
      proposal.primaryBlockerId = trimmed ? trimmed.slice(0, MAX_PROPOSED_ID_CHARS) : null;
    }
  }
  if ("primaryBlockerPinned" in raw && typeof raw.primaryBlockerPinned === "boolean") {
    proposal.primaryBlockerPinned = raw.primaryBlockerPinned;
  }
  if ("nextStep" in raw) proposal.nextStep = cleanProposedNextStep(raw.nextStep, now);
  if ("confidence" in raw) proposal.confidence = cleanEnrichmentConfidence(raw.confidence);
  if ("rationale" in raw || "reasoning" in raw) {
    proposal.rationale = optionalString(raw.rationale ?? raw.reasoning, MAX_PROPOSED_RATIONALE_CHARS) ?? null;
  }
  return proposal;
}

/** True when the enrichment proposed any orchestration change at all. */
export function hasOrchestrationContent(proposal: EnrichmentOrchestrationProposal): boolean {
  return (
    proposal.dependencies !== undefined
    || proposal.primaryBlockerId !== undefined
    || proposal.primaryBlockerPinned !== undefined
    || proposal.nextStep !== undefined
  );
}

/** The orchestration fields, as a patch. */
export function enrichmentPatch(proposal: EnrichmentOrchestrationProposal): BoardAgenticPatch {
  const patch: BoardAgenticPatch = {};
  if (proposal.dependencies !== undefined) patch.dependencies = proposal.dependencies;
  if (proposal.primaryBlockerId !== undefined) patch.primaryBlockerId = proposal.primaryBlockerId;
  if (proposal.primaryBlockerPinned !== undefined) patch.primaryBlockerPinned = proposal.primaryBlockerPinned;
  if (proposal.nextStep !== undefined) patch.nextStep = proposal.nextStep;
  return patch;
}

/** Every `repo#number` attached anywhere on the board — the reachable set. */
export function reachableGitHubRefs(cards: readonly Card[]): Set<string> {
  const refs = new Set<string>();
  for (const candidate of cards) {
    for (const link of candidate.github) {
      if (link.repo && typeof link.number === "number") refs.add(`${link.repo}#${link.number}`);
    }
  }
  return refs;
}

function dependencyGitHubRef(dependency: TaskDependency): string | null {
  if (typeof dependency.ref === "string" && dependency.ref.trim()) {
    const match = dependency.ref.trim().match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/);
    if (match) return `${match[1]}#${match[2]}`;
  }
  if (typeof dependency.url === "string" && dependency.url.trim()) {
    const parsed = taskGitHubLinkFromUrl(dependency.url);
    if (parsed && parsed.repo && typeof parsed.number === "number") {
      return `${parsed.repo}#${parsed.number}`;
    }
  }
  return null;
}

function sameDependencyValue(left: TaskDependency, right: TaskDependency): boolean {
  return (
    left.id === right.id
    && left.kind === right.kind
    && left.label === right.label
    && (left.taskId ?? null) === (right.taskId ?? null)
    && (left.ref ?? null) === (right.ref ?? null)
    && (left.url ?? null) === (right.url ?? null)
    && left.state === right.state
    && left.origin === right.origin
    && left.createdAt === right.createdAt
  );
}

function sameNextStepValue(left: TaskNextStep | null | undefined, right: TaskNextStep | null | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.summary === right.summary
    && (left.actorFamiliarId ?? null) === (right.actorFamiliarId ?? null)
    && (left.capability ?? null) === (right.capability ?? null)
    && (left.target ?? null) === (right.target ?? null)
    && (left.inputs ?? null) === (right.inputs ?? null)
    && left.requiresApproval === right.requiresApproval
    && left.origin === right.origin
    && left.updatedAt === right.updatedAt
  );
}

function issue(
  gate: EnrichmentGateName,
  code: string,
  message: string,
  field?: BoardAgenticProposalError["field"],
  dependencyId?: string,
): EnrichmentGateIssue {
  return {
    gate,
    code,
    message,
    ...(field ? { field } : {}),
    ...(dependencyId ? { dependencyId } : {}),
  };
}

/**
 * Grounding: every proposed reference must resolve to a live card, a reachable
 * GitHub item, or a known service. Unknown references fail here and are routed
 * to the review queue — the safe direction for anything a model might invent.
 */
function gateGrounding(
  card: Card,
  cards: readonly Card[],
  proposal: EnrichmentOrchestrationProposal,
  issues: EnrichmentGateIssue[],
): void {
  const live = new Set(cards.map((candidate) => candidate.id));
  const githubRefs = reachableGitHubRefs(cards);
  for (const dependency of proposal.dependencies ?? []) {
    if (dependency.kind === "task") {
      if (!dependency.taskId || !live.has(dependency.taskId)) {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: dependency "${dependency.label}" names task "${dependency.taskId ?? "(none)"}" which is not a live board task.`,
          "dependencies",
          dependency.id,
        ));
      } else if (dependency.taskId === card.id) {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: dependency "${dependency.label}" cannot depend on the task itself.`,
          "dependencies",
          dependency.id,
        ));
      }
    } else if (dependency.kind === "github") {
      const ref = dependencyGitHubRef(dependency);
      if (!ref || !githubRefs.has(ref)) {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: dependency "${dependency.label}" names GitHub "${ref ?? "(none)"}" which is not a reachable attached item.`,
          "dependencies",
          dependency.id,
        ));
      }
    } else if (dependency.kind === "service") {
      const ref = typeof dependency.ref === "string" && dependency.ref.trim()
        ? dependency.ref.trim()
        : "";
      if (!KNOWN_SERVICE_REFS.has(ref)) {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: dependency "${dependency.label}" names service "${ref || "(none)"}" which is not a known service.`,
          "dependencies",
          dependency.id,
        ));
      }
    }
  }
  const target = proposal.nextStep?.target;
  if (typeof target === "string" && target.trim()) {
    const trimmed = target.trim();
    if (trimmed.startsWith("svc:")) {
      if (!KNOWN_SERVICE_REFS.has(trimmed)) {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: the next step targets service "${trimmed}" which is not a known service.`,
          "nextStep",
        ));
      }
    } else if (/^https?:\/\//i.test(trimmed)) {
      try {
        new URL(trimmed);
      } catch {
        issues.push(issue(
          "grounding",
          "ungrounded_reference",
          `Grounding gate: the next step target "${trimmed}" is not a valid URL.`,
          "nextStep",
        ));
      }
    }
  }
}

/**
 * Structural validity: the merged card must pass the full validator as a dry
 * run — cycle, dangling, blocked-triple, and shape checks included. The write
 * chokepoint re-runs the same validator, so a suggestion that slips through
 * here still cannot be persisted invalid (acceptance test 3 parity).
 */
function gateStructural(
  card: Card,
  cards: readonly Card[],
  candidate: Card,
  issues: EnrichmentGateIssue[],
): void {
  const projected = cards.map((other) => (other.id === card.id ? candidate : other));
  const errors = validateOrchestration(candidate, {
    cards: projected,
    previous: card,
    automated: true,
  });
  for (const entry of errors) {
    issues.push(issue(
      "structural",
      entry.code,
      `Structural gate: ${entry.message}`,
      entry.field,
      entry.dependencyId,
    ));
  }
}

/**
 * Non-conflict: automation may rewrite only enhance/system records. A proposal
 * that would displace a human-authored dependency or next step fails here and
 * becomes a review proposal, matching the mutator's I6 authorship guard.
 */
function gateNonConflict(
  card: Card,
  proposal: EnrichmentOrchestrationProposal,
  issues: EnrichmentGateIssue[],
): void {
  if (proposal.nextStep !== undefined) {
    const previousStep = card.nextStep;
    const changed = previousStep
      ? !sameNextStepValue(previousStep, proposal.nextStep)
      : proposal.nextStep !== null;
    if (previousStep?.origin === "human" && changed) {
      issues.push(issue(
        "non-conflict",
        "next_step_authorship",
        "Non-conflict gate: the current next step was written by a human. Propose a change instead of overwriting it.",
        "nextStep",
      ));
    }
  }
  if (proposal.dependencies !== undefined) {
    const nextById = new Map((proposal.dependencies ?? []).map((dependency) => [dependency.id, dependency]));
    for (const before of dependenciesOf(card)) {
      if (before.origin !== "human") continue;
      const after = nextById.get(before.id);
      if (!after || !sameDependencyValue(before, after)) {
        issues.push(issue(
          "non-conflict",
          "dependency_authorship",
          `Non-conflict gate: dependency "${before.label}" was written by a human. Propose a change instead of overwriting it.`,
          "dependencies",
          before.id,
        ));
      }
    }
  }
}

/**
 * Runs the three auto-application gates against the given proposal. The
 * candidate card (plain enrichment plus orchestration fields merged) is
 * structural-gate dry-run; the caller still writes through updateCard, which
 * re-validates at the mutator chokepoint.
 */
export function assessEnrichmentGates(
  card: Card,
  cards: readonly Card[],
  proposal: EnrichmentOrchestrationProposal,
  candidate: Card,
): EnrichmentGateResult {
  const issues: EnrichmentGateIssue[] = [];
  gateGrounding(card, cards, proposal, issues);
  gateStructural(card, cards, candidate, issues);
  gateNonConflict(card, proposal, issues);
  const gatesPassed = ENRICHMENT_GATES.filter((gate) => !issues.some((entry) => entry.gate === gate));
  const gatesFailed = ENRICHMENT_GATES.filter((gate) => issues.some((entry) => entry.gate === gate));
  return { proposal, issues, gatesPassed, gatesFailed, candidate };
}

/** One check per gate, so the queue entry names every gate it failed. */
export function enrichmentGateChecks(result: EnrichmentGateResult): AgenticVerificationCheck[] {
  return ENRICHMENT_GATES.map((gate) => ({
    id: `gate:${gate}`,
    state: result.gatesPassed.includes(gate) ? "passed" as const : "failed" as const,
    detail: result.gatesPassed.includes(gate)
      ? `The ${gate} gate passed for this enrichment suggestion.`
      : `The ${gate} gate rejected this enrichment suggestion.`,
  }));
}

/**
 * Builds the review-queue record for one orchestration suggestion. Gate-passed
 * suggestions are recorded as auto-applied with their patch and gate checks;
 * anything failing a gate is recorded as blocked with the failed gate named on
 * every error. Confidence rides the rank reasons — it never authorizes.
 */
export function buildEnrichmentProposalRecord(
  card: Card,
  cards: readonly Card[],
  proposal: EnrichmentOrchestrationProposal,
  result: EnrichmentGateResult,
  now: string,
): BoardAgenticProposalRecord {
  const context = buildBoardAgenticContext(card, cards);
  const patch = enrichmentPatch(proposal);
  const blocked = result.gatesFailed.length > 0;
  const kind: AgenticRecommendation["kind"] =
    proposal.dependencies !== undefined || proposal.primaryBlockerId !== undefined
      ? "dependency"
      : "action";
  const rankReasons = [
    ...(proposal.confidence !== null && proposal.confidence !== undefined
      ? [`Model-reported confidence: ${proposal.confidence.toFixed(2)} — ranking only, never authorization.`]
      : []),
    ...(blocked
      ? [`Rejected by gate(s): ${result.gatesFailed.join(", ")}.`]
      : [`Passed gates: ${result.gatesPassed.join(", ")}.`]),
  ];
  const checks = enrichmentGateChecks(result);
  const errors: BoardAgenticProposalError[] = result.issues.map((entry) => ({
    code: entry.code,
    message: entry.message,
    ...(entry.field ? { field: entry.field } : {}),
    ...(entry.dependencyId ? { dependencyId: entry.dependencyId } : {}),
    gate: entry.gate,
  }));
  const recommendation: AgenticRecommendation = {
    id: `enrich-${crypto.randomUUID()}`,
    surface: "board",
    kind,
    payload: { cardId: card.id, patch },
    rationale: proposal.rationale?.trim()
      || (blocked
        ? "This dependency/next-step suggestion did not pass every auto-application gate."
        : "The assigned familiar proposed this dependency/next-step change."),
    inferredGoal: "Make the task's dependencies and next step reflect its current reality.",
    rankReasons,
    evidenceRefs: [],
    contextFingerprint: context.fingerprint,
    verification: {
      status: blocked ? "blocked" : "proposal",
      checks,
    },
    application: {
      mode: "review",
      requiresApproval: proposal.nextStep?.requiresApproval === true,
      reversible: false,
    },
  };
  return {
    id: recommendation.id,
    recommendation,
    patch,
    state: blocked ? "blocked" : "auto-applied",
    context: {
      ...context.context,
      fingerprint: context.fingerprint,
    },
    evidence: [],
    validation: {
      status: recommendation.verification.status,
      checks: recommendation.verification.checks,
      errors,
    },
    needsHuman: proposal.nextStep?.requiresApproval === true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Bounded append into the card's agenticEnhance queue (mirrors cave-board). */
export function appendEnrichmentProposal(
  current: BoardAgenticEnhanceState | undefined,
  record: BoardAgenticProposalRecord,
  action: BoardAgenticProposalAuditEntry["action"],
  actor: string,
  now: string,
): BoardAgenticEnhanceState {
  const base = current ?? { proposals: [], audit: [] };
  const proposals = [
    ...(base.proposals ?? []).filter((entry) => entry.id !== record.id),
    record,
  ].slice(-MAX_PROPOSED_PROPOSALS);
  const audit = [
    ...(base.audit ?? []),
    {
      proposalId: record.id,
      action,
      actor,
      at: now,
      context: structuredClone(record.context),
      evidence: structuredClone(record.evidence),
      validation: structuredClone(record.validation),
    },
  ].slice(-MAX_AUDIT_ENTRIES);
  return { proposals, audit };
}

/** A blocked record built from write-level validator errors (defense in depth). */
export function blockedRecordFromWriteErrors(
  card: Card,
  cards: readonly Card[],
  proposal: EnrichmentOrchestrationProposal,
  errors: readonly { code: string; field?: BoardAgenticProposalError["field"]; dependencyId?: string; message: string }[],
  now: string,
): BoardAgenticProposalRecord {
  const issues: EnrichmentGateIssue[] = errors.map((entry) => ({
    gate: "structural",
    code: entry.code,
    message: `Structural gate: ${entry.message}`,
    ...(entry.field ? { field: entry.field } : {}),
    ...(entry.dependencyId ? { dependencyId: entry.dependencyId } : {}),
  }));
  const result: EnrichmentGateResult = {
    proposal,
    issues,
    gatesPassed: ENRICHMENT_GATES.filter((gate) => gate !== "structural"),
    gatesFailed: ["structural"],
    candidate: card,
  };
  return buildEnrichmentProposalRecord(card, cards, proposal, result, now);
}
