"use client";

// Roles section of the Marketplace hub — role cards with per-capability rows
// (skills, MCP servers, tools, plugins, workflows). Extracted from the old
// standalone Roles page (plugins-view) when Roles and Marketplace merged into
// one surface. Chips style themselves with utilities; the one surviving CSS
// hook is plugins-role-chip--mcp (accent tint for MCP server chips).

import { useMemo } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  emoji?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  mcpServers: string[];
  plugins: string[];
  workflows: string[];
  path: string;
  active: boolean;
  activatedAt?: string;
};

const ICONS = {
  roles: "ph:mask-happy",
  skill: "ph:sparkle",
  mcpServer: "ph:plug-bold",
  tool: "ph:wrench-bold",
  plugin: "ph:puzzle-piece-bold",
  workflow: "ph:graph",
} satisfies Record<string, IconName>;

function includesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function roleMatchesQuery(role: RoleEntry, query: string): boolean {
  return includesQuery(
    [
      role.id,
      role.name,
      role.description,
      role.familiar,
      ...role.skills,
      ...role.tools,
      ...role.mcpServers,
      ...role.plugins,
      ...role.workflows,
    ],
    query,
  );
}

function roleCapabilityCount(role: RoleEntry): number {
  return role.skills.length + role.tools.length + role.mcpServers.length + role.plugins.length + role.workflows.length;
}

type Props = {
  roles: RoleEntry[];
  loaded: boolean;
  query: string;
  onClearQuery: () => void;
  busyRoleKey: string | null;
  onToggleRole: (role: RoleEntry) => void;
  onOpenChat?: (familiarId: string) => void;
  onOpenSkill?: (name: string) => void;
  /** Jumps to the hub's Browse section — the empty state's "get more" CTA. */
  onBrowseMarketplace?: () => void;
};

export function RolesSection({
  roles,
  loaded,
  query,
  onClearQuery,
  busyRoleKey,
  onToggleRole,
  onOpenChat,
  onOpenSkill,
  onBrowseMarketplace,
}: Props) {
  const filtered = useMemo(() => roles.filter((role) => roleMatchesQuery(role, query)), [roles, query]);
  const rolesSetupSummary = useMemo(() => {
    const familiars = new Set(filtered.map((role) => role.familiar));
    const mcpServers = new Set(filtered.flatMap((role) => role.mcpServers));
    const active = filtered.filter((role) => role.active).length;
    const emptyRoles = filtered.filter((role) => roleCapabilityCount(role) === 0).length;
    return [
      {
        icon: "ph:check-circle" as const,
        label: "Active roles",
        value: `${active}/${filtered.length}`,
        detail: active === filtered.length ? "Every visible role is enabled" : "Enabled for familiar work",
      },
      {
        icon: "ph:users-three" as const,
        label: "Familiars",
        value: String(familiars.size),
        detail: "Owners represented here",
      },
      {
        icon: ICONS.mcpServer,
        label: "MCP links",
        value: String(mcpServers.size),
        detail: "Unique server bindings",
      },
      {
        icon: emptyRoles > 0 ? "ph:warning" as const : "ph:seal-check" as const,
        label: "Setup gaps",
        value: emptyRoles > 0 ? String(emptyRoles) : "None",
        detail: emptyRoles > 0 ? "Roles without capabilities" : "Visible roles have coverage",
      },
    ];
  }, [filtered]);

  if (!loaded) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)]"
          />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return query ? (
      <EmptyState
        icon="ph:magnifying-glass"
        headline="No roles match your search"
        subtitle={`Nothing matches “${query}”. Try a different term or clear the search.`}
        actions={<Button onClick={onClearQuery}>Clear search</Button>}
      />
    ) : (
      <EmptyState
        icon={ICONS.roles}
        headline="No roles found"
        subtitle="Add ROLE.md files to a familiar workspace to populate this view, or browse the marketplace to give your familiars new capabilities."
        actions={
          onBrowseMarketplace ? (
            <Button onClick={onBrowseMarketplace}>Browse the marketplace</Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="marketplace-roles-summary" aria-label="Roles setup summary">
        {rolesSetupSummary.map((item) => (
          <div key={item.label} className="marketplace-roles-summary__card">
            <span className="marketplace-roles-summary__label">
              <Icon name={item.icon} width={13} aria-hidden />
              {item.label}
            </span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
      {filtered.map((role) => {
        const key = `${role.familiar}:${role.id}`;
        const capabilityCount = roleCapabilityCount(role);
        return (
          <article
            key={key}
            className="plugins-role-card rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[15px] font-semibold text-[var(--text-primary)]">
                  {role.emoji || role.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{role.name}</h3>
                    <span className="rounded-full bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {role.familiar}
                    </span>
                    {role.active ? (
                      <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] text-[var(--accent-text)]">
                        Active
                      </span>
                    ) : null}
                  </div>
                  {role.description ? (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-secondary)]">{role.description}</p>
                  ) : null}
                  <div className="plugins-role-card__facts" aria-label={`${role.name} setup facts`}>
                    <span className="plugins-role-card__fact">
                      <Icon name={role.active ? "ph:check-circle" : "ph:circle"} width={11} aria-hidden />
                      {role.active ? "Enabled" : "Disabled"}
                    </span>
                    <span className="plugins-role-card__fact">
                      <Icon name="ph:lightning-bold" width={11} aria-hidden />
                      {capabilityCount} {capabilityCount === 1 ? "capability" : "capabilities"}
                    </span>
                    <span className="plugins-role-card__fact">
                      <Icon name={ICONS.mcpServer} width={11} aria-hidden />
                      {role.mcpServers.length} MCP
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <button
                  type="button"
                  disabled={busyRoleKey === key}
                  onClick={() => onToggleRole(role)}
                  className="plugins-role-toggle focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                >
                  {role.active ? "Disable" : "Enable"}
                </button>
                {onOpenChat ? (
                  <button
                    type="button"
                    onClick={() => onOpenChat(role.familiar)}
                    className="focus-ring rounded-md bg-[var(--text-primary)] px-3 py-1.5 text-[12px] text-[var(--bg-base)]"
                  >
                    Open chat
                  </button>
                ) : null}
              </div>
            </div>

            <dl className="mt-3 space-y-2">
              <CapabilityRow
                label="Skills"
                items={role.skills}
                onOpen={onOpenSkill}
                openHint="Open skill"
                icon={ICONS.skill}
              />
              <CapabilityRow
                label="MCP Servers"
                items={role.mcpServers}
                emptyText="No MCP servers"
                icon={ICONS.mcpServer}
                tone="mcp"
              />
              <CapabilityRow label="Tools" items={role.tools} icon={ICONS.tool} />
              <CapabilityRow
                label="Plugins"
                items={role.plugins}
                emptyText="No plugins"
                icon={ICONS.plugin}
              />
              <CapabilityRow
                label="Workflows"
                items={role.workflows}
                emptyText="No workflows"
                icon={ICONS.workflow}
              />
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function CapabilityRow({
  label,
  items,
  onOpen,
  openHint,
  icon,
  emptyText = "None",
  tone = "default",
}: {
  label: string;
  items: string[];
  onOpen?: (id: string) => void;
  openHint?: string;
  icon: IconName;
  emptyText?: string;
  tone?: "default" | "mcp";
}) {
  return (
    <div className="plugins-role-capability grid grid-cols-[96px_minmax(0,1fr)] items-start gap-2">
      <dt className="pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="min-w-0">
        {items.length === 0 ? (
          <span className="text-[12px] text-[var(--text-muted)]">{emptyText}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) =>
              onOpen ? (
                <button
                  key={item}
                  type="button"
                  onClick={() => onOpen(item)}
                  title={openHint ? `${openHint}: ${item}` : item}
                  className={`${tone === "mcp" ? "plugins-role-chip--mcp " : ""}focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:text-[var(--accent-text)]`}
                >
                  <Icon name={icon} width={10} aria-hidden />
                  {item}
                </button>
              ) : (
                <span
                  key={item}
                  className={`${tone === "mcp" ? "plugins-role-chip--mcp " : ""}inline-flex items-center gap-1 rounded-md bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-secondary)]`}
                >
                  {tone === "mcp" ? <Icon name={icon} width={10} aria-hidden /> : null}
                  {item}
                </span>
              ),
            )}
          </div>
        )}
      </dd>
    </div>
  );
}
