"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { streamFamiliarText } from "@/lib/familiar-stream";
import { contextFingerprint, type AgenticRecommendation } from "@/lib/agentic-recommendations";
import { useAgenticRecommendations } from "@/lib/use-agentic-recommendations";
import {
  buildEnhanceInstruction,
  buildPromptEnhancement,
  createPromptEnhancementRecommendation,
  extractCompleteEnhancedPrompt,
  extractEnhancedPrompt,
  isPromptEnhancementRecommendationCurrent,
  parsePromptEnhancementRecommendationOutput,
  promptEnhancementContextFingerprintInput,
  promptEnhancementEvidenceRefs,
  promptEnhancementLifecycleFingerprint,
  serializePromptEnhancementRecommendation,
  settleEnhance,
  type EnhanceIntent,
  type PromptEnhancementPayload,
  type PromptEnhanceMode,
} from "@/lib/prompt-enhancer";
import { containsSecretText } from "@/lib/secret-redaction";

// Model-backed prompt enhancement (cave-b6c2) is deliberately a manual use of
// the shared recommendation lifecycle: typing only updates its fingerprint;
// the existing Enhance control explicitly starts a generation.

export const ENHANCE_FIRST_TOKEN_TIMEOUT_MS = 8000;

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
  | { phase: "suggested"; enhanced: string; offline: boolean; recommendation: PromptEnhanceRecommendation }
  | { phase: "applied"; original: string; offline: boolean; recommendation: PromptEnhanceRecommendation }
  | { phase: "error"; message: string };

type PromptEnhanceRequest = {
  baseDraft: string;
  intent: EnhanceIntent;
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
    || typeof payload.offline !== "boolean"
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
  setDraft,
  familiarId,
  mode,
  context,
  disabled,
}: {
  draft: string;
  setDraft: (value: string) => void;
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
  const currentContextFingerprintRef = useRef("");

  draftRef.current = draft;
  stateRef.current = state;
  contextRef.current = context;
  familiarIdRef.current = familiarId;

  const contextKey = contextFingerprint({
    mode,
    familiarId: familiarId ?? null,
    context: promptEnhancementContextFingerprintInput(context),
  });
  const currentContextFingerprint = promptEnhancementLifecycleFingerprint({ mode, familiarId, context });
  currentContextFingerprintRef.current = currentContextFingerprint;
  const agenticContext = useMemo<PromptEnhanceLifecycleContext>(() => ({ contextKey }), [contextKey]);

  const generate = useCallback(async (request: {
    contextFingerprint: string;
    runId: string;
    signal: AbortSignal;
  }) => {
    const activeRequest = requestRef.current;
    if (!activeRequest) throw new Error("Enhance request is missing.");
    activeRunIdRef.current = request.runId;

    const localRecommendation = () => {
      const local = buildPromptEnhancement({
        draft: activeRequest.baseDraft,
        mode,
        context: contextRef.current,
      });
      if (!local.ok) throw new Error(local.error);
      return local.enhanced;
    };
    const toRecommendationOutput = (enhanced: string, offline: boolean) => {
      const clean = enhanced.trim();
      if (!clean) throw new Error("Enhance returned nothing usable.");
      if (containsSecretText(clean)) {
        throw new Error("Enhance returned text that may contain sensitive values.");
      }
      const recommendation = createPromptEnhancementRecommendation({
        id: recommendationId(request.runId),
        enhanced: clean,
        offline,
        mode,
        intent: activeRequest.intent,
        contextFingerprint: request.contextFingerprint,
        evidenceRefs: promptEnhancementEvidenceRefs(contextRef.current),
      });
      return serializePromptEnhancementRecommendation(recommendation);
    };

    if (!familiarIdRef.current) return toRecommendationOutput(localRecommendation(), true);

    let sawToken = false;
    const controller = new AbortController();
    const abortForLifecycle = () => controller.abort();
    request.signal.addEventListener("abort", abortForLifecycle, { once: true });
    const timer = setTimeout(() => {
      if (!sawToken && !request.signal.aborted) {
        stopEnhanceRun(request.runId);
        controller.abort();
      }
    }, ENHANCE_FIRST_TOKEN_TIMEOUT_MS);

    try {
      const { text, error } = await streamFamiliarText({
        familiarId: familiarIdRef.current,
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
          sawToken = true;
          const { partial } = extractEnhancedPrompt(text);
          setState((previous) =>
            previous.phase === "loading" ? { ...previous, preview: partial } : previous,
          );
        },
      });
      if (request.signal.aborted) throw new Error("Enhance cancelled.");
      if (error) return toRecommendationOutput(localRecommendation(), true);
      const enhanced = extractCompleteEnhancedPrompt(text);
      return enhanced ? toRecommendationOutput(enhanced, false) : "{}";
    } catch (error) {
      if (request.signal.aborted) throw error;
      return toRecommendationOutput(localRecommendation(), true);
    } finally {
      clearTimeout(timer);
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
    parseOutput: parsePromptEnhancementRecommendationOutput,
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
    const offline = recommendation.payload.offline;
    if (settleEnhance(activeRequest.baseDraft, draftRef.current) === "apply") {
      selfEditRef.current = true;
      setDraft(recommendation.payload.enhanced);
      setState({
        phase: "applied",
        original: activeRequest.baseDraft,
        offline,
        recommendation,
      });
      announce(offline ? "Prompt enhanced offline." : "Prompt enhanced.", "polite");
      return;
    }
    setState({
      phase: "suggested",
      enhanced: recommendation.payload.enhanced,
      offline,
      recommendation,
    });
    announce("Enhanced prompt ready — apply or dismiss.", "polite");
  }, [agentic.state.items, announce, setDraft]);

  useEffect(() => {
    if (agentic.state.phase !== "error" || stateRef.current.phase !== "loading") return;
    setState({ phase: "error", message: agentic.state.error?.message ?? "Enhance could not be completed." });
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
    const baseDraft = draftOverride ?? draftRef.current;
    if (!baseDraft.trim() || disabled) return;
    handledRecommendationRef.current = null;
    requestRef.current = { baseDraft, intent };
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
      setState({ phase: "error", message: "Chat context changed. Enhance again before applying." });
      return;
    }
    const original = draftRef.current;
    selfEditRef.current = true;
    setDraft(previous.enhanced);
    setState({
      phase: "applied",
      original,
      offline: previous.offline,
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

  return { state, enhance, apply, dismiss, revert, cancel, reset: cancel };
}
