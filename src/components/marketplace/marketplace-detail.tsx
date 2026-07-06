"use client";

import { useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { pluginBadgeState, type MarketplacePlugin } from "@/lib/marketplace-catalog";
import { openExternalUrl } from "@/lib/open-external";

const TRUST_LABEL: Record<string, string> = {
  "official-remote": "Official remote",
  "official-local": "Official (local)",
  "reference-local": "Reference (local)",
  "preview-local": "Preview (local)",
  "local-tool": "Local tool",
};

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  onClose: () => void;
  onAdd: () => void;
  onRemove: () => void;
};

function kindIcon(kind: MarketplacePlugin["kind"]) {
  if (kind === "mcp") return "ph:plug-bold";
  if (kind === "api") return "ph:cloud-bold";
  return "ph:sparkle-bold";
}

function kindLabel(kind: MarketplacePlugin["kind"]) {
  if (kind === "mcp") return "MCP server";
  if (kind === "api") return "API";
  return "Skill";
}

function detailDecisionItems(plugin: MarketplacePlugin) {
  const requiredFields = plugin.requiredConfig.length;
  const capabilities = plugin.capabilities.length > 0 ? plugin.capabilities : plugin.keywords;
  const roles = [...new Set(plugin.roleAffinity.flatMap((entry) => entry.roles).filter(Boolean))];
  const setup = !plugin.available
    ? {
      icon: "ph:warning" as const,
      value: "Unavailable",
      detail: "This listing cannot be added from Cave right now.",
    }
    : plugin.requiresSetup && !plugin.configured
      ? {
        icon: "ph:key" as const,
        value: requiredFields > 0 ? `${requiredFields} credential${requiredFields === 1 ? "" : "s"}` : "Needs setup",
        detail: "Add it now, then finish credentials before runtime use.",
      }
      : plugin.requiresSetup && plugin.configured
        ? {
          icon: "ph:check-circle" as const,
          value: "Configured",
          detail: "Credentials are already saved for this installation.",
        }
        : plugin.policy.authentication === "ON_INSTALL"
          ? {
            icon: "ph:lock-simple" as const,
            value: "OAuth on first use",
            detail: "No key entry here; authorize when the tool runs.",
          }
          : plugin.remoteUrl
            ? {
              icon: "ph:cloud-bold" as const,
              value: "Remote endpoint",
              detail: "Cave connects to the hosted endpoint for execution.",
            }
            : {
              icon: "ph:check-circle" as const,
              value: "No setup",
              detail: "Available immediately after adding to Cave.",
            };

  return [
    { label: "Setup effort", ...setup },
    {
      label: "Capability fit",
      icon: "ph:lightning-bold" as const,
      value: capabilities.length > 0 ? capabilities.slice(0, 3).join(", ") : "Core capability",
      detail: capabilities.length > 3 ? `And ${capabilities.length - 3} more — full list below.` : "Primary ways this listing extends a familiar.",
    },
    {
      label: "Role fit",
      icon: "ph:mask-happy" as const,
      value: roles.length > 0 ? roles.slice(0, 3).join(", ") : "General fit",
      detail: roles.length > 3 ? `And ${roles.length - 3} more — full list below.` : "Best matching familiar role assignments.",
    },
  ];
}

export function MarketplaceDetail({ plugin, busy, onClose, onAdd, onRemove }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  type ConnState = { state: "idle" | "testing" | "reachable" | "unreachable"; message?: string };
  const [conn, setConn] = useState<ConnState>({ state: "idle" });

  const testConnection = useCallback(async () => {
    setConn({ state: "testing" });
    try {
      const res = await fetch("/api/marketplace/validate-endpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: plugin.id }),
      });
      const json = (await res.json()) as { ok?: boolean; reachable?: boolean; detail?: string | null; error?: string | null };
      if (!json.ok) throw new Error(json.error ?? "check failed");
      setConn(json.reachable
        ? { state: "reachable", message: json.detail ?? "Reachable" }
        : { state: "unreachable", message: json.error ?? "Unreachable" });
    } catch (err) {
      setConn({ state: "unreachable", message: err instanceof Error ? err.message : "check failed" });
    }
  }, [plugin.id]);
  useFocusTrap(true, ref, { onEscape: onClose });
  const state = pluginBadgeState(plugin);
  const decisionItems = detailDecisionItems(plugin);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} details`}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
              <Icon name={kindIcon(plugin.kind)} width={18} className="text-[var(--text-muted)]" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-[var(--text-primary)]">{plugin.displayName}</h2>
              <p className="truncate text-[12px] text-[var(--text-muted)]">By {plugin.author} · {plugin.category}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        {plugin.description ? <p className="text-[13px] text-[var(--text-primary)]">{plugin.description}</p> : null}

        <div className="marketplace-detail__decision-grid" aria-label="Install decision summary">
          {decisionItems.map((item) => (
            <div key={item.label} className="marketplace-detail__decision-card">
              <span className="marketplace-detail__decision-label">
                <Icon name={item.icon} width={12} aria-hidden />
                {item.label}
              </span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
            <Icon name={kindIcon(plugin.kind)} width={11} aria-hidden />{" "}
            {kindLabel(plugin.kind)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
            <Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}
          </span>
          {plugin.policy.authentication === "ON_INSTALL" ? (
            <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5">Auth on install</span>
          ) : null}
          {plugin.requiresSetup ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
              <Icon name="ph:warning" width={11} aria-hidden /> Needs setup
            </span>
          ) : null}
        </div>

        {plugin.capabilities.length ? (
          <Section title="Capabilities">
            <div className="flex flex-wrap gap-1.5">
              {plugin.capabilities.map((c) => (
                <span key={c} className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{c}</span>
              ))}
            </div>
          </Section>
        ) : null}

        {plugin.roleAffinity.length ? (
          <Section title="Role affinity">
            <ul className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
              {plugin.roleAffinity.map((ra) => (
                <li key={ra.familiar}><span className="text-[var(--text-primary)]">{ra.familiar}</span> · {ra.roles.join(", ")}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {plugin.requiresSetup ? (
          <Section title="Required configuration">
            <p className="text-[12px] text-[var(--text-muted)]">
              This plugin needs credentials before it can run. Adding it now records your choice; credential setup is a later step.
            </p>
          </Section>
        ) : null}

        {plugin.remoteUrl ? (
          <Section title="Connection">
            <p className="text-[11px] text-[var(--text-muted)]">
              Authenticates via OAuth when first used — no setup needed here.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={conn.state === "testing"}
                onClick={() => void testConnection()}
              >
                Test connection
              </Button>
              {conn.state === "reachable" || conn.state === "unreachable" ? (
                <span
                  role="status"
                  className={`inline-flex items-center gap-1 text-[11px] ${conn.state === "reachable" ? "text-[var(--text-primary)]" : "text-[var(--danger-text)]"}`}
                >
                  <Icon name={conn.state === "reachable" ? "ph:check-circle" : "ph:warning"} width={12} aria-hidden />
                  {conn.message}
                </span>
              ) : null}
            </div>
          </Section>
        ) : null}

        {plugin.homepage || plugin.repository ? (
          <Section title="Links">
            <div className="flex flex-col gap-1 text-[12px]">
              {plugin.homepage ? (
                <a
                  className="text-[var(--text-primary)] underline"
                  href={plugin.homepage}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(plugin.homepage || "");
                  }}
                >
                  Homepage
                </a>
              ) : null}
              {plugin.repository ? (
                <a
                  className="text-[var(--text-primary)] underline"
                  href={plugin.repository}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(plugin.repository || "");
                  }}
                >
                  Repository
                </a>
              ) : null}
            </div>
          </Section>
        ) : null}

        <div className="mt-auto pt-2">
          {state === "added" ? (
            <Button variant="secondary" fullWidth leadingIcon="ph:check" loading={busy} onClick={onRemove}>Added — remove</Button>
          ) : state === "unavailable" ? (
            <Button variant="ghost" fullWidth disabled>Unavailable</Button>
          ) : (
            <Button variant="primary" fullWidth leadingIcon="ph:plus" loading={busy} onClick={onAdd}>Add to Cave</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}
