"use client";

import React from "react";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import { PluginCard } from "@/components/plugin-card";
import { SkillCard } from "@/components/skill-card";
import {
  CapabilitiesView,
  type HarnessCapabilityManifest,
} from "@/components/capability-card";
import {
  SkillDetailDrawer,
  type SkillEntry as SkillEntryWithDetail,
  type FamiliarForSkill,
} from "@/components/skill-detail-drawer";

type Tab = "roles" | "skills" | "plugins" | "capabilities";

type HarnessReport = {
  id: string;
  label: string;
  binary: string;
  chatSupported: boolean;
  installed: boolean;
  path: string | null;
  version: string | null;
};

type SkillEntry = {
  id: string;
  name: string;
  owner?: string;
  category?: string;
  tags?: string[];
  score?: number;
  source?: "local" | "daemon";
};

type RoleEntry = {
  id: string;
  name: string;
  description?: string;
  emoji?: string;
  familiar: string;
  skills: string[];
  tools: string[];
  plugins: string[];
  workflows: string[];
  active: boolean;
  activatedAt?: string;
};

type Props = {
  onOpenChat: () => void;
  onCreateSkill?: () => void;
  onCreatePlugin?: () => void;
  familiars?: FamiliarForSkill[];
};

const TAB_LABEL: Record<Tab, string> = {
  plugins: "Plugins",
  skills: "Skills",
  roles: "Roles",
  capabilities: "Capabilities",
};

const HERO_HEADLINE: Record<Tab, string> = {
  plugins: "Make Cave work your way",
  skills: "Harness your familiar's skills",
  roles: "Shape how familiars show up",
  capabilities: "Explore harness capabilities",
};

const HERO_SEARCH_PLACEHOLDER: Record<Tab, string> = {
  plugins: "Search plugins",
  skills: "Search skills",
  roles: "Search roles",
  capabilities: "Search capabilities",
};

const SECTION_LABEL: Record<Tab, string> = {
  plugins: "Harness plugins",
  skills: "Installed skills",
  roles: "Installed roles",
  capabilities: "Harness capabilities",
};

export function PluginsView({ onOpenChat, onCreateSkill, onCreatePlugin, familiars = [] }: Props) {
  const [tab, setTab] = useState<Tab>("roles");
  const [query, setQuery] = useState("");

  const [harnesses, setHarnesses] = useState<HarnessReport[]>([]);
  const [harnessesLoaded, setHarnessesLoaded] = useState(false);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);

  const handleRoleToggle = async (role: RoleEntry) => {
    const next = !role.active;
    // Optimistic update
    setRoles(prev => prev.map(r => r.id === role.id && r.familiar === role.familiar ? { ...r, active: next } : r));
    try {
      const res = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: role.id, familiar: role.familiar, active: next }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      // Rollback on error
      setRoles(prev => prev.map(r => r.id === role.id && r.familiar === role.familiar ? { ...r, active: role.active } : r));
    }
  };
  const [capabilities, setCapabilities] = useState<HarnessCapabilityManifest[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesRefresh, setCapabilitiesRefresh] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillEntryWithDetail | null>(null);
  const createRef = useRef<HTMLDivElement | null>(null);

  // Reset query when switching tabs
  const handleTabChange = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    setQuery("");
  };

  useEffect(() => {
    if (tab === "plugins" && !harnessesLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/harnesses", { cache: "no-store" });
          const json = await res.json();
          if (!cancelled && json.ok) setHarnesses(json.harnesses ?? []);
        } catch {
          /* leave empty */
        } finally {
          if (!cancelled) setHarnessesLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }
    if (tab === "skills" && !skillsLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const [daemonRes, localRes] = await Promise.allSettled([
            fetch("/api/skills", { cache: "no-store" }).then(r => r.json()),
            fetch("/api/skills/local", { cache: "no-store" }).then(r => r.json()),
          ]);
          if (!cancelled) {
            const daemonSkills: SkillEntry[] = daemonRes.status === "fulfilled" && daemonRes.value.ok
              ? (daemonRes.value.skills ?? []).map((s: SkillEntry) => ({ ...s, source: "daemon" as const }))
              : [];
            const localSkills: SkillEntry[] = localRes.status === "fulfilled" && localRes.value.ok
              ? (localRes.value.skills ?? []).map((s: SkillEntry) => ({ ...s, source: "local" as const }))
              : [];
            // Deduplicate by id — local wins over daemon
            const seen = new Set<string>();
            const merged: SkillEntry[] = [];
            for (const s of [...localSkills, ...daemonSkills]) {
              if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
            }
            setSkills(merged);
            setSkillsError(null);
          }
        } catch (err) {
          if (!cancelled) setSkillsError(err instanceof Error ? err.message : "fetch failed");
        } finally {
          if (!cancelled) setSkillsLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }
    if (tab === "roles" && !rolesLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/roles", { cache: "no-store" });
          const json = await res.json();
          if (!cancelled) {
            if (json.ok) {
              setRoles(json.roles ?? []);
              setRolesError(null);
            } else {
              setRolesError(json.error ?? "failed to load roles");
            }
          }
        } catch (err) {
          if (!cancelled) setRolesError(err instanceof Error ? err.message : "fetch failed");
        } finally {
          if (!cancelled) setRolesLoaded(true);
        }
      })();
      return () => { cancelled = true; };
    }
    if (tab === "capabilities" && !capabilitiesLoaded) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(`/api/capabilities${capabilitiesRefresh ? '?refresh=1' : ''}`, { cache: "no-store" });
          const json = await res.json();
          if (!cancelled) {
            if (json.ok) {
              setCapabilities(json.harness_capabilities ?? []);
              setCapabilitiesError(null);
            } else {
              setCapabilitiesError(json.error ?? "daemon offline");
            }
          }
        } catch (err) {
          if (!cancelled) setCapabilitiesError(err instanceof Error ? err.message : "fetch failed");
        } finally {
          if (!cancelled) { setCapabilitiesLoaded(true); setCapabilitiesRefresh(false); }
        }
      })();
      return () => { cancelled = true; };
    }
  }, [tab, harnessesLoaded, skillsLoaded, rolesLoaded, capabilitiesLoaded]);

  const filteredHarnesses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return harnesses;
    return harnesses.filter(
      (h) =>
        h.label.toLowerCase().includes(q) ||
        h.id.toLowerCase().includes(q),
    );
  }, [harnesses, query]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.owner ?? "").toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q),
    );
  }, [skills, query]);

  const filteredRoles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.familiar ?? "").toLowerCase().includes(q) ||
      r.skills.some(s => s.toLowerCase().includes(q))
    );
  }, [roles, query]);

  const installedHarnessCount = harnesses.filter((h) => h.installed).length;
  const pageMeta =
    tab === "plugins"
      ? harnessesLoaded
        ? `${installedHarnessCount}/${harnesses.length} installed`
        : "Loading plugins"
      : tab === "skills"
        ? skillsLoaded && !skillsError
          ? `${skills.length} installed`
          : "Loading skills"
        : tab === "roles"
          ? rolesLoaded && !rolesError
            ? `${roles.length} installed`
            : "Loading roles"
          : capabilitiesLoaded && !capabilitiesError
            ? `${capabilities.length} manifests`
            : "Loading capabilities";

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground">
      {/* ── Top bar: tabs left, controls right ─────────────────────────── */}
      <header className="shrink-0 border-b border-border px-4 sm:px-8">
        <div className="flex h-12 items-center justify-between gap-4">
          {/* Tabs flush left — underline style */}
          <nav className="flex h-full items-end gap-1 overflow-x-auto" aria-label="View tabs">
            {(["roles", "skills", "plugins", "capabilities"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleTabChange(t)}
                className={`relative flex h-full shrink-0 items-center px-3 text-[13px] font-medium transition-colors after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:rounded-full after:transition-colors ${
                  tab === t
                    ? "text-foreground after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground after:bg-transparent"
                }`}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </nav>

          {/* Controls flush right */}
          <div className="flex shrink-0 items-center gap-2 text-[12px]">
            {tab === "capabilities" ? (
              <button
                type="button"
                onClick={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="ph:arrows-clockwise-bold" className="text-muted-foreground" width="0.8rem" />
                <span>Refresh</span>
              </button>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Coming soon"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="ph:sliders-horizontal" className="text-muted-foreground" width="0.8rem" />
                <span>Manage</span>
              </button>
            )}

            <div ref={createRef} className="relative">
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-foreground transition-colors hover:bg-muted"
                onClick={() => setCreateOpen((v) => !v)}
              >
                <span>Create</span>
                <Icon
                  name="ph:caret-down-bold"
                  className={`text-[10px] text-muted-foreground transition-transform duration-150 ${
                    createOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {createOpen && (
                <CreateDropdown
                  onClose={() => setCreateOpen(false)}
                  containerRef={createRef}
                  onCreatePlugin={onCreatePlugin}
                  onCreateSkill={onCreateSkill}
                />
              )}
            </div>

          </div>
        </div>
      </header>

      {/* ── Scrolling content ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-4 pb-12 sm:px-8">

          {/* ── Overview section ─────────────────────────────────────────── */}
          <div className="pb-6 pt-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-[22px] font-semibold text-[var(--text-primary)]">
                  {HERO_HEADLINE[tab]}
                </h1>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {pageMeta}
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenChat}
                className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="ph:chat-circle-dots-bold" width={12} />
                <span>Open chat</span>
              </button>
            </div>

            <div className="relative max-w-[560px]">
              <Icon
                name="ph:magnifying-glass-bold"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                width="0.9rem"
                height="0.9rem"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={HERO_SEARCH_PLACEHOLDER[tab]}
                className="h-10 w-full rounded-lg border border-border bg-card pl-9 pr-4 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border-strong"
              />
            </div>
          </div>

          {/* ── Section label + grid ──────────────────────────────────────── */}
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {SECTION_LABEL[tab]}
              {tab === "plugins" && harnessesLoaded && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  {installedHarnessCount}/{harnesses.length} installed
                </span>
              )}
              {tab === "skills" && skillsLoaded && !skillsError && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  {skills.length} installed
                </span>
              )}
              {tab === "roles" && rolesLoaded && !rolesError && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  {roles.length} installed
                </span>
              )}
            </h2>

            {tab === "plugins" ? (
              <PluginGrid items={filteredHarnesses} loaded={harnessesLoaded} onOpenChat={onOpenChat} />
            ) : tab === "skills" ? (
              <SkillGrid items={filteredSkills} loaded={skillsLoaded} error={skillsError} onSelect={(s) => setSelectedSkill(s)} />
            ) : tab === "roles" ? (
              <RoleGrid items={filteredRoles} loaded={rolesLoaded} error={rolesError} onToggle={handleRoleToggle} />
            ) : (
              <CapabilitiesView
                items={capabilities.filter((c) => {
                  const q = query.trim().toLowerCase();
                  return !q || c.harness_id.toLowerCase().includes(q);
                })}
                loaded={capabilitiesLoaded}
                error={capabilitiesError}
                onRefresh={() => { setCapabilitiesRefresh(true); setCapabilitiesLoaded(false); }}
              />
            )}
          </section>
        </div>
      </div>

      <SkillDetailDrawer
        skill={selectedSkill}
        familiars={familiars}
        onClose={() => setSelectedSkill(null)}
      />
    </div>
  );
}

function PluginGrid({
  items,
  loaded,
  onOpenChat,
}: {
  items: HarnessReport[];
  loaded: boolean;
  onOpenChat: () => void;
}) {
  if (!loaded) {
    return <GridSkeleton />;
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No plugins match.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((h) => (
        <PluginCard key={h.id} harness={h} onLaunch={onOpenChat} />
      ))}
    </div>
  );
}

function SkillGrid({
  items,
  loaded,
  error,
  onSelect,
}: {
  items: SkillEntry[];
  loaded: boolean;
  error: string | null;
  onSelect: (s: SkillEntryWithDetail) => void;
}) {
  if (!loaded) {
    return <GridSkeleton />;
  }
  if (error) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        Skills unavailable: {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No skills installed yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((s) => (
        <SkillCard
          key={s.id}
          skill={s}
          onClick={() => onSelect(s)}
        />
      ))}
    </div>
  );
}

function RoleGrid({
  items,
  loaded,
  error,
  onToggle,
}: {
  items: RoleEntry[];
  loaded: boolean;
  error: string | null;
  onToggle: (role: RoleEntry) => Promise<void>;
}) {
  if (!loaded) return <GridSkeleton />;
  if (error) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        Roles unavailable: {error}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
        No roles installed yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((r) => (
        <RoleCard key={r.id} role={r} onToggle={onToggle} />
      ))}
    </div>
  );
}

function RoleCard({ role, onToggle }: { role: RoleEntry; onToggle: (role: RoleEntry) => Promise<void> }) {
  const [toggling, setToggling] = React.useState(false);
  const chips = [
    role.skills.length > 0 && `${role.skills.length} skill${role.skills.length !== 1 ? "s" : ""}`,
    role.workflows.length > 0 && `${role.workflows.length} workflow${role.workflows.length !== 1 ? "s" : ""}`,
    role.tools.length > 0 && `${role.tools.length} tool${role.tools.length !== 1 ? "s" : ""}`,
  ].filter(Boolean) as string[];

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    try { await onToggle(role); } finally { setToggling(false); }
  };

  return (
    <div className={`group flex min-w-0 items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${role.active ? "border-[var(--accent)] bg-[var(--accent-subtle,var(--bg-card))]" : "border-[var(--border-hairline)] bg-[var(--bg-card)] hover:bg-muted/40"}`}>
      {/* Emoji / icon */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-raised)] text-[18px]">
        {role.emoji ?? "📦"}
      </span>
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="block truncate text-[13px] font-medium text-[var(--text-primary)]">{role.name}</span>
          {role.familiar && (
            <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{role.familiar}</span>
          )}
          {role.active && (
            <span className="ml-auto shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-white">active</span>
          )}
        </div>
        {role.description && (
          <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-muted)]">{role.description}</p>
        )}
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-md bg-[var(--bg-raised)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{c}</span>
            ))}
          </div>
        )}
      </div>
      {/* Toggle button */}
      <button
        type="button"
        disabled={toggling}
        onClick={handleToggle}
        className={`shrink-0 rounded-full p-1.5 transition-colors ${role.active ? "text-[var(--accent)] hover:bg-[var(--accent)]/10" : "text-[var(--text-muted)] hover:bg-muted"} disabled:opacity-40`}
        title={role.active ? "Deactivate role" : "Activate role"}
        aria-label={role.active ? "Deactivate role" : "Activate role"}
      >
        <Icon name={toggling ? "ph:arrows-clockwise" : role.active ? "ph:toggle-right-bold" : "ph:toggle-left-bold"} width={20} height={20} />
      </button>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
            <span className="block h-2.5 w-3/4 animate-pulse rounded bg-muted" />
          </span>
          <span className="h-7 w-7 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

// ─── Create Dropdown ───────────────────────────────────────────────────────────

type CreateDropdownProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onCreatePlugin?: () => void;
  onCreateSkill?: () => void;
};

const CREATE_ITEMS: {
  id: "plugin" | "skill";
  label: string;
  icon: IconName;
  desc: string;
}[] = [
  {
    id: "plugin",
    label: "Plugin",
    icon: "ph:puzzle-piece-bold",
    desc: "Add a new Cave plugin",
  },
  {
    id: "skill",
    label: "Skill",
    icon: "ph:sparkle-bold",
    desc: "Define a reusable familiar skill",
  },
];

function CreateDropdown({
  containerRef,
  onClose,
  onCreatePlugin,
  onCreateSkill,
}: CreateDropdownProps) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [containerRef, onClose]);

  const handlers: Record<string, (() => void) | undefined> = {
    plugin: onCreatePlugin,
    skill: onCreateSkill,
  };

  return (
    <div
      className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      role="menu"
    >
      {CREATE_ITEMS.map((item, i) => (
        <button
          key={item.id}
          role="menuitem"
          className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-[12px] transition-colors hover:bg-muted ${
            i < CREATE_ITEMS.length - 1 ? "border-b border-border" : ""
          }`}
          onClick={() => {
            handlers[item.id]?.();
            onClose();
          }}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon name={item.icon} className="text-[13px]" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-foreground">{item.label}</span>
            <span className="text-[10px] text-muted-foreground">{item.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
