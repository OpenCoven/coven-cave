"use client";

import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { SkillEntry } from "@/components/skill-detail-drawer";

// ── Skill icon resolver ───────────────────────────────────────────────────────
// Priority: exact name match → category match → tag match → fallback

type IconRule = { pattern: RegExp; icon: IconName };

const NAME_RULES: IconRule[] = [
  { pattern: /xurl|twitter|x.com/i,          icon: "ph:x-logo-bold" },
  { pattern: /github/i,                        icon: "ph:github-logo" },
  { pattern: /git/i,                         icon: "ph:git-branch-bold" },
  { pattern: /codex/i,                         icon: "ph:terminal-window-bold" },
  { pattern: /claude/i,                        icon: "ph:brain-bold" },
  { pattern: /openclaw|opencoven|coven/i,      icon: "ph:paw-print-bold" },
  { pattern: /copilot/i,                       icon: "ph:git-branch-bold" },
  { pattern: /figma|design/i,                  icon: "ph:pen-nib-bold" },
  { pattern: /linear/i,                        icon: "ph:arrow-clockwise-bold" },
  { pattern: /notion/i,                        icon: "ph:note-bold" },
  { pattern: /slack/i,                         icon: "ph:slack-logo-bold" },
  { pattern: /discord/i,                       icon: "ph:discord-logo-bold" },
  { pattern: /telegram/i,                      icon: "ph:telegram-logo-bold" },
  { pattern: /email|mail|gmail/i,              icon: "ph:envelope-bold" },
  { pattern: /calendar|schedule/i,             icon: "ph:calendar-bold" },
  { pattern: /browser|chrome|web/i,            icon: "ph:globe-bold" },
  { pattern: /search|query/i,                  icon: "ph:magnifying-glass-bold" },
  { pattern: /file|document|doc/i,             icon: "ph:file-text-bold" },
  { pattern: /image|vision|photo/i,            icon: "ph:image-bold" },
  { pattern: /audio|voice|tts|speech/i,        icon: "ph:waveform-bold" },
  { pattern: /video/i,                         icon: "ph:video-bold" },
  { pattern: /database|sql|data/i,             icon: "ph:database-bold" },
  { pattern: /api|http|fetch|request/i,        icon: "ph:cloud-arrow-up-bold" },
  { pattern: /deploy|ci|cd|build/i,            icon: "ph:rocket-bold" },
  { pattern: /test|spec|qa/i,                  icon: "ph:check-circle-bold" },
  { pattern: /code|script|program/i,           icon: "ph:code-bold" },
  { pattern: /memory|remember|recall/i,        icon: "ph:brain-bold" },
  { pattern: /task|todo|board/i,               icon: "ph:kanban-bold" },
  { pattern: /shell|bash|zsh|terminal/i,       icon: "ph:terminal-bold" },
  { pattern: /package|npm|pnpm|yarn/i,         icon: "ph:package-bold" },
  { pattern: /docker|container/i,              icon: "ph:cube-bold" },
  { pattern: /aws|cloud|gcp|azure/i,           icon: "ph:cloud-bold" },
  { pattern: /analytics|metric|stat/i,         icon: "ph:chart-bar-bold" },
  { pattern: /social|post|tweet/i,             icon: "ph:share-network-bold" },
  { pattern: /write|draft|copy|content/i,      icon: "ph:pencil-bold" },
  { pattern: /review|pr|pull.?request/i,       icon: "ph:git-pull-request-bold" },
  { pattern: /issue|bug|ticket/i,              icon: "ph:bug-bold" },
  { pattern: /plugin|extension|harness/i,      icon: "ph:plug-bold" },
  { pattern: /role|persona|agent/i,            icon: "ph:mask-happy-bold" },
  { pattern: /cron|automation|workflow/i,      icon: "ph:clock-bold" },
  { pattern: /secret|key|auth|token/i,         icon: "ph:key-bold" },
  { pattern: /map|graph|trace/i,               icon: "ph:graph-bold" },
];

const CAT_RULES: IconRule[] = [
  { pattern: /devrel|community/i,     icon: "ph:users-three-bold" },
  { pattern: /dev|engineering/i,      icon: "ph:code-bold" },
  { pattern: /social|marketing/i,     icon: "ph:share-network-bold" },
  { pattern: /writing|content/i,      icon: "ph:pencil-line-bold" },
  { pattern: /research|reading/i,     icon: "ph:books-bold" },
  { pattern: /ops|infra|system/i,     icon: "ph:sliders-horizontal-bold" },
  { pattern: /data|analytics/i,       icon: "ph:chart-bar-bold" },
];

function resolveSkillIcon(skill: SkillEntry): IconName {
  const hay = [skill.name, skill.id].join(" ");
  for (const r of NAME_RULES) {
    if (r.pattern.test(hay)) return r.icon;
  }
  if (skill.category) {
    for (const r of CAT_RULES) {
      if (r.pattern.test(skill.category)) return r.icon;
    }
  }
  if (skill.tags) {
    for (const tag of skill.tags) {
      for (const r of NAME_RULES) {
        if (r.pattern.test(tag)) return r.icon;
      }
    }
  }
  return "ph:wrench-bold";
}

export function SkillCard({
  skill,
  onClick,
}: {
  skill: SkillEntry;
  onClick: () => void;
}) {
  const meta =
    [skill.owner, skill.category].filter(Boolean).join(" · ") || "Skill";
  const icon = resolveSkillIcon(skill);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-0 w-full items-center gap-3 rounded-xl border border-border bg-[#050409] px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-[#111018]"
    >
      {/* Icon */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#111018]">
        <Icon name={icon} width={18} className="text-muted-foreground" />
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
          <span className="rounded-full bg-[#111018] px-1.5 py-0.5 text-[9px] text-muted-foreground">
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
