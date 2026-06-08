"use client";

import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { MarketplacePluginWithState } from "@/lib/plugin-marketplace";

const TRUST_LABEL: Record<MarketplacePluginWithState["trust"], string> = {
  "official-remote": "Official remote",
  "reference-local": "Reference local",
  "preview-local": "Preview local",
  "local-tool": "Local tool",
};

const CATEGORY_ICON: Record<string, IconName> = {
  "Developer Tools": "ph:code-bold",
  Productivity: "ph:tray",
  "Project Management": "ph:kanban-bold",
  Design: "ph:paint-brush",
  "Local Tools": "ph:terminal-window-bold",
  Memory: "ph:brain-bold",
  Reasoning: "ph:sparkle-bold",
  Utility: "ph:wrench-bold",
};

const ROW_CLASS =
  "focus-ring flex w-full items-center gap-4 px-3 py-3 border-b border-[var(--border-hairline)] last:border-b-0 transition-colors hover:bg-[var(--bg-raised)]";

function recommendedFor(plugin: MarketplacePluginWithState): string {
  const familiars = plugin.roleAffinity.map((entry) => entry.familiar);
  const unique = Array.from(new Set(familiars));
  if (unique.length === 0) return "No role affinity yet";
  const shown = unique.slice(0, 4).map((name) => name[0].toUpperCase() + name.slice(1));
  return unique.length > shown.length
    ? `${shown.join(", ")} +${unique.length - shown.length}`
    : shown.join(", ");
}

function serverCount(plugin: MarketplacePluginWithState): number {
  return Object.keys(plugin.mcpServers ?? {}).length;
}

function setupLabel(plugin: MarketplacePluginWithState): string {
  if (Object.keys(plugin.userConfig ?? {}).length > 0) return "Setup";
  if (serverCount(plugin) > 0) return "MCP";
  return "Skill";
}

export function PluginCard({
  plugin,
  busy,
  onClick,
}: {
  plugin: MarketplacePluginWithState;
  busy?: boolean;
  onClick?: () => void;
}) {
  const iconName = CATEGORY_ICON[plugin.category] ?? "ph:plug-bold";
  const count = serverCount(plugin);
  const recommended = recommendedFor(plugin);

  const inner = (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-muted-foreground"
      >
        <Icon name={iconName} width={16} height={16} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {plugin.displayName}
          </span>
          <span className="shrink-0 rounded-full bg-[var(--bg-elevated)] px-1.5 py-px text-[10px] text-[var(--text-muted)]">
            {plugin.category}
          </span>
        </span>
        <span className="block truncate text-[12px] text-[var(--text-muted)]">
          {plugin.description}
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <span>{TRUST_LABEL[plugin.trust]}</span>
          {count > 0 && <span>{count} MCP server{count === 1 ? "" : "s"}</span>}
          <span>Recommended for {recommended}</span>
        </span>
      </span>

      {busy ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:arrows-clockwise" width={10} />
          Updating
        </span>
      ) : plugin.installed ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <Icon name="ph:check-bold" width={10} />
          Installed
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--accent-presence)]">
          <Icon name="ph:plug-bold" width={10} />
          {setupLabel(plugin)}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        disabled={busy || plugin.installed}
        onClick={onClick}
        className={`${ROW_CLASS} disabled:cursor-default disabled:hover:bg-transparent text-left`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={ROW_CLASS}>
      {inner}
    </div>
  );
}
