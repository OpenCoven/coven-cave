"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { streamFamiliarText } from "@/lib/familiar-stream";
import {
  buildEnhanceInstruction,
  buildPromptEnhancement,
  extractEnhancedPrompt,
  settleEnhance,
  type EnhanceIntent,
  type PromptEnhanceMode,
} from "@/lib/prompt-enhancer";

// Model-backed prompt enhancement (cave-b6c2), shared by the home, chat, and
// quick-chat composers. One state machine owns the whole lifecycle:
//
//   idle → loading{baseDraft} → applied{original} | suggested{enhanced} | error
//
// The race rule (the old implementations' bug): the draft captured at request
// time is compared with the draft at completion — unchanged applies in place,
// changed surfaces the rewrite as a suggestion strip and NEVER overwrites the
// newer text. `original` only exists in `applied`, so typing mid-flight has
// nothing to lose. A generation counter makes stale completions inert.
//
// Model path: streamFamiliarText (the sanctioned client LLM bridge) as an
// ephemeral run — no sessionId, origin "enhance" (hidden from chat lists),
// low effort + fast speed. Falls back to the local rule engine when there is
// no familiar, the stream errors, or the first token takes too long.

export const ENHANCE_FIRST_TOKEN_TIMEOUT_MS = 8000;

export type PromptEnhanceState =
  | { phase: "idle" }
  | { phase: "loading"; intent: EnhanceIntent; preview: string }
  | { phase: "suggested"; enhanced: string; offline: boolean }
  | { phase: "applied"; original: string; offline: boolean }
  | { phase: "error"; message: string };

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

  // Refs, not state: completions must read the LATEST draft and generation
  // without re-subscribing the stream callbacks. stateRef mirrors state so
  // apply/revert can read-then-act without side effects inside a setState
  // updater (updaters must be pure — setDraft/announce there re-renders
  // LiveRegionProvider mid-render).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Set before the hook itself writes the draft (apply/revert), so the
  // draft-watch below can tell hook writes from user typing.
  const selfEditRef = useRef(false);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: "idle" });
  }, []);

  /** Full reset — send, session switch, submit. */
  const reset = cancel;

  // A USER edit dismisses a lingering applied strip (typing over an applied
  // rewrite means Revert would corrupt the new text) and clears errors. The
  // hook's own writes (apply/revert) don't count — selfEditRef marks those.
  // `suggested` survives edits: applying later stashes the draft-at-apply, so
  // it stays safe. `loading` survives too — the race rule downgrades its
  // completion to a suggestion instead.
  useEffect(() => {
    if (selfEditRef.current) {
      selfEditRef.current = false;
      return;
    }
    setState((prev) =>
      prev.phase === "applied" || prev.phase === "error" ? { phase: "idle" } : prev,
    );
  }, [draft]);

  const finish = useCallback(
    (gen: number, baseDraft: string, enhanced: string, offline: boolean) => {
      if (gen !== generationRef.current) return; // stale completion — inert
      abortRef.current = null;
      const text = enhanced.trim();
      if (!text) {
        setState({ phase: "error", message: "Enhance returned nothing usable." });
        return;
      }
      if (settleEnhance(baseDraft, draftRef.current) === "apply") {
        selfEditRef.current = true;
        setDraft(text);
        setState({ phase: "applied", original: baseDraft, offline });
        announce(offline ? "Prompt enhanced offline." : "Prompt enhanced.", "polite");
      } else {
        setState({ phase: "suggested", enhanced: text, offline });
        announce("Enhanced prompt ready — apply or dismiss.", "polite");
      }
    },
    [announce, setDraft],
  );

  const fallback = useCallback(
    (gen: number, baseDraft: string) => {
      const local = buildPromptEnhancement({ draft: baseDraft, mode, context });
      if (!local.ok) {
        if (gen === generationRef.current) setState({ phase: "error", message: local.error });
        return;
      }
      finish(gen, baseDraft, local.enhanced, true);
    },
    [context, finish, mode],
  );

  const enhance = useCallback(
    (intent: EnhanceIntent = "auto") => {
      const baseDraft = draftRef.current;
      if (!baseDraft.trim() || disabled) return;
      generationRef.current += 1;
      const gen = generationRef.current;
      abortRef.current?.abort();

      if (!familiarId) {
        setState({ phase: "loading", intent, preview: "" });
        fallback(gen, baseDraft);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: "loading", intent, preview: "" });

      let sawToken = false;
      // No first token in time → abort the stream and enhance locally. The
      // rewrite should feel instant-ish; a cold harness shouldn't stall it.
      const timer = setTimeout(() => {
        if (!sawToken && gen === generationRef.current) {
          controller.abort();
          fallback(gen, baseDraft);
        }
      }, ENHANCE_FIRST_TOKEN_TIMEOUT_MS);

      void streamFamiliarText({
        familiarId,
        prompt: buildEnhanceInstruction({ draft: baseDraft, mode, intent, context }),
        origin: "enhance",
        reasoningEffort: "low",
        responseSpeed: "fast",
        signal: controller.signal,
        onText: (text) => {
          if (gen !== generationRef.current) return;
          sawToken = true;
          const { partial } = extractEnhancedPrompt(text);
          setState((prev) =>
            prev.phase === "loading" ? { ...prev, preview: partial } : prev,
          );
        },
      })
        .then(({ text, error }) => {
          clearTimeout(timer);
          if (gen !== generationRef.current) return;
          if (error || !text.trim()) {
            fallback(gen, baseDraft);
            return;
          }
          finish(gen, baseDraft, extractEnhancedPrompt(text).partial, false);
        })
        .catch(() => {
          clearTimeout(timer);
          if (gen === generationRef.current) fallback(gen, baseDraft);
        });
    },
    [context, disabled, fallback, familiarId, finish, mode],
  );

  const apply = useCallback(() => {
    const prev = stateRef.current;
    if (prev.phase !== "suggested") return;
    const original = draftRef.current;
    selfEditRef.current = true;
    setDraft(prev.enhanced);
    setState({ phase: "applied", original, offline: prev.offline });
    announce("Enhanced prompt applied.", "polite");
  }, [announce, setDraft]);

  const dismiss = useCallback(() => {
    setState((prev) => (prev.phase === "suggested" || prev.phase === "error" ? { phase: "idle" } : prev));
  }, []);

  const revert = useCallback(() => {
    const prev = stateRef.current;
    if (prev.phase !== "applied") return;
    selfEditRef.current = true;
    setDraft(prev.original);
    setState({ phase: "idle" });
    announce("Prompt restored.", "polite");
  }, [announce, setDraft]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, enhance, apply, dismiss, revert, cancel, reset };
}
