"use client";

/**
 * AutoStatusCard — the in-thread "/auto mission phase" block. Mirrors
 * SkillStageCard (skill-stage-card.tsx): agent-emitted
 * `<coven:auto-status>` markers (auto-status-blocks.ts) update it in place as
 * the mission moves from clarifying → working → blocked/done.
 */

import { Icon } from "@/lib/icon";
import type { AutoMissionState } from "@/lib/auto-status-blocks";

function stateVisual(state: AutoMissionState): { label: string; cls: string; icon: Parameters<typeof Icon>[0]["name"] } {
  switch (state) {
    case "clarifying":
      return { label: "needs answers", cls: "text-[var(--text-secondary)]", icon: "ph:question" };
    case "working":
      return { label: "working", cls: "text-[var(--accent-presence)]", icon: "ph:magic-wand" };
    case "blocked":
      return { label: "blocked — needs you", cls: "text-[var(--color-danger)]", icon: "ph:hand-palm" };
    case "done":
      return { label: "mission complete", cls: "text-[var(--color-success)]", icon: "ph:check-circle" };
  }
}

export function AutoStatusCard({ state, note }: { state: AutoMissionState; note?: string }) {
  const v = stateVisual(state);
  return (
    <div
      className="cave-auto-status-card flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-1.5 text-[length:var(--text-xs)]"
      data-auto-state={state}
      role="status"
      aria-label={`Auto mission: ${v.label}${note ? ` — ${note}` : ""}`}
    >
      <span aria-hidden className={`inline-flex shrink-0 ${v.cls}`}>
        <Icon name={v.icon} width={13} />
      </span>
      <span className={`${v.cls} shrink-0 font-medium`}>{v.label}</span>
      {note ? <span className="min-w-0 truncate text-[var(--text-secondary)]" title={note}>{note}</span> : null}
    </div>
  );
}
