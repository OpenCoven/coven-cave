"use client";

import { Icon } from "@/lib/icon";

type AiToggleProps = {
  mode: "manual" | "agent";
  onChange: (mode: "manual" | "agent") => void;
  /** Optional title override for the button. */
  title?: string;
};

/**
 * Manual ↔ Agent toggle. Chrome only — not a primary CTA.
 * In "agent" mode the hairline border is replaced with the
 * OpenCoven lavender gradient (--accent-presence →
 * --accent-presence-soft) to signal AI handling.
 */
export function AiToggle({ mode, onChange, title }: AiToggleProps) {
  const next = mode === "manual" ? "agent" : "manual";
  return (
    <button
      type="button"
      className={`ui-ai-toggle${mode === "agent" ? " ui-ai-toggle--agent" : ""}`}
      onClick={() => onChange(next)}
      title={title ?? `Switch to ${next} mode`}
      aria-label={`AI mode: ${mode}`}
    >
      <Icon name={mode === "agent" ? "ph:sparkle" : "ph:hand"} width={12} />
      <span style={{ textTransform: "capitalize" }}>{mode}</span>
    </button>
  );
}
