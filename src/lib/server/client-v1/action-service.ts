import { createHash } from "node:crypto";

import {
  activeConversationTurns,
  deriveConversationAttentionEvidence,
  isSafeConversationSessionId,
  saveConversation,
  type ChatTurn,
  type ConversationFile,
} from "@/lib/cave-conversations";
import { createCard, type NewCardInput } from "@/lib/cave-board";
import type { CardStatus } from "@/lib/cave-board-types";
import { trustedProjectCwd, loadProjects, projectForRoot } from "@/lib/cave-projects";
import {
  createTaskFromChat,
  type ChatHandoffContext,
  type HandoffTurn,
} from "@/lib/chat-task-handoff";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import { chatTurnVisibleText } from "@/lib/chat-rendered-text";
import { sliceGitHubBlocks, type GitHubActionDescriptor } from "@/lib/github-blocks";
import { extractNextPaths } from "@/lib/next-paths";
import { MAX_PROMPT_CHARS } from "@/lib/server/session-security";
import { cwdFromConversationRuntime } from "@/lib/server/chat-work-branch";

import { isUuid, type ClientV1ErrorCode } from "./contract.ts";
import { withAuthorizedClientConversation, type AuthorizedClientConversationResult } from "./chat-service.ts";
import {
  executeGitHubComment,
  type GitHubCommentResult,
} from "@/app/api/github/comment/route";
import {
  executeGitHubReview,
  type GitHubReviewResult,
} from "@/app/api/github/review/route";
import {
  executeGitHubMerge,
  type GitHubMergeResult,
} from "@/app/api/github/merge/route";
import {
  executeGitHubRerun,
  type GitHubRerunResult,
} from "@/app/api/github/rerun/route";
import {
  executeGitHubDispatch,
  type GitHubDispatchResult,
} from "@/app/api/github/dispatch/route";
import {
  beginGitHubEffect,
  GitHubEffectStoreCapacityError,
  type GitHubEffectClaim,
  type GitHubEffectSource,
  settleGitHubEffectManualReconciliation,
  settleGitHubEffectRetryableFailure,
  settleGitHubEffectSuccess,
  type GitHubEffectActionAudit,
  type GitHubEffectFailureSnapshot,
} from "./github-effect-store.ts";
import { reconcileGitHubActionEffect } from "./github-effect-reconciliation.ts";

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const WORKFLOW_RE = /^(?:\d+|[A-Za-z0-9._-]+\.ya?ml)$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,255}$/;
const PROPOSAL_PROMPT_MAX_CHARS = 200;
const TASK_TITLE_MAX_CHARS = 200;
const GITHUB_BODY_MAX_CHARS = 65_535;
const GITHUB_RECEIPT_TEXT_MAX_BYTES = 2_048;
const GITHUB_EFFECT_AUDIT_TEXT_MAX_BYTES = 512;
const ATTENTION_RESPONSE_RESERVATION_KEYS = ["operationId"] as const;

type AttentionResponseReservation = NonNullable<NonNullable<ChatTurn["responseMetadata"]>["attentionResponse"]>;

type ActionServiceErrorResult = {
  ok: false;
  status: number;
  code: ClientV1ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type AttentionResponseInput = {
  conversationId: string;
  prompt: string;
};

export type TaskHandoffInput = {
  conversationId: string;
  turnId: string;
  prompt: string;
  title?: string;
};

export type GitHubActionInput =
  | { kind: "comment"; repo: string; number: number; body: string }
  | { kind: "review"; repo: string; number: number; event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"; body?: string }
  | { kind: "merge"; repo: string; number: number; method: "squash" | "merge" | "rebase" }
  | { kind: "rerun"; repo: string; runId: string }
  | { kind: "dispatch"; repo: string; workflow: string; ref: string };

export type GitHubActionExecutionInput = {
  conversationId: string;
  turnId: string;
  confirmed: true;
  action: GitHubActionInput;
};

export type PreparedAttentionResponse = {
  ok: true;
  send: {
    operationId: string;
    conversationId: string;
    familiarId: string;
    prompt: string;
    attachmentIds: string[];
    projectRoot: string | null;
  };
};

export type TaskHandoffReceipt = {
  source: {
    conversationId: string;
    turnId: string;
    prompt: string;
  };
  task: {
    id: string;
    title: string;
    status: CardStatus;
    familiarId: string | null;
    projectId: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type TaskHandoffSuccess = {
  ok: true;
  receipt: TaskHandoffReceipt;
};

export type GitHubActionReceipt = {
  source: {
    conversationId: string;
    turnId: string;
  };
  action:
    | {
        kind: "comment";
        repo: string;
        number: number;
        body: string;
        bodyBytes: number;
        bodySha256: string;
        bodyTruncated?: boolean;
      }
    | {
        kind: "review";
        repo: string;
        number: number;
        event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
        body?: string;
        bodyBytes?: number;
        bodySha256?: string;
        bodyTruncated?: boolean;
      }
    | {
        kind: "merge";
        repo: string;
        number: number;
        method: "squash" | "merge" | "rebase";
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
  result:
    | {
        kind: "comment";
        commentId: string;
        body: string;
        bodyBytes: number;
        bodySha256: string;
        bodyTruncated?: boolean;
        createdAt: string | null;
        url: string | null;
      }
    | {
        kind: "review";
        reviewId: string;
        state: string;
        url: string | null;
      }
    | {
        kind: "merge";
        merged: true;
        sha: string | null;
        branchDeleted: boolean;
        branchDeleteError: string | null;
      }
    | {
        kind: "rerun";
        accepted: true;
      }
    | {
        kind: "dispatch";
        accepted: true;
      };
};

export type GitHubActionSuccess = {
  ok: true;
  receipt: GitHubActionReceipt;
};

export type GitHubActionExecutionResult =
  | {
      kind: "comment";
      commentId: string;
      body: string;
      createdAt: string | null;
      url: string | null;
    }
  | {
      kind: "review";
      reviewId: string;
      state: string;
      url: string | null;
    }
  | {
      kind: "merge";
      merged: true;
      sha: string | null;
      branchDeleted: boolean;
      branchDeleteError: string | null;
    }
  | {
      kind: "rerun";
      accepted: true;
    }
  | {
      kind: "dispatch";
      accepted: true;
    };

export type TaskHandoffResult = TaskHandoffSuccess | ActionServiceErrorResult;
export type GitHubActionResult = GitHubActionSuccess | ActionServiceErrorResult;
export type AttentionResponseResult = PreparedAttentionResponse | ActionServiceErrorResult;

function invalidRequest(message: string): never {
  throw new Error(message);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidRequest(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || !keys.every((key) => allowed.includes(key))) {
    invalidRequest(`${label} contains unexpected fields.`);
  }
}

function requireAllowedKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (!Object.keys(record).every((key) => allowed.includes(key))) {
    invalidRequest(`${label} contains unexpected fields.`);
  }
}

function requireRequiredKeys(record: Record<string, unknown>, required: readonly string[], label: string): void {
  for (const key of required) {
    if (!Object.hasOwn(record, key)) invalidRequest(`${label} must contain "${key}".`);
  }
}

function requireVariantKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  requireAllowedKeys(record, [...required, ...optional], label);
  requireRequiredKeys(record, required, label);
}

function parseConversationId(value: unknown, label: string): string {
  if (typeof value !== "string") invalidRequest(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!isSafeConversationSessionId(trimmed)) invalidRequest(`${label} is invalid.`);
  return trimmed;
}

function parseNonEmptyText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") invalidRequest(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    invalidRequest(`${label} must contain between 1 and ${max} characters.`);
  }
  return trimmed;
}

function parseOptionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalidRequest(`${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    invalidRequest(`${label} must contain between 1 and ${max} characters.`);
  }
  return trimmed;
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    invalidRequest(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function parseRunId(value: unknown): string {
  if (typeof value !== "string") invalidRequest('"action.runId" must be a string.');
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) invalidRequest('"action.runId" must be a positive integer string.');
  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    invalidRequest('"action.runId" must be a safe positive integer string.');
  }
  return trimmed;
}

function parseAttentionResponseReservation(value: unknown): AttentionResponseReservation | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== ATTENTION_RESPONSE_RESERVATION_KEYS.length
    || !keys.every((key) => key === "operationId")
  ) return null;
  if (typeof record.operationId !== "string") return null;
  const operationId = record.operationId.trim();
  if (!isUuid(operationId)) return null;
  return { operationId };
}

function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

export function parseAttentionResponseInput(value: unknown): AttentionResponseInput {
  const record = requireRecord(value, "Request body");
  requireExactKeys(record, ["conversationId", "prompt"], "Request body");
  return {
    conversationId: parseConversationId(record.conversationId, '"conversationId"'),
    prompt: parseNonEmptyText(record.prompt, '"prompt"', MAX_PROMPT_CHARS),
  };
}

export function parseTaskHandoffInput(value: unknown): TaskHandoffInput {
  const record = requireRecord(value, "Request body");
  const keys = Object.keys(record);
  if (!keys.every((key) => ["conversationId", "turnId", "prompt", "title"].includes(key))) {
    invalidRequest("Request body contains unexpected fields.");
  }
  if (!Object.hasOwn(record, "conversationId") || !Object.hasOwn(record, "turnId") || !Object.hasOwn(record, "prompt")) {
    invalidRequest('Request body must contain exactly "conversationId", "turnId", and "prompt" (plus optional "title").');
  }
  return {
    conversationId: parseConversationId(record.conversationId, '"conversationId"'),
    turnId: parseConversationId(record.turnId, '"turnId"'),
    prompt: parseNonEmptyText(record.prompt, '"prompt"', PROPOSAL_PROMPT_MAX_CHARS),
    ...(parseOptionalText(record.title, '"title"', TASK_TITLE_MAX_CHARS)
      ? { title: parseOptionalText(record.title, '"title"', TASK_TITLE_MAX_CHARS)! }
      : {}),
  };
}

function parseGitHubActionInput(value: unknown): GitHubActionInput {
  const record = requireRecord(value, '"action"');
  if (typeof record.kind !== "string") invalidRequest('"action.kind" must be a string.');
  const kind = record.kind.trim();
  switch (kind) {
    case "comment": {
      requireVariantKeys(record, ["kind", "repo", "number", "body"], [], '"action"');
      const repo = parseNonEmptyText(record.repo, '"action.repo"', 200);
      if (!REPO_RE.test(repo)) invalidRequest('"action.repo" must be an owner/name repository string.');
      return {
        kind: "comment",
        repo,
        number: parsePositiveInteger(record.number, '"action.number"'),
        body: parseNonEmptyText(record.body, '"action.body"', GITHUB_BODY_MAX_CHARS),
      };
    }
    case "review": {
      requireVariantKeys(record, ["kind", "repo", "number", "event"], ["body"], '"action"');
      const repo = parseNonEmptyText(record.repo, '"action.repo"', 200);
      if (!REPO_RE.test(repo)) invalidRequest('"action.repo" must be an owner/name repository string.');
      const event = parseNonEmptyText(record.event, '"action.event"', 32).toUpperCase();
      if (event !== "APPROVE" && event !== "REQUEST_CHANGES" && event !== "COMMENT") {
        invalidRequest('"action.event" must be APPROVE, REQUEST_CHANGES, or COMMENT.');
      }
      const body = parseOptionalText(record.body, '"action.body"', GITHUB_BODY_MAX_CHARS);
      if (event !== "APPROVE" && !body) {
        invalidRequest('"action.body" is required unless the review event is APPROVE.');
      }
      return {
        kind: "review",
        repo,
        number: parsePositiveInteger(record.number, '"action.number"'),
        event,
        ...(body ? { body } : {}),
      };
    }
    case "merge": {
      requireVariantKeys(record, ["kind", "repo", "number", "method"], [], '"action"');
      const repo = parseNonEmptyText(record.repo, '"action.repo"', 200);
      if (!REPO_RE.test(repo)) invalidRequest('"action.repo" must be an owner/name repository string.');
      const method = parseNonEmptyText(record.method, '"action.method"', 32);
      if (method !== "squash" && method !== "merge" && method !== "rebase") {
        invalidRequest('"action.method" must be squash, merge, or rebase.');
      }
      return {
        kind: "merge",
        repo,
        number: parsePositiveInteger(record.number, '"action.number"'),
        method,
      };
    }
    case "rerun": {
      requireVariantKeys(record, ["kind", "repo", "runId"], [], '"action"');
      const repo = parseNonEmptyText(record.repo, '"action.repo"', 200);
      if (!REPO_RE.test(repo)) invalidRequest('"action.repo" must be an owner/name repository string.');
      return {
        kind: "rerun",
        repo,
        runId: parseRunId(record.runId),
      };
    }
    case "dispatch": {
      requireVariantKeys(record, ["kind", "repo", "workflow", "ref"], [], '"action"');
      const repo = parseNonEmptyText(record.repo, '"action.repo"', 200);
      if (!REPO_RE.test(repo)) invalidRequest('"action.repo" must be an owner/name repository string.');
      const workflow = parseNonEmptyText(record.workflow, '"action.workflow"', 255);
      if (!WORKFLOW_RE.test(workflow)) {
        invalidRequest('"action.workflow" must be a numeric id or workflow file name.');
      }
      const ref = parseNonEmptyText(record.ref, '"action.ref"', 255);
      if (!REF_RE.test(ref)) invalidRequest('"action.ref" is invalid.');
      return {
        kind: "dispatch",
        repo,
        workflow,
        ref,
      };
    }
    default:
      invalidRequest('"action.kind" is unsupported.');
  }
}

export function parseGitHubActionExecutionInput(value: unknown): GitHubActionExecutionInput {
  const record = requireRecord(value, "Request body");
  const keys = Object.keys(record);
  if (!keys.every((key) => ["conversationId", "turnId", "confirmed", "action"].includes(key))) {
    invalidRequest("Request body contains unexpected fields.");
  }
  for (const key of ["conversationId", "turnId", "confirmed", "action"] as const) {
    if (!Object.hasOwn(record, key)) invalidRequest(`Request body must contain "${key}".`);
  }
  if (record.confirmed !== true) invalidRequest('"confirmed" must be true.');
  return {
    conversationId: parseConversationId(record.conversationId, '"conversationId"'),
    turnId: parseConversationId(record.turnId, '"turnId"'),
    confirmed: true,
    action: parseGitHubActionInput(record.action),
  };
}

const NOT_FOUND_RESULT: ActionServiceErrorResult = {
  ok: false,
  status: 404,
  code: "not_found",
  message: "Conversation not found.",
  retryable: false,
};

function conflict(message: string, details?: Record<string, unknown>): ActionServiceErrorResult {
  return { ok: false, status: 409, code: "conflict", message, retryable: false, ...(details ? { details } : {}) };
}

function serviceUnavailable(
  message: string,
  retryable = true,
  details?: Record<string, unknown>,
): ActionServiceErrorResult {
  return {
    ok: false,
    status: 503,
    code: "service_unavailable",
    message,
    retryable,
    ...(details ? { details } : {}),
  };
}

function internalError(): ActionServiceErrorResult {
  return { ok: false, status: 500, code: "internal_error", message: "An internal error occurred. Please try again later.", retryable: true };
}

function canonicalProjectRoot(conversation: Pick<ConversationFile, "projectRoot" | "runtime">): string | null {
  if (Object.hasOwn(conversation, "projectRoot")) return conversation.projectRoot ?? null;
  return cwdFromConversationRuntime(conversation.runtime) ?? null;
}

function activeTurns(conversation: ConversationFile): ChatTurn[] | null {
  const resolved = activeConversationTurns(conversation);
  if (conversation.turns.length > 0 && resolved.length === 0) return null;
  return resolved;
}

function toHandoffTurns(turns: readonly ChatTurn[]): HandoffTurn[] {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    text: chatTurnVisibleText(turn).trimEnd(),
    createdAt: turn.createdAt,
    ...(turn.isError || turn.cancelled ? { error: true } : {}),
  }));
}

function matchedAssistantTurn(conversation: ConversationFile, turnId: string): { turn: ChatTurn; active: ChatTurn[] } | null | undefined {
  const active = activeTurns(conversation);
  if (!active) return undefined;
  const turn = active.find((candidate) => candidate.id === turnId && candidate.role === "assistant");
  return turn ? { turn, active } : null;
}

function toCanonicalGitHubAction(action: GitHubActionDescriptor): GitHubActionInput | null {
  switch (action.kind) {
    case "comment":
      return action.number && action.body
        ? { kind: "comment", repo: action.repo, number: action.number, body: action.body }
        : null;
    case "review":
      return action.number && action.event
        ? {
            kind: "review",
            repo: action.repo,
            number: action.number,
            event: action.event,
            ...(action.body ? { body: action.body } : {}),
          }
        : null;
    case "merge":
      return action.number
        ? { kind: "merge", repo: action.repo, number: action.number, method: action.method ?? "squash" }
        : null;
    case "rerun":
      return typeof action.runId === "number"
        ? { kind: "rerun", repo: action.repo, runId: String(action.runId) }
        : null;
    case "dispatch":
      return action.workflow && action.ref
        ? { kind: "dispatch", repo: action.repo, workflow: action.workflow, ref: action.ref }
        : null;
    default:
      return null;
  }
}

function sameGitHubAction(a: GitHubActionInput, b: GitHubActionInput): boolean {
  if (a.kind !== b.kind || normalizeRepo(a.repo) !== normalizeRepo(b.repo)) return false;
  switch (a.kind) {
    case "comment":
      return a.number === (b as Extract<GitHubActionInput, { kind: "comment" }>).number
        && a.body === (b as Extract<GitHubActionInput, { kind: "comment" }>).body;
    case "review": {
      const review = b as Extract<GitHubActionInput, { kind: "review" }>;
      return a.number === review.number && a.event === review.event && (a.body ?? "") === (review.body ?? "");
    }
    case "merge":
      return a.number === (b as Extract<GitHubActionInput, { kind: "merge" }>).number
        && a.method === (b as Extract<GitHubActionInput, { kind: "merge" }>).method;
    case "rerun":
      return a.runId === (b as Extract<GitHubActionInput, { kind: "rerun" }>).runId;
    case "dispatch":
      return a.workflow === (b as Extract<GitHubActionInput, { kind: "dispatch" }>).workflow
        && a.ref === (b as Extract<GitHubActionInput, { kind: "dispatch" }>).ref;
  }
}

type GitHubWriteFailure =
  | Extract<GitHubCommentResult, { ok: false }>
  | Extract<GitHubReviewResult, { ok: false }>
  | Extract<GitHubMergeResult, { ok: false }>
  | Extract<GitHubRerunResult, { ok: false }>
  | Extract<GitHubDispatchResult, { ok: false }>;

type GitHubActionExecutionOutcome =
  | {
      kind: "success";
      result: GitHubActionExecutionResult;
    }
  | {
      kind: "failure";
      failure: GitHubWriteFailure;
    };

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function sliceUtf8Bytes(text: string, maxBytes: number): { value: string; truncated: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { value: text, truncated: false };
  let sliced = "";
  let usedBytes = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + charBytes > maxBytes) break;
    sliced += char;
    usedBytes += charBytes;
  }
  return { value: sliced.trimEnd(), truncated: true };
}

function boundedGitHubText(text: string, maxBytes: number): {
  text: string;
  bytes: number;
  sha256: string;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(text, "utf8");
  const sliced = sliceUtf8Bytes(text, maxBytes);
  return {
    text: sliced.value,
    bytes,
    sha256: sha256Hex(text),
    truncated: sliced.truncated,
  };
}

function receiptTextFields(text: string): {
  body: string;
  bodyBytes: number;
  bodySha256: string;
  bodyTruncated?: boolean;
} {
  const bounded = boundedGitHubText(text, GITHUB_RECEIPT_TEXT_MAX_BYTES);
  return {
    body: bounded.text,
    bodyBytes: bounded.bytes,
    bodySha256: bounded.sha256,
    ...(bounded.truncated ? { bodyTruncated: true } : {}),
  };
}

function auditGitHubAction(action: GitHubActionInput): GitHubEffectActionAudit {
  switch (action.kind) {
    case "comment": {
      const bounded = boundedGitHubText(action.body, GITHUB_EFFECT_AUDIT_TEXT_MAX_BYTES);
      return {
        kind: "comment",
        repo: action.repo,
        number: action.number,
        bodyPreview: bounded.text,
        bodyBytes: bounded.bytes,
        bodySha256: bounded.sha256,
        bodyTruncated: bounded.truncated,
      };
    }
    case "review": {
      const bounded = action.body
        ? boundedGitHubText(action.body, GITHUB_EFFECT_AUDIT_TEXT_MAX_BYTES)
        : null;
      return {
        kind: "review",
        repo: action.repo,
        number: action.number,
        event: action.event,
        ...(bounded
          ? {
              bodyPreview: bounded.text,
              bodyBytes: bounded.bytes,
              bodySha256: bounded.sha256,
              bodyTruncated: bounded.truncated,
            }
          : {}),
      };
    }
    case "merge":
      return action;
    case "rerun":
      return action;
    case "dispatch":
      return action;
  }
}

function receiptAction(action: GitHubActionInput): GitHubActionReceipt["action"] {
  switch (action.kind) {
    case "comment":
      return {
        kind: "comment",
        repo: action.repo,
        number: action.number,
        ...receiptTextFields(action.body),
      };
    case "review":
      return {
        kind: "review",
        repo: action.repo,
        number: action.number,
        event: action.event,
        ...(action.body ? receiptTextFields(action.body) : {}),
      };
    case "merge":
      return action;
    case "rerun":
      return action;
    case "dispatch":
      return action;
  }
}

function buildGitHubActionReceipt(
  source: GitHubActionReceipt["source"],
  action: GitHubActionInput,
  result: GitHubActionExecutionResult,
): GitHubActionReceipt {
  if (result.kind === "comment") {
    const body = receiptTextFields(result.body);
    return {
      source,
      action: receiptAction(action),
      result: {
        kind: "comment",
        commentId: result.commentId,
        ...body,
        createdAt: result.createdAt,
        url: result.url,
      },
    };
  }
  return {
    source,
    action: receiptAction(action),
    result,
  };
}

function mappedGitHubFailureForEffect(
  effectId: string,
  source: GitHubEffectSource,
  action: GitHubEffectActionAudit,
  failure: GitHubEffectFailureSnapshot,
): ActionServiceErrorResult {
  const base =
    failure.code === "not_found"
      ? { ok: false as const, status: 404, code: "not_found" as const, message: failure.message ?? "GitHub target not found.", retryable: false }
      : failure.code === "service_unavailable"
        ? { ok: false as const, status: 503, code: "service_unavailable" as const, message: failure.message ?? "GitHub access is not configured.", retryable: failure.retryable }
        : { ok: false as const, status: 409, code: "conflict" as const, message: failure.message ?? "GitHub rejected this action.", retryable: false };
  return {
    ...base,
    details: {
      reason: "github_pre_effect_failure",
      effectState: "retryable_failure",
      effectId,
      source,
      action,
      githubFailureReason: failure.reason,
      githubStatus: failure.status,
      ...(failure.message ? { githubMessage: failure.message } : {}),
    },
  };
}

function manualReconciliationError(
  effectId: string,
  source: GitHubEffectSource,
  action: GitHubEffectActionAudit,
  failure: GitHubEffectFailureSnapshot,
): ActionServiceErrorResult {
  return conflict(
    "This GitHub action's outcome is uncertain. Verify it on GitHub and recover it manually before retrying.",
    {
      reason: "manual_reconciliation_required",
      effectState: "manual_reconciliation",
      effectId,
      source,
      action,
      githubFailureReason: failure.reason,
      githubStatus: failure.status,
      ...(failure.message ? { githubMessage: failure.message } : {}),
    },
  );
}

function preEffectFailureSnapshot(failure: GitHubWriteFailure): GitHubEffectFailureSnapshot {
  const mapped = mapGitHubFailure(failure);
  return {
    code: mapped.code === "not_found" ? "not_found" : mapped.code === "service_unavailable" ? "service_unavailable" : "conflict",
    status: mapped.status,
    retryable: mapped.retryable,
    reason: failure.reason === "auth_required" ? "auth_required" : "upstream_rejected",
    message: failure.error,
  };
}

async function resolveProjectId(projectRoot: string | null): Promise<string | null> {
  if (!projectRoot) return null;
  const projects = await loadProjects();
  return projectForRoot(projectRoot, projects)?.id ?? null;
}

async function taskHandoffFetch(
  url: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const href = typeof url === "string"
    ? url
    : url instanceof URL
      ? url.pathname
      : new URL(url.url).pathname;
  if (href !== "/api/board" && href !== "http://localhost/api/board") {
    throw new Error(`Unsupported board route target: ${href}`);
  }
  const raw = typeof init?.body === "string" ? init.body : "";
  let body: (NewCardInput & { id?: string }) | null = null;
  try {
    body = JSON.parse(raw) as (NewCardInput & { id?: string });
  } catch {
    return Response.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  if (!body?.title || !body.title.trim()) {
    return Response.json({ ok: false, error: "title required" }, { status: 400 });
  }
  let cwd = body.cwd ?? null;
  if (body.projectId) {
    const resolved = await trustedProjectCwd(body.projectId);
    if (!resolved.ok) {
      return Response.json({ ok: false, error: "assigned project not found" }, { status: 409 });
    }
    cwd = resolved.root;
  }
  const card = await createCard({
    ...body,
    cwd,
    ...(body.id ? { id: body.id } : {}),
  });
  return Response.json({ ok: true, card });
}

export type ClientActionServiceDeps = {
  authorizeConversation: <T>(
    sessionId: string,
    effect: (conversation: ConversationFile) => Promise<T>,
  ) => Promise<AuthorizedClientConversationResult<T>>;
  saveConversation: typeof saveConversation;
  createTaskFromChat: (args: {
    sessionId: string;
    context: ChatHandoffContext;
    title?: string;
    cardId?: string;
  }) => Promise<{ ok: boolean; card?: { id: string; title: string; status: CardStatus; familiarId: string | null; projectId?: string | null; createdAt: string; updatedAt: string }; error?: string }>;
  resolveProjectId: (projectRoot: string | null) => Promise<string | null>;
  executeGitHubComment: typeof executeGitHubComment;
  executeGitHubReview: typeof executeGitHubReview;
  executeGitHubMerge: typeof executeGitHubMerge;
  executeGitHubRerun: typeof executeGitHubRerun;
  executeGitHubDispatch: typeof executeGitHubDispatch;
  beginGitHubEffect: typeof beginGitHubEffect;
  settleGitHubEffectSuccess: typeof settleGitHubEffectSuccess;
  settleGitHubEffectRetryableFailure: typeof settleGitHubEffectRetryableFailure;
  settleGitHubEffectManualReconciliation: typeof settleGitHubEffectManualReconciliation;
  reconcileGitHubActionEffect: typeof reconcileGitHubActionEffect;
};

function defaultDeps(): ClientActionServiceDeps {
  return {
    authorizeConversation: withAuthorizedClientConversation,
    saveConversation,
    createTaskFromChat: ({ sessionId, context, title, cardId }) =>
      createTaskFromChat({
        sessionId,
        context,
        title,
        cardId,
        fetchImpl: taskHandoffFetch,
      }),
    resolveProjectId,
    executeGitHubComment,
    executeGitHubReview,
    executeGitHubMerge,
    executeGitHubRerun,
    executeGitHubDispatch,
    beginGitHubEffect,
    settleGitHubEffectSuccess,
    settleGitHubEffectRetryableFailure,
    settleGitHubEffectManualReconciliation,
    reconcileGitHubActionEffect,
  };
}

function mapGitHubFailure(result: GitHubWriteFailure): ActionServiceErrorResult {
  if (result.reason === "auth_required") {
    return serviceUnavailable("GitHub access is not configured.", false);
  }
  if (result.reason === "network" || result.status >= 500) {
    return serviceUnavailable("GitHub is temporarily unavailable. Please try again later.", true);
  }
  if (result.status === 404) {
    return { ok: false, status: 404, code: "not_found", message: result.error, retryable: false };
  }
  return { ok: false, status: 409, code: "conflict", message: result.error, retryable: false };
}

async function persistGitHubEffectOutcome(
  persist: () => Promise<boolean | void>,
): Promise<void> {
  try {
    const persisted = await persist();
    if (persisted === false) {
      console.warn("[client-v1] skipped stale GitHub effect settlement after a newer claim took ownership");
    }
  } catch (error) {
    console.error("[client-v1] failed to persist GitHub effect outcome:", error);
  }
}

async function executeCanonicalGitHubAction(
  deps: ClientActionServiceDeps,
  action: GitHubActionInput,
): Promise<GitHubActionExecutionOutcome> {
  switch (action.kind) {
    case "comment": {
      const result = await deps.executeGitHubComment({ repo: action.repo, number: action.number, body: action.body });
      return result.ok
        ? {
            kind: "success",
            result: {
              kind: "comment",
              commentId: result.comment.id,
              body: result.comment.body,
              createdAt: result.comment.createdAt,
              url: result.comment.url,
            },
          }
        : { kind: "failure", failure: result };
    }
    case "review": {
      const result = await deps.executeGitHubReview({
        repo: action.repo,
        number: action.number,
        event: action.event,
        ...(action.body ? { body: action.body } : {}),
      });
      return result.ok
        ? {
            kind: "success",
            result: {
              kind: "review",
              reviewId: result.review.id,
              state: result.review.state,
              url: result.review.url,
            },
          }
        : { kind: "failure", failure: result };
    }
    case "merge": {
      const result = await deps.executeGitHubMerge({ repo: action.repo, number: action.number, method: action.method });
      return result.ok
        ? {
            kind: "success",
            result: {
              kind: "merge",
              merged: true,
              sha: result.sha,
              branchDeleted: result.branchDeleted,
              branchDeleteError: result.branchDeleteError,
            },
          }
        : { kind: "failure", failure: result };
    }
    case "rerun": {
      const result = await deps.executeGitHubRerun({
        repo: action.repo,
        runId: Number.parseInt(action.runId, 10),
        failedOnly: true,
      });
      return result.ok
        ? {
            kind: "success",
            result: { kind: "rerun", accepted: true },
          }
        : { kind: "failure", failure: result };
    }
    case "dispatch": {
      const result = await deps.executeGitHubDispatch({ repo: action.repo, workflow: action.workflow, ref: action.ref });
      return result.ok
        ? {
            kind: "success",
            result: { kind: "dispatch", accepted: true },
          }
        : { kind: "failure", failure: result };
    }
  }
}

async function reconcilePendingGitHubEffect(
  deps: ClientActionServiceDeps,
  args: {
    effectId: string;
    source: GitHubEffectSource;
    claim: GitHubEffectClaim;
    action: GitHubActionInput;
    actionAudit: GitHubEffectActionAudit;
    pendingSince: string;
    rootReason: Extract<GitHubEffectFailureSnapshot["reason"], "crash_window" | "network_ambiguous" | "upstream_ambiguous">;
  },
): Promise<GitHubActionResult> {
  let reconciled;
  try {
    reconciled = await deps.reconcileGitHubActionEffect({
      action: args.action,
      pendingSince: args.pendingSince,
      rootReason: args.rootReason,
    });
  } catch {
    const failure: GitHubEffectFailureSnapshot = {
      code: "conflict",
      status: 409,
      retryable: false,
      reason: "reconciliation_unavailable",
      message: "GitHub reconciliation is unavailable.",
    };
    await persistGitHubEffectOutcome(() =>
      deps.settleGitHubEffectManualReconciliation({
        effectId: args.effectId,
        failure,
        expected: { state: "pending", claim: args.claim },
      }),
    );
    return manualReconciliationError(args.effectId, args.source, args.actionAudit, failure);
  }

  if (reconciled.kind === "success") {
    const receipt = buildGitHubActionReceipt(args.source, args.action, reconciled.result);
    await persistGitHubEffectOutcome(() =>
      deps.settleGitHubEffectSuccess({
        effectId: args.effectId,
        receipt,
        expected: { state: "pending", claim: args.claim },
        mode: "reconciled",
      }),
    );
    return { ok: true, receipt };
  }

  await persistGitHubEffectOutcome(() =>
    deps.settleGitHubEffectManualReconciliation({
      effectId: args.effectId,
      failure: reconciled.failure,
      expected: { state: "pending", claim: args.claim },
    }),
  );
  return manualReconciliationError(args.effectId, args.source, args.actionAudit, reconciled.failure);
}

export function createClientActionService(overrides: Partial<ClientActionServiceDeps> = {}) {
  const deps = { ...defaultDeps(), ...overrides };

  return {
    async prepareAttentionResponse(
      requestTurnId: string,
      input: AttentionResponseInput,
      operationId: string,
    ): Promise<AttentionResponseResult> {
      const authorized = await deps.authorizeConversation(input.conversationId, async (conversation) => {
        const active = activeTurns(conversation);
        if (!active) return { kind: "integrity" as const };
        const request = deriveConversationAttentionEvidence(conversation)?.request;
        if (
          !request
          || "state" in request
          || request.sessionId !== conversation.sessionId
          || request.turnId !== requestTurnId
        ) {
          return { kind: "stale" as const };
        }
        const requestTurn = active.find((turn) => turn.id === requestTurnId && turn.role === "assistant");
        if (!requestTurn || request.requestedAt !== requestTurn.createdAt) {
          return { kind: "stale" as const };
        }
        const persistedRequestTurn = conversation.turns.find(
          (turn) => turn.id === requestTurnId && turn.role === "assistant",
        );
        if (!persistedRequestTurn || persistedRequestTurn.createdAt !== requestTurn.createdAt) {
          return { kind: "integrity" as const };
        }
        const responseMetadata =
          persistedRequestTurn.responseMetadata && typeof persistedRequestTurn.responseMetadata === "object"
            ? persistedRequestTurn.responseMetadata as ChatResponseMetadata & Record<string, unknown>
            : null;
        if (!responseMetadata) return { kind: "integrity" as const };
        const existingReservation = parseAttentionResponseReservation(responseMetadata.attentionResponse);
        if (existingReservation === null) return { kind: "integrity" as const };
        if (existingReservation && existingReservation.operationId !== operationId) {
          return { kind: "claimed" as const };
        }
        if (!existingReservation) {
          persistedRequestTurn.responseMetadata = {
            ...responseMetadata,
            attentionResponse: { operationId },
          };
          await deps.saveConversation(conversation);
        }
        return {
          kind: "authorized" as const,
          familiarId: conversation.familiarId,
          projectRoot: canonicalProjectRoot(conversation),
        };
      });
      if (!authorized.ok) return NOT_FOUND_RESULT;
      if (authorized.value.kind === "integrity") return internalError();
      if (authorized.value.kind === "claimed") {
        return conflict("This attention request is already being answered.", {
          conversationId: input.conversationId,
          turnId: requestTurnId,
        });
      }
      if (authorized.value.kind === "stale") {
        return conflict("This attention request is stale or no longer active.", {
          conversationId: input.conversationId,
          turnId: requestTurnId,
        });
      }
      return {
        ok: true,
        send: {
          operationId,
          conversationId: input.conversationId,
          familiarId: authorized.value.familiarId,
          prompt: input.prompt.trim(),
          attachmentIds: [],
          projectRoot: authorized.value.projectRoot,
        },
      };
    },

    async handoffTask(
      input: TaskHandoffInput,
      options: { effectId?: string } = {},
    ): Promise<TaskHandoffResult> {
      const authorized = await deps.authorizeConversation(input.conversationId, async (conversation) => {
        const matched = matchedAssistantTurn(conversation, input.turnId);
        if (matched === undefined) return { kind: "integrity" as const };
        if (!matched) return { kind: "stale" as const };
        const proposal = extractNextPaths(matched.turn.text).suggestions.find(
          (suggestion) => suggestion.kind === "task" && suggestion.prompt === input.prompt,
        );
        if (!proposal) return { kind: "stale" as const };
        return {
          kind: "authorized" as const,
          projectRoot: canonicalProjectRoot(conversation),
          context: {
            turns: toHandoffTurns(matched.active),
            familiarId: conversation.familiarId ?? null,
          },
          title: input.title ?? proposal.prompt,
        };
      });
      if (!authorized.ok) return NOT_FOUND_RESULT;
      if (authorized.value.kind === "integrity") return internalError();
      if (authorized.value.kind === "stale") {
        return conflict("This task proposal is stale or no longer available.", {
          conversationId: input.conversationId,
          turnId: input.turnId,
          prompt: input.prompt.trim(),
        });
      }

      const projectId = await deps.resolveProjectId(authorized.value.projectRoot);
      const created = await deps.createTaskFromChat({
        sessionId: input.conversationId,
        context: { ...authorized.value.context, projectId },
        title: authorized.value.title,
        ...(options.effectId ? { cardId: options.effectId } : {}),
      });
      if (!created.ok || !created.card) {
        const error = created.error?.trim() || "The task could not be created.";
        if (/network|offline/i.test(error)) {
          return serviceUnavailable("The task could not be created right now. Please try again later.", true);
        }
        return conflict(error);
      }

      return {
        ok: true,
        receipt: {
          source: {
            conversationId: input.conversationId,
            turnId: input.turnId,
            prompt: input.prompt.trim(),
          },
          task: {
            id: created.card.id,
            title: created.card.title,
            status: created.card.status,
            familiarId: created.card.familiarId ?? null,
            projectId: created.card.projectId ?? null,
            createdAt: created.card.createdAt,
            updatedAt: created.card.updatedAt,
          },
        },
      };
    },

    async executeGitHubAction(
      input: GitHubActionExecutionInput,
      options: { effectId?: string } = {},
    ): Promise<GitHubActionResult> {
      const authorized = await deps.authorizeConversation(input.conversationId, async (conversation) => {
        const matched = matchedAssistantTurn(conversation, input.turnId);
        if (matched === undefined) return { kind: "integrity" as const };
        if (!matched) return { kind: "stale" as const };
        const canonical = sliceGitHubBlocks(matched.turn.text, { unfurlBareUrls: false })
          .flatMap((piece) => (piece.kind === "action" ? [piece.action] : []))
          .map(toCanonicalGitHubAction)
          .filter((candidate): candidate is GitHubActionInput => candidate !== null)
          .find((candidate) => sameGitHubAction(candidate, input.action));
        if (!canonical) return { kind: "stale" as const };
        return { kind: "authorized" as const, action: canonical };
      });
      if (!authorized.ok) return NOT_FOUND_RESULT;
      if (authorized.value.kind === "integrity") return internalError();
      if (authorized.value.kind === "stale") {
        return conflict("This GitHub action proposal is stale or no longer available.", {
          conversationId: input.conversationId,
          turnId: input.turnId,
        });
      }

      const action = authorized.value.action;
      const source = { conversationId: input.conversationId, turnId: input.turnId };
      const effectId = options.effectId?.trim() || null;

      if (!effectId) {
        const executed = await executeCanonicalGitHubAction(deps, action);
        if (executed.kind === "failure") return mapGitHubFailure(executed.failure);
        return {
          ok: true,
          receipt: buildGitHubActionReceipt(source, action, executed.result),
        };
      }

      const actionAudit = auditGitHubAction(action);
      let reserved;
      try {
        reserved = await deps.beginGitHubEffect({
          effectId,
          source,
          action: actionAudit,
        });
      } catch (error) {
        if (error instanceof GitHubEffectStoreCapacityError) {
          return serviceUnavailable(
            "Too many GitHub actions are still awaiting durable resolution. Retry later with the same Idempotency-Key.",
            true,
            { reason: "github_effect_capacity_exceeded" },
          );
        }
        return serviceUnavailable("GitHub action state is unavailable. Please try again later.", true);
      }

      if (reserved.kind === "replay") {
        return { ok: true, receipt: reserved.receipt };
      }
      if (reserved.kind === "manual_reconciliation") {
        return manualReconciliationError(
          effectId,
          reserved.record.source,
          reserved.record.action,
          reserved.failure,
        );
      }
      if (reserved.kind === "reconcile") {
        return reconcilePendingGitHubEffect(deps, {
          effectId,
          source: reserved.record.source,
          claim: reserved.claim,
          action,
          actionAudit: reserved.record.action,
          pendingSince: reserved.record.pendingSince ?? reserved.record.updatedAt,
          rootReason: "crash_window",
        });
      }

      const executed = await executeCanonicalGitHubAction(deps, action);
      if (executed.kind === "success") {
        const receipt = buildGitHubActionReceipt(source, action, executed.result);
        await persistGitHubEffectOutcome(() =>
          deps.settleGitHubEffectSuccess({
            effectId,
            receipt,
            expected: { state: "pending", claim: reserved.claim },
            mode: "direct",
          }),
        );
        return { ok: true, receipt };
      }

      const failure = executed.failure;
      if (failure.reason !== "network" && failure.status < 500) {
        const snapshot = preEffectFailureSnapshot(failure);
        await persistGitHubEffectOutcome(() =>
          deps.settleGitHubEffectRetryableFailure({
            effectId,
            failure: snapshot,
            expected: { state: "pending", claim: reserved.claim },
          }),
        );
        return mappedGitHubFailureForEffect(effectId, source, actionAudit, snapshot);
      }

      return reconcilePendingGitHubEffect(deps, {
        effectId,
        source,
        claim: reserved.claim,
        action,
        actionAudit,
        pendingSince: reserved.record.pendingSince ?? reserved.record.updatedAt,
        rootReason: failure.reason === "network" ? "network_ambiguous" : "upstream_ambiguous",
      });
    },
  };
}

export const clientActionService = createClientActionService();
