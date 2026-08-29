"use client";

/**
 * AutoStatusCard — the in-thread "/auto mission phase" block. Mirrors
 * SkillStageCard (skill-stage-card.tsx): agent-emitted
 * `<coven:auto-status>` markers (auto-status-blocks.ts) update it in place as
 * the mission moves from clarifying → working → needs-approval/blocked/done.
 *
 * `needs-approval` is the one state that renders an affordance: the mission is
 * stopped on something irreversible and only a yes (or no) from the human
 * resumes it. The buttons appear only when the caller supplies both handlers —
 * chat-view passes them for the live, unanswered approval, so a historical
 * marker in an already-answered transcript renders the state without buttons.
 * `blocked` ("cannot proceed at all") keeps the plain wall: no answer unblocks
 * it, so there is nothing to approve.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { AutoMissionState } from "@/lib/auto-status-blocks";

function stateVisual(state: AutoMissionState): { label: string; cls: string; icon: Parameters<typeof Icon>[0]["name"] } {
  switch (state) {
    case "clarifying":
      return { label: "needs answers", cls: "text-[var(--text-secondary)]", icon: "ph:question" };
    case "working":
      return { label: "working", cls: "text-[var(--accent-presence)]", icon: "ph:magic-wand" };
    case "needs-approval":
      return { label: "needs your go-ahead", cls: "text-[var(--color-warning)]", icon: "ph:hand-palm" };
    case "blocked":
      return { label: "blocked — cannot proceed", cls: "text-[var(--color-danger)]", icon: "ph:hand-palm" };
    case "failed":
      return { label: "couldn't finish", cls: "text-[var(--color-danger)]", icon: "ph:warning-circle" };
    case "done":
      return { label: "mission complete", cls: "text-[var(--color-success)]", icon: "ph:check-circle" };
  }
}

export function AutoStatusCard({
  state,
  note,
  onApprove,
  onDeny,
}: {
  state: AutoMissionState;
  note?: string;
  onApprove?: () => void;
  onDeny?: () => void;
}) {
  const v = stateVisual(state);
  const approval = state === "needs-approval" && Boolean(onApprove && onDeny);
  return (
    <div
      className="cave-auto-status-card flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-1.5 text-[length:var(--text-xs)]"
      data-auto-state={state}
      role="status"
      aria-label={`Auto mission: ${v.label}${note ? ` — ${note}` : ""}`}
    >
      <span aria-hidden className={`inline-flex shrink-0 ${v.cls}`}>
        <Icon name={v.icon} width={13} />
      </span>
      <span className={`${v.cls} shrink-0 font-medium`}>{v.label}</span>
      {note ? <span className="min-w-0 truncate text-[var(--text-secondary)]" title={note}>{note}</span> : null}
      {approval ? (
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button size="xs" variant="primary" leadingIcon="ph:check" onClick={onApprove}>
            Approve
          </Button>
          <Button size="xs" variant="ghost" leadingIcon="ph:x" onClick={onDeny}>
            Deny
          </Button>
        </span>
      ) : null}
    </div>
  );
}
