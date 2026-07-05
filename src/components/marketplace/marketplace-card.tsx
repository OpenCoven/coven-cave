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

function kindIcon(kind: MarketplacePlugin["kind"]) {
  if (kind === "mcp") return "ph:plug-bold";
  if (kind === "api") return "ph:cloud-bold";
  return "ph:sparkle-bold";
}

function kindLabel(kind: MarketplacePlugin["kind"]) {
  if (kind === "mcp") return "MCP";
  if (kind === "api") return "API";
  return "Skill";
}

function setupEffortLabel(plugin: MarketplacePlugin) {
  if (!plugin.available) return { icon: "ph:warning" as const, label: "Unavailable" };
  if (plugin.requiresSetup && !plugin.configured) {
    const fields = plugin.requiredConfig.length;
    return {
      icon: "ph:key" as const,
      label: fields > 0 ? `${fields} credential${fields === 1 ? "" : "s"}` : "Needs setup",
    };
  }
  if (plugin.requiresSetup && plugin.configured) return { icon: "ph:check-circle" as const, label: "Configured" };
  if (plugin.policy.authentication === "ON_INSTALL") return { icon: "ph:lock-simple" as const, label: "OAuth on first use" };
  if (plugin.remoteUrl) return { icon: "ph:cloud-bold" as const, label: "Remote endpoint" };
  return { icon: "ph:check-circle" as const, label: "No setup" };
}

function capabilityPreview(plugin: MarketplacePlugin) {
  const capabilities = plugin.capabilities.length > 0 ? plugin.capabilities : plugin.keywords;
  if (capabilities.length === 0) return "Core capability";
  const first = capabilities.slice(0, 2).join(", ");
  const more = capabilities.length > 2 ? ` +${capabilities.length - 2}` : "";
  return `${first}${more}`;
}

function roleFitLabel(plugin: MarketplacePlugin) {
  const roles = plugin.roleAffinity.flatMap((entry) => entry.roles).filter(Boolean);
  if (roles.length === 0) return "General fit";
  const unique = [...new Set(roles)];
  const first = unique.slice(0, 2).join(", ");
  const more = unique.length > 2 ? ` +${unique.length - 2}` : "";
  return `${first}${more}`;
}

export const MarketplaceCard = memo(function MarketplaceCard({
  plugin,
  busy,
  onOpen,
  onAdd,
  onRemove,
  onConfigure,
}: Props) {
  const state = pluginBadgeState(plugin);
  const setup = setupEffortLabel(plugin);
  const capability = capabilityPreview(plugin);
  const roleFit = roleFitLabel(plugin);
  return (
    <div className="marketplace-card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(plugin.id)}
          className="focus-ring flex min-w-0 items-center gap-3 rounded-md text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
            <Icon name={kindIcon(plugin.kind)} width={16} className="text-[var(--text-muted)]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold text-[var(--text-primary)]">
              {plugin.displayName}
            </span>
            <span className="block truncate text-[12px] text-[var(--text-muted)]">
              {kindLabel(plugin.kind)} · {plugin.author}
            </span>
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
      <div
        className="marketplace-card__decision"
        aria-label={`Decision notes: ${setup.label}; ${capability}; ${roleFit}`}
      >
        <span className="marketplace-card__decision-chip" title={setup.label}>
          <Icon name={setup.icon} width={11} aria-hidden /> {setup.label}
        </span>
        <span className="marketplace-card__decision-chip" title={capability}>
          <Icon name="ph:lightning-bold" width={11} aria-hidden /> {capability}
        </span>
        <span className="marketplace-card__decision-chip" title={roleFit}>
          <Icon name="ph:mask-happy" width={11} aria-hidden /> {roleFit}
        </span>
      </div>
      <div className="marketplace-card__meta">
        <span>
          <Icon name={kindIcon(plugin.kind)} width={11} aria-hidden />{" "}
          {kindLabel(plugin.kind)}
        </span>
        <span>
          <Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}
        </span>
        {plugin.requiresSetup && plugin.configured ? (
          <button
            type="button"
            onClick={() => onConfigure(plugin.id)}
            className="focus-ring hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:check-circle" width={11} aria-hidden /> Configured
          </button>
        ) : null}
        {state === "needs-setup" ? (
          <span className="text-[var(--text-primary)]">
            <Icon name="ph:warning" width={11} aria-hidden /> Needs setup
          </span>
        ) : null}
      </div>
    </div>
  );
});
