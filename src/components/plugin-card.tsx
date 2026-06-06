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

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-w-0 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        harness.installed
          ? "border-border bg-[#050409] hover:border-border-strong hover:bg-[#111018]"
          : "border-border bg-[#050409] opacity-50 hover:opacity-70"
      }`}
    >
      {/* Icon */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#111018] text-muted-foreground">
        {iconName ? (
          <Icon name={iconName} width={18} height={18} />
        ) : (
          <span className="text-[15px] font-semibold text-foreground">
            {(harness.label.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase()}
          </span>
        )}
      </span>

      {/* Name + tagline */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {harness.label}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {tagline}
        </span>
      </span>

      {/* Install status */}
      {harness.installed ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/60"
          title="Installed"
        >
          <Icon name="ph:check-bold" width={13} />
        </span>
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors group-hover:border-border-strong group-hover:text-foreground">
          <Icon name="ph:plus-bold" width={11} />
        </span>
      )}
    </button>
  );
}
