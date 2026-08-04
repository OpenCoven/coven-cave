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
 * Pronouns are always `they/them` and always flagged as a default; the endpoint
 * never asks for and never parses them (see `src/lib/scry.ts`).
 */

import { useEffect, useState } from "react";

import { emptyScrySuggestions, type ScrySuggestions } from "@/lib/scry";

export type ScryState = {
  status: "idle" | "scrying" | "done" | "failed";
  suggestions: ScrySuggestions | null;
  /** Which harness looked, once one has. */
  harnessLabel: string | null;
  /** Why nothing came back — shown as a plain line, never a blocking error. */
  error: string | null;
};

const IDLE: ScryState = { status: "idle", suggestions: null, harnessLabel: null, error: null };

/** Read a File into the base64 data URL the endpoint expects. */
function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function useScry(file: File | null): ScryState {
  const [state, setState] = useState<ScryState>(IDLE);

  useEffect(() => {
    if (!file) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setState({ status: "scrying", suggestions: null, harnessLabel: null, error: null });

    void (async () => {
      try {
        const dataUrl = await readDataUrl(file);
        const response = await fetch("/api/scry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            image: { name: file.name, mimeType: file.type, dataUrl },
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; error?: string; harnessLabel?: string; suggestions?: ScrySuggestions }
          | null;
        if (cancelled) return;
        if (!response.ok || !payload?.ok || !payload.suggestions) {
          setState({
            status: "failed",
            suggestions: null,
            harnessLabel: null,
            error: payload?.error ?? "The scry did not come back.",
          });
          return;
        }
        setState({
          status: "done",
          // Defensive: an older/odd payload still yields a complete shape with
          // the default pronouns rather than undefined fields in the inputs.
          suggestions: { ...emptyScrySuggestions(), ...payload.suggestions },
          harnessLabel: payload.harnessLabel ?? null,
          error: null,
        });
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        setState({
          status: "failed",
          suggestions: null,
          harnessLabel: null,
          error: "The scry did not come back.",
        });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [file]);

  return state;
}
