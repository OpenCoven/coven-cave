"use client";

import { Icon } from "@/lib/icon";
import type { SkillEntry } from "@/components/skill-detail-drawer";

export function SkillCard({
  skill,
  onClick,
}: {
  skill: SkillEntry;
  onClick: () => void;
}) {
  const meta =
    [skill.owner, skill.category].filter(Boolean).join(" · ") || "Skill";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-muted/40"
    >
      {/* Icon */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon name="ph:sparkle-bold" width={18} className="text-muted-foreground" />
      </span>

      {/* Name + meta */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {skill.name}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {meta}
        </span>
        {skill.description && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
            {skill.description}
          </span>
        )}
      </span>

      {/* Version + arrow */}
      <span className="flex shrink-0 items-center gap-2">
        {skill.version && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
            v{skill.version}
          </span>
        )}
        <Icon
          name="ph:arrow-right-bold"
          width={13}
          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </span>
    </button>
  );
}
