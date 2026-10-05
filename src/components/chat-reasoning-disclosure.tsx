"use client";

import { useState, type ReactNode } from "react";
import { useShowThinking } from "@/lib/reasoning-visibility";

/** Preference changes apply to every block; local toggles survive token,
 * position and lifecycle updates. Pending state never overrides an opt-out. */
export function ChatReasoningDisclosure({ pending, summary, children }: {
  pending: boolean; summary: ReactNode; children: ReactNode;
}) {
  const [showThinking, , ready] = useShowThinking();
  const [preference, setPreference] = useState(showThinking);
  const [open, setOpen] = useState(showThinking);
  if (preference !== showThinking) {
    setPreference(showThinking);
    setOpen(showThinking);
  }
  // localStorage is not known during SSR. Mount the disclosure only once its
  // preference is known, rather than paint the opposite saved state first.
  if (!ready) return null;
  return (
    <details className="cave-reasoning-block mt-3" data-default-collapsed="true"
      data-streaming={pending || undefined} open={open || undefined}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}>
      <summary className="cave-tool-summary focus-ring">{summary}</summary>
      {children}
    </details>
  );
}
