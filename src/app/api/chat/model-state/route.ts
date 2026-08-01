import { NextResponse } from "next/server";
import { bindingFor, loadConfig, saveConfig } from "@/lib/cave-config";
import {
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
  withConversationLock,
} from "@/lib/cave-conversations";
import { cleanModelId, resolveChatModelState } from "@/lib/chat-model-state";
import { canonicalHarnessId } from "@/lib/harness-adapters";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";
import { modelControlCapabilities } from "@/lib/model-control-capabilities";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { hermesApiConfig } from "@/lib/hermes-responses-stream";
import { isSshRuntime } from "@/lib/familiar-runtime";

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

function modelBindingScope(
  binding: ReturnType<typeof bindingFor>,
  runtime: string | null,
): string {
  const harness = canonicalHarnessId(binding.harness);
  const hermesScope = harness === "hermes"
    ? binding.hasInvalidHermesProfileBinding
      ? "invalid-profile"
      : binding.hermesProfile
        ? `profile:${binding.hermesProfile.id}`
        : "bare"
    : "default";
  // This is a non-secret presentation identity: it intentionally excludes
  // credentials and profile home paths while still changing across local,
  // SSH, and Hermes profile bindings.
  return JSON.stringify([
    harness,
    runtimeForBinding(binding),
    runtime,
    hermesScope,
  ]);
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
    harness: canonicalHarnessId(binding.harness),
    runtime: conversation?.runtime ?? runtimeForBinding(binding),
    globalDefaultModel: config.defaults.model,
    familiarModel: config.familiars[familiarId]?.model ?? null,
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
  if (sessionId && !isSafeConversationSessionId(sessionId)) {
    return jsonError("invalid session id", 400);
  }

  const state = await currentState(familiarId, sessionId);
  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  // Also hand back the pickable model menu for this chat's runtime so non-web
  // clients (the iOS app) don't have to mirror runtime capability rules.
  // `allowCustom` means a free-typed id is valid.
  // OpenCode and bare Hermes inventories are derived from local authenticated
  // providers. Keep those discovery calls local-only without denying this
  // aggregate state endpoint to iOS, which still needs the selected model and
  // may free-type a model id.
  const localInventoryRequest = rejectNonLocalRequest(req) === null;
  const canReadOpenCodeInventory =
    state.harness === "opencode" && localInventoryRequest;
  const bareLocalHermes =
    state.harness === "hermes" &&
    canonicalHarnessId(binding.harness) === "hermes" &&
    !binding.hermesProfile &&
    !binding.hasInvalidHermesProfileBinding &&
    !isSshRuntime(binding.runtime) &&
    !state.runtime?.startsWith("ssh:");
  const canReadHermesInventory = bareLocalHermes && localInventoryRequest;
  const inventory = await listRuntimeModelInventory(
    state.harness,
    familiarId,
    {
      allowOpenCodeInventory: canReadOpenCodeInventory,
      allowHermesInventory: canReadHermesInventory,
    },
  );
  // Native Hermes controls are available only through its configured Responses
  // API transport. Keep the state response aligned with the send boundary so
  // a client never renders a provider setting that would be rejected later.
  const hermesEnvironment = bareLocalHermes ? harnessSpawnEnv(familiarId) : null;
  const hermesApi = hermesEnvironment
    ? hermesApiConfig({
        HERMES_API_URL: hermesEnvironment.HERMES_API_URL,
        HERMES_API_KEY: hermesEnvironment.HERMES_API_KEY,
      })
    : null;
  const hermesDirect = bareLocalHermes;
  const controls = modelControlCapabilities(state.harness, state.effectiveModel)
    .filter((capability) => capability.delivery !== "native-provider" || (hermesDirect && hermesApi !== null));
  return NextResponse.json({
    ok: true,
    state,
    bindingScope: modelBindingScope(binding, state.runtime),
    controls,
    options: inventory.models,
    inventory,
    allowCustom: inventory.allowCustom,
  });
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
  const clearModel = body.model === null;
  const model = clearModel ? null : cleanModelId(body.model);
  const scope = body.scope;

  if (!familiarId) return jsonError("familiarId is required", 400);
  if (sessionId && !isSafeConversationSessionId(sessionId)) {
    return jsonError("invalid session id", 400);
  }
  if (!clearModel && !model) return jsonError("invalid model", 400);
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
  const updated = await withConversationLock(sessionId, async () => {
    const conversation = await loadConversation(sessionId);
    if (!conversation || conversation.familiarId !== familiarId) return false;
    if (clearModel) {
      // Keep an explicit empty session intent. Deleting it would immediately
      // re-expose a familiar/global model and makes clear → send race-prone.
      conversation.modelIntent = {
        model: "",
        source: "session",
        applicationState: "saved",
        reason: "Using the runtime's configured default model.",
      };
    } else if (model) {
      conversation.modelIntent = {
        model,
        source: "session",
        applicationState: "saved",
        reason: "Saved for this chat.",
      };
    }
    await saveConversation(conversation);
    return true;
  });
  if (!updated) return jsonError("not found", 404);
  const state = await currentState(familiarId, sessionId);
  return NextResponse.json({ ok: true, state });
}
