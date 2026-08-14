import { NextResponse } from "next/server";
import { bindingFor, loadConfig, saveConfig } from "@/lib/cave-config";
import {
  isSafeConversationSessionId,
  loadConversation,
  saveConversation,
  withConversationLock,
} from "@/lib/cave-conversations";
import { cleanModelId, resolveChatModelState } from "@/lib/chat-model-state";
import {
  canonicalHarnessId,
  resolveTrustedConversationHarness,
} from "@/lib/harness-adapters";
import { rejectNonLocalRequest } from "@/lib/server/api-security";
import { listRuntimeModelInventory } from "@/lib/server/runtime-model-options";
import { modelControlCapabilities } from "@/lib/model-control-capabilities";
import { isModelAllowedByRuntime } from "@/lib/runtime-models";
import { harnessSpawnEnv } from "@/lib/harness-spawn-env";
import { hermesApiConfig } from "@/lib/hermes-responses-stream";
import { isSshRuntime } from "@/lib/familiar-runtime";
import {
  isValidFamiliarId,
  resolveAuthoritativeFamiliarId,
} from "@/lib/server/familiar-id";

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

function untrustedChatHarnessError() {
  return NextResponse.json(
    {
      ok: false,
      code: "untrusted_chat_harness",
      error: "This familiar is not available for native Cave chat.",
    },
    { status: 403 },
  );
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function exactFamiliarId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
  const [config, conversation] = await Promise.all([
    loadConfig(),
    sessionId ? loadConversation(sessionId) : null,
  ]);
  if (conversation && conversation.familiarId !== familiarId) {
    return { ok: false as const, reason: "not-found" as const };
  }
  const familiarResolution = await resolveAuthoritativeFamiliarId(config, familiarId);
  if (!familiarResolution.ok) {
    return { ok: false as const, reason: "untrusted-familiar" as const };
  }
  const canonicalFamiliarId = familiarResolution.familiarId;
  const binding = bindingFor(config, canonicalFamiliarId);
  const harnessResolution = resolveTrustedConversationHarness(
    binding.harness,
    conversation?.harness,
  );
  if (!harnessResolution.ok) {
    return { ok: false as const, reason: "untrusted-harness" as const };
  }
  return {
    ok: true as const,
    binding,
    familiarId: canonicalFamiliarId,
    state: resolveChatModelState({
      familiarId: canonicalFamiliarId,
      // Match chat/send's dual-trust contract: persisted provenance may retain
      // a trusted conversation runtime, but it cannot bypass an untrusted
      // current binding or revive an untrusted legacy harness.
      harness: harnessResolution.harness,
      runtime: conversation?.runtime ?? runtimeForBinding(binding),
      globalDefaultModel: config.defaults.model,
      familiarModel: config.familiars[canonicalFamiliarId]?.model ?? null,
      sessionModel: conversation?.modelIntent?.model,
      nextMessageModel,
      lastResponseModel: lastResponseModel(conversation),
    }),
  };
}

type ModelStateGetDependencies = {
  listRuntimeModelInventory: typeof listRuntimeModelInventory;
};

const DEFAULT_GET_DEPENDENCIES: ModelStateGetDependencies = {
  listRuntimeModelInventory,
};

export async function handleModelStateGet(
  req: Request,
  dependencies: ModelStateGetDependencies = DEFAULT_GET_DEPENDENCIES,
) {
  const url = new URL(req.url);
  const familiarId = exactFamiliarId(url.searchParams.get("familiarId"));
  const sessionId = cleanText(url.searchParams.get("sessionId"));
  const rawPreviewModel = url.searchParams.get("model");
  // A model preview is intentionally read-only. Clients use it after staging
  // a pre-first-send selection so the response controls are resolved for that
  // pending model rather than for the familiar/session model that was visible
  // before the selection.
  const previewModel = rawPreviewModel === null
    ? undefined
    : rawPreviewModel === ""
      ? ""
      : cleanModelId(rawPreviewModel);
  if (!familiarId) return jsonError("familiarId is required", 400);
  if (!isValidFamiliarId(familiarId)) return jsonError("invalid familiar id", 400);
  if (sessionId && !isSafeConversationSessionId(sessionId)) {
    return jsonError("invalid session id", 400);
  }
  if (rawPreviewModel !== null && previewModel === null) {
    return jsonError("invalid model", 400);
  }

  const current = await currentState(familiarId, sessionId, previewModel);
  if (!current.ok) {
    return current.reason === "not-found"
      ? jsonError("not found", 404)
      : untrustedChatHarnessError();
  }
  const { binding, familiarId: canonicalFamiliarId, state } = current;
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
  const inventory = await dependencies.listRuntimeModelInventory(
    state.harness,
    canonicalFamiliarId,
    {
      allowOpenCodeInventory: canReadOpenCodeInventory,
      allowHermesInventory: canReadHermesInventory,
    },
  );
  // Native Hermes controls are available only through its configured Responses
  // API transport. Keep the state response aligned with the send boundary so
  // a client never renders a provider setting that would be rejected later.
  const hermesEnvironment = bareLocalHermes ? harnessSpawnEnv(canonicalFamiliarId) : null;
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

export async function GET(req: Request) {
  return handleModelStateGet(req);
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

  const familiarId = exactFamiliarId(body.familiarId);
  const sessionId = cleanText(body.sessionId);
  // Both null (older clients) and the empty string (new clients that need to
  // preserve the sentinel through JSON/config merges) mean explicit runtime
  // default intent. Whitespace is still rejected as an invalid model id.
  const clearModel = body.model === null || body.model === "";
  const model = clearModel ? null : cleanModelId(body.model);
  const scope = body.scope;

  if (!familiarId) return jsonError("familiarId is required", 400);
  if (!isValidFamiliarId(familiarId)) return jsonError("invalid familiar id", 400);
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

  const [config, sessionConversation] = await Promise.all([
    loadConfig(),
    sessionId ? loadConversation(sessionId) : null,
  ]);
  if (sessionConversation && sessionConversation.familiarId !== familiarId) {
    return jsonError("not found", 404);
  }
  if (scope === "session" && sessionId && !sessionConversation) {
    return jsonError("not found", 404);
  }
  const familiarResolution = await resolveAuthoritativeFamiliarId(config, familiarId);
  if (!familiarResolution.ok) return untrustedChatHarnessError();
  const canonicalFamiliarId = familiarResolution.familiarId;
  const binding = bindingFor(config, canonicalFamiliarId);
  const harnessResolution = resolveTrustedConversationHarness(
    binding.harness,
    sessionConversation?.harness,
  );
  if (!harnessResolution.ok) return untrustedChatHarnessError();
  const modelValidationHarness = scope === "session"
    ? harnessResolution.harness
    : canonicalHarnessId(binding.harness);
  if (model && !isModelAllowedByRuntime(modelValidationHarness, model)) {
    return jsonError("model is not allowed by this runtime", 400);
  }

  if (scope === "familiar-default") {
    await saveConfig({
      familiars: {
        [canonicalFamiliarId]: {
          ...(config.familiars[canonicalFamiliarId] ?? {}),
          // Empty model is a durable Runtime-default intent. A null patch
          // remains accepted for old clients, but must not erase the intent
          // and expose a stale familiar/global fallback on the next send.
          model: clearModel ? "" : model,
        },
      },
    });
    const current = await currentState(canonicalFamiliarId, sessionId);
    if (!current.ok) {
      return current.reason === "not-found"
        ? jsonError("not found", 404)
        : untrustedChatHarnessError();
    }
    return NextResponse.json({ ok: true, state: current.state });
  }

  if (!sessionId) return jsonError("sessionId is required for session scope", 400);
  const updated = await withConversationLock(sessionId, async () => {
    const conversation = await loadConversation(sessionId);
    if (!conversation || conversation.familiarId !== canonicalFamiliarId) return false;
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
  const current = await currentState(canonicalFamiliarId, sessionId);
  if (!current.ok) {
    return current.reason === "not-found"
      ? jsonError("not found", 404)
      : untrustedChatHarnessError();
  }
  return NextResponse.json({ ok: true, state: current.state });
}
