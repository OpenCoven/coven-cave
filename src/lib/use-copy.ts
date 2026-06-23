"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * Copy-to-clipboard with transient "copied" feedback — the shared shape behind
 * the various copy buttons (debug pane, library preview, GitHub rows, …) that
 * each used to re-implement the same `useState` + `setTimeout` dance.
 *
 * Uses the context-safe {@link copyText} (not `navigator.clipboard` directly),
 * so copies still land — and the "Copied" confirmation only shows on real
 * success — inside the Tauri webview and over non-secure Tailscale Serve.
 *
 * `copied` flips true on a successful copy and resets after `resetMs`.
 */
export function useCopy(resetMs = 1500): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    });
  };
  return { copied, copy };
}
