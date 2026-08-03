import { NextResponse } from "next/server";
import { cleanModelId } from "@/lib/chat-model-state";
import type { ChatResponseMetadata } from "@/lib/chat-response-metadata";
import { cleanModelControlValues } from "@/lib/model-control-capabilities";
import {
  isSafeConversationSessionId,
  deleteConversation,
  loadConversation,
  saveConversation,
  withConversationLock,
  type ChatTurn,
  type ConversationFile,
} from "@/lib/cave-conversations";
import { linkedContextForSession } from "@/lib/chat-linked-context";
import { unlinkSessionFromCards } from "@/lib/cave-board";
import { loadConversationFromJsonl } from "@/lib/openclaw-conversation";
import { loadState, recordSessionFamiliar, sacrificeSessionLocal } from "@/lib/cave-config";
import { defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { normalizeTurnUsage, parseCostUsd } from "@/lib/usage-format";
import {
  checkTurnBounds,
  sanitizeClientTurns,
} from "@/lib/server/conversation-write-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConversationWriteBody = {
  sessionId?: string;
  familiarId?: string;
  harness?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  turn?: unknown;
  turns?: unknown[];
  activeLeafId?: unknown;
};

type ConversationPatchBody = {
  modelIntent?: {
    model?: unknown;
    source?: unknown;
    applicationState?: unknown;
    reason?: unknown;
  } | null;
  activeLeafId?: unknown;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

const MODEL_METADATA_SOURCES = new Set([
  "runtime-default",
  "global-default",
  "familiar-default",
  "session",
  "next-message",
]);
const MODEL_METADATA_STATES = new Set([
  "unknown",
  "saved",
  "pending",
  "applied",
  "unsupported",
  "failed",
]);
const OPENCLAW_AGENT_SOURCES = new Set([
  "explicit",
  "id-match",
  "name-match",
  "default",
  "fallback",
]);
const MODEL_APPLICATION_REASONS = new Set([
  "Runtime rejected the selected model.",
  "Runtime confirmed the selected model.",
  "Cave saved the model intent and is waiting for runtime confirmation.",
  "Saved in Cave. Runtime model application is not confirmed by this runtime path yet.",
  "Using the runtime's configured default model for this message.",
  "Selected for the next message only.",
  "Using the runtime's configured default model.",
  "Saved for this chat.",
  "Using the runtime default.",
  "Inherited from Cave defaults.",
  "The selected model id failed launch-boundary validation.",
  "The model override scope must be next-message, session, or runtime-default.",
  "Runtime-owned defaults are represented by omitting the model id.",
  "Explicit model ids require session or next-message scope; clearing requires a runtime-default scope.",
  "Model forwarding is unavailable for this runtime binding.",
  "Coven forwarded the selected model; downstream acceptance was not confirmed.",
]);

function safeMetadataText(value: unknown, maxLength = 512, allowEmpty = false): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > maxLength) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

function cleanMetadataModel(value: unknown, allowEmpty = false): string | undefined {
  if (allowEmpty && value === "") return "";
  return cleanModelId(value) ?? undefined;
}

function cleanMetadataHarness(value: unknown): string | undefined {
  const harness = safeMetadataText(value, 80);
  return harness && /^[A-Za-z0-9._-]+$/.test(harness) ? harness : undefined;
}

function cleanMetadataRuntime(value: unknown): string | undefined {
  const runtime = safeMetadataText(value, 1024);
  // Conversation runtime facts are Cave's `local:`/`ssh:` display tokens, not
  // arbitrary provider URLs. Reject URL delimiters and userinfo so a client
  // cannot smuggle credentials into persisted metadata.
  return runtime && /^(?:local|ssh):/.test(runtime) && !/[?#@]/.test(runtime.slice(runtime.indexOf(":") + 1))
    ? runtime
    : undefined;
}

function cleanMetadataToken(value: unknown, maxLength: number): string | undefined {
  const token = safeMetadataText(value, maxLength);
  return token && !/[/?#@]/.test(token) ? token : undefined;
}

/**
 * Conversation writes can come from older clients, so response metadata is
 * normalized at this boundary before it is persisted. Keep only bounded,
 * user-visible facts; provider payloads, credentials, and secret-bearing URLs
 * are never accepted as transcript metadata.
 */
function normalizeResponseMetadata(input: unknown): ChatResponseMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const familiarId = safeMetadataText(value.familiarId, 160);
  const harness = cleanMetadataHarness(value.harness);
  // Model identity is a launch-safe id, not an arbitrary provider payload or
  // URL. Keep the runtime-default empty sentinel, but reject everything else
  // that cannot cross the launch boundary safely.
  const model = cleanMetadataModel(value.model, true);
  const runtime = cleanMetadataRuntime(value.runtime);
  if (!familiarId || !/^[A-Za-z0-9._-]+$/.test(familiarId) || !harness || model === undefined || !runtime) {
    return undefined;
  }

  const requestedModel = cleanMetadataModel(value.requestedModel, true);
  const desiredModel = cleanMetadataModel(value.desiredModel, true);
  const forwardedModel = cleanMetadataModel(value.forwardedModel);
  const confirmedModel = cleanMetadataModel(value.confirmedModel);
  const retryModel = cleanMetadataModel(value.retryModel);
  const modelSource = MODEL_METADATA_SOURCES.has(String(value.modelSource))
    ? value.modelSource as ChatResponseMetadata["modelSource"]
    : undefined;
  const modelApplicationState = MODEL_METADATA_STATES.has(String(value.modelApplicationState))
    ? value.modelApplicationState as ChatResponseMetadata["modelApplicationState"]
    : undefined;
  const modelApplicationReason = MODEL_APPLICATION_REASONS.has(String(value.modelApplicationReason))
    ? value.modelApplicationReason as string
    : undefined;
  const rejectedControlFamilies = Array.isArray(value.rejectedControlFamilies)
    ? value.rejectedControlFamilies.flatMap((family) => {
      const clean = safeMetadataText(family, 64);
      return clean && /^[a-z][a-z0-9-]{0,63}$/.test(clean) ? [clean] : [];
    }).slice(0, 16)
    : undefined;
  const normalizeControls = (controls: unknown): ChatResponseMetadata["requestedControls"] => {
    const clean = cleanModelControlValues(controls);
    const safe = Object.fromEntries(
      Object.entries(clean).filter(([, control]) => /^[A-Za-z0-9._-]{1,80}$/.test(control)),
    ) as ChatResponseMetadata["requestedControls"];
    return safe && Object.keys(safe).length ? safe : undefined;
  };
  const openclawAgentId = cleanMetadataToken(value.openclawAgentId, 160);
  const openclawAgentSource = OPENCLAW_AGENT_SOURCES.has(String(value.openclawAgentSource))
    ? value.openclawAgentSource as ChatResponseMetadata["openclawAgentSource"]
    : undefined;
  const caveSessionId = cleanMetadataToken(value.caveSessionId, 160);
  const gatewaySessionId = cleanMetadataToken(value.gatewaySessionId, 160);
  const sessionKey = cleanMetadataToken(value.sessionKey, 256);

  return {
    familiarId,
    harness,
    model,
    runtime,
    ...(requestedModel !== undefined ? { requestedModel } : {}),
    ...(desiredModel !== undefined ? { desiredModel } : {}),
    ...(forwardedModel !== undefined ? { forwardedModel } : {}),
    ...(confirmedModel !== undefined ? { confirmedModel } : {}),
    ...(retryModel !== undefined ? { retryModel } : {}),
    ...(modelSource ? { modelSource } : {}),
    ...(modelApplicationState ? { modelApplicationState } : {}),
    ...(modelApplicationReason ? { modelApplicationReason } : {}),
    ...(normalizeControls(value.requestedControls) ? { requestedControls: normalizeControls(value.requestedControls) } : {}),
    ...(normalizeControls(value.forwardedControls) ? { forwardedControls: normalizeControls(value.forwardedControls) } : {}),
    ...(normalizeControls(value.promptGuidanceControls) ? { promptGuidanceControls: normalizeControls(value.promptGuidanceControls) } : {}),
    ...(normalizeControls(value.appliedControls) ? { appliedControls: normalizeControls(value.appliedControls) } : {}),
    ...(rejectedControlFamilies?.length ? { rejectedControlFamilies } : {}),
    ...(openclawAgentId ? { openclawAgentId } : {}),
    ...(openclawAgentSource ? { openclawAgentSource } : {}),
    ...(caveSessionId ? { caveSessionId } : {}),
    ...(gatewaySessionId ? { gatewaySessionId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
  };
}

function sanitizeConversationMetadata(conversation: ConversationFile): ConversationFile {
  const modelIntent = conversation.modelIntent;
  const safeModelIntent = modelIntent && modelIntent.source === "session"
    ? (() => {
        const model = cleanMetadataModel(modelIntent.model, true);
        if (model === undefined) return undefined;
        const applicationState = MODEL_METADATA_STATES.has(String(modelIntent.applicationState))
          ? modelIntent.applicationState
          : undefined;
        const reason = MODEL_APPLICATION_REASONS.has(String(modelIntent.reason))
          ? modelIntent.reason
          : undefined;
        return {
          model,
          source: "session" as const,
          ...(applicationState ? { applicationState } : {}),
          ...(reason ? { reason } : {}),
        };
      })()
    : undefined;
  return {
    ...conversation,
    ...(safeModelIntent ? { modelIntent: safeModelIntent } : { modelIntent: undefined }),
    turns: conversation.turns.map((turn) => {
      const responseMetadata = turn.role === "user"
        ? undefined
        : normalizeResponseMetadata(turn.responseMetadata);
      return {
        ...turn,
        ...(responseMetadata ? { responseMetadata } : { responseMetadata: undefined }),
      };
    }),
  };
}

async function readBody(req: Request): Promise<ConversationWriteBody | null> {
  try {
    return (await req.json()) as ConversationWriteBody;
  } catch {
    return null;
  }
}

function normalizeTurn(input: unknown): ChatTurn | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Partial<ChatTurn>;
  if (value.role !== "user" && value.role !== "assistant" && value.role !== "system") {
    return null;
  }
  if (typeof value.text !== "string") return null;
  const now = new Date().toISOString();
  const usage = normalizeTurnUsage(value.usage);
  const costUsd = parseCostUsd(value.costUsd);
  const reasoningEffort =
    value.reasoningEffort === "low"
    || value.reasoningEffort === "medium"
    || value.reasoningEffort === "high"
      ? value.reasoningEffort
      : undefined;
  const responseSpeed =
    value.responseSpeed === "fast"
    || value.responseSpeed === "balanced"
    || value.responseSpeed === "careful"
      ? value.responseSpeed
      : undefined;
  const modelOverride = cleanModelId(value.modelOverride);
  const modelOverrideScope =
    value.modelOverrideScope === "runtime-default"
      ? "runtime-default" as const
      : undefined;
  const modelControls = cleanModelControlValues(value.modelControls);
  // Response metadata is harness-owned. User turns may carry retry intent,
  // but a client must not be able to persist a forged provider/runtime fact
  // that later renders as an effective response in the transcript.
  const responseMetadata = value.role === "user"
    ? undefined
    : normalizeResponseMetadata(value.responseMetadata);
  const progress = Array.isArray(value.progress)
    ? value.progress.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as NonNullable<ChatTurn["progress"]>[number];
      if (
        typeof item.id !== "string"
        || typeof item.label !== "string"
        || typeof item.createdAt !== "string"
        || (item.status !== "running" && item.status !== "done" && item.status !== "error")
      ) return [];
      return [{
        id: item.id,
        label: item.label,
        ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
        status: item.status,
        createdAt: item.createdAt,
        ...(typeof item.durationMs === "number" && Number.isFinite(item.durationMs) ? { durationMs: item.durationMs } : {}),
      }];
    })
    : undefined;
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : crypto.randomUUID(),
    role: value.role,
    text: value.text,
    ...(Array.isArray(value.attachments) ? { attachments: value.attachments } : {}),
    ...(typeof value.reasoning === "string" ? { reasoning: value.reasoning } : {}),
    ...(Array.isArray(value.tools) ? { tools: value.tools } : {}),
    ...(progress?.length ? { progress } : {}),
    ...(typeof value.parentId === "string" || value.parentId === null
      ? { parentId: value.parentId }
      : {}),
    ...(typeof value.harnessSessionId === "string"
      ? { harnessSessionId: value.harnessSessionId }
      : {}),
    createdAt:
      typeof value.createdAt === "string" && value.createdAt.trim()
        ? value.createdAt
        : now,
    ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(value.role === "user" && reasoningEffort ? { reasoningEffort } : {}),
    ...(value.role === "user" && responseSpeed ? { responseSpeed } : {}),
    ...(value.role === "user" && modelOverride && !modelOverrideScope
      ? { modelOverride }
      : {}),
    ...(value.role === "user" && modelOverrideScope ? { modelOverrideScope } : {}),
    ...(value.role === "user" && Object.keys(modelControls).length ? { modelControls } : {}),
    ...(responseMetadata ? { responseMetadata } : {}),
  };
}

function normalizeTurns(body: ConversationWriteBody): ChatTurn[] | null {
  const rawTurns = Array.isArray(body.turns)
    ? body.turns
    : body.turn !== undefined
      ? [body.turn]
      : null;
  if (!rawTurns) return null;
  const turns = rawTurns.map(normalizeTurn);
  if (turns.some((turn) => !turn)) return null;
  return turns as ChatTurn[];
}

function conversationTitle(id: string, body: ConversationWriteBody, existing: ConversationFile | null): string {
  if (typeof body.title === "string") return body.title;
  if (existing?.title) return existing.title;
  return defaultChatTitleForSession(id);
}

function buildConversation(args: {
  id: string;
  body: ConversationWriteBody;
  existing: ConversationFile | null;
  turns: ChatTurn[];
}): ConversationFile | null {
  const familiarId =
    typeof args.body.familiarId === "string" && args.body.familiarId.trim()
      ? args.body.familiarId.trim()
      : args.existing?.familiarId;
  const harness =
    typeof args.body.harness === "string" && args.body.harness.trim()
      ? args.body.harness.trim()
      : args.existing?.harness;
  if (!familiarId || !harness) return null;
  const now = new Date().toISOString();
  return {
    sessionId: args.id,
    ...(args.existing?.harnessSessionId ? { harnessSessionId: args.existing.harnessSessionId } : {}),
    ...(args.existing?.grokSandboxProfile
      ? { grokSandboxProfile: args.existing.grokSandboxProfile }
      : {}),
    familiarId,
    harness,
    ...(args.existing?.model ? { model: args.existing.model } : {}),
    ...(args.existing?.modelIntent ? { modelIntent: args.existing.modelIntent } : {}),
    ...(args.existing?.runtime ? { runtime: args.existing.runtime } : {}),
    title: conversationTitle(args.id, args.body, args.existing),
    createdAt:
      typeof args.body.createdAt === "string" && args.body.createdAt.trim()
        ? args.body.createdAt
        : args.existing?.createdAt ?? now,
    updatedAt:
      typeof args.body.updatedAt === "string" && args.body.updatedAt.trim()
        ? args.body.updatedAt
        : args.existing?.updatedAt ?? now,
    turns: args.turns,
    ...(typeof args.body.activeLeafId === "string" && args.body.activeLeafId
      ? { activeLeafId: args.body.activeLeafId }
      : args.existing?.activeLeafId
        ? { activeLeafId: args.existing.activeLeafId }
        : {}),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }

  // Primary: cave-conversations JSON (written by chat/send for UI-originated chats)
  const conv = await loadConversation(id);
  if (conv) {
    const context = await linkedContextForSession(id);
    return NextResponse.json({
      ok: true,
      conversation: sanitizeConversationMetadata(conv),
      context,
    });
  }

  // Fallback: read the openclaw .jsonl transcript for sessions that were started
  // outside CovenCave (via CLI, OpenClaw channel, or another harness).
  // We need the familiarId to know which agent folder to look in.
  const state = await loadState();
  const familiarId = state.sessionFamiliar[id];
  if (familiarId) {
    const jsonlConv = await loadConversationFromJsonl(id, familiarId);
    if (jsonlConv) {
      const context = await linkedContextForSession(id);
      return NextResponse.json({
        ok: true,
        conversation: sanitizeConversationMetadata(jsonlConv),
        context,
      });
    }
  }

  // No transcript yet — but if a board card claims this session, surface
  // the task affiliation so the chat header can show the Task pill on first open.
  const context = await linkedContextForSession(id);
  if (context) {
    return NextResponse.json({ ok: true, conversation: null, context });
  }

  return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }
  const body = await readBody(req);
  if (!body) return jsonError("invalid json body", 400);
  if (body.sessionId && body.sessionId !== id) {
    return jsonError("session id mismatch", 400);
  }
  const turns = normalizeTurns(body);
  if (!turns || turns.length === 0) {
    return jsonError("turn or turns required", 400);
  }
  // Client writers cannot forge harness telemetry onto assistant/system turns.
  const safeTurns = sanitizeClientTurns(turns);
  const existingRaw = await loadConversation(id);
  const existing = existingRaw ? sanitizeConversationMetadata(existingRaw) : null;
  const merged = [...(existing?.turns ?? []), ...safeTurns];
  const bounds = checkTurnBounds(merged);
  if (bounds) return jsonError(bounds.error, bounds.status);
  const conversation = buildConversation({
    id,
    body,
    existing,
    turns: merged,
  });
  if (!conversation) {
    return jsonError("familiarId and harness are required for new history", 400);
  }
  await saveConversation(conversation);
  await recordSessionFamiliar(id, conversation.familiarId);
  return NextResponse.json({ ok: true, conversation });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }
  const body = await readBody(req);
  if (!body) return jsonError("invalid json body", 400);
  if (body.sessionId && body.sessionId !== id) {
    return jsonError("session id mismatch", 400);
  }
  const turns = normalizeTurns(body);
  if (!turns) return jsonError("turns required", 400);
  // Client writers cannot forge harness telemetry onto assistant/system turns.
  const safeTurns = sanitizeClientTurns(turns);
  const bounds = checkTurnBounds(safeTurns);
  if (bounds) return jsonError(bounds.error, bounds.status);
  const existingRaw = await loadConversation(id);
  const existing = existingRaw ? sanitizeConversationMetadata(existingRaw) : null;
  const conversation = buildConversation({ id, body, existing, turns: safeTurns });
  if (!conversation) {
    return jsonError("familiarId and harness are required", 400);
  }
  await saveConversation(conversation);
  await recordSessionFamiliar(id, conversation.familiarId);
  return NextResponse.json({ ok: true, conversation });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }

  let body: ConversationPatchBody;
  try {
    body = (await req.json()) as ConversationPatchBody;
  } catch {
    return jsonError("invalid json body", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("invalid json body", 400);
  }

  return withConversationLock(id, async () => {
    const existingRaw = await loadConversation(id);
    const existing = existingRaw ? sanitizeConversationMetadata(existingRaw) : null;
    if (!existing) return jsonError("not found", 404);

    if (typeof body.activeLeafId === "string" && body.activeLeafId) {
      // Reject a leaf that isn't an actual turn — persisting a bogus id would make
      // resolveActivePath silently fall back to showing every turn unfiltered.
      if (!existing.turns.some((turn) => turn.id === body.activeLeafId)) {
        return jsonError("unknown activeLeafId", 400);
      }
      existing.activeLeafId = body.activeLeafId;
      await saveConversation(existing);
      return NextResponse.json({ ok: true, conversation: existing });
    }

    if (body.modelIntent === null) {
      delete existing.modelIntent;
      await saveConversation(existing);
      return NextResponse.json({ ok: true, conversation: existing });
    }

    if (body.modelIntent !== undefined) {
      if (!body.modelIntent || typeof body.modelIntent !== "object" || Array.isArray(body.modelIntent)) {
        return jsonError("invalid model intent", 400);
      }
      const model = cleanModelId(body.modelIntent.model);
      if (!model) return jsonError("invalid model", 400);
      if (body.modelIntent.source !== "session") {
        return jsonError("model intent source must be session", 400);
      }
      const reason = MODEL_APPLICATION_REASONS.has(String(body.modelIntent.reason))
        ? body.modelIntent.reason as string
        : "Saved for this chat.";
      existing.modelIntent = {
        model,
        source: "session",
        applicationState: "saved",
        reason,
      };
      await saveConversation(existing);
      return NextResponse.json({ ok: true, conversation: existing });
    }

    return jsonError("nothing to patch", 400);
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }

  // Voice new-chat discard (?ifEmpty=1): the caller only wants to clean up a
  // conversation that never got a turn — never sacrifice here. Sacrificing
  // would permanently hide the session from every list if an in-flight first
  // exchange (chat/send survives transport aborts) recreates the file right
  // after this delete lands; skipping it means a recreated file simply
  // resurfaces in the rail (correct — the data is real), and a truly-empty
  // delete leaves nothing to hide since local session rows derive from the
  // conversation files themselves.
  if (new URL(req.url).searchParams.get("ifEmpty") === "1") {
    const existing = await loadConversation(id);
    if (!existing || existing.turns.length > 0) {
      return NextResponse.json({ ok: true, deleted: false });
    }
    const deleted = await deleteConversation(id);
    return NextResponse.json({ ok: true, deleted });
  }

  // Default: an explicit user-initiated delete. Sacrifice keeps a
  // recreated-later file (e.g. a stale client retrying) from resurrecting a
  // session the user deliberately removed — other callers depend on this.
  const deleted = await deleteConversation(id);
  const sacrificedAt = await sacrificeSessionLocal(id);
  const unlinkedCards = await unlinkSessionFromCards(id);
  return NextResponse.json({ ok: true, deleted, sacrificedAt, unlinkedCards });
}
