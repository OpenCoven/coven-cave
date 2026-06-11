"use client";

import { useEffect, useState, type ReactNode } from "react";

export type ThinkingIndicatorProps = {
  /** Label next to the dots (e.g. "Thinking", "Reaching out"). */
  label?: ReactNode;
  /** When provided, shows elapsed time since this timestamp. */
  startedAt?: number;
  className?: string;
};

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

export function ThinkingIndicator({ label = "Thinking", startedAt, className }: ThinkingIndicatorProps) {
  const [elapsed, setElapsed] = useState(() => (startedAt ? Date.now() - startedAt : 0));
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    return () => clearInterval(t);
  }, [startedAt]);

  return (
    <div className={["ui-thinking", className ?? ""].filter(Boolean).join(" ")} role="status" aria-live="polite">
      <span className="ui-thinking-dots" aria-hidden>
        <span className="ui-thinking-dot" />
        <span className="ui-thinking-dot" />
        <span className="ui-thinking-dot" />
      </span>
      <span>{label}</span>
      {startedAt ? <span className="ui-thinking-timer" aria-live="off">{formatElapsed(elapsed)}</span> : null}
    </div>
  );
}
