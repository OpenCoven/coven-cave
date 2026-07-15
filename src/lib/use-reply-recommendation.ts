"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamFamiliarText } from "@/lib/familiar-stream";
import {
  buildRecommendationInstruction,
  extractRecommendedReply,
  type RecommendationTurn,
} from "@/lib/reply-recommendation";

// Model-backed reply recommendation for quick chat. After a familiar's reply
// settles, this proposes the user's most useful next message so it can be
// Tab-accepted straight into the composer. It mirrors usePromptEnhance's
// discipline — a generation counter makes stale completions inert, and a
// per-turn ref fires the request exactly once per reply.
//
// Model path: streamFamiliarText as an ephemeral run — no sessionId, origin
// "enhance" (hidden from chat lists), low effort + fast speed. On any error,
// empty result, or a slow first token it fails quiet (idle) — a missing
// suggestion is a non-event, never an error the user must clear.

export const RECOMMEND_FIRST_TOKEN_TIMEOUT_MS = 9000;

export type ReplyRecommendationState =
  | { phase: "idle" }
  | { phase: "loading"; preview: string }
  | { phase: "ready"; text: string };

export type UseReplyRecommendation = {
  state: ReplyRecommendationState;
  /** The ready suggestion, or null while idle/loading. */
  suggestion: string | null;
  loading: boolean;
  /** Consume the ready suggestion: returns its text and goes idle. */
  accept: () => string | null;
  /** Drop a ready suggestion without using it (kept out for this turn). */
  dismiss: () => void;
  /** Ask for a different suggestion for the same turn. */
  regenerate: () => void;
};

export function useReplyRecommendation({
  messages,
  familiarId,
  familiarName,
  draft,
  enabled = true,
}: {
  messages: RecommendationTurn[];
  familiarId: string | null | undefined;
  familiarName?: string | null;
  /** The composer draft — a non-empty draft suppresses the recommendation
   *  (the user is already writing their own reply). */
  draft: string;
  /** Gate generation (pane inactive / sending). Flipping off cancels in-flight. */
  enabled?: boolean;
}): UseReplyRecommendation {
  const [state, setState] = useState<ReplyRecommendationState>({ phase: "idle" });

  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // The assistant turn we last generated (or are generating) a suggestion for,
  // so the auto-trigger fires exactly once per reply.
  const servedTurnRef = useRef<string | null>(null);
  // Refs so completions/regenerate read the latest without re-subscribing.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const stateRef = useRef(state);
  stateRef.current = state;
  const familiarNameRef = useRef(familiarName);
  familiarNameRef.current = familiarName;
  const familiarIdRef = useRef(familiarId);
  familiarIdRef.current = familiarId;

  // The valid recommendation anchor: a settled, non-empty assistant turn that
  // is actually the last message (a trailing user turn means we're waiting on a
  // reply, not ready to suggest the next one). Keyed by index so identical
  // adjacent thread shapes still re-fire per new reply.
  const lastIndex = messages.length - 1;
  const last = lastIndex >= 0 ? messages[lastIndex] : null;
  const anchorId =
    last && last.role === "assistant" && !last.pending && !last.local && last.text.trim().length > 0
      ? `${lastIndex}:${last.text.length}`
      : null;
  const anchorRef = useRef<string | null>(anchorId);
  anchorRef.current = anchorId;

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ phase: "idle" });
  }, []);

  const run = useCallback((turnId: string) => {
    const familiar = familiarIdRef.current;
    if (!familiar) return;
    servedTurnRef.current = turnId;
    generationRef.current += 1;
    const gen = generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: "loading", preview: "" });

    let sawToken = false;
    const timer = setTimeout(() => {
      if (!sawToken && gen === generationRef.current) {
        controller.abort();
        setState({ phase: "idle" });
      }
    }, RECOMMEND_FIRST_TOKEN_TIMEOUT_MS);

    void streamFamiliarText({
      familiarId: familiar,
      prompt: buildRecommendationInstruction({
        messages: messagesRef.current,
        familiarName: familiarNameRef.current,
      }),
      origin: "enhance",
      reasoningEffort: "low",
      responseSpeed: "fast",
      // Recommendations are hidden, automatic meta-runs over untrusted
      // transcript text. Force read-only so prompt injection cannot escalate
      // into privileged harness actions before explicit user intent.
      permissionMode: "read",
      signal: controller.signal,
      onText: (text) => {
        if (gen !== generationRef.current) return;
        sawToken = true;
        const { partial } = extractRecommendedReply(text);
        setState((prev) => (prev.phase === "loading" ? { ...prev, preview: partial } : prev));
      },
    })
      .then(({ text, error }) => {
        clearTimeout(timer);
        if (gen !== generationRef.current) return;
        const { partial } = extractRecommendedReply(text);
        // Fail quiet: no suggestion is a non-event, and if the user started
        // typing their own reply mid-stream, don't nag them with one.
        if (error || !partial.trim() || draftRef.current.trim()) {
          setState({ phase: "idle" });
          return;
        }
        setState({ phase: "ready", text: partial.trim() });
      })
      .catch(() => {
        clearTimeout(timer);
        if (gen === generationRef.current) setState({ phase: "idle" });
      });
  }, []);

  // Auto-trigger: one suggestion per settled reply, only while enabled and the
  // composer is empty. servedTurnRef guards against re-firing for the same turn
  // (including after the state settles or the draft is cleared again).
  useEffect(() => {
    if (!enabled || !familiarId) return;
    if (draft.trim()) return;
    if (!anchorId || servedTurnRef.current === anchorId) return;
    run(anchorId);
  }, [enabled, familiarId, draft, anchorId, run]);

  // Typing over a live suggestion retires it — the user is writing their own
  // reply. servedTurnRef stays set, so clearing the draft won't auto-regenerate
  // (they can ask again with the refresh control).
  useEffect(() => {
    if (draft.trim() && stateRef.current.phase !== "idle") cancel();
  }, [draft, cancel]);

  // Going inactive / sending cancels any in-flight or ready suggestion.
  useEffect(() => {
    if (!enabled && stateRef.current.phase !== "idle") cancel();
  }, [enabled, cancel]);

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const accept = useCallback((): string | null => {
    const prev = stateRef.current;
    if (prev.phase !== "ready") return null;
    setState({ phase: "idle" });
    return prev.text;
  }, []);

  const dismiss = useCallback(() => {
    setState((prev) => (prev.phase === "ready" ? { phase: "idle" } : prev));
  }, []);

  const regenerate = useCallback(() => {
    if (anchorRef.current) run(anchorRef.current);
  }, [run]);

  return {
    state,
    suggestion: state.phase === "ready" ? state.text : null,
    loading: state.phase === "loading",
    accept,
    dismiss,
    regenerate,
  };
}
