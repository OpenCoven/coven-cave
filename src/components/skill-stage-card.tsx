"use client";

/**
 * SkillStageCard — the in-thread "which skill, what stage, what came of it"
 * block (design: docs/chat-github-integration.md §5; bead cave-fpqx.11).
 * Rendered per skill name per turn: agent-emitted `<coven:skill>` markers
 * update it in place; `/skill` invocations render the deterministic
 * "invoked" form under the user turn.
 */

import { Icon } from "@/lib/icon";
import type { SkillStage } from "@/lib/skill-blocks";

const STAGE_ORDER: SkillStage[] = ["loaded", "running", "done"];

function stageVisual(stage: SkillStage | "invoked"): { label: string; cls: string } {
  switch (stage) {
    case "done":
      return { label: "done", cls: "text-[var(--color-success)]" };
    case "error":
      return { label: "error", cls: "text-[var(--color-danger)]" };
    case "running":
      return { label: "running", cls: "text-[var(--accent-presence)]" };
    case "loaded":
      return { label: "loaded", cls: "text-[var(--text-secondary)]" };
    case "invoked":
      return { label: "invoked", cls: "text-[var(--text-secondary)]" };
  }
}

export function SkillStageCard({
  name,
  stage,
  note,
}: {
  name: string;
  stage: SkillStage | "invoked";
  note?: string;
}) {
  const v = stageVisual(stage);
  return (
    <div
      className="cave-skill-card flex items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[color-mix(in_oklch,var(--bg-raised)_78%,transparent)] px-3 py-1.5 text-[length:var(--text-xs)]"
      data-skill-stage={stage}
      role="status"
      aria-label={`Skill ${name}: ${v.label}${note ? ` — ${note}` : ""}`}
    >
      <span aria-hidden className="inline-flex shrink-0 text-[var(--accent-presence)]">
        <Icon name="ph:sparkle" width={13} />
      </span>
      <span className="font-medium text-[var(--text-primary)]">{name}</span>
      {stage !== "invoked" ? (
        <span aria-hidden className="flex items-center gap-1">
          {STAGE_ORDER.map((s, i) => {
            const reached =
              stage === "error" ? i === 0 : STAGE_ORDER.indexOf(stage) >= i;
            return (
              <span
                key={s}
                className="inline-block h-1 w-1 rounded-full"
                style={{
                  background: reached ? "var(--accent-presence)" : "var(--border-strong)",
                }}
              />
            );
          })}
        </span>
      ) : null}
      <span className={`${v.cls} shrink-0`}>{v.label}</span>
      {note ? <span className="min-w-0 truncate text-[var(--text-secondary)]" title={note}>{note}</span> : null}
    </div>
  );
}
