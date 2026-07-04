"use client";

import { memo } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { pluginBadgeState, type MarketplacePlugin } from "@/lib/marketplace-catalog";

const TRUST_LABEL: Record<string, string> = {
  "official-remote": "Official",
  "official-local": "Official",
  "reference-local": "Reference",
  "preview-local": "Preview",
  "local-tool": "Local tool",
};

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  // id-based so the parent can pass stable handlers (add/remove/setSelected/
  // setConfiguringId) directly — without per-card lambdas the memo below lets
  // unchanged cards skip re-render while the search box re-renders the surface.
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onConfigure: (id: string) => void;
};

export const MarketplaceCard = memo(function MarketplaceCard({
  plugin,
  busy,
  onOpen,
  onAdd,
  onRemove,
  onConfigure,
}: Props) {
  const state = pluginBadgeState(plugin);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(plugin.id)}
          className="focus-ring flex min-w-0 items-center gap-3 rounded-md text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
            <Icon name="ph:plug-bold" width={16} className="text-[var(--text-muted)]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-[var(--text-primary)]">
              {plugin.displayName}
            </span>
            <span className="block truncate text-[12px] text-[var(--text-muted)]">By {plugin.author}</span>
          </span>
        </button>
        {state === "needs-setup" ? (
          <Button variant="primary" size="sm" leadingIcon="ph:warning" onClick={() => onConfigure(plugin.id)}>
            Set up
          </Button>
        ) : state === "added" ? (
          <Button variant="secondary" size="sm" leadingIcon="ph:check" loading={busy} onClick={() => onRemove(plugin.id)}>
            Added
          </Button>
        ) : state === "unavailable" ? (
          <Button variant="ghost" size="sm" disabled>
            Unavailable
          </Button>
        ) : (
          <Button variant="primary" size="sm" leadingIcon="ph:plus" loading={busy} onClick={() => onAdd(plugin.id)}>
            Add
          </Button>
        )}
      </div>
      <p className="line-clamp-2 text-[12px] text-[var(--text-muted)]">{plugin.description}</p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
          <Icon name={plugin.kind === "mcp" ? "ph:plug-bold" : "ph:sparkle-bold"} width={11} aria-hidden />{" "}
          {plugin.kind === "mcp" ? "MCP" : "Skill"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
          <Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}
        </span>
        <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5">{plugin.category}</span>
        {plugin.requiresSetup && plugin.configured ? (
          <button
            type="button"
            onClick={() => onConfigure(plugin.id)}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:check-circle" width={11} aria-hidden /> Configured
          </button>
        ) : null}
        {state === "needs-setup" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[var(--text-primary)]">
            <Icon name="ph:warning" width={11} aria-hidden /> Needs setup
          </span>
        ) : null}
      </div>
    </div>
  );
});
