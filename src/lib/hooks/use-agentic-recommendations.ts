"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  contextFingerprint,
  isAutoApplyAllowed,
  parseAgenticRecommendationsOutput,
  type AgenticRecommendation,
  type AgenticSurface,
} from "../agentic-recommendations.ts";
import {
  recordAgenticDiagnostic,
  type AgenticDiagnosticInput,
  type AgenticDiagnosticSink,
} from "../agentic-diagnostics.ts";

export const MIN_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS = 100;
export const MAX_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS = 1_000;
export const DEFAULT_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS = 400;

export type AgenticRecommendationClock = {
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
};

export type AgenticRecommendationGenerationRequest<TContext> = {
  context: TContext;
  contextFingerprint: string;
  runId: string;
  attempt: 0 | 1;
  signal: AbortSignal;
};

export type AgenticRecommendationGenerator<TContext> = (
  request: AgenticRecommendationGenerationRequest<TContext>,
) => Promise<string>;

export type AgenticRecommendationOutputParser = (text: string) => AgenticRecommendation[];

export type AgenticRecommendationApplyResult = {
  revert: () => Promise<void> | void;
};

export type AgenticRecommendationApply<TContext> = (
  recommendation: AgenticRecommendation,
  context: TContext,
) => Promise<AgenticRecommendationApplyResult>;

export type AgenticRecommendationItemPhase =
  | "review"
  | "applying"
  | "applied"
  | "reverting"
  | "dismissed"
  | "error";

export type AgenticRecommendationItem = {
  recommendation: AgenticRecommendation;
  phase: AgenticRecommendationItemPhase;
  error?: string;
};

export type AgenticRecommendationsLifecyclePhase =
  | "idle"
  | "debouncing"
  | "generating"
  | "review"
  | "error";

export type AgenticRecommendationsLifecycleError = {
  code: "generation" | "validation" | "cancellation";
  message: string;
};

export type AgenticRecommendationsLifecycleState = {
  phase: AgenticRecommendationsLifecyclePhase;
  runId: string | null;
  contextFingerprint: string | null;
  meaningfulContextKey: string | null;
  items: AgenticRecommendationItem[];
  error: AgenticRecommendationsLifecycleError | null;
};

export type AgenticRecommendationsLifecycle<TContext> = {
  getState: () => AgenticRecommendationsLifecycleState;
  subscribe: (listener: () => void) => () => void;
  update: (context: TContext) => void;
  refresh: () => void;
  cancel: (runId: string) => boolean;
  review: (recommendationId: string) => void;
  dismiss: (recommendationId: string) => void;
  apply: (recommendationId: string) => Promise<void>;
  revert: (recommendationId: string) => Promise<void>;
  dispose: () => void;
};

export type CreateAgenticRecommendationsLifecycleOptions<TContext> = {
  generate: AgenticRecommendationGenerator<TContext>;
  apply: AgenticRecommendationApply<TContext>;
  /** Surface-specific strict extraction; defaults to the shared model parser. */
  parseOutput?: AgenticRecommendationOutputParser;
  /** A durable-context key. Draft keystrokes must not change this value. */
  meaningfulContextKey: (context: TContext) => string;
  /** Keep existing explicit controls manual while still tracking freshness. */
  autoGenerate?: boolean;
  createRunId: () => string;
  cancelRun?: (runId: string) => Promise<void> | void;
  /** Optional content-free diagnostic sink for lifecycle outcomes. */
  diagnostics?: AgenticDiagnosticSink;
  diagnosticSurface?: AgenticSurface;
  clock?: AgenticRecommendationClock;
  debounceMs?: number;
};

type ActiveRun<TContext> = {
  context: TContext;
  fingerprint: string;
  meaningfulContextKey: string;
  runId: string;
  controller: AbortController;
  timer: number | null;
  started: boolean;
};

const browserClock: AgenticRecommendationClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay) as unknown as number,
  clearTimeout: (timer) => globalThis.clearTimeout(timer as unknown as ReturnType<typeof setTimeout>),
};

function boundedDebounce(delay = DEFAULT_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS): number {
  return Math.min(
    MAX_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS,
    Math.max(MIN_AGENTIC_RECOMMENDATIONS_DEBOUNCE_MS, delay),
  );
}

function generationError(): AgenticRecommendationsLifecycleError {
  return { code: "generation", message: "Recommendations could not be generated. Please try again." };
}

function validationError(): AgenticRecommendationsLifecycleError {
  return { code: "validation", message: "Recommendations could not be validated. Please try again." };
}

function cancellationError(): AgenticRecommendationsLifecycleError {
  return { code: "cancellation", message: "Recommendations could not be cancelled. Please try again." };
}

function itemError(message: string): string {
  return message;
}

function newState(
  phase: AgenticRecommendationsLifecyclePhase,
  overrides: Partial<Omit<AgenticRecommendationsLifecycleState, "phase">> = {},
): AgenticRecommendationsLifecycleState {
  return {
    phase,
    runId: null,
    contextFingerprint: null,
    meaningfulContextKey: null,
    items: [],
    error: null,
    ...overrides,
  };
}

/**
 * A cancellation-safe client lifecycle for contextual recommendations.
 *
 * Context is the full reviewable snapshot (including any draft). The injected
 * meaningfulContextKey selects the durable part (card, sources, dependencies,
 * etc.); update() only auto-requests when that key changes.
 */
export function createAgenticRecommendationsLifecycle<TContext>(
  options: CreateAgenticRecommendationsLifecycleOptions<TContext>,
): AgenticRecommendationsLifecycle<TContext> {
  const clock = options.clock ?? browserClock;
  const autoGenerate = options.autoGenerate ?? true;
  const debounceMs = boundedDebounce(options.debounceMs);
  const listeners = new Set<() => void>();
  const reverters = new Map<string, () => Promise<void> | void>();
  let state = newState("idle");
  let active: ActiveRun<TContext> | null = null;
  let latestContext: TContext | null = null;
  let latestFingerprint: string | null = null;
  let latestMeaningfulContextKey: string | null = null;

  const recordLifecycleDiagnostic = (
    input: Omit<AgenticDiagnosticInput, "surface">,
  ) => {
    if (!options.diagnostics) return;
    const event = recordAgenticDiagnostic({
      surface: options.diagnosticSurface ?? "chat",
      ...input,
    });
    try {
      options.diagnostics(event);
    } catch {
      // Diagnostics must not change lifecycle behavior.
    }
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const setState = (next: AgenticRecommendationsLifecycleState) => {
    state = next;
    notify();
  };

  const retainedItems = () =>
    state.items.filter(({ phase }) =>
      phase === "applying" || phase === "applied" || phase === "reverting",
    );

  const reportCancellationError = (failedRun: ActiveRun<TContext>) => {
    if (active && active !== failedRun) {
      const newerRun = active;
      active = null;
      if (newerRun.timer !== null) clock.clearTimeout(newerRun.timer);
      newerRun.controller.abort();
    }
    setState(newState("error", {
      contextFingerprint: latestFingerprint,
      meaningfulContextKey: latestMeaningfulContextKey,
      items: retainedItems(),
      error: cancellationError(),
    }));
  };

  const stopActive = (run: ActiveRun<TContext>) => {
    if (active !== run) return true;
    active = null;
    if (run.timer !== null) clock.clearTimeout(run.timer);
    run.controller.abort();
    if (!run.started || !options.cancelRun) return true;
    try {
      const cancellation = options.cancelRun(run.runId);
      void Promise.resolve(cancellation).catch(() => reportCancellationError(run));
      return true;
    } catch {
      reportCancellationError(run);
      return false;
    }
  };

  const isCurrent = (run: ActiveRun<TContext>) =>
    active === run && latestFingerprint === run.fingerprint && !run.controller.signal.aborted;

  const finishWithError = (
    run: ActiveRun<TContext>,
    error: AgenticRecommendationsLifecycleError,
  ) => {
    if (!isCurrent(run)) return;
    active = null;
    setState(newState("error", {
      contextFingerprint: run.fingerprint,
      meaningfulContextKey: run.meaningfulContextKey,
      items: retainedItems(),
      error,
    }));
  };

  const finishWithRecommendations = (
    run: ActiveRun<TContext>,
    recommendations: AgenticRecommendation[],
  ) => {
    if (!isCurrent(run)) return;
    active = null;
    const retained = retainedItems();
    const retainedIds = new Set(retained.map(({ recommendation }) => recommendation.id));
    setState(newState("review", {
      contextFingerprint: run.fingerprint,
      meaningfulContextKey: run.meaningfulContextKey,
      items: [
        ...retained,
        ...recommendations
          .filter((recommendation) => !retainedIds.has(recommendation.id))
          .map((recommendation) => ({ recommendation, phase: "review" as const })),
      ],
    }));
  };

  const generate = async (run: ActiveRun<TContext>) => {
    for (const attempt of [0, 1] as const) {
      let text: string;
      try {
        text = await options.generate({
          context: run.context,
          contextFingerprint: run.fingerprint,
          runId: run.runId,
          attempt,
          signal: run.controller.signal,
        });
      } catch {
        if (!run.controller.signal.aborted) finishWithError(run, generationError());
        return;
      }

      if (!isCurrent(run)) {
        recordLifecycleDiagnostic({
          code: "stale_discarded",
        });
        return;
      }

      try {
        const recommendations = (options.parseOutput ?? parseAgenticRecommendationsOutput)(text);
        if (recommendations.some((recommendation) => recommendation.contextFingerprint !== run.fingerprint)) {
          recordLifecycleDiagnostic({
            code: "stale_discarded",
            counts: { recommendations: recommendations.length },
          });
          throw new Error("recommendation context fingerprint does not match the active context");
        }
        finishWithRecommendations(run, recommendations);
        return;
      } catch {
        if (attempt === 1) {
          recordLifecycleDiagnostic({
            code: "generation_validation_failed",
            counts: { attempts: 2 },
          });
          finishWithError(run, validationError());
          return;
        }
      }
    }
  };

  const begin = (context: TContext, fingerprint: string, meaningfulContextKey: string) => {
    const run: ActiveRun<TContext> = {
      context,
      fingerprint,
      meaningfulContextKey,
      runId: options.createRunId(),
      controller: new AbortController(),
      timer: null,
      started: false,
    };
    active = run;
    setState(newState("debouncing", {
      runId: run.runId,
      contextFingerprint: fingerprint,
      meaningfulContextKey,
      items: retainedItems(),
    }));
    run.timer = clock.setTimeout(() => {
      if (!isCurrent(run)) return;
      run.timer = null;
      run.started = true;
      setState(newState("generating", {
        runId: run.runId,
        contextFingerprint: fingerprint,
        meaningfulContextKey,
        items: retainedItems(),
      }));
      void generate(run);
    }, debounceMs);
  };

  const replaceItem = (
    recommendationId: string,
    mapper: (item: AgenticRecommendationItem) => AgenticRecommendationItem,
  ) => {
    const index = state.items.findIndex(({ recommendation }) => recommendation.id === recommendationId);
    if (index < 0) return false;
    const items = [...state.items];
    items[index] = mapper(items[index]!);
    setState({ ...state, items });
    return true;
  };

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    update: (context) => {
      const fingerprint = contextFingerprint(context);
      const meaningfulContextKey = options.meaningfulContextKey(context);
      const didMeaningfulContextChange = latestMeaningfulContextKey !== meaningfulContextKey;
      const didFingerprintChange = latestFingerprint !== fingerprint;
      latestContext = context;
      latestFingerprint = fingerprint;
      latestMeaningfulContextKey = meaningfulContextKey;

      if (!autoGenerate) {
        if (active && didFingerprintChange && !stopActive(active)) return;
        if (active) return;
        setState(newState("idle", {
          contextFingerprint: fingerprint,
          meaningfulContextKey,
          items: retainedItems(),
        }));
        return;
      }

      if (!didMeaningfulContextChange) {
        if (!didFingerprintChange) return;
        if (active && !stopActive(active)) return;
        setState(newState("idle", {
          contextFingerprint: fingerprint,
          meaningfulContextKey,
          items: retainedItems(),
        }));
        return;
      }

      if (active && !stopActive(active)) return;
      begin(context, fingerprint, meaningfulContextKey);
    },

    refresh: () => {
      if (
        latestContext === null
        || latestFingerprint === null
        || latestMeaningfulContextKey === null
      ) return;
      if (active && !stopActive(active)) return;
      begin(latestContext, latestFingerprint, latestMeaningfulContextKey);
    },

    cancel: (runId) => {
      if (!active || active.runId !== runId) return false;
      const stopped = stopActive(active);
      if (stopped) {
        recordLifecycleDiagnostic({ code: "cancelled" });
        setState(newState("idle", {
          contextFingerprint: latestFingerprint,
          meaningfulContextKey: latestMeaningfulContextKey,
          items: retainedItems(),
        }));
      }
      return true;
    },

    review: (recommendationId) => {
      replaceItem(recommendationId, (item) =>
        item.phase === "dismissed" || item.phase === "error"
          ? { ...item, phase: "review", error: undefined }
          : item,
      );
    },

    dismiss: (recommendationId) => {
      replaceItem(recommendationId, (item) =>
        item.phase === "review" || item.phase === "error"
          ? { ...item, phase: "dismissed", error: undefined }
          : item,
      );
    },

    apply: async (recommendationId) => {
      const item = state.items.find(({ recommendation }) => recommendation.id === recommendationId);
      if (!item || item.phase !== "review" || latestContext === null) return;
      if (
        item.recommendation.application.mode === "auto-apply"
        && !isAutoApplyAllowed(item.recommendation)
      ) {
        recordLifecycleDiagnostic({
          code: "verification_blocked",
        });
        replaceItem(recommendationId, (current) => ({
          ...current,
          phase: "error",
          error: itemError("Recommendation is not trusted for automatic application."),
        }));
        return;
      }
      if (item.recommendation.contextFingerprint !== latestFingerprint) {
        recordLifecycleDiagnostic({
          code: "stale_discarded",
        });
        replaceItem(recommendationId, (current) => ({
          ...current,
          phase: "error",
          error: itemError("Recommendation context changed. Refresh recommendations before applying."),
        }));
        return;
      }

      replaceItem(recommendationId, (current) => ({ ...current, phase: "applying", error: undefined }));
      try {
        const result = await options.apply(item.recommendation, latestContext);
        if (typeof result.revert !== "function") {
          throw new Error("missing reversible apply result");
        }
        const current = state.items.find(({ recommendation }) => recommendation.id === recommendationId);
        if (!current || current.phase !== "applying" || current.recommendation !== item.recommendation) return;
        reverters.set(recommendationId, result.revert);
        replaceItem(recommendationId, (next) => ({ ...next, phase: "applied" }));
      } catch {
        recordLifecycleDiagnostic({
          code: "apply_failed",
        });
        replaceItem(recommendationId, (current) => ({
          ...current,
          phase: "error",
          error: itemError("Recommendation could not be applied. Please try again."),
        }));
      }
    },

    revert: async (recommendationId) => {
      const item = state.items.find(({ recommendation }) => recommendation.id === recommendationId);
      const revert = reverters.get(recommendationId);
      if (!item || item.phase !== "applied" || !revert) return;

      replaceItem(recommendationId, (current) => ({ ...current, phase: "reverting", error: undefined }));
      try {
        await revert();
        const current = state.items.find(({ recommendation }) => recommendation.id === recommendationId);
        if (!current || current.phase !== "reverting") return;
        reverters.delete(recommendationId);
        replaceItem(recommendationId, (next) => ({ ...next, phase: "review" }));
      } catch {
        replaceItem(recommendationId, (current) => ({
          ...current,
          phase: "applied",
          error: itemError("Recommendation could not be reverted. Please try again."),
        }));
      }
    },

    dispose: () => {
      if (active) stopActive(active);
      listeners.clear();
      reverters.clear();
    },
  };
}

export type UseAgenticRecommendationsOptions<TContext> =
  CreateAgenticRecommendationsLifecycleOptions<TContext> & {
    context: TContext;
    enabled?: boolean;
  };

export function useAgenticRecommendations<TContext>(
  options: UseAgenticRecommendationsOptions<TContext>,
) {
  const { context, enabled = true, generate, apply, cancelRun, ...lifecycleOptions } = options;
  const callbacksRef = useRef({ generate, apply, cancelRun });
  callbacksRef.current = { generate, apply, cancelRun };
  const lifecycleRef = useRef<AgenticRecommendationsLifecycle<TContext> | null>(null);

  if (!lifecycleRef.current) {
    lifecycleRef.current = createAgenticRecommendationsLifecycle({
      ...lifecycleOptions,
      generate: (request) => callbacksRef.current.generate(request),
      apply: (recommendation, currentContext) => callbacksRef.current.apply(recommendation, currentContext),
      cancelRun: (runId) => callbacksRef.current.cancelRun?.(runId),
    });
  }

  const lifecycle = lifecycleRef.current;
  const [state, setState] = useState(lifecycle.getState);

  useEffect(() => lifecycle.subscribe(() => setState(lifecycle.getState())), [lifecycle]);

  useEffect(() => {
    if (!enabled) {
      const runId = lifecycle.getState().runId;
      if (runId) lifecycle.cancel(runId);
      return;
    }
    lifecycle.update(context);
  }, [context, enabled, lifecycle]);

  useEffect(() => () => lifecycle.dispose(), [lifecycle]);

  const cancel = useCallback(() => {
    const runId = lifecycle.getState().runId;
    return runId ? lifecycle.cancel(runId) : false;
  }, [lifecycle]);

  return {
    state,
    refresh: lifecycle.refresh,
    cancel,
    review: lifecycle.review,
    dismiss: lifecycle.dismiss,
    apply: lifecycle.apply,
    revert: lifecycle.revert,
  };
}
