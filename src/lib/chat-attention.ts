import { CHAT_ATTENTION_REASONS } from "./chat-attention-marker.ts";
import type { ChatAttentionReason } from "./chat-attention-marker.ts";
import { ACTIVE_SESSION_STATUSES } from "./chat-auto-archive.ts";
import type { ChatResponseMetadata } from "./chat-response-metadata.ts";
import type { SessionRow } from "./types.ts";

const LEFT_HANGING_MS = 24 * 60 * 60 * 1000;
const OVERDUE_HUMAN_MS = 48 * 60 * 60 * 1000;
const VALID_REASON_SET = new Set<string>(CHAT_ATTENTION_REASONS);

export type ChatAttentionState =
  | "none"
  | "left-hanging"
  | "awaiting-human"
  | "overdue-human";

export type ChatAttention = {
  state: ChatAttentionState;
  since: string | null;
  reason: ChatAttentionReason | null;
};

export type ChatAttentionEvidence = {
  latestCompletedTurn: { role: "user" | "assistant"; at: string } | null;
  latestUserTurnAt: string | null;
  request: ChatResponseMetadata["attentionRequest"] | null;
};

export const NO_CHAT_ATTENTION: ChatAttention = {
  state: "none",
  since: null,
  reason: null,
};

export function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function deriveChatAttention(args: {
  evidence: ChatAttentionEvidence | null | undefined;
  status: string;
  archivedAt: string | null;
  now: number;
}): ChatAttention {
  const nowMs = normalizeTimestamp(args.now);
  if (nowMs === null) return NO_CHAT_ATTENTION;
  if ((args.status ?? "").trim().toLowerCase() === "archived") return NO_CHAT_ATTENTION;
  if (args.archivedAt) return NO_CHAT_ATTENTION;
  if (ACTIVE_SESSION_STATUSES.has((args.status ?? "").trim().toLowerCase())) {
    return NO_CHAT_ATTENTION;
  }

  const evidence = args.evidence;
  if (!evidence) return NO_CHAT_ATTENTION;

  const latest = normalizeLatestCompletedTurn(evidence.latestCompletedTurn, nowMs);
  if (evidence.latestCompletedTurn && latest === null) return NO_CHAT_ATTENTION;
  const latestUserTurnAtMs = normalizeLatestUserTurnAt(evidence.latestUserTurnAt, nowMs);
  if (evidence.latestUserTurnAt && latestUserTurnAtMs === null) return NO_CHAT_ATTENTION;

  const request = normalizeAttentionRequest(evidence.request, nowMs);
  if (evidence.request && request === null) return NO_CHAT_ATTENTION;

  const resolvedRequest =
    request &&
    ((latestUserTurnAtMs !== null && latestUserTurnAtMs > request.requestedAtMs) ||
      (latest?.role === "user" && latest.atMs > request.requestedAtMs))
      ? null
      : request;

  if (resolvedRequest) {
    const elapsedMs = nowMs - resolvedRequest.requestedAtMs;
    return {
      state: elapsedMs >= OVERDUE_HUMAN_MS ? "overdue-human" : "awaiting-human",
      since: resolvedRequest.requestedAt,
      reason: resolvedRequest.reason,
    };
  }

  if (!latest || latest.role !== "assistant") return NO_CHAT_ATTENTION;
  if (nowMs - latest.atMs < LEFT_HANGING_MS) return NO_CHAT_ATTENTION;

  return {
    state: "left-hanging",
    since: latest.at,
    reason: null,
  };
}

export function compareChatAttention(
  a: Pick<SessionRow, "attention">,
  b: Pick<SessionRow, "attention">,
): number {
  const rankDiff = attentionPriority(a.attention.state) - attentionPriority(b.attention.state);
  if (rankDiff !== 0) return rankDiff;

  const aMs = parseFiniteIso(a.attention.since);
  const bMs = parseFiniteIso(b.attention.since);
  if (aMs === null && bMs === null) return 0;
  if (aMs === null) return 1;
  if (bMs === null) return -1;
  return aMs - bMs;
}

export function chatAttentionLabel(state: ChatAttentionState): string | null {
  switch (state) {
    case "left-hanging":
      return "Left hanging";
    case "awaiting-human":
      return "Awaiting you";
    case "overdue-human":
      return "Still waiting";
    default:
      return null;
  }
}

export function chatAttentionDescription(
  attention: ChatAttention,
  now: number,
): string | null {
  const label = chatAttentionLabel(attention.state);
  if (!label || !attention.since) return null;
  const sinceMs = parseFiniteIso(attention.since);
  const nowMs = normalizeTimestamp(now);
  if (sinceMs === null || nowMs === null || sinceMs > nowMs) return null;

  const elapsed = formatElapsedDuration(nowMs - sinceMs);
  const reason = formatReason(attention.reason);

  return `${label}${reason ? ` for ${reason}` : ""} since ${elapsed}.`;
}

function attentionPriority(state: ChatAttentionState): number {
  switch (state) {
    case "overdue-human":
      return 0;
    case "awaiting-human":
      return 1;
    case "left-hanging":
      return 2;
    default:
      return 3;
  }
}

function normalizeLatestCompletedTurn(
  value: ChatAttentionEvidence["latestCompletedTurn"],
  nowMs: number,
): { role: "user" | "assistant"; at: string; atMs: number } | null {
  if (!value) return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  const atMs = parseFiniteIso(value.at);
  if (atMs === null || atMs > nowMs) return null;
  return { ...value, atMs };
}

function normalizeAttentionRequest(
  value: ChatAttentionEvidence["request"],
  nowMs: number,
): {
  sessionId: string;
  turnId: string;
  requestedAt: string;
  requestedAtMs: number;
  reason: ChatAttentionReason;
} | null {
  if (!value) return null;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    typeof value.turnId !== "string" ||
    !value.turnId ||
    typeof value.reason !== "string" ||
    !VALID_REASON_SET.has(value.reason)
  ) {
    return null;
  }
  const requestedAtMs = parseFiniteIso(value.requestedAt);
  if (requestedAtMs === null || requestedAtMs > nowMs) return null;
  return {
    sessionId: value.sessionId,
    turnId: value.turnId,
    requestedAt: value.requestedAt,
    requestedAtMs,
    reason: value.reason as ChatAttentionReason,
  };
}

function normalizeLatestUserTurnAt(value: ChatAttentionEvidence["latestUserTurnAt"], nowMs: number): number | null {
  if (value == null) return null;
  const atMs = parseFiniteIso(value);
  if (atMs === null || atMs > nowMs) return null;
  return atMs;
}

function parseFiniteIso(value: string | null | undefined): number | null {
  if (!isCanonicalIsoInstant(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function formatElapsedDuration(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;

  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(elapsedMs / 86_400_000);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function formatReason(reason: ChatAttentionReason | null): string | null {
  switch (reason) {
    case "decision":
      return "a decision";
    case "input":
    case "approval":
    case "credentials":
      return reason;
    default:
      return null;
  }
}
