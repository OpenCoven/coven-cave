"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SkillCard } from "@/components/skill-card";
import {
  SkillDetailDrawer,
  type FamiliarForSkill,
  type SkillEntry as SkillDetailEntry,
} from "@/components/skill-detail-drawer";
import { listWorkflows, type WorkflowSummary } from "@/lib/workflows";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { CapabilitiesViewSurface } from "@/components/capabilities-view";

type Tab = "roles" | "workflows" | "skills" | "capabilities";

type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  emoji?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  plugins: string[];
  workflows: string[];
  path: string;
  active: boolean;
  activatedAt?: string;
};

type LocalSkillEntry = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  tags?: string[];
  path: string;
  familiar: string;
};

type Props = {
  onOpenChat: () => void;
  onOpenWorkflow?: (id: string) => void;
  onCreateSkill?: () => void;
  familiars?: FamiliarForSkill[];
  tabs?: Tab[];
  initialTab?: Tab;
  /** Pre-selects the harness filter on the Capabilities tab (the active
   *  familiar's harness), mirroring the standalone capabilities surface. */
  activeHarness?: string | null;
};

const TAB_LABEL: Record<Tab, string> = {
  roles: "Roles",
  workflows: "Workflows",
  skills: "Skills",
  capabilities: "Capabilities",
};

type IconName = Parameters<typeof Icon>[0]["name"];

// Single source of truth for every icon in this view — edit a name here to swap it everywhere.
const ICONS = {
  search: "ph:magnifying-glass",
  tabRoles: "ph:mask-happy",
  tabWorkflows: "ph:graph",
  tabSkills: "ph:sparkle",
  tabCapabilities: "ph:lightning-bold",
  workflowChip: "ph:lightning-bold",
  workflowItem: "ph:graph",
  workflowOpen: "ph:arrow-right-bold",
} satisfies Record<string, IconName>;

const TAB_ICON: Record<Tab, IconName> = {
  roles: ICONS.tabRoles,
  workflows: ICONS.tabWorkflows,
  skills: ICONS.tabSkills,
  capabilities: ICONS.tabCapabilities,
};

function includesQuery(values: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function PluginsView({
  onOpenChat,
  onOpenWorkflow,
  onCreateSkill,
  familiars = [],
  tabs = ["roles", "workflows", "skills"],
  initialTab,
  activeHarness = null,
}: Props) {
  const tabSet = useMemo(() => tabs, [tabs]);
  const [tab, setTab] = useState<Tab>(() => {
    if (initialTab && tabs.includes(initialTab)) return initialTab;
    return tabs[0] ?? "roles";
  });
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [skills, setSkills] = useState<LocalSkillEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [workflowsLoaded, setWorkflowsLoaded] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [busyRoleKey, setBusyRoleKey] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetailEntry | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadRoles = useCallback(async () => {
    setRolesLoaded(false);
    try {
      const res = await fetch("/api/roles", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; roles?: RoleEntry[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? `roles http ${res.status}`);
      setRoles(json.roles ?? []);
      setRolesError(null);
    } catch (err) {
      setRoles([]);
      setRolesError(err instanceof Error ? err.message : "roles unavailable");
    } finally {
      setRolesLoaded(true);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    setSkillsLoaded(false);
    try {
      const res = await fetch("/api/skills/local", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; skills?: LocalSkillEntry[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? `skills http ${res.status}`);
      setSkills(json.skills ?? []);
      setSkillsError(null);
    } catch (err) {
      setSkills([]);
      setSkillsError(err instanceof Error ? err.message : "skills unavailable");
    } finally {
      setSkillsLoaded(true);
    }
  }, []);

  const loadWorkflows = useCallback(async () => {
    setWorkflowsLoaded(false);
    try {
      const result = await listWorkflows();
      if (!result.ok) throw new Error(result.error ?? "workflows unavailable");
      setWorkflows(result.workflows ?? []);
      setWorkflowsError(null);
    } catch (err) {
      setWorkflows([]);
      setWorkflowsError(err instanceof Error ? err.message : "workflows unavailable");
    } finally {
      setWorkflowsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
    void loadSkills();
    void loadWorkflows();
  }, [loadRoles, loadSkills, loadWorkflows]);

  useEffect(() => {
    if (tabSet.includes(tab)) return;
    setTab(tabSet[0] ?? "roles");
  }, [tab, tabSet]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredRoles = useMemo(
    () =>
      roles.filter((role) =>
        includesQuery(
          [
            role.id,
            role.name,
            role.description,
            role.familiar,
            ...role.skills,
            ...role.tools,
            ...role.plugins,
            ...role.workflows,
          ],
          query,
        ),
      ),
    [roles, query],
  );

  const filteredSkills = useMemo(
    () =>
      skills.filter((skill) =>
        includesQuery([skill.id, skill.name, skill.description, skill.kind, skill.familiar, ...(skill.tags ?? [])], query),
      ),
    [skills, query],
  );

  const filteredWorkflows = useMemo(
    () =>
      workflows.filter((workflow) =>
        includesQuery([workflow.id, workflow.name, workflow.summary, workflow.pattern, workflow.familiar], query),
      ),
    [workflows, query],
  );

  const toggleRole = async (role: RoleEntry) => {
    const key = `${role.familiar}:${role.id}`;
    const next = !role.active;
    setBusyRoleKey(key);
    setRoles((current) =>
      current.map((item) => (item.id === role.id && item.familiar === role.familiar ? { ...item, active: next } : item)),
    );
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: role.id, familiar: role.familiar, active: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) throw new Error(json.error ?? `roles http ${res.status}`);
    } catch (err) {
      setRoles((current) =>
        current.map((item) =>
          item.id === role.id && item.familiar === role.familiar ? { ...item, active: role.active } : item,
        ),
      );
      setRolesError(err instanceof Error ? err.message : "role update failed");
    } finally {
      setBusyRoleKey(null);
    }
  };

  // The Capabilities tab renders a self-contained surface that owns its own
  // loading/error UI, so the shared header error is suppressed there.
  const activeError =
    tab === "roles"
      ? rolesError
      : tab === "skills"
        ? skillsError
        : tab === "workflows"
          ? workflowsError
          : null;

  // "Open Capabilities" (the Skills empty-state CTA) now switches to the
  // sibling Capabilities tab when it's present, falling back to the legacy
  // callback for callers that render the Skills tab on its own.
  const openCapabilities = useCallback(() => {
    if (tabSet.includes("capabilities")) {
      setTab("capabilities");
      setQuery("");
    } else {
      onCreateSkill?.();
    }
  }, [tabSet, onCreateSkill]);

  return (
    <section className="plugins-view flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      <div className="border-b border-[var(--border-hairline)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Roles
            </p>
            <h2 className="text-[20px] font-semibold text-[var(--text-primary)]">
              Role and capability map
            </h2>
          </div>
          {tab === "capabilities" ? null : (
            <label className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3 py-2 lg:w-80">
              <Icon name={ICONS.search} width={15} className="shrink-0 text-[var(--text-muted)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${TAB_LABEL[tab].toLowerCase()}`}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </label>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {tabSet.map((nextTab) => (
            <button
              key={nextTab}
              type="button"
              onClick={() => {
                setTab(nextTab);
                setQuery("");
              }}
              className={`focus-ring flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                tab === nextTab
                  ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon name={TAB_ICON[nextTab]} width={14} />
              {TAB_LABEL[nextTab]}
            </button>
          ))}
        </div>
        {activeError ? (
          <p className="mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {activeError}
          </p>
        ) : null}
      </div>

      {tab === "capabilities" ? (
        // Self-contained surface: it owns its own scroll, header, search, and
        // filters, so it renders full-bleed (no shared padding/scroll wrapper).
        <div className="flex min-h-0 flex-1 flex-col">
          <CapabilitiesViewSurface activeHarness={activeHarness} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {tab === "roles" ? (
            <RolesTab
              roles={filteredRoles}
              loaded={rolesLoaded}
              busyRoleKey={busyRoleKey}
              onToggleRole={toggleRole}
              onOpenChat={onOpenChat}
              onOpenWorkflow={onOpenWorkflow}
            />
          ) : tab === "workflows" ? (
            <WorkflowsTab workflows={filteredWorkflows} loaded={workflowsLoaded} onOpenWorkflow={onOpenWorkflow} />
          ) : (
            <SkillsTab
              skills={filteredSkills}
              loaded={skillsLoaded}
              onCreateSkill={openCapabilities}
              onSelectSkill={(skill) =>
                setSelectedSkill({
                  id: skill.id,
                  name: skill.name,
                  description: skill.description,
                  version: skill.version,
                  category: skill.kind,
                  owner: skill.familiar,
                  tags: skill.tags,
                  source: skill.path,
                })
              }
            />
          )}
        </div>
      )}

      <SkillDetailDrawer
        skill={selectedSkill}
        familiars={familiars}
        onClose={() => setSelectedSkill(null)}
      />
    </section>
  );
}

function RolesTab({
  roles,
  loaded,
  busyRoleKey,
  onToggleRole,
  onOpenChat,
  onOpenWorkflow,
}: {
  roles: RoleEntry[];
  loaded: boolean;
  busyRoleKey: string | null;
  onToggleRole: (role: RoleEntry) => void;
  onOpenChat: () => void;
  onOpenWorkflow?: (id: string) => void;
}) {
  if (!loaded) return <ListSkeleton />;
  if (roles.length === 0) return <EmptyPanel icon={ICONS.tabRoles} title="No roles found" body="Add ROLE.md files to a familiar workspace to populate this view." />;

  return (
    <div className="flex flex-col gap-2">
      {roles.map((role) => {
        const key = `${role.familiar}:${role.id}`;
        return (
          <article
            key={key}
            className="plugins-role-card rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3"
          >
            <div className="flex items-start gap-3">
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
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busyRoleKey === key}
                  onClick={() => onToggleRole(role)}
                  className="plugins-role-toggle focus-ring rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-raised)] disabled:opacity-50"
                >
                  {role.active ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={onOpenChat}
                  className="focus-ring rounded-md bg-[var(--text-primary)] px-3 py-1.5 text-[12px] text-[var(--bg-base)]"
                >
                  Open chat
                </button>
              </div>
            </div>

            <dl className="mt-3 space-y-2">
              <CapabilityRow label="Skills" items={role.skills} />
              <CapabilityRow label="Tools" items={role.tools} />
              <CapabilityRow
                label="Workflows"
                items={role.workflows}
                onOpen={onOpenWorkflow}
                openHint="Open workflow"
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
}: {
  label: string;
  items: string[];
  onOpen?: (id: string) => void;
  openHint?: string;
}) {
  return (
    <div className="plugins-role-capability grid grid-cols-[78px_minmax(0,1fr)] items-start gap-2">
      <dt className="pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="min-w-0">
        {items.length === 0 ? (
          <span className="text-[12px] text-[var(--text-muted)]">None</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) =>
              onOpen ? (
                <button
                  key={item}
                  type="button"
                  onClick={() => onOpen(item)}
                  title={openHint ? `${openHint}: ${item}` : item}
                  className="plugins-role-chip plugins-role-chip--action focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:text-[var(--accent-text)]"
                >
                  <Icon name={ICONS.workflowChip} width={10} aria-hidden />
                  {item}
                </button>
              ) : (
                <span
                  key={item}
                  className="plugins-role-chip inline-flex items-center rounded-md bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                >
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

function WorkflowsTab({
  workflows,
  loaded,
  onOpenWorkflow,
}: {
  workflows: WorkflowSummary[];
  loaded: boolean;
  onOpenWorkflow?: (id: string) => void;
}) {
  if (!loaded) return <ListSkeleton />;
  if (workflows.length === 0) return <EmptyPanel icon={ICONS.tabWorkflows} title="No workflows found" body="Workflow manifests will appear here once the library scan succeeds." />;

  return (
    <div className="divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)]">
      {workflows.map((workflow) => (
        <button
          key={workflow.id}
          type="button"
          onClick={() => onOpenWorkflow?.(workflow.id)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-raised)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)]">
            <Icon name={ICONS.workflowItem} width={16} className="text-[var(--text-muted)]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">
              {workflow.name ?? workflow.id}
            </span>
            <span className="block truncate text-[12px] text-[var(--text-muted)]">
              {[workflow.pattern, workflow.familiar, workflow.summary].filter(Boolean).join(" · ") || workflow.id}
            </span>
          </span>
          <Icon name={ICONS.workflowOpen} width={13} className="text-[var(--text-muted)]" />
        </button>
      ))}
    </div>
  );
}

function SkillsTab({
  skills,
  loaded,
  onCreateSkill,
  onSelectSkill,
}: {
  skills: LocalSkillEntry[];
  loaded: boolean;
  onCreateSkill?: () => void;
  onSelectSkill: (skill: LocalSkillEntry) => void;
}) {
  if (!loaded) return <ListSkeleton />;
  if (skills.length === 0) {
    return <EmptyPanel icon={ICONS.tabSkills} title="No local skills found" body="Create or install skills to make them available to familiars." actionLabel="Open Capabilities" onAction={onCreateSkill} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {skills.map((skill) => (
        <SkillCard
          key={`${skill.familiar}:${skill.id}:${skill.path}`}
          skill={{
            id: skill.id,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            category: skill.kind,
            owner: skill.familiar,
            tags: skill.tags,
            source: skill.path,
          }}
          onClick={() => onSelectSkill(skill)}
        />
      ))}
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <EmptyState
      icon={icon}
      headline={title}
      subtitle={body}
      actions={
        actionLabel && onAction ? (
          <Button onClick={onAction}>{actionLabel}</Button>
        ) : undefined
      }
    />
  );
}

function ListSkeleton() {
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
