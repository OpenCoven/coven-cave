import { NextResponse } from "next/server";
import { bindingFor, loadConfig } from "@/lib/cave-config";
import {
  AgenticRecommendationParseError,
  parseAgenticRecommendationsOutput,
} from "@/lib/agentic-recommendations";
import {
  recordAgenticDiagnostic,
  type AgenticDiagnosticInput,
  type AgenticDiagnosticSink,
} from "@/lib/agentic-diagnostics";
import {
  boardAgenticProposalRecord,
  buildBoardAgenticContext,
  validateBoardAgenticRecommendation,
} from "@/lib/board-agentic-enhance";
import {
  applyBoardAgenticProposal,
  autoApplyBoardAgenticProposalBatch,
  BoardAgenticProposalMutationError,
  dismissBoardAgenticProposal,
  loadBoard,
  OrchestrationValidationError,
  revertBoardAgenticProposal,
} from "@/lib/cave-board";
import { canonicalHarnessId, isTrustedChatHarness } from "@/lib/harness-adapters";
import { resolveFamiliarWorkspace, runCovenOneShot } from "@/lib/server/coven-oneshot";
import { extractRewrite } from "@/lib/reader-rewrite";
import { containsSecretText } from "@/lib/secret-redaction";
import { cleanModelId } from "@/lib/chat-model-state";
import { isModelAllowedByRuntime, runtimeModelIdForLaunch } from "@/lib/runtime-models";
import { covenRunSupportsModel } from "@/app/api/chat/send/chat-send-capabilities";

export const dynamic = "force-dynamic";

const ENHANCE_INTENT = "board-agentic-enhance";

type EnhanceBody = {
  intent?: unknown;
  action?: unknown;
  output?: unknown;
  proposalId?: unknown;
  contextFingerprint?: unknown;
  actor?: unknown;
  patch?: unknown;
  automatic?: unknown;
  familiarId?: unknown;
  model?: unknown;
};

function inputError(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function actorFrom(body: EnhanceBody): string | undefined {
  return typeof body.actor === "string" ? body.actor : undefined;
}

function mutationError(error: unknown): NextResponse | null {
  if (error instanceof OrchestrationValidationError) {
    return NextResponse.json(
      { ok: false, error: "orchestration_invalid", errors: error.errors },
      { status: 422 },
    );
  }
  if (error instanceof BoardAgenticProposalMutationError) {
    if (error.code === "cancelled") return cancelled();
    if (error.code === "orchestration_invalid") {
      return NextResponse.json(
        { ok: false, error: error.code, errors: error.errors },
        { status: 422 },
      );
    }
    if (error.code === "proposal_not_found") {
      return NextResponse.json({ ok: false, error: error.code }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: error.code },
      { status: error.code === "invalid_patch" ? 400 : 409 },
    );
  }
  return null;
}

async function readBody(
  req: Request,
): Promise<{ body: EnhanceBody | null; invalidJson: boolean }> {
  try {
    const body: unknown = await req.json();
    return {
      body: body != null && typeof body === "object" && !Array.isArray(body)
        ? body as EnhanceBody
        : null,
      invalidJson: false,
    };
  } catch {
    return { body: null, invalidJson: true };
  }
}

const SAFE_FAMILIAR_ID = /^[a-z0-9_-]+$/i;
const MAX_PROMPT_TEXT_CHARS = 160;
const MAX_PROMPT_CONTEXT_BYTES = 16 * 1024;

export type BoardEnhanceRouteDeps = {
  loadBoard: typeof loadBoard;
  loadConfig: typeof loadConfig;
  bindingFor: typeof bindingFor;
  isTrustedHarness: typeof isTrustedChatHarness;
  resolveWorkspace: typeof resolveFamiliarWorkspace;
  runFamiliar: typeof runCovenOneShot;
  supportsModel: typeof covenRunSupportsModel;
  diagnostics?: AgenticDiagnosticSink;
};

const productionDeps: BoardEnhanceRouteDeps = {
  loadBoard,
  loadConfig,
  bindingFor,
  isTrustedHarness: isTrustedChatHarness,
  resolveWorkspace: resolveFamiliarWorkspace,
  runFamiliar: runCovenOneShot,
  supportsModel: covenRunSupportsModel,
};

function recordBoardDiagnostic(
  diagnostics: AgenticDiagnosticSink | undefined,
  input: Omit<AgenticDiagnosticInput, "surface">,
): void {
  const event = recordAgenticDiagnostic({ surface: "board", ...input });
  try {
    diagnostics?.(event);
  } catch {
    // Observability cannot alter an Enhance response.
  }
}

function cancelled(diagnostics?: AgenticDiagnosticSink) {
  recordBoardDiagnostic(diagnostics, { code: "cancelled" });
  return NextResponse.json({ ok: false, error: "request cancelled" }, { status: 499 });
}

function recordBoardMutationDiagnostic(
  diagnostics: AgenticDiagnosticSink | undefined,
  error: unknown,
  action: "apply" | "revert" | "auto-apply" | "dismiss",
): void {
  if (error instanceof BoardAgenticProposalMutationError) {
    if (error.code === "cancelled") {
      recordBoardDiagnostic(diagnostics, { code: "cancelled" });
      return;
    }
    if (error.code === "stale_context") {
      recordBoardDiagnostic(diagnostics, { code: "stale_discarded" });
      return;
    }
    if (error.code === "orchestration_invalid" || error.code === "untrusted_automatic") {
      recordBoardDiagnostic(diagnostics, {
        code: "verification_blocked",
        counts: { verificationChecks: error.errors.length },
      });
      return;
    }
  }
  if (action === "apply" || action === "revert" || action === "auto-apply") {
    recordBoardDiagnostic(diagnostics, { code: "apply_failed" });
  }
}

function boardEnhancePrompt(
  context: ReturnType<typeof buildBoardAgenticContext>,
  retry: boolean,
): string {
  return [
    "You are generating governed Board Enhance recommendations.",
    "Return only a strict <recommendations> JSON envelope. Do not write prose outside it.",
    "Every recommendation must have surface \"board\", the exact contextFingerprint below,",
    "and evidenceRefs that name only task/dependency/GitHub ids from the trusted context.",
    "Return exactly this envelope: {\"recommendations\":[RECOMMENDATION]}.",
    "RECOMMENDATION exact required keys: id, surface, kind, payload, rationale, inferredGoal, rankReasons, evidenceRefs, contextFingerprint.",
    "Allowed surfaces: board. Allowed kinds: canonicalize-reference, deduplicate-reference, identifier-normalization, recompute-readonly-projection, prose, dependency, topic, action.",
    "Each evidenceRef exact keys are id, kind, label. Allowed evidence kinds: task, dependency, github, mission, saved-link, vault, message, artifact.",
    "Example: {\"recommendations\":[{\"id\":\"proposal-1\",\"surface\":\"board\",\"kind\":\"prose\",\"payload\":{\"cardId\":\"TASK_ID\",\"patch\":{\"notes\":\"Clarify the acceptance condition.\"}},\"rationale\":\"The task needs a concrete outcome.\",\"inferredGoal\":\"Make completion verifiable.\",\"rankReasons\":[\"It resolves an explicit gap.\"],\"evidenceRefs\":[{\"id\":\"task:TASK_ID\",\"kind\":\"task\",\"label\":\"Task\"}],\"contextFingerprint\":\"EXACT_FINGERPRINT\"}]}.",
    "For model-authored changes, use payload {\"cardId\":\"...\",\"patch\":{...}}.",
    "Do not propose status, lifecycle, execution, or needs-human fields.",
    "A canonicalize-reference recommendation must name an exact GitHub reference and is the only",
    "deterministic normalization kind. All prose, dependency, and next-step changes remain review proposals.",
    `Context fingerprint: ${context.fingerprint}`,
    `Trusted Board context: ${serializedPromptContext(context)}`,
    retry
      ? "Your previous response was malformed. Return the strict envelope now."
      : "Produce a small, evidence-grounded recommendation set now.",
  ].join("\n");
}

function safePromptText(value: unknown, maximum = MAX_PROMPT_TEXT_CHARS): string {
  if (typeof value !== "string") return "";
  if (containsSecretText(value)) return "[redacted]";
  return value.slice(0, maximum);
}

function sanitizePromptValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return safePromptText(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (depth >= 8) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 64).map((entry) => sanitizePromptValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 64)
        .map(([key, entry]) => [safePromptText(key, 64), sanitizePromptValue(entry, depth + 1)]),
    );
  }
  return "";
}

function serializedPromptContext(context: ReturnType<typeof buildBoardAgenticContext>): string {
  const sanitized = sanitizePromptValue(context.snapshot);
  const serialized = JSON.stringify(sanitized);
  if (new TextEncoder().encode(serialized).length <= MAX_PROMPT_CONTEXT_BYTES) return serialized;
  return JSON.stringify({
    cardId: safePromptText(context.context.cardId, 96),
    taskIds: context.context.taskIds.slice(0, 64).map((id) => safePromptText(id, 96)),
    truncated: true,
  });
}

export function createBoardEnhanceRoute(deps: BoardEnhanceRouteDeps) {
  return async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (req.signal.aborted) return cancelled(deps.diagnostics);
  if (req.headers.get("x-coven-cave-intent") !== ENHANCE_INTENT) {
    return NextResponse.json({ ok: false, error: "missing enhance intent" }, { status: 403 });
  }
  const parsedBody = await readBody(req);
  if (parsedBody.invalidJson) return inputError("invalid json body");
  const body = parsedBody.body;
  if (!body || (body.intent !== ENHANCE_INTENT && body.intent !== "generate")) {
    return NextResponse.json({ ok: false, error: "missing enhance intent" }, { status: 403 });
  }
  const action = body.intent === "generate" ? "generate" : body.action;
  if (
    action !== "generate"
    && action !== "apply"
    && action !== "dismiss"
    && action !== "revert"
  ) {
    return inputError("invalid enhance action");
  }

  const { id } = await params;
  const board = await deps.loadBoard();
  let card = board.cards.find((entry) => entry.id === id);
  if (!card) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  if (action === "generate") {
    const requestedFamiliarId = typeof body.familiarId === "string"
      ? body.familiarId.trim()
      : "";
    const familiarId = card.familiarId ?? requestedFamiliarId;
    if (!SAFE_FAMILIAR_ID.test(familiarId)) {
      return inputError("missing or invalid familiar id");
    }
    if (card.familiarId && requestedFamiliarId && card.familiarId !== requestedFamiliarId) {
      return NextResponse.json({ ok: false, error: "familiar mismatch" }, { status: 409 });
    }
    if (
      body.model !== undefined
      && (
        typeof body.model !== "string"
        || !card.modelOverride
        || body.model !== card.modelOverride
      )
    ) {
      return NextResponse.json({ ok: false, error: "model mismatch" }, { status: 409 });
    }
    const generationCard = card;

    const context = buildBoardAgenticContext(generationCard, board.cards);
    if (
      typeof body.contextFingerprint === "string"
      && body.contextFingerprint !== context.fingerprint
    ) {
      recordBoardDiagnostic(deps.diagnostics, { code: "stale_discarded" });
      return NextResponse.json({ ok: false, error: "stale_context" }, { status: 409 });
    }
    const config = await deps.loadConfig();
    const binding = deps.bindingFor(config, familiarId);
    if (!binding?.harness || !deps.isTrustedHarness(binding.harness)) {
      return NextResponse.json(
        { ok: false, error: "enhance unavailable for this familiar" },
        { status: 501 },
      );
    }
    const harness = canonicalHarnessId(binding.harness);
    const selectedModel = generationCard.modelOverride
      ? generationCard.modelOverrideHarness && canonicalHarnessId(generationCard.modelOverrideHarness) === harness
        ? cleanModelId(generationCard.modelOverride)
        : null
      : binding.model
        ? cleanModelId(binding.model)
        : null;
    if (generationCard.modelOverride && !selectedModel) {
      return NextResponse.json({ ok: false, error: "stale or invalid task model override" }, { status: 409 });
    }
    if (selectedModel && !isModelAllowedByRuntime(harness, selectedModel)) {
      return NextResponse.json({ ok: false, error: "unsupported task model override" }, { status: 409 });
    }
    if (selectedModel && !await deps.supportsModel()) {
      return NextResponse.json({ ok: false, error: "selected model is unsupported by this Coven runtime" }, { status: 409 });
    }
    const launchModel = selectedModel ? runtimeModelIdForLaunch(harness, selectedModel) : null;
    if (selectedModel && !launchModel) {
      return NextResponse.json({ ok: false, error: "invalid task model override" }, { status: 409 });
    }

    const workspace = await deps.resolveWorkspace(familiarId);
    let recommendations;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (req.signal.aborted) return cancelled(deps.diagnostics);
      const args = [
        "run",
        binding.harness,
        "--stream-json",
        "--archive",
        "--permission",
        "read-only",
        "--title",
        `Board enhance: ${safePromptText(generationCard.id, 80) || "task"}`,
        "--labels",
        "board,agentic-enhance",
        "--familiar",
        familiarId,
        ...(launchModel ? ["--model", launchModel] : []),
        "--",
        boardEnhancePrompt(context, attempt === 1),
      ];
      const raw = await deps.runFamiliar(args, req.signal, workspace, familiarId);
      if (req.signal.aborted) return cancelled(deps.diagnostics);
      try {
        recommendations = parseAgenticRecommendationsOutput(extractRewrite(raw) || raw);
        break;
      } catch (error) {
        if (!(error instanceof AgenticRecommendationParseError)) throw error;
      }
    }
    if (!recommendations) {
      recordBoardDiagnostic(deps.diagnostics, {
        code: "generation_validation_failed",
        counts: { attempts: 2 },
      });
      return NextResponse.json({ ok: false, error: "malformed_familiar_output" }, { status: 502 });
    }
    if (recommendations.some((recommendation) => recommendation.contextFingerprint !== context.fingerprint)) {
      recordBoardDiagnostic(deps.diagnostics, {
        code: "stale_discarded",
        counts: { recommendations: recommendations.length },
      });
      return NextResponse.json({ ok: false, error: "stale_context" }, { status: 409 });
    }

    const validations = recommendations.map((recommendation) =>
      validateBoardAgenticRecommendation(generationCard, board.cards, recommendation));
    const usedProposalIds = new Set(card.agenticEnhance?.proposals.map((proposal) => proposal.id) ?? []);
    const generationValidations = validations.map((validation, index) => {
      const rawId = validation.recommendation.id;
      const base = `${rawId}--${context.fingerprint.slice(7, 15)}-${index + 1}`;
      let id = rawId;
      if (usedProposalIds.has(id)) id = base;
      let suffix = 2;
      while (usedProposalIds.has(id)) id = `${base}-${suffix++}`;
      usedProposalIds.add(id);
      return { ...validation, recommendation: { ...validation.recommendation, id } };
    });
    const blocked = validations.filter((validation) => validation.status === "blocked");
    if (blocked.length > 0) {
      recordBoardDiagnostic(deps.diagnostics, {
        code: "verification_blocked",
        counts: {
          recommendations: blocked.length,
          verificationChecks: blocked.reduce((total, validation) => total + validation.errors.length, 0),
        },
      });
    }
    let stored;
    try {
      stored = await autoApplyBoardAgenticProposalBatch(
        id,
        generationValidations
          .filter((validation) => validation.status === "verified" && validation.patch)
          .map((validation) => validation.recommendation.id),
        {
          contextFingerprint: context.fingerprint,
          actor: actorFrom(body) ?? "enhance",
          signal: req.signal,
          generationInputs: generationValidations.map((validation) => ({
            ...boardAgenticProposalRecord(context, validation),
            actor: actorFrom(body) ?? "enhance",
          })),
        },
      );
    } catch (error) {
      recordBoardMutationDiagnostic(deps.diagnostics, error, "auto-apply");
      const response = mutationError(error);
      if (response) return response;
      throw error;
    }
    if (!stored) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    card = stored;

    return NextResponse.json({ ok: true, card });
  }

  if (typeof body.proposalId !== "string" || !body.proposalId) {
    return inputError("missing proposal id");
  }

  if (action === "dismiss") {
    try {
      const dismissed = await dismissBoardAgenticProposal(id, body.proposalId, actorFrom(body));
      if (!dismissed) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, card: dismissed });
    } catch (error) {
      recordBoardMutationDiagnostic(deps.diagnostics, error, "dismiss");
      const response = mutationError(error);
      if (response) return response;
      throw error;
    }
  }

  if (
    (action === "apply" || action === "revert")
    && (
      Object.prototype.hasOwnProperty.call(body, "patch")
      || Object.prototype.hasOwnProperty.call(body, "automatic")
    )
  ) {
    return inputError("invalid apply intent");
  }

  if (typeof body.contextFingerprint !== "string") return inputError("missing context fingerprint");
  try {
    const mutation = action === "revert"
      ? await revertBoardAgenticProposal(
        id,
        body.proposalId,
        { contextFingerprint: body.contextFingerprint, actor: actorFrom(body) },
      )
      : await applyBoardAgenticProposal(
      id,
      body.proposalId,
      { contextFingerprint: body.contextFingerprint, actor: actorFrom(body) },
    );
    if (!mutation) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, card: mutation });
  } catch (error) {
    recordBoardMutationDiagnostic(deps.diagnostics, error, "apply");
    const response = mutationError(error);
    if (response) return response;
    throw error;
  }
  };
}

export const POST = createBoardEnhanceRoute(productionDeps);
