"use client";

import { memo } from "react";
import { Icon } from "@/lib/icon";
import type { SkillBrowserEntry } from "@/lib/skill-directory";
import { MarketplaceLogo } from "@/components/marketplace/marketplace-logo";

export type SkillExploreCardProps = {
  skill: SkillBrowserEntry;
  onOpen: (skill: SkillBrowserEntry) => void;
};

export const SkillExploreCard = memo(function SkillExploreCard({
  skill,
  onOpen,
}: SkillExploreCardProps) {
  return (
    <div className="marketplace-card flex flex-col gap-3">
      <button
        type="button"
        onClick={() => onOpen(skill)}
        className="focus-ring flex min-w-0 items-center gap-3 rounded-md text-left"
      >
        <MarketplaceLogo id={skill.id} displayName={skill.name} />
        <span className="min-w-0">
          <span className="block truncate text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
            {skill.name}
          </span>
          <span className="block truncate text-[length:var(--text-sm)] text-[var(--text-muted)]">
            Local skill · {skill.local?.scope ?? "local"}
          </span>
        </span>
      </button>
      <p className="line-clamp-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{skill.description}</p>
      <div className="marketplace-card__decision" aria-label="Installed local skill">
        <span className="marketplace-card__decision-chip">
          <Icon name="ph:check-circle" width={11} aria-hidden /> Installed
        </span>
        <span className="marketplace-card__decision-chip">
          <Icon name="ph:folder-open" width={11} aria-hidden /> Local skill
        </span>
        {skill.local?.version ? (
          <span className="marketplace-card__decision-chip">
            <Icon name="ph:tag" width={11} aria-hidden /> {skill.local.version}
          </span>
        ) : null}
      </div>
      <div className="marketplace-card__meta">
        <span>
          <Icon name="ph:sparkle" width={11} aria-hidden /> Skill
        </span>
        <span>
          <Icon name="ph:folder-open" width={11} aria-hidden /> {skill.local?.scope ?? "local"}
        </span>
      </div>
    </div>
  );
});
