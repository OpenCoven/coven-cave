"use client";

import { useEffect, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import type { SessionRow } from "@/lib/types";

export function isFlowSession(session: Partial<SessionRow> | null | undefined): boolean {
  return session?.origin === "flow" || Boolean(session?.flow);
}

export function useFlowDiscussion(
  onOpenSession: (sessionId: string, familiarId: string) => void,
  scopeKey?: string | null,
) {
  const { announce } = useAnnouncer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;

  useEffect(() => {
    setBusy(false);
    setError(null);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [scopeKey]);

  async function discuss(sessionId: string) {
    if (pending.current) return;
    const controller = new AbortController();
    const startedFor = scopeKey;
    pending.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/flows/discussion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
        signal: controller.signal,
      });
      const result = await response.json() as {
        ok?: boolean; sessionId?: string; familiarId?: string; error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Try again when the execution is available.");
      }
      if (
        typeof result.sessionId !== "string" || !result.sessionId.trim()
        || result.sessionId === sessionId
        || typeof result.familiarId !== "string" || !result.familiarId.trim()
      ) {
        throw new Error("The server did not return a separate chat. Try again.");
      }
      if (controller.signal.aborted || currentScope.current !== startedFor) return;
      announce("Discussion opened in Chat.");
      onOpenSession(result.sessionId, result.familiarId);
    } catch (cause) {
      if (controller.signal.aborted || currentScope.current !== startedFor) return;
      const message = cause instanceof Error ? cause.message : "Try again.";
      setError(message);
      announce(`Couldn’t open discussion. ${message}`, "assertive");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  return { discuss, busy, error };
}
