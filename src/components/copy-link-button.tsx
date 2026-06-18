"use client";

import { useCallback, useState } from "react";
import { Icon } from "@/lib/icon";

/**
 * Copies the current page URL to the clipboard with brief inline feedback.
 * Used in the daily-report / dashboard top bars so a report is one click to
 * share. Falls back silently when the clipboard API is unavailable.
 */
export function CopyLinkButton({ label = "Copy link" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions) — no-op.
    }
  }, []);

  return (
    <button type="button" className="dr-btn dr-btn--sm focus-ring" onClick={onCopy}>
      <Icon name={copied ? "ph:check" : "ph:link"} aria-hidden />
      {copied ? "Copied" : label}
    </button>
  );
}
