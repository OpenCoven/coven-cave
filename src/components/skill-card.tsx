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
  const initial = (skill.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  const meta = [
    skill.owner && `by ${skill.owner}`,
    skill.category,
    skill.source === "local" && "local",
  ].filter(Boolean).join(" · ") || "Skill";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 w-full items-center gap-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Icon */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">
        {initial}
      </span>

      {/* Name + meta */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
          {skill.name}
        </span>
        <span className="block truncate text-[12px] text-[var(--text-muted)]">
          {meta}
        </span>
      </span>

      {/* Arrow flush right */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-hairline)] text-[var(--text-muted)] transition-colors group-hover:border-[var(--border-strong)] group-hover:text-[var(--text-primary)]">
        <Icon name="ph:arrow-right-bold" width={12} />
      </span>
    </button>
  );
}
