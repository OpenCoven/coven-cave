"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchToolOutput } from "./tool-output-fetch.ts";

type OutputState = { status: "idle" | "loading" | "ready" | "error"; text?: string };
type OutputTarget = { id: string; outputSessionId?: string };
type OutputLoader = (sessionId: string, toolId: string, signal: AbortSignal) => Promise<string>;
const loadOutput: OutputLoader = (sessionId, toolId, signal) => fetchToolOutput(sessionId, toolId, fetch, signal);

/** Own a lazy read for exactly one open disclosure. A new scope/reopen gets a
 * new request key before effects run, so even a synchronous paint cannot use
 * the previous scope's result. Cleanup also rejects loaders ignoring abort. */
export function useToolOutput(target: OutputTarget, open: boolean, load: OutputLoader = loadOutput) {
  const { outputSessionId: sessionId, id: toolId } = target;
  const [attempt, setAttempt] = useState(0);
  // Replacing a history record invalidates its old read even when IDs match.
  const key = useMemo(() => ({ target, open, attempt, load }), [target, open, attempt, load]);
  const [result, setResult] = useState<OutputState & { key: object }>({ key, status: "idle" });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!open) { setResult({ key, status: "idle" }); return; }
    if (!sessionId) { setResult({ key, status: "error" }); return; }
    const controller = new AbortController();
    setResult({ key, status: "loading" });
    void load(sessionId, toolId, controller.signal).then(
      (text) => { if (!controller.signal.aborted) setResult({ key, status: "ready", text }); },
      () => { if (!controller.signal.aborted) setResult({ key, status: "error" }); },
    );
    return () => controller.abort();
  }, [key, sessionId, toolId, open, load]);
  const state: OutputState = !open ? { status: "idle" }
    : result.key === key ? result : { status: sessionId ? "loading" : "error" };
  return { ...state, retry };
}
