import { NextResponse } from "next/server";
import { cleanModelId } from "@/lib/chat-model-state";
import {
  isSafeConversationSessionId,
  deleteConversation,
  loadConversation,
  saveConversation,
  type ChatTurn,
  type ConversationFile,
} from "@/lib/cave-conversations";
import { linkedContextForSession } from "@/lib/chat-linked-context";
import { loadConversationFromJsonl } from "@/lib/openclaw-conversation";
import { loadState, recordSessionFamiliar, sacrificeSessionLocal } from "@/lib/cave-config";
import { defaultChatTitleForSession } from "@/lib/cave-chat-titles";
import { normalizeTurnUsage, parseCostUsd } from "@/lib/usage-format";

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
};

type ConversationPatchBody = {
  modelIntent?: {
    model?: unknown;
    source?: unknown;
    applicationState?: unknown;
    reason?: unknown;
  } | null;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
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
  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : crypto.randomUUID(),
    role: value.role,
    text: value.text,
    ...(Array.isArray(value.attachments) ? { attachments: value.attachments } : {}),
    ...(typeof value.reasoning === "string" ? { reasoning: value.reasoning } : {}),
    ...(Array.isArray(value.tools) ? { tools: value.tools } : {}),
    createdAt:
      typeof value.createdAt === "string" && value.createdAt.trim()
        ? value.createdAt
        : now,
    ...(typeof value.durationMs === "number" ? { durationMs: value.durationMs } : {}),
    ...(typeof value.isError === "boolean" ? { isError: value.isError } : {}),
    ...(typeof value.cancelled === "boolean" ? { cancelled: value.cancelled } : {}),
    ...(usage ? { usage } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
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
    familiarId,
    harness,
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
    return NextResponse.json({ ok: true, conversation: conv, context });
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
      return NextResponse.json({ ok: true, conversation: jsonlConv, context });
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
  const existing = await loadConversation(id);
  const conversation = buildConversation({
    id,
    body,
    existing,
    turns: [...(existing?.turns ?? []), ...turns],
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
  const existing = await loadConversation(id);
  const conversation = buildConversation({ id, body, existing, turns });
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

  const existing = await loadConversation(id);
  if (!existing) return jsonError("not found", 404);

  if (body.modelIntent === null) {
    delete existing.modelIntent;
    await saveConversation(existing);
    return NextResponse.json({ ok: true, conversation: existing });
  }

  if (body.modelIntent !== undefined) {
    const model = cleanModelId(body.modelIntent.model);
    if (!model) return jsonError("invalid model", 400);
    if (body.modelIntent.source !== "session") {
      return jsonError("model intent source must be session", 400);
    }
    const reason =
      typeof body.modelIntent.reason === "string" && body.modelIntent.reason.trim()
        ? body.modelIntent.reason.trim()
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
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }
  const deleted = await deleteConversation(id);
  const sacrificedAt = await sacrificeSessionLocal(id);
  return NextResponse.json({ ok: true, deleted, sacrificedAt });
}
