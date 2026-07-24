"use client";

import { memo } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import type { SkillBrowserEntry } from "@/components/skill-browser";
import { sourceTarget } from "@/lib/skill-directory";

export type SkillExploreCardProps = {
  skill: SkillBrowserEntry;
  installed: boolean;
  busy: boolean;
  /** Opens the detail drawer. */
  onOpen: (skill: SkillBrowserEntry) => void;
  /** Installs or removes the skill. */
  onToggleInstall: (skill: SkillBrowserEntry) => void;
};

// Compact install counts read like the registry ("2.6M installs") — a full
// number in a chip is noise, so collapse to M/K past a threshold.
function formatInstalls(value: number | undefined): string {
  if (!value || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function firstTopic(skill: SkillBrowserEntry): string | null {
  return skill.topics?.[0] ?? skill.tags?.[0] ?? null;
}

export const SkillExploreCard = memo(function SkillExploreCard({
  skill,
  installed,
  busy,
  onOpen,
  onToggleInstall,
}: SkillExploreCardProps) {
  const source = sourceTarget(skill);
  const official = Boolean(skill.trust?.official);
  const installs = skill.installsAllTime ?? 0;
  const topic = firstTopic(skill);
  return (
    <div className="marketplace-card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(skill)}
          className="focus-ring flex min-w-0 items-center gap-3 rounded-md text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
            <Icon name="ph:sparkle" width={16} className="text-[var(--text-muted)]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">
              {skill.name}
            </span>
            <span className="block truncate text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Skill · {skill.owner ?? source}
            </span>
          </span>
        </button>
        {installed ? (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:check"
            loading={busy}
            onClick={(e) => {
              e.stopPropagation();
              onToggleInstall(skill);
            }}
            title="Installed — click to remove it"
          >
            Installed
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leadingIcon="ph:plus-bold"
            loading={busy}
            onClick={(e) => {
              e.stopPropagation();
              onToggleInstall(skill);
            }}
            title="Install this skill — familiars load it while they work"
          >
            Install
          </Button>
        )}
      </div>
      <p className="line-clamp-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">{skill.description}</p>
      <div
        className="marketplace-card__decision"
        aria-label={`Decision notes: ${formatInstalls(installs)} installs; ${official ? "Official" : "Community"}${topic ? `; ${topic}` : ""}`}
      >
        <span className="marketplace-card__decision-chip" title={`${installs.toLocaleString()} installs`}>
          <Icon name="ph:download-simple" width={11} aria-hidden /> {formatInstalls(installs)} installs
        </span>
        <span className="marketplace-card__decision-chip" title={official ? "Official skill" : "Community skill"}>
          <Icon name="ph:mask-happy" width={11} aria-hidden /> {official ? "Official" : "Community"}
        </span>
        {topic ? (
          <span className="marketplace-card__decision-chip" title={topic}>
            <Icon name="ph:lightning-bold" width={11} aria-hidden /> {topic}
          </span>
        ) : null}
      </div>
      <div className="marketplace-card__meta">
        <span>
          <Icon name="ph:sparkle" width={11} aria-hidden /> Skill
        </span>
        <span>
          <Icon name="ph:seal-check" width={11} aria-hidden /> {official ? "Official" : "Community"}
        </span>
      </div>
    </div>
  );
});
