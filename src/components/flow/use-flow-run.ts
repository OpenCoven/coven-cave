"use client";

import { useEffect, useMemo, useState } from "react";
import { parseFlowRunProgress, type FlowRunProgress } from "@/lib/flow/flow-progress";
import type { FlowRunRecord } from "@/lib/flows";

const POLL_MS = 2500;

const EMPTY: FlowRunProgress = {
  phases: {},
  activeNodeId: null,
  done: false,
  markersFound: false,
  steps: [],
  transcript: "",
};

/**
 * Live node-phase progress for an active flow run. Polls the run's agent
 * session transcript and parses the `@@step-…` markers into per-node phases.
 * Polling stops once the run is no longer `running` or every node has resolved,
 * keeping the last parsed phases so the canvas holds the finished state.
 */
export function useFlowRun(run: FlowRunRecord | null): FlowRunProgress {
  const sessionId = run?.sessionId ?? null;
  const live = run?.status === "running";
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    if (!sessionId) {
      setTranscript("");
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const params = new URLSearchParams({ sessionId });
        const res = await fetch(`/api/flows/session-transcript?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; transcript?: string }
          | null;
        if (!alive) return;
        if (json?.ok && typeof json.transcript === "string") {
          setTranscript(json.transcript);
        }
      } catch {
        // transient — keep the last transcript and retry on the next tick
      }
      if (alive && live) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, live]);

  // Memoize: parseFlowRunProgress regex-scans the whole transcript and mints a
  // fresh object each call. Without this it re-ran on *every* FlowView render
  // (keystroke, notice tick, unrelated setState) — even with no active run —
  // and its new object identity cascaded into re-deriving all canvas nodes.
  return useMemo(
    () => (run ? parseFlowRunProgress(transcript, run.steps) : EMPTY),
    [run, transcript],
  );
}
