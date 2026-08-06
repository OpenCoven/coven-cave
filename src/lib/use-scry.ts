"use client";

/**
 * useScry — ask a local harness what it sees in the dropped likeness
 * (cave-3rz.3).
 *
 * Fires once per FILE, in the background, the moment an image lands. What comes
 * back is never applied for the user: it is handed to the caller as
 * `suggestions`, which the rite renders as pre-filled but fully editable
 * fields. A scry that fails costs nothing — the rite still summons, the fields
 * are just empty.
 *
 * The endpoint streams (`text/event-stream`, see `src/lib/scry-stream.ts`), so
 * this hook exposes the live stage and the harness's own words as they arrive
 * rather than a single boolean. Nothing here invents a stage or advances one on
 * a timer: every field below changes only when a frame says it did.
 *
 * `EventSource` cannot POST, so the stream is read off `fetch`'s body reader.
 *
 * Pronouns are always `they/them` and always flagged as a default; the endpoint
 * never asks for and never parses them (see `src/lib/scry.ts`).
 */

import { useEffect, useState } from "react";

import { emptyScrySuggestions, type ScrySuggestions } from "@/lib/scry";
import { decodeScryStream, scryMurmur, type ScryStage } from "@/lib/scry-stream";

export type ScryState = {
  status: "idle" | "scrying" | "done" | "failed";
  /** The last stage the endpoint reported reaching. Never set locally. */
  stage: ScryStage | null;
  suggestions: ScrySuggestions | null;
  /** Which harness looked, from the moment one answers — not only at the end. */
  harnessLabel: string | null;
  /** The harness's own mid-flight words, verbatim. Null until it says
   *  something that is not its JSON answer. */
  murmur: string | null;
  /** `performance.now()` at the request, for an honest elapsed readout. */
  startedAt: number | null;
  /** Why nothing came back — shown as a plain line, never a blocking error. */
  error: string | null;
  /**
   * The endpoint's machine-readable reason, when it gave one.
   *
   * The rite branches on this: `no_local_vision_harness` means no scry is
   * possible on this machine at all, which is a fall-into-manual-mode, not an
   * error to show. Everything else is an ordinary failure. See
   * `src/lib/rite-flow.ts`.
   */
  errorCode: string | null;
};

const IDLE: ScryState = {
  status: "idle",
  stage: null,
  suggestions: null,
  harnessLabel: null,
  murmur: null,
  startedAt: null,
  error: null,
  errorCode: null,
};

const FAILED_LINE = "The scry did not come back.";

/** Read a File into the base64 data URL the endpoint expects. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Probe the harness list before anyone needs it.
 *
 * `/api/harnesses` costs ~3.4s and writes its answer into the server-side
 * cache that `/api/scry` reads. Calling it while the user is still choosing an
 * image moves that cost out of the wait entirely — it is the single largest
 * saving available, and it is a real removal rather than an animation over it.
 */
function warmHarnessCache(signal: AbortSignal): void {
  void fetch("/api/harnesses", { cache: "no-store", signal }).catch(() => {
    // Advisory. A failed warm just means the scry probes for itself.
  });
}

export function useScry(file: File | null): ScryState {
  const [state, setState] = useState<ScryState>(IDLE);

  // Warm once per mount, not per file: the cache outlives a single rite step.
  useEffect(() => {
    const controller = new AbortController();
    warmHarnessCache(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!file) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const startedAt = performance.now();
    setState({ ...IDLE, status: "scrying", startedAt });

    const fail = (error: string, code: string | null = null) => {
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        status: "failed",
        suggestions: null,
        error,
        errorCode: code,
      }));
    };

    void (async () => {
      try {
        const dataUrl = await readDataUrl(file);
        const response = await fetch("/api/scry", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          signal: controller.signal,
          body: JSON.stringify({
            image: { name: file.name, mimeType: file.type, dataUrl },
          }),
        });

        // Request-shape failures still answer as JSON with a real status; only
        // the run itself streams. Read whichever this is.
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("text/event-stream")) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          fail(payload?.error ?? FAILED_LINE, payload?.code ?? null);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          fail(FAILED_LINE);
          return;
        }
        const decoder = new TextDecoder();
        let carry = "";
        let settled = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          const decoded = decodeScryStream(decoder.decode(value, { stream: true }), carry);
          carry = decoded.carry;
          for (const event of decoded.events) {
            if (cancelled) return;
            if (event.kind === "stage") {
              setState((prev) => ({
                ...prev,
                stage: event.stage,
                harnessLabel: event.detail ?? prev.harnessLabel,
              }));
            } else if (event.kind === "text") {
              // Only prose is surfaced; the JSON answer is rendered as fields.
              const murmur = scryMurmur(event.text);
              if (murmur) setState((prev) => ({ ...prev, murmur }));
            } else if (event.kind === "done") {
              settled = true;
              setState((prev) => ({
                ...prev,
                status: "done",
                stage: "done",
                harnessLabel: event.harnessLabel ?? prev.harnessLabel,
                // Defensive: an older/odd payload still yields a complete shape
                // with the default pronouns rather than undefined in the inputs.
                suggestions: {
                  ...emptyScrySuggestions(),
                  ...(event.suggestions as Partial<ScrySuggestions>),
                },
                error: null,
                errorCode: null,
              }));
            } else if (event.kind === "error") {
              settled = true;
              fail(event.error || FAILED_LINE, event.code || null);
            }
          }
        }
        // A stream that ended without a terminal event is a failure, not a
        // silent success — the rite must never sit on "scrying" forever.
        if (!settled && !cancelled) fail(FAILED_LINE);
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        fail(FAILED_LINE);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [file]);

  return state;
}
