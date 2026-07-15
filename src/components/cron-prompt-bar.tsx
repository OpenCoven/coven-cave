"use client";

/**
 * CronPromptBar — a one-line "describe it" input for the cron surfaces.
 * Turns natural language ("every weekday at 9am check open PRs…") or a classic
 * cron expression ("0 9 * * 1-5") into deterministic form edits via
 * parseCronPrompt, then hands the parsed update to the host form. The host
 * merges it into its own field state, so nothing persists until Save/Create —
 * the prompt only fills the form.
 */

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import {
  describeCronPromptUpdate,
  parseCronPrompt,
  type CronPromptUpdate,
} from "@/lib/cron-prompt";

export function CronPromptBar({
  onApply,
  disabled,
  placeholder = 'Describe it — "every weekday at 9am, check open PRs" or "0 9 * * 1-5"',
  ariaLabel = "Describe the cron in plain language",
  className,
}: {
  /** Merge the parsed update into the host form's field state. */
  onApply: (update: CronPromptUpdate) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "miss"; message: string } | null>(null);

  const apply = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const update = parseCronPrompt(trimmed);
    if (!update) {
      setFeedback({
        tone: "miss",
        message: "Nothing actionable found — try a cadence (“every weekday at 9am”), a cron line, or “name it …”.",
      });
      return;
    }
    onApply(update);
    setFeedback({
      tone: "ok",
      message: `Updated ${describeCronPromptUpdate(update)} — review below, then save.`,
    });
    setText("");
  };

  return (
    <div className={className}>
      <div
        className="flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5"
        style={{
          borderColor: "color-mix(in oklch, var(--accent-presence) 35%, var(--border-hairline))",
          background: "color-mix(in oklch, var(--accent-presence) 6%, var(--bg-base))",
        }}
      >
        <span aria-hidden style={{ color: "var(--accent-presence)", lineHeight: 0 }}>
          <Icon name="ph:sparkle" width={13} />
        </span>
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (feedback) setFeedback(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
          style={{ color: "var(--text-primary)" }}
        />
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled || text.trim().length === 0}
          onClick={apply}
          className="shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[11px] font-medium"
          style={{ color: "var(--accent-presence)" }}
        >
          Apply
        </Button>
      </div>
      {/* role=status: applied/miss feedback is announced without stealing focus. */}
      <p role="status" className="mt-1 min-h-0 text-[11px]" style={{ color: feedback?.tone === "miss" ? "var(--color-warning)" : "var(--text-muted)" }}>
        {feedback?.message ?? ""}
      </p>
    </div>
  );
}
