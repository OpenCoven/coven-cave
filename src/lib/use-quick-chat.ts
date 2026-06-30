"use client";

// Shared quick-chat state + send logic, used by both the Tauri standalone
// window (`TrayQuickChat`) and the in-app popover (`QuickChatOverlay`). It
// loads the familiar roster, resolves @mentions, and streams a one-shot reply
// through the sanctioned familiar chat bridge — with incremental token
// streaming, in-flight abort, and unmount cleanup.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COMMAND_CONTROL_DEFAULTS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
import { resolveQuickChatTarget } from "@/lib/quick-chat";
import { streamFamiliarText } from "@/lib/familiar-stream";
import type { Familiar } from "@/lib/types";

const LAST_FAMILIAR_KEY = "cave.quick-chat.last-familiar";

export type QuickChatSendState = "idle" | "sending" | "done";

export type UseQuickChat = {
  familiars: Familiar[];
  selectedFamiliarId: string | null;
  setSelectedFamiliarId: (id: string | null) => void;
  selectedFamiliar: Familiar | null;
  draft: string;
  setDraft: (value: string) => void;
  answer: string;
  error: string | null;
  sessionId: string | null;
  sendState: QuickChatSendState;
  loading: boolean;
  thinkingEffort: CommandThinkingEffort;
  setThinkingEffort: (value: CommandThinkingEffort) => void;
  responseSpeed: CommandResponseSpeed;
  setResponseSpeed: (value: CommandResponseSpeed) => void;
  send: () => Promise<void>;
  cancel: () => void;
};

export function useQuickChat(): UseQuickChat {
  const [familiars, setFamiliars] = useState<Familiar[]>([]);
  const [selectedFamiliarId, setSelectedFamiliarId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sendState, setSendState] = useState<QuickChatSendState>("idle");
  const [loading, setLoading] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/familiars");
        const json = await res.json();
        if (!alive) return;
        const next = (json?.familiars ?? []) as Familiar[];
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(LAST_FAMILIAR_KEY)
            : null;
        setFamiliars(next);
        setSelectedFamiliarId(
          (stored && next.some((familiar) => familiar.id === stored) ? stored : null) ??
            next[0]?.id ??
            null,
        );
      } catch (err) {
        if (alive) setError((err as Error)?.message ?? "Failed to load familiars.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Abort any in-flight stream when the consumer unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const selectedFamiliar = useMemo(
    () => familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? familiars[0] ?? null,
    [familiars, selectedFamiliarId],
  );

  const send = useCallback(async () => {
    const target = resolveQuickChatTarget(draft, familiars, selectedFamiliarId);
    setError(target.error);
    setAnswer("");
    setSessionId(null);
    if (target.error || !target.familiarId) return;

    setSendState("sending");
    setSelectedFamiliarId(target.familiarId);
    window.localStorage.setItem(LAST_FAMILIAR_KEY, target.familiarId);

    const controller = new AbortController();
    abortRef.current = controller;
    const result = await streamFamiliarText({
      familiarId: target.familiarId,
      prompt: target.prompt,
      reasoningEffort: thinkingEffort,
      responseSpeed,
      signal: controller.signal,
      onText: (t) => setAnswer(t),
    });
    if (abortRef.current === controller) abortRef.current = null;
    setAnswer(result.text);
    setError(result.error);
    setSessionId(result.sessionId ?? null);
    setSendState("done");
  }, [draft, familiars, responseSpeed, selectedFamiliarId, thinkingEffort]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSendState("idle");
  }, []);

  return {
    familiars,
    selectedFamiliarId,
    setSelectedFamiliarId,
    selectedFamiliar,
    draft,
    setDraft,
    answer,
    error,
    sessionId,
    sendState,
    loading,
    thinkingEffort,
    setThinkingEffort,
    responseSpeed,
    setResponseSpeed,
    send,
    cancel,
  };
}
