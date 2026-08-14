import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { isCanonicalIsoInstant } from "@/lib/chat-attention";
import { isSafeConversationSessionId } from "@/lib/cave-conversations";
import { caveHome } from "@/lib/coven-paths";
import { writeJsonAtomic } from "@/lib/server/atomic-write";

import { isUuid, type ClientV1ErrorCode } from "./contract.ts";
import { withOperationTransactionLock } from "./operation-transaction-lock.ts";

import type { GitHubActionReceipt } from "./action-service.ts";

const STORE_VERSION = 1;
const MAX_GITHUB_EFFECTS = 512;
const MAX_EFFECT_ATTEMPTS = 8;
const MAX_FAILURE_MESSAGE_CHARS = 512;
const MAX_GITHUB_RECEIPT_TEXT_BYTES = 2_048;
const MAX_GITHUB_AUDIT_TEXT_BYTES = 512;
const MAX_GITHUB_RECEIPT_URL_CHARS = 4_096;
const MAX_GITHUB_RECEIPT_STATE_CHARS = 128;
const MAX_GITHUB_RECEIPT_ERROR_CHARS = 2_048;
const MAX_REPO_CHARS = 200;
const MAX_NUMERIC_ID_CHARS = 32;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const WORKFLOW_RE = /^(?:\d+|[A-Za-z0-9._-]+\.ya?ml)$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,255}$/;
const POSITIVE_DECIMAL_RE = /^[1-9]\d*$/;
const GIT_OBJECT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const STORE_KEYS = ["version", "effects"] as const;
const EFFECT_RECORD_REQUIRED_KEYS = [
  "effectId",
  "state",
  "source",
  "action",
  "createdAt",
  "updatedAt",
  "pendingSince",
  "receipt",
  "lastFailure",
  "attempts",
] as const;
const EFFECT_RECORD_OPTIONAL_KEYS = ["claim"] as const;
const EFFECT_SOURCE_KEYS = ["conversationId", "turnId"] as const;
const EFFECT_CLAIM_KEYS = ["generation", "token"] as const;
const FAILURE_KEYS = ["code", "status", "retryable", "reason", "message"] as const;
const ATTEMPT_KEYS = ["at", "outcome", "reason", "status"] as const;
const RECEIPT_KEYS = ["source", "action", "result"] as const;
const RECEIPT_TEXT_KEYS = ["body", "bodyBytes", "bodySha256", "bodyTruncated"] as const;
const AUDIT_TEXT_KEYS = ["bodyPreview", "bodyBytes", "bodySha256", "bodyTruncated"] as const;

const EFFECT_STATES = ["pending", "retryable_failure", "succeeded", "manual_reconciliation"] as const;
const ATTEMPT_OUTCOMES = ["started", "retryable_failure", "succeeded", "manual_reconciliation"] as const;
const REVIEW_EVENTS = ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const;
const MERGE_METHODS = ["squash", "merge", "rebase"] as const;
const FAILURE_REASONS = [
  "auth_required",
  "upstream_rejected",
  "network_ambiguous",
  "upstream_ambiguous",
  "crash_window",
  "comment_not_found",
  "comment_ambiguous",
  "review_not_found",
  "review_ambiguous",
  "merge_unverified",
  "reconciliation_unavailable",
] as const;

type GitHubEffectState = (typeof EFFECT_STATES)[number];
type GitHubEffectAttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];
type GitHubReviewEvent = (typeof REVIEW_EVENTS)[number];
type GitHubMergeMethod = (typeof MERGE_METHODS)[number];

export type GitHubEffectSource = {
  conversationId: string;
  turnId: string;
};

export type GitHubEffectClaim = {
  generation: number;
  token: string;
};

export type GitHubEffectActionAudit =
  | {
      kind: "comment";
      repo: string;
      number: number;
      bodyPreview: string;
      bodyBytes: number;
      bodySha256: string;
      bodyTruncated: boolean;
    }
  | {
      kind: "review";
      repo: string;
      number: number;
      event: GitHubReviewEvent;
      bodyPreview?: string;
      bodyBytes?: number;
      bodySha256?: string;
      bodyTruncated?: boolean;
    }
  | {
      kind: "merge";
      repo: string;
      number: number;
      method: GitHubMergeMethod;
    }
  | {
      kind: "rerun";
      repo: string;
      runId: string;
    }
  | {
      kind: "dispatch";
      repo: string;
      workflow: string;
      ref: string;
    };

export type GitHubEffectFailureReason = (typeof FAILURE_REASONS)[number];

export type GitHubEffectFailureSnapshot = {
  code: Extract<ClientV1ErrorCode, "service_unavailable" | "conflict" | "not_found">;
  status: number;
  retryable: boolean;
  reason: GitHubEffectFailureReason;
  message: string | null;
};

export type GitHubEffectAttempt = {
  at: string;
  outcome: GitHubEffectAttemptOutcome;
  reason: string | null;
  status: number | null;
};

export type GitHubEffectRecord = {
  effectId: string;
  state: GitHubEffectState;
  source: GitHubEffectSource;
  action: GitHubEffectActionAudit;
  claim: GitHubEffectClaim | null;
  createdAt: string;
  updatedAt: string;
  pendingSince: string | null;
  receipt: GitHubActionReceipt | null;
  lastFailure: GitHubEffectFailureSnapshot | null;
  attempts: GitHubEffectAttempt[];
};

type GitHubEffectStoreFile = {
  version: 1;
  effects: GitHubEffectRecord[];
};

export type GitHubEffectSettlementGuard = {
  state: "pending";
  claim: GitHubEffectClaim;
};

export type BeginGitHubEffectResult =
  | {
      kind: "dispatch";
      record: GitHubEffectRecord;
      claim: GitHubEffectClaim;
    }
  | {
      kind: "reconcile";
      record: GitHubEffectRecord;
      claim: GitHubEffectClaim;
    }
  | {
      kind: "replay";
      record: GitHubEffectRecord;
      receipt: GitHubActionReceipt;
    }
  | {
      kind: "manual_reconciliation";
      record: GitHubEffectRecord;
      failure: GitHubEffectFailureSnapshot;
    };

export class GitHubEffectStoreCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubEffectStoreCapacityError";
  }
}

export function clientGitHubEffectStorePath(): string {
  const override = process.env.COVEN_CAVE_CLIENT_GITHUB_EFFECT_STORE_PATH?.trim();
  return override || path.join(/* turbopackIgnore: true */ caveHome(), "client-v1-github-effects.json");
}

function emptyStore(): GitHubEffectStoreFile {
  return { version: STORE_VERSION, effects: [] };
}

let readFileForTest: ((path: string, encoding: "utf8") => Promise<string>) | null = null;

export function setGitHubEffectStoreReadFileForTest(
  hook: ((path: string, encoding: "utf8") => Promise<string>) | null,
): void {
  readFileForTest = hook;
}

function readStoreFile(storePath: string): Promise<string> {
  const impl = readFileForTest ?? readFile;
  return impl(storePath, "utf8");
}

async function ensureStoreDir(storePath: string): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true });
}

function safeFailureMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FAILURE_MESSAGE_CHARS) : null;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

function isFinitePositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isStatus(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}

function isFailureReason(value: unknown): value is GitHubEffectFailureReason {
  return typeof value === "string" && FAILURE_REASONS.includes(value as GitHubEffectFailureReason);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function hasRequiredKeys(record: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => Object.hasOwn(record, key));
}

function hasVariantKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return hasRequiredKeys(record, required) && hasOnlyAllowedKeys(record, [...required, ...optional]);
}

function parseCanonicalString(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxChars && trimmed === value ? trimmed : null;
}

function parseNullableIsoInstant(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isCanonicalIsoInstant(value) ? value : undefined;
}

function parseNullableHttpUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  const text = parseCanonicalString(value, MAX_GITHUB_RECEIPT_URL_CHARS);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function parseNullableErrorText(value: unknown): string | null | undefined {
  if (value === null) return null;
  const text = parseCanonicalString(value, MAX_GITHUB_RECEIPT_ERROR_CHARS);
  return text ?? undefined;
}

function parseRepo(value: unknown): string | null {
  const repo = parseCanonicalString(value, MAX_REPO_CHARS);
  return repo && REPO_RE.test(repo) ? repo : null;
}

function parseWorkflow(value: unknown): string | null {
  const workflow = parseCanonicalString(value, 255);
  return workflow && WORKFLOW_RE.test(workflow) ? workflow : null;
}

function parseRef(value: unknown): string | null {
  const ref = parseCanonicalString(value, 255);
  return ref && REF_RE.test(ref) ? ref : null;
}

function parseGitHubId(value: unknown): string | null {
  const id = parseCanonicalString(value, MAX_NUMERIC_ID_CHARS);
  return id && POSITIVE_DECIMAL_RE.test(id) ? id : null;
}

function parseRunId(value: unknown): string | null {
  const runId = parseGitHubId(value);
  if (!runId) return null;
  const numeric = Number.parseInt(runId, 10);
  return Number.isSafeInteger(numeric) && numeric > 0 ? runId : null;
}

function parseGitObjectId(value: unknown): string | null {
  const sha = parseCanonicalString(value, 64);
  return sha && GIT_OBJECT_ID_RE.test(sha) ? sha : null;
}

function parseEffectSource(value: unknown): GitHubEffectSource | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, EFFECT_SOURCE_KEYS)) return null;
  const conversationId = typeof value.conversationId === "string" ? value.conversationId : null;
  const turnId = typeof value.turnId === "string" ? value.turnId : null;
  if (!conversationId || !turnId || !isSafeConversationSessionId(conversationId) || !isSafeConversationSessionId(turnId)) {
    return null;
  }
  return { conversationId, turnId };
}

function parseGitHubEffectClaim(value: unknown): GitHubEffectClaim | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, EFFECT_CLAIM_KEYS)) return null;
  if (!isFinitePositiveInteger(value.generation) || !isUuid(value.token)) return null;
  return {
    generation: value.generation,
    token: value.token.toLowerCase(),
  };
}

type ParsedAuditTextFields = {
  bodyPreview: string;
  bodyBytes: number;
  bodySha256: string;
  bodyTruncated: boolean;
};

function parseAuditTextFields(record: Record<string, unknown>): ParsedAuditTextFields | null {
  if (typeof record.bodyPreview !== "string" || !record.bodyPreview) return null;
  const previewBytes = Buffer.byteLength(record.bodyPreview, "utf8");
  if (previewBytes === 0 || previewBytes > MAX_GITHUB_AUDIT_TEXT_BYTES) return null;
  if (!isFinitePositiveInteger(record.bodyBytes)) return null;
  if (typeof record.bodySha256 !== "string" || !SHA256_HEX_RE.test(record.bodySha256)) return null;
  if (typeof record.bodyTruncated !== "boolean") return null;
  if (!record.bodyTruncated) {
    if (record.bodyBytes !== previewBytes) return null;
    if (sha256Hex(record.bodyPreview) !== record.bodySha256) return null;
  } else if (record.bodyBytes <= previewBytes) {
    return null;
  }
  return {
    bodyPreview: record.bodyPreview,
    bodyBytes: record.bodyBytes,
    bodySha256: record.bodySha256,
    bodyTruncated: record.bodyTruncated,
  };
}

function parseGitHubEffectActionAudit(value: unknown): GitHubEffectActionAudit | null {
  if (!isStringRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "comment": {
      if (!hasVariantKeys(value, ["kind", "repo", "number", ...AUDIT_TEXT_KEYS])) return null;
      const repo = parseRepo(value.repo);
      const text = parseAuditTextFields(value);
      if (!repo || !isFinitePositiveInteger(value.number) || !text) return null;
      return { kind: "comment", repo, number: value.number, ...text };
    }
    case "review": {
      if (!hasOnlyAllowedKeys(value, ["kind", "repo", "number", "event", ...AUDIT_TEXT_KEYS])) return null;
      if (!hasRequiredKeys(value, ["kind", "repo", "number", "event"])) return null;
      const repo = parseRepo(value.repo);
      if (!repo || !isFinitePositiveInteger(value.number)) return null;
      if (!REVIEW_EVENTS.includes(value.event as GitHubReviewEvent)) return null;
      const hasBody = AUDIT_TEXT_KEYS.some((key) => Object.hasOwn(value, key));
      if (value.event !== "APPROVE" && !hasBody) return null;
      if (!hasBody) {
        return { kind: "review", repo, number: value.number, event: value.event as GitHubReviewEvent };
      }
      if (!hasRequiredKeys(value, AUDIT_TEXT_KEYS)) return null;
      const text = parseAuditTextFields(value);
      return text
        ? { kind: "review", repo, number: value.number, event: value.event as GitHubReviewEvent, ...text }
        : null;
    }
    case "merge": {
      if (!hasVariantKeys(value, ["kind", "repo", "number", "method"])) return null;
      const repo = parseRepo(value.repo);
      if (!repo || !isFinitePositiveInteger(value.number)) return null;
      return MERGE_METHODS.includes(value.method as GitHubMergeMethod)
        ? { kind: "merge", repo, number: value.number, method: value.method as GitHubMergeMethod }
        : null;
    }
    case "rerun": {
      if (!hasVariantKeys(value, ["kind", "repo", "runId"])) return null;
      const repo = parseRepo(value.repo);
      const runId = parseRunId(value.runId);
      return repo && runId ? { kind: "rerun", repo, runId } : null;
    }
    case "dispatch": {
      if (!hasVariantKeys(value, ["kind", "repo", "workflow", "ref"])) return null;
      const repo = parseRepo(value.repo);
      const workflow = parseWorkflow(value.workflow);
      const ref = parseRef(value.ref);
      return repo && workflow && ref ? { kind: "dispatch", repo, workflow, ref } : null;
    }
    default:
      return null;
  }
}

function parseGitHubEffectFailureSnapshot(value: unknown): GitHubEffectFailureSnapshot | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, FAILURE_KEYS)) return null;
  if (
    (value.code !== "service_unavailable" && value.code !== "conflict" && value.code !== "not_found")
    || !isStatus(value.status)
    || typeof value.retryable !== "boolean"
    || !isFailureReason(value.reason)
  ) {
    return null;
  }
  if (value.message !== null) {
    const message = safeFailureMessage(value.message);
    if (message === null || message !== value.message) return null;
  }
  return {
    code: value.code,
    status: value.status,
    retryable: value.retryable,
    reason: value.reason,
    message: value.message,
  };
}

function parseGitHubEffectAttempt(value: unknown): GitHubEffectAttempt | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, ATTEMPT_KEYS)) return null;
  if (!isCanonicalIsoInstant(value.at)) return null;
  if (!ATTEMPT_OUTCOMES.includes(value.outcome as GitHubEffectAttemptOutcome)) return null;
  switch (value.outcome) {
    case "started":
      if (value.reason !== null || value.status !== null) return null;
      break;
    case "succeeded":
      if ((value.reason !== "direct" && value.reason !== "reconciled") || value.status !== 200) return null;
      break;
    case "retryable_failure":
    case "manual_reconciliation":
      if (!isFailureReason(value.reason) || !isStatus(value.status)) return null;
      break;
    default:
      return null;
  }
  return {
    at: value.at,
    outcome: value.outcome,
    reason: value.reason,
    status: value.status,
  };
}

type ParsedReceiptTextFields = {
  body: string;
  bodyBytes: number;
  bodySha256: string;
  bodyTruncated?: boolean;
};

function parseReceiptTextFields(
  record: Record<string, unknown>,
  required: boolean,
): ParsedReceiptTextFields | null {
  const hasAny = RECEIPT_TEXT_KEYS.some((key) => Object.hasOwn(record, key));
  if (!required && !hasAny) return null;
  if (!hasRequiredKeys(record, ["body", "bodyBytes", "bodySha256"])) return null;
  if (typeof record.body !== "string" || !record.body) return null;
  const actualBytes = Buffer.byteLength(record.body, "utf8");
  if (actualBytes === 0 || actualBytes > MAX_GITHUB_RECEIPT_TEXT_BYTES) return null;
  if (!isFinitePositiveInteger(record.bodyBytes)) return null;
  if (typeof record.bodySha256 !== "string" || !SHA256_HEX_RE.test(record.bodySha256)) return null;
  if (Object.hasOwn(record, "bodyTruncated")) {
    if (record.bodyTruncated !== true || record.bodyBytes <= actualBytes) return null;
    return {
      body: record.body,
      bodyBytes: record.bodyBytes,
      bodySha256: record.bodySha256,
      bodyTruncated: true,
    };
  }
  if (record.bodyBytes !== actualBytes) return null;
  if (sha256Hex(record.body) !== record.bodySha256) return null;
  return {
    body: record.body,
    bodyBytes: record.bodyBytes,
    bodySha256: record.bodySha256,
  };
}

function expectedReviewState(event: GitHubReviewEvent): string {
  switch (event) {
    case "APPROVE":
      return "APPROVED";
    case "REQUEST_CHANGES":
      return "CHANGES_REQUESTED";
    default:
      return "COMMENTED";
  }
}

function receiptTextMatchesAudit(
  receiptText: ParsedReceiptTextFields,
  auditText: ParsedAuditTextFields,
): boolean {
  return receiptText.bodyBytes === auditText.bodyBytes
    && receiptText.bodySha256 === auditText.bodySha256
    && receiptText.body.startsWith(auditText.bodyPreview)
    && (!receiptText.bodyTruncated || auditText.bodyTruncated);
}

function receiptActionMatchesEffectAction(
  action: GitHubActionReceipt["action"],
  audit: GitHubEffectActionAudit,
): boolean {
  if (action.kind !== audit.kind || normalizeRepo(action.repo) !== normalizeRepo(audit.repo)) return false;
  switch (audit.kind) {
    case "comment": {
      if (action.kind !== "comment") return false;
      return action.number === audit.number
        && receiptTextMatchesAudit(action, audit);
    }
    case "review": {
      if (action.kind !== "review") return false;
      if (action.number !== audit.number || action.event !== audit.event) return false;
      const auditHasBody = "bodyPreview" in audit;
      const actionHasBody = "body" in action;
      if (auditHasBody !== actionHasBody) return false;
      if (!auditHasBody) return true;
      return receiptTextMatchesAudit(action as Extract<GitHubActionReceipt["action"], { kind: "review" }> & ParsedReceiptTextFields, audit as GitHubEffectActionAudit & ParsedAuditTextFields);
    }
    case "merge":
      return action.kind === "merge"
        && action.number === audit.number
        && action.method === audit.method;
    case "rerun":
      return action.kind === "rerun" && action.runId === audit.runId;
    case "dispatch":
      return action.kind === "dispatch"
        && action.workflow === audit.workflow
        && action.ref === audit.ref;
  }
}

function parseGitHubActionReceiptAction(value: unknown): GitHubActionReceipt["action"] | null {
  if (!isStringRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "comment": {
      if (!hasVariantKeys(value, ["kind", "repo", "number", "body", "bodyBytes", "bodySha256"], ["bodyTruncated"])) {
        return null;
      }
      const repo = parseRepo(value.repo);
      const text = parseReceiptTextFields(value, true);
      if (!repo || !isFinitePositiveInteger(value.number) || !text) return null;
      return { kind: "comment", repo, number: value.number, ...text };
    }
    case "review": {
      if (!hasOnlyAllowedKeys(value, ["kind", "repo", "number", "event", ...RECEIPT_TEXT_KEYS])) return null;
      if (!hasRequiredKeys(value, ["kind", "repo", "number", "event"])) return null;
      const repo = parseRepo(value.repo);
      if (!repo || !isFinitePositiveInteger(value.number)) return null;
      if (!REVIEW_EVENTS.includes(value.event as GitHubReviewEvent)) return null;
      const text = parseReceiptTextFields(value, false);
      if (value.event !== "APPROVE" && text === null) return null;
      return {
        kind: "review",
        repo,
        number: value.number,
        event: value.event as GitHubReviewEvent,
        ...(text ?? {}),
      };
    }
    case "merge": {
      if (!hasVariantKeys(value, ["kind", "repo", "number", "method"])) return null;
      const repo = parseRepo(value.repo);
      if (!repo || !isFinitePositiveInteger(value.number)) return null;
      return MERGE_METHODS.includes(value.method as GitHubMergeMethod)
        ? { kind: "merge", repo, number: value.number, method: value.method as GitHubMergeMethod }
        : null;
    }
    case "rerun": {
      if (!hasVariantKeys(value, ["kind", "repo", "runId"])) return null;
      const repo = parseRepo(value.repo);
      const runId = parseRunId(value.runId);
      return repo && runId ? { kind: "rerun", repo, runId } : null;
    }
    case "dispatch": {
      if (!hasVariantKeys(value, ["kind", "repo", "workflow", "ref"])) return null;
      const repo = parseRepo(value.repo);
      const workflow = parseWorkflow(value.workflow);
      const ref = parseRef(value.ref);
      return repo && workflow && ref ? { kind: "dispatch", repo, workflow, ref } : null;
    }
    default:
      return null;
  }
}

function parseGitHubActionReceiptResult(
  value: unknown,
  action: GitHubActionReceipt["action"],
): GitHubActionReceipt["result"] | null {
  if (!isStringRecord(value) || typeof value.kind !== "string" || value.kind !== action.kind) return null;
  switch (action.kind) {
    case "comment": {
      if (!hasVariantKeys(value, ["kind", "commentId", "body", "bodyBytes", "bodySha256", "createdAt", "url"], ["bodyTruncated"])) {
        return null;
      }
      const commentId = parseGitHubId(value.commentId);
      const text = parseReceiptTextFields(value, true);
      const createdAt = parseNullableIsoInstant(value.createdAt);
      const url = parseNullableHttpUrl(value.url);
      if (!commentId || !text || createdAt === undefined || url === undefined) return null;
      if (
        text.body !== action.body
        || text.bodyBytes !== action.bodyBytes
        || text.bodySha256 !== action.bodySha256
        || Boolean(text.bodyTruncated) !== Boolean(action.bodyTruncated)
      ) {
        return null;
      }
      return {
        kind: "comment",
        commentId,
        ...text,
        createdAt,
        url,
      };
    }
    case "review": {
      if (!hasVariantKeys(value, ["kind", "reviewId", "state", "url"])) return null;
      const reviewId = parseGitHubId(value.reviewId);
      const state = parseCanonicalString(value.state, MAX_GITHUB_RECEIPT_STATE_CHARS);
      const url = parseNullableHttpUrl(value.url);
      if (!reviewId || !state || url === undefined) return null;
      if (state.toUpperCase() !== expectedReviewState(action.event)) return null;
      return { kind: "review", reviewId, state, url };
    }
    case "merge": {
      if (!hasVariantKeys(value, ["kind", "merged", "sha", "branchDeleted", "branchDeleteError"])) return null;
      if (value.merged !== true || typeof value.branchDeleted !== "boolean") return null;
      const sha = value.sha === null ? null : parseGitObjectId(value.sha);
      const branchDeleteError = parseNullableErrorText(value.branchDeleteError);
      if ((value.sha !== null && sha === null) || branchDeleteError === undefined) return null;
      if (value.branchDeleted === true && branchDeleteError !== null) return null;
      return {
        kind: "merge",
        merged: true,
        sha,
        branchDeleted: value.branchDeleted,
        branchDeleteError,
      };
    }
    case "rerun":
      return hasVariantKeys(value, ["kind", "accepted"]) && value.accepted === true
        ? { kind: "rerun", accepted: true }
        : null;
    case "dispatch":
      return hasVariantKeys(value, ["kind", "accepted"]) && value.accepted === true
        ? { kind: "dispatch", accepted: true }
        : null;
  }
}

function parseGitHubActionReceipt(
  value: unknown,
  expected?: { source: GitHubEffectSource; action: GitHubEffectActionAudit },
): GitHubActionReceipt | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, RECEIPT_KEYS)) return null;
  const source = parseEffectSource(value.source);
  const action = parseGitHubActionReceiptAction(value.action);
  if (!source || !action) return null;
  const result = parseGitHubActionReceiptResult(value.result, action);
  if (!result) return null;
  if (expected) {
    if (
      source.conversationId !== expected.source.conversationId
      || source.turnId !== expected.source.turnId
      || !receiptActionMatchesEffectAction(action, expected.action)
    ) {
      return null;
    }
  }
  return { source, action, result };
}

function parseGitHubEffectRecord(value: unknown): GitHubEffectRecord | null {
  if (!isStringRecord(value)) return null;
  if (!hasOnlyAllowedKeys(value, [...EFFECT_RECORD_REQUIRED_KEYS, ...EFFECT_RECORD_OPTIONAL_KEYS])) return null;
  if (!hasRequiredKeys(value, EFFECT_RECORD_REQUIRED_KEYS)) return null;

  const effectId = typeof value.effectId === "string" ? value.effectId : null;
  if (!effectId || !isSafeConversationSessionId(effectId)) return null;
  if (!EFFECT_STATES.includes(value.state as GitHubEffectState)) return null;

  const source = parseEffectSource(value.source);
  const action = parseGitHubEffectActionAudit(value.action);
  const claim = !Object.hasOwn(value, "claim") || value.claim === null ? null : parseGitHubEffectClaim(value.claim);
  if (Object.hasOwn(value, "claim") && value.claim !== null && claim === null) return null;
  if (!source || !action || !isCanonicalIsoInstant(value.createdAt) || !isCanonicalIsoInstant(value.updatedAt)) return null;
  if (compareIso(value.updatedAt, value.createdAt) < 0) return null;

  const pendingSince = value.pendingSince === null ? null : isCanonicalIsoInstant(value.pendingSince) ? value.pendingSince : null;
  if (value.pendingSince !== null && pendingSince === null) return null;
  if (pendingSince !== null && (compareIso(pendingSince, value.createdAt) < 0 || compareIso(value.updatedAt, pendingSince) < 0)) {
    return null;
  }

  const receipt = value.receipt === null ? null : parseGitHubActionReceipt(value.receipt, { source, action });
  if (value.receipt !== null && receipt === null) return null;

  const lastFailure = value.lastFailure === null ? null : parseGitHubEffectFailureSnapshot(value.lastFailure);
  if (value.lastFailure !== null && lastFailure === null) return null;

  if (!Array.isArray(value.attempts) || value.attempts.length === 0 || value.attempts.length > MAX_EFFECT_ATTEMPTS) {
    return null;
  }
  const attempts = value.attempts.map(parseGitHubEffectAttempt);
  if (attempts.some((attempt) => attempt === null)) return null;
  const parsedAttempts = attempts as GitHubEffectAttempt[];
  if (!hasValidAttemptWindow(value.createdAt, value.updatedAt, parsedAttempts)) {
    return null;
  }

  switch (value.state) {
    case "pending":
      if (claim === null || pendingSince === null || receipt !== null || lastFailure !== null) return null;
      if (parsedAttempts[parsedAttempts.length - 1]!.outcome !== "started") return null;
      break;
    case "succeeded":
      if (pendingSince !== null || receipt === null || lastFailure !== null || claim !== null) return null;
      if (parsedAttempts[parsedAttempts.length - 1]!.outcome !== "succeeded") return null;
      break;
    case "retryable_failure":
      if (pendingSince !== null || receipt !== null || lastFailure === null || claim !== null) return null;
      if (
        parsedAttempts[parsedAttempts.length - 1]!.outcome !== "retryable_failure"
        || parsedAttempts[parsedAttempts.length - 1]!.reason !== lastFailure.reason
        || parsedAttempts[parsedAttempts.length - 1]!.status !== lastFailure.status
      ) {
        return null;
      }
      break;
    case "manual_reconciliation":
      if (pendingSince !== null || receipt !== null || lastFailure === null || claim !== null) return null;
      if (
        parsedAttempts[parsedAttempts.length - 1]!.outcome !== "manual_reconciliation"
        || parsedAttempts[parsedAttempts.length - 1]!.reason !== lastFailure.reason
        || parsedAttempts[parsedAttempts.length - 1]!.status !== lastFailure.status
      ) {
        return null;
      }
      break;
    default:
      return null;
  }

  return {
    effectId,
    state: value.state,
    source,
    action,
    claim,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    pendingSince,
    receipt,
    lastFailure,
    attempts: parsedAttempts,
  };
}

async function readStore(storePath: string): Promise<GitHubEffectStoreFile> {
  let raw: string;
  try {
    raw = await readStoreFile(storePath);
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return emptyStore();
    throw new Error("GitHub effect store is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("GitHub effect store is unreadable.");
  }
  if (!isStringRecord(parsed) || !hasVariantKeys(parsed, STORE_KEYS)) {
    throw new Error("GitHub effect store is invalid.");
  }
  if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.effects)) {
    throw new Error("GitHub effect store is invalid.");
  }
  const effects = parsed.effects.map(parseGitHubEffectRecord);
  if (effects.some((effect) => effect === null)) {
    throw new Error("GitHub effect store is invalid.");
  }
  const records = effects as GitHubEffectRecord[];
  const effectIds = new Set<string>();
  for (const effect of records) {
    if (effectIds.has(effect.effectId)) {
      throw new Error("GitHub effect store is invalid.");
    }
    effectIds.add(effect.effectId);
  }
  return { version: STORE_VERSION, effects: records };
}

async function writeStore(storePath: string, store: GitHubEffectStoreFile): Promise<void> {
  await ensureStoreDir(storePath);
  await writeJsonAtomic(storePath, store);
}

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hasValidAttemptWindow(
  createdAt: string,
  updatedAt: string,
  attempts: GitHubEffectAttempt[],
): boolean {
  for (let index = 1; index < attempts.length; index += 1) {
    if (compareIso(attempts[index - 1]!.at, attempts[index]!.at) >= 0) return false;
  }
  const firstAttempt = attempts[0]!;
  const lastAttempt = attempts[attempts.length - 1]!;
  if (compareIso(firstAttempt.at, createdAt) < 0 || compareIso(lastAttempt.at, updatedAt) !== 0) {
    return false;
  }
  return compareIso(firstAttempt.at, createdAt) === 0 || attempts.length === MAX_EFFECT_ATTEMPTS;
}

function nextAttemptAt(requestedAt: string, previousAt: string): string {
  if (compareIso(requestedAt, previousAt) > 0) return requestedAt;
  return new Date(Date.parse(previousAt) + 1).toISOString();
}

function capAttempts(attempts: GitHubEffectAttempt[]): GitHubEffectAttempt[] {
  return attempts.slice(-MAX_EFFECT_ATTEMPTS);
}

function ensureCapacityForNewEffect(
  effects: GitHubEffectRecord[],
): { ok: true; effects: GitHubEffectRecord[]; changed: boolean } | { ok: false } {
  if (effects.length < MAX_GITHUB_EFFECTS) return { ok: true, effects, changed: false };
  const needed = effects.length - MAX_GITHUB_EFFECTS + 1;
  const terminalOldestFirst = effects
    .map((effect, index) => ({ effect, index }))
    .filter((entry) => entry.effect.state !== "pending")
    .sort((a, b) => compareIso(a.effect.updatedAt, b.effect.updatedAt));
  if (terminalOldestFirst.length < needed) return { ok: false };
  const evictIndexes = new Set(terminalOldestFirst.slice(0, needed).map((entry) => entry.index));
  return {
    ok: true,
    effects: effects.filter((_, index) => !evictIndexes.has(index)),
    changed: true,
  };
}

async function mutateStore<T>(
  mutator: (store: GitHubEffectStoreFile) => { value: T; changed: boolean },
): Promise<T> {
  const storePath = clientGitHubEffectStorePath();
  return withOperationTransactionLock(
    {
      storePath,
      label: "client-v1-github-effects",
    },
    async () => {
      const store = await readStore(storePath);
      const result = mutator(store);
      if (result.changed) {
        await writeStore(storePath, store);
      }
      return result.value;
    },
  );
}

function appendAttempt(
  record: GitHubEffectRecord,
  attempt: GitHubEffectAttempt,
): GitHubEffectRecord {
  record.attempts = capAttempts([...record.attempts, attempt]);
  return record;
}

function cloneClaim(claim: GitHubEffectClaim): GitHubEffectClaim {
  return { ...claim };
}

function cloneReceipt(receipt: GitHubActionReceipt): GitHubActionReceipt {
  return JSON.parse(JSON.stringify(receipt)) as GitHubActionReceipt;
}

function cloneRecord(record: GitHubEffectRecord): GitHubEffectRecord {
  return {
    ...record,
    source: { ...record.source },
    action: { ...record.action } as GitHubEffectActionAudit,
    claim: record.claim ? cloneClaim(record.claim) : null,
    receipt: record.receipt ? cloneReceipt(record.receipt) : null,
    lastFailure: record.lastFailure ? { ...record.lastFailure } : null,
    attempts: record.attempts.map((attempt) => ({ ...attempt })),
  };
}

function mintClaim(previous: GitHubEffectClaim | null): GitHubEffectClaim {
  return {
    generation: (previous?.generation ?? 0) + 1,
    token: randomUUID(),
  };
}

function claimsEqual(left: GitHubEffectClaim | null, right: GitHubEffectClaim): boolean {
  if (!left) return false;
  return left.generation === right.generation && left.token === right.token;
}

function parseGitHubEffectSettlementGuard(value: unknown): GitHubEffectSettlementGuard | null {
  if (!isStringRecord(value) || !hasVariantKeys(value, ["state", "claim"])) return null;
  const claim = parseGitHubEffectClaim(value.claim);
  return value.state === "pending" && claim ? { state: "pending", claim } : null;
}

export async function beginGitHubEffect(args: {
  effectId: string;
  source: GitHubEffectSource;
  action: GitHubEffectActionAudit;
  at?: string;
}): Promise<BeginGitHubEffectResult> {
  const at = args.at ?? new Date().toISOString();
  if (!isSafeConversationSessionId(args.effectId) || !isCanonicalIsoInstant(at)) {
    throw new Error("Invalid GitHub effect reservation input.");
  }
  const source = parseEffectSource(args.source);
  const action = parseGitHubEffectActionAudit(args.action);
  if (!source || !action) throw new Error("Invalid GitHub effect reservation input.");

  return mutateStore<BeginGitHubEffectResult>((store) => {
    const existing = store.effects.find((effect) => effect.effectId === args.effectId);
    if (!existing) {
      const capacity = ensureCapacityForNewEffect(store.effects);
      if (!capacity.ok) {
        throw new GitHubEffectStoreCapacityError(
          "GitHub effect store is full of live effects awaiting resolution.",
        );
      }
      store.effects = capacity.effects;
      const claim = mintClaim(null);
      const created: GitHubEffectRecord = {
        effectId: args.effectId,
        state: "pending",
        source,
        action,
        claim,
        createdAt: at,
        updatedAt: at,
        pendingSince: at,
        receipt: null,
        lastFailure: null,
        attempts: [{ at, outcome: "started", reason: null, status: null }],
      };
      store.effects.push(created);
      return {
        changed: true,
        value: { kind: "dispatch", record: cloneRecord(created), claim: cloneClaim(claim) },
      };
    }

    if (existing.state === "succeeded" && existing.receipt) {
      return {
        changed: false,
        value: {
          kind: "replay",
          record: cloneRecord(existing),
          receipt: cloneReceipt(existing.receipt),
        },
      };
    }

    if (existing.state === "manual_reconciliation" && existing.lastFailure) {
      return {
        changed: false,
        value: {
          kind: "manual_reconciliation",
          record: cloneRecord(existing),
          failure: { ...existing.lastFailure },
        },
      };
    }

    if (existing.state === "pending") {
      const nextAt = nextAttemptAt(at, existing.updatedAt);
      const claim = mintClaim(existing.claim);
      existing.claim = claim;
      existing.updatedAt = nextAt;
      appendAttempt(existing, { at: nextAt, outcome: "started", reason: null, status: null });
      return {
        changed: true,
        value: {
          kind: "reconcile",
          record: cloneRecord(existing),
          claim: cloneClaim(claim),
        },
      };
    }

    const nextAt = nextAttemptAt(at, existing.updatedAt);
    const claim = mintClaim(null);
    existing.state = "pending";
    existing.claim = claim;
    existing.updatedAt = nextAt;
    existing.pendingSince = nextAt;
    existing.lastFailure = null;
    existing.receipt = null;
    appendAttempt(existing, { at: nextAt, outcome: "started", reason: null, status: null });
    return {
      changed: true,
      value: {
        kind: "dispatch",
        record: cloneRecord(existing),
        claim: cloneClaim(claim),
      },
    };
  });
}

export async function settleGitHubEffectSuccess(args: {
  effectId: string;
  receipt: GitHubActionReceipt;
  expected: GitHubEffectSettlementGuard;
  at?: string;
  mode?: "direct" | "reconciled";
}): Promise<boolean> {
  const at = args.at ?? new Date().toISOString();
  const receipt = parseGitHubActionReceipt(args.receipt);
  const expected = parseGitHubEffectSettlementGuard(args.expected);
  if (!isSafeConversationSessionId(args.effectId) || !isCanonicalIsoInstant(at) || !receipt || !expected) {
    throw new Error("Invalid GitHub effect success input.");
  }
  return mutateStore((store) => {
    const record = store.effects.find((effect) => effect.effectId === args.effectId);
    if (!record) throw new Error("GitHub effect not found.");
    if (record.state !== expected.state || !claimsEqual(record.claim, expected.claim)) {
      return { changed: false, value: false };
    }
    const nextAt = nextAttemptAt(at, record.updatedAt);
    const matchedReceipt = parseGitHubActionReceipt(receipt, { source: record.source, action: record.action });
    if (!matchedReceipt) {
      throw new Error("GitHub effect receipt does not match the claimed effect.");
    }
    record.state = "succeeded";
    record.claim = null;
    record.updatedAt = nextAt;
    record.pendingSince = null;
    record.receipt = cloneReceipt(matchedReceipt);
    record.lastFailure = null;
    appendAttempt(record, {
      at: nextAt,
      outcome: "succeeded",
      reason: args.mode ?? "direct",
      status: 200,
    });
    return { changed: true, value: true };
  });
}

export async function settleGitHubEffectRetryableFailure(args: {
  effectId: string;
  failure: GitHubEffectFailureSnapshot;
  expected: GitHubEffectSettlementGuard;
  at?: string;
}): Promise<boolean> {
  const at = args.at ?? new Date().toISOString();
  const failure = parseGitHubEffectFailureSnapshot(args.failure);
  const expected = parseGitHubEffectSettlementGuard(args.expected);
  if (!isSafeConversationSessionId(args.effectId) || !isCanonicalIsoInstant(at) || !failure || !expected) {
    throw new Error("Invalid GitHub effect failure input.");
  }
  return mutateStore((store) => {
    const record = store.effects.find((effect) => effect.effectId === args.effectId);
    if (!record) throw new Error("GitHub effect not found.");
    if (record.state !== expected.state || !claimsEqual(record.claim, expected.claim)) {
      return { changed: false, value: false };
    }
    const nextAt = nextAttemptAt(at, record.updatedAt);
    record.state = "retryable_failure";
    record.claim = null;
    record.updatedAt = nextAt;
    record.pendingSince = null;
    record.receipt = null;
    record.lastFailure = { ...failure };
    appendAttempt(record, {
      at: nextAt,
      outcome: "retryable_failure",
      reason: failure.reason,
      status: failure.status,
    });
    return { changed: true, value: true };
  });
}

export async function settleGitHubEffectManualReconciliation(args: {
  effectId: string;
  failure: GitHubEffectFailureSnapshot;
  expected: GitHubEffectSettlementGuard;
  at?: string;
}): Promise<boolean> {
  const at = args.at ?? new Date().toISOString();
  const failure = parseGitHubEffectFailureSnapshot(args.failure);
  const expected = parseGitHubEffectSettlementGuard(args.expected);
  if (!isSafeConversationSessionId(args.effectId) || !isCanonicalIsoInstant(at) || !failure || !expected) {
    throw new Error("Invalid GitHub effect manual reconciliation input.");
  }
  return mutateStore((store) => {
    const record = store.effects.find((effect) => effect.effectId === args.effectId);
    if (!record) throw new Error("GitHub effect not found.");
    if (record.state !== expected.state || !claimsEqual(record.claim, expected.claim)) {
      return { changed: false, value: false };
    }
    const nextAt = nextAttemptAt(at, record.updatedAt);
    record.state = "manual_reconciliation";
    record.claim = null;
    record.updatedAt = nextAt;
    record.pendingSince = null;
    record.receipt = null;
    record.lastFailure = { ...failure };
    appendAttempt(record, {
      at: nextAt,
      outcome: "manual_reconciliation",
      reason: failure.reason,
      status: failure.status,
    });
    return { changed: true, value: true };
  });
}
