import { NextResponse } from "next/server";
import { bindingFor, loadConfig, saveConfig } from "@/lib/cave-config";
import { loadConversation, saveConversation } from "@/lib/cave-conversations";
import { cleanModelId, resolveChatModelState } from "@/lib/chat-model-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ModelStatePatchBody = {
  familiarId?: unknown;
  sessionId?: unknown;
  model?: unknown;
  scope?: unknown;
};

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function runtimeForBinding(binding: ReturnType<typeof bindingFor>): string | null {
  if (binding.runtime?.kind === "ssh") {
    return `ssh:${binding.runtime.host}:${binding.runtime.cwd}`;
  }
  if (binding.runtime?.kind === "local") return "local";
  return null;
}

function lastResponseModel(
  conversation: Awaited<ReturnType<typeof loadConversation>>,
): string | null {
  for (const turn of [...(conversation?.turns ?? [])].reverse()) {
    const model = cleanModelId(turn.responseMetadata?.model);
    if (model) return model;
  }
  return null;
}

async function currentState(
  familiarId: string,
  sessionId?: string | null,
  nextMessageModel?: string | null,
) {
  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  const conversation = sessionId ? await loadConversation(sessionId) : null;
  return resolveChatModelState({
    familiarId,
    harness: binding.harness,
    runtime: conversation?.runtime ?? runtimeForBinding(binding),
    globalDefaultModel: config.defaults.model,
    familiarModel: binding.model,
    sessionModel: conversation?.modelIntent?.model,
    nextMessageModel,
    lastResponseModel: lastResponseModel(conversation),
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = cleanText(url.searchParams.get("familiarId"));
  const sessionId = cleanText(url.searchParams.get("sessionId"));
  if (!familiarId) return jsonError("familiarId is required", 400);

  const state = await currentState(familiarId, sessionId);
  return NextResponse.json({ ok: true, state });
}

export async function PATCH(req: Request) {
  let body: ModelStatePatchBody;
  try {
    body = (await req.json()) as ModelStatePatchBody;
  } catch {
    return jsonError("invalid json body", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("invalid json body", 400);
  }

  const familiarId = cleanText(body.familiarId);
  const sessionId = cleanText(body.sessionId);
  const model = cleanModelId(body.model);
  const scope = body.scope;

  if (!familiarId) return jsonError("familiarId is required", 400);
  if (!model) return jsonError("invalid model", 400);
  if (scope === "next-message") {
    return jsonError("next-message scope is composer-local", 400);
  }
  if (scope !== "familiar-default" && scope !== "session") {
    return jsonError("unsupported scope", 400);
  }

  if (scope === "familiar-default") {
    const config = await loadConfig();
    await saveConfig({
      familiars: {
        [familiarId]: {
          ...(config.familiars[familiarId] ?? {}),
          model,
        },
      },
    });
    const state = await currentState(familiarId, sessionId);
    return NextResponse.json({ ok: true, state });
  }

  if (!sessionId) return jsonError("sessionId is required for session scope", 400);
  const conversation = await loadConversation(sessionId);
  if (!conversation) return jsonError("not found", 404);
  conversation.modelIntent = {
    model,
    source: "session",
    applicationState: "saved",
    reason: "Saved for this chat.",
  };
  await saveConversation(conversation);
  const state = await currentState(familiarId, sessionId);
  return NextResponse.json({ ok: true, state });
}
