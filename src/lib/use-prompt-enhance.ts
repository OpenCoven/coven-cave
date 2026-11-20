"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { streamFamiliarText } from "@/lib/familiar-stream";
import { contextFingerprint, type AgenticRecommendation } from "@/lib/agentic-recommendations";
import { useAgenticRecommendations } from "@/lib/use-agentic-recommendations";
import {
  buildEnhanceInstruction,
  containsPromptEnhancementSecret,
  createPromptEnhancementRecommendation,
  describePromptEnhancementFailure,
  extractCompleteEnhancedPrompt,
  extractEnhancedPrompt,
  isPromptEnhancementRecommendationCurrent,
  parsePromptEnhancementRecommendationOutput,
  promptEnhancementContextFingerprintInput,
  promptEnhancementEvidenceRefs,
  serializePromptEnhancementRecommendation,
  settleEnhance,
  type EnhanceIntent,
  type PromptEnhancementFailure,
  type PromptEnhancementPayload,
  type PromptEnhanceMode,
} from "@/lib/prompt-enhancer";

// Model-backed prompt enhancement (cave-b6c2) is deliberately a manual use of
// the shared recommendation lifecycle: typing only updates its fingerprint;
// the existing Enhance control explicitly starts a generation. A successful
// enhancement is always the familiar's own rewrite (#5920): every failure
// keeps the draft and reports an actionable error instead of a template.

// Account-backed harnesses can spend ~20 seconds starting before emitting text.
export const ENHANCE_FIRST_TOKEN_TIMEOUT_MS = 30_000;
export const ENHANCE_GENERATION_TIMEOUT_MS = 120_000;

/** Enhancement needs a familiar to write the rewrite; callers show this reason
 *  beside the disabled control rather than offering a scripted substitute. */
export const PROMPT_ENHANCE_NO_FAMILIAR_REASON = "Choose a familiar to enhance this prompt.";

/** A failure whose actionable message the hook already chose. */
class PromptEnhanceFailure extends Error {}

function newEnhanceRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `enhance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function stopEnhanceRun(runId: string | null | undefined) {
  if (!runId) return;
  void fetch("/api/chat/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  }).catch(() => {
    // Best-effort stop: the lifecycle signal still prevents stale UI writes.
  });
}

export type PromptEnhanceRecommendation = AgenticRecommendation<PromptEnhancementPayload>;

export type PromptEnhanceState =
  | { phase: "idle" }
  | { phase: "loading"; intent: EnhanceIntent; preview: string }
  | { phase: "suggested"; enhanced: string; applied: string; recommendation: PromptEnhanceRecommendation }
  | { phase: "applied"; original: string; recommendation: PromptEnhanceRecommendation }
  /** `retryable` is false only when retrying cannot help (no familiar). */
  | { phase: "error"; message: string; retryable: boolean };

type PromptEnhanceRequest = {
  baseDraft: string;
  originalDraft: string;
  intent: EnhanceIntent;
  applyDraft: (enhanced: string) => string;
};

type PromptEnhanceLifecycleContext = {
  contextKey: string;
};

function asPromptEnhancementRecommendation(
  recommendation: AgenticRecommendation,
): PromptEnhanceRecommendation | null {
  const payload = recommendation.payload;
  if (
    recommendation.surface !== "chat"
    || recommendation.kind !== "prose"
    || typeof payload.enhanced !== "string"
    || (
      payload.mode !== "chat"
      && payload.mode !== "code"
      && payload.mode !== "image"
      && payload.mode !== "research"
      && payload.mode !== "task"
    )
    || (
      payload.intent !== "auto"
      && payload.intent !== "clarify"
      && payload.intent !== "expand"
      && payload.intent !== "specific"
      && payload.intent !== "shorten"
      && payload.intent !== "criteria"
    )
  ) {
    return null;
  }
  return recommendation as PromptEnhanceRecommendation;
}

function recommendationId(runId: string): string {
  return `prompt-enhance-${runId.replace(/[^A-Za-z0-9._:/-]/g, "-").slice(0, 72)}`;
}

export function usePromptEnhance({
  draft,
  sourceDraft,
  setDraft,
  transformEnhanced,
  familiarId,
  mode,
  context,
  disabled,
}: {
  draft: string;
  sourceDraft?: string;
  setDraft: (value: string) => void;
  transformEnhanced?: (value: string) => string;
  familiarId: string | null | undefined;
  mode: PromptEnhanceMode;
  /** Passed through to the instruction builder (project, files, thread). */
  context?: unknown;
  /** e.g. while the composer is sending. */
  disabled?: boolean;
}) {
  const { announce } = useAnnouncer();
  const [state, setState] = useState<PromptEnhanceState>({ phase: "idle" });
  const draftRef = useRef(draft);
  const stateRef = useRef(state);
  const requestRef = useRef<PromptEnhanceRequest | null>(null);
  const enhanceRequestedRef = useRef(false);
  const handledRecommendationRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const selfEditRef = useRef(false);
  const contextRef = useRef(context);
  const familiarIdRef = useRef(familiarId);
  const sourceDraftRef = useRef(sourceDraft);
  const transformEnhancedRef = useRef(transformEnhanced);
  const currentContextFingerprintRef = useRef("");
  // The shared lifecycle reports a generic generation error; the hook keeps
  // the specific reason its own generation chose for the current request.
  const failureRef = useRef<{ message: string; retryable: boolean } | null>(null);
  const lastIntentRef = useRef<EnhanceIntent>("auto");
  const unavailableReason = familiarId ? null : PROMPT_ENHANCE_NO_FAMILIAR_REASON;

  draftRef.current = draft;
  stateRef.current = state;
  contextRef.current = context;
  familiarIdRef.current = familiarId;
  sourceDraftRef.current = sourceDraft;
  transformEnhancedRef.current = transformEnhanced;

  const contextKey = contextFingerprint({
    mode,
    familiarId: familiarId ?? null,
    context: promptEnhancementContextFingerprintInput(context),
  });
  // Same value as promptEnhancementLifecycleFingerprint({ mode, familiarId,
  // context }), without building the redacted context input a second time.
  const currentContextFingerprint = contextFingerprint({ contextKey });
  currentContextFingerprintRef.current = currentContextFingerprint;
  const agenticContext = useMemo<PromptEnhanceLifecycleContext>(() => ({ contextKey }), [contextKey]);

  const generate = useCallback(async (request: {
    contextFingerprint: string;
    runId: string;
    signal: AbortSignal;
  }) => {
    const activeRequest = requestRef.current;
    if (!activeRequest) throw new Error("Enhance request is missing.");
    const runFamiliarId = familiarIdRef.current;
    if (!runFamiliarId) {
      failureRef.current = { message: PROMPT_ENHANCE_NO_FAMILIAR_REASON, retryable: false };
      throw new PromptEnhanceFailure(PROMPT_ENHANCE_NO_FAMILIAR_REASON);
    }
    activeRunIdRef.current = request.runId;

    const fail = (failure: PromptEnhancementFailure) => {
      const message = describePromptEnhancementFailure(failure);
      failureRef.current = { message, retryable: true };
      return new PromptEnhanceFailure(message);
    };
    const toRecommendationOutput = (enhanced: string) => {
      const clean = enhanced.trim();
      if (!clean) throw fail({ kind: "invalid-output" });
      if (containsPromptEnhancementSecret(clean, contextRef.current)) throw fail({ kind: "unsafe-output" });
      const recommendation = createPromptEnhancementRecommendation({
        id: recommendationId(request.runId),
        enhanced: clean,
        mode,
        intent: activeRequest.intent,
        contextFingerprint: request.contextFingerprint,
        evidenceRefs: promptEnhancementEvidenceRefs(contextRef.current),
      });
      return serializePromptEnhancementRecommendation(recommendation);
    };

    const controller = new AbortController();
    const abortForLifecycle = () => controller.abort();
    request.signal.addEventListener("abort", abortForLifecycle, { once: true });
    const timeout: { failure: PromptEnhancementFailure | null } = { failure: null };
    const abortForTimeout = (failure: PromptEnhancementFailure) => () => {
      if (controller.signal.aborted || request.signal.aborted) return;
      timeout.failure = failure;
      stopEnhanceRun(request.runId);
      controller.abort();
    };
    const firstTokenTimer = setTimeout(
      abortForTimeout({ kind: "timeout", stage: "start", ms: ENHANCE_FIRST_TOKEN_TIMEOUT_MS }),
      ENHANCE_FIRST_TOKEN_TIMEOUT_MS,
    );
    const generationTimer = setTimeout(
      abortForTimeout({ kind: "timeout", stage: "finish", ms: ENHANCE_GENERATION_TIMEOUT_MS }),
      ENHANCE_GENERATION_TIMEOUT_MS,
    );

    try {
      const { text, error } = await streamFamiliarText({
        familiarId: runFamiliarId,
        prompt: buildEnhanceInstruction({
          draft: activeRequest.baseDraft,
          mode,
          intent: activeRequest.intent,
          context: contextRef.current,
        }),
        origin: "enhance",
        runId: request.runId,
        permissionMode: "read",
        reasoningEffort: "low",
        responseSpeed: "fast",
        signal: controller.signal,
        onText: (text) => {
          if (controller.signal.aborted || activeRunIdRef.current !== request.runId) return;
          if (text.trim()) clearTimeout(firstTokenTimer);
          const { partial } = extractEnhancedPrompt(text);
          setState((previous) =>
            previous.phase === "loading" ? { ...previous, preview: partial } : previous,
          );
        },
      });
      if (request.signal.aborted) throw new Error("Enhance cancelled.");
      if (timeout.failure) throw fail(timeout.failure);
      if (error) throw fail({ kind: "stream", detail: error });
      const enhanced = extractCompleteEnhancedPrompt(text);
      return enhanced ? toRecommendationOutput(enhanced) : "{}";
    } catch (error) {
      if (request.signal.aborted || error instanceof PromptEnhanceFailure) throw error;
      throw fail({ kind: "stream", detail: error instanceof Error ? error.message : "" });
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(generationTimer);
      request.signal.removeEventListener("abort", abortForLifecycle);
      if (activeRunIdRef.current === request.runId) activeRunIdRef.current = null;
    }
  }, [mode]);

  const agentic = useAgenticRecommendations<PromptEnhanceLifecycleContext>({
    context: agenticContext,
    autoGenerate: false,
    meaningfulContextKey: (current) => current.contextKey,
    createRunId: newEnhanceRunId,
    cancelRun: stopEnhanceRun,
    debounceMs: 100,
    generate: async (request) => generate(request),
    apply: async () => ({ revert: () => {} }),
    parseOutput: (text) => parsePromptEnhancementRecommendationOutput(text, contextRef.current),
  });

  // A user edit clears only a completed direct replacement. Loading work
  // survives so its eventual output becomes a proposal instead of an overwrite.
  useEffect(() => {
    if (selfEditRef.current) {
      selfEditRef.current = false;
      return;
    }
    setState((previous) =>
      previous.phase === "applied" || previous.phase === "error" ? { phase: "idle" } : previous,
    );
  }, [draft]);

  useEffect(() => {
    setState((previous) =>
      previous.phase === "suggested"
      && !isPromptEnhancementRecommendationCurrent(previous.recommendation, currentContextFingerprint)
        ? { phase: "idle" }
        : previous,
    );
  }, [currentContextFingerprint]);

  // The shared lifecycle strictly parses and fingerprint-checks the proposal;
  // the legacy Chat UX then retains its direct-apply-or-suggest race rule.
  useEffect(() => {
    const item = agentic.state.items.find((candidate) => candidate.phase === "review");
    const recommendation = item ? asPromptEnhancementRecommendation(item.recommendation) : null;
    const activeRequest = requestRef.current;
    if (!item || !recommendation || !activeRequest || handledRecommendationRef.current === recommendation.id) return;
    if (!isPromptEnhancementRecommendationCurrent(
      recommendation,
      currentContextFingerprintRef.current,
    )) {
      setState({ phase: "idle" });
      return;
    }

    handledRecommendationRef.current = recommendation.id;
    const applied = activeRequest.applyDraft(recommendation.payload.enhanced);
    if (settleEnhance(activeRequest.originalDraft, draftRef.current) === "apply") {
      selfEditRef.current = true;
      setDraft(applied);
      setState({
        phase: "applied",
        original: activeRequest.originalDraft,
        recommendation,
      });
      announce("Prompt enhanced.", "polite");
      return;
    }
    setState({
      phase: "suggested",
      enhanced: recommendation.payload.enhanced,
      applied,
      recommendation,
    });
    announce("Enhanced prompt ready — apply or dismiss.", "polite");
  }, [agentic.state.items, announce, setDraft]);

  // The draft is never written on failure: the error only reports what
  // happened and whether Retry can help.
  useEffect(() => {
    if (agentic.state.phase !== "error" || stateRef.current.phase !== "loading") return;
    const failure = failureRef.current;
    setState({
      phase: "error",
      message: failure?.message ?? describePromptEnhancementFailure(
        agentic.state.error?.code === "validation"
          ? { kind: "invalid-output" }
          : { kind: "stream", detail: "" },
      ),
      retryable: failure?.retryable ?? true,
    });
  }, [agentic.state.error, agentic.state.phase]);

  useEffect(() => {
    if (
      !enhanceRequestedRef.current
      || agentic.state.phase !== "idle"
      || stateRef.current.phase !== "loading"
    ) {
      return;
    }
    enhanceRequestedRef.current = false;
    requestRef.current = null;
    setState({ phase: "idle" });
  }, [agentic.state.phase]);

  const cancel = useCallback(() => {
    agentic.cancel();
    activeRunIdRef.current = null;
    requestRef.current = null;
    enhanceRequestedRef.current = false;
    setState({ phase: "idle" });
  }, [agentic]);

  const enhance = useCallback((intent: EnhanceIntent = "auto", draftOverride?: string) => {
    const baseDraft = draftOverride ?? sourceDraftRef.current ?? draftRef.current;
    if (!baseDraft.trim() || disabled) return;
    lastIntentRef.current = intent;
    if (!familiarIdRef.current) {
      setState({ phase: "error", message: PROMPT_ENHANCE_NO_FAMILIAR_REASON, retryable: false });
      return;
    }
    failureRef.current = null;
    handledRecommendationRef.current = null;
    requestRef.current = {
      baseDraft,
      originalDraft: draftOverride ?? draftRef.current,
      intent,
      applyDraft: transformEnhancedRef.current ?? ((value) => value),
    };
    enhanceRequestedRef.current = true;
    setState({ phase: "loading", intent, preview: "" });
    agentic.refresh();
  }, [agentic, disabled]);

  const apply = useCallback(() => {
    const previous = stateRef.current;
    if (previous.phase !== "suggested") return;
    if (!isPromptEnhancementRecommendationCurrent(
      previous.recommendation,
      currentContextFingerprintRef.current,
    )) {
      setState({ phase: "error", message: "Chat context changed. Enhance again before applying.", retryable: true });
      return;
    }
    const original = draftRef.current;
    selfEditRef.current = true;
    setDraft(previous.applied);
    setState({
      phase: "applied",
      original,
      recommendation: previous.recommendation,
    });
    announce("Enhanced prompt applied.", "polite");
  }, [announce, setDraft]);

  const dismiss = useCallback(() => {
    setState((previous) =>
      previous.phase === "suggested" || previous.phase === "error" ? { phase: "idle" } : previous,
    );
  }, []);

  const revert = useCallback(() => {
    const previous = stateRef.current;
    if (previous.phase !== "applied") return;
    selfEditRef.current = true;
    setDraft(previous.original);
    setState({ phase: "idle" });
    announce("Prompt restored.", "polite");
  }, [announce, setDraft]);

  /** Re-run the failed intent on the current draft. */
  const retry = useCallback(() => {
    const previous = stateRef.current;
    if (previous.phase !== "error" || !previous.retryable) return;
    enhance(lastIntentRef.current);
  }, [enhance]);

  return { state, enhance, apply, dismiss, revert, retry, cancel, reset: cancel, unavailableReason };
}
