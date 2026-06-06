"use client";

import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";

export type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
};

const HARNESS_TAGLINE: Record<string, string> = {
  codex: "Run Codex sessions from this Cave",
  claude: "Drive Claude Code from a familiar",
  openclaw: "Bring OpenClaw into the Coven",
  copilot: "Wire up GitHub Copilot CLI",
  opencode: "Run OpenCode locally",
  gemini: "Talk to Google Gemini CLI",
  hermes: "Light a Hermes runtime",
  openhands: "Open up OpenHands tasks",
  aider: "Pair with Aider in-repo",
};

const HARNESS_ICON: Record<string, IconName> = {
  codex:     "ph:terminal-window-bold",
  claude:    "ph:brain-bold",
  openclaw:  "ph:paw-print-bold",
  copilot:   "ph:git-branch-bold",
  opencode:  "ph:code-bold",
  gemini:    "ph:sparkle-bold",
  hermes:    "ph:lightning-bold",
  openhands: "ph:hand-bold",
  aider:     "ph:wrench-bold",
};

export function PluginCard({
  harness,
  onClick,
}: {
  harness: HarnessReport;
  onClick?: () => void;
}) {
  const tagline =
    HARNESS_TAGLINE[harness.id] ?? `Run ${harness.label} from a familiar`;
  const iconName = HARNESS_ICON[harness.id];

  const inner = (
    <>
      {/* Icon */}
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] ${
          harness.installed ? "text-muted-foreground" : "text-muted-foreground/40"
        }`}
      >
        {iconName ? (
          <Icon name={iconName} width={16} height={16} />
        ) : (
          <span className="text-[13px] font-semibold text-foreground">
            {(harness.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase()}
          </span>
        )}
      </span>

      {/* Name + tagline */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
          {harness.label}
        </span>
        <span className="block truncate text-[12px] text-[var(--text-muted)]">
          {tagline}
        </span>
      </span>

      {/* Install status */}
      {harness.installed ? (
        <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:check-bold" width={10} />
          Installed
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[11px] text-[oklch(0.65_0.18_280)]">
          <Icon name="ph:arrow-down-bold" width={10} />
          Install
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-4 px-0 py-3 border-b border-[var(--border-hairline)] last:border-b-0 transition-colors hover:bg-[var(--bg-raised)] text-left"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex w-full items-center gap-4 px-0 py-3 border-b border-[var(--border-hairline)] last:border-b-0 transition-colors hover:bg-[var(--bg-raised)]">
      {inner}
    </div>
  );
}
