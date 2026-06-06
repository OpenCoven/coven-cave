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
  description?: string;
  familiar?: string;
  path?: string;
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
    setSelectedRole(prev => prev && prev.id === role.id && prev.familiar === role.familiar ? { ...prev, active: next } : prev);
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
      setSelectedRole(prev => prev && prev.id === role.id && prev.familiar === role.familiar ? role : prev);
    }
  };
  const [capabilities, setCapabilities] = useState<HarnessCapabilityManifest[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [capabilitiesRefresh, setCapabilitiesRefresh] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillEntryWithDetail | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleEntry | null>(null);
  const createRef = useRef<HTMLDivElement | null>(null);

  // Reset query when switching tabs
  const handleTabChange = (t: Tab) => {
    if (t === tab) return;
    setTab(t);
    setQuery("");
    setSelectedRole(null);
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
          const [rolesRes, daemonRes, localRes, capabilitiesRes] = await Promise.allSettled([
            fetch("/api/roles", { cache: "no-store" }).then(r => r.json()),
            fetch("/api/skills", { cache: "no-store" }).then(r => r.json()),
            fetch("/api/skills/local", { cache: "no-store" }).then(r => r.json()),
            fetch("/api/capabilities", { cache: "no-store" }).then(r => r.json()),
          ]);
          if (!cancelled) {
            if (rolesRes.status === "fulfilled" && rolesRes.value.ok) {
              setRoles(rolesRes.value.roles ?? []);
              setRolesError(null);
            } else {
              setRolesError(
                rolesRes.status === "fulfilled"
                  ? rolesRes.value.error ?? "failed to load roles"
                  : rolesRes.reason instanceof Error
                    ? rolesRes.reason.message
                    : "failed to load roles",
              );
            }

            const daemonSkills: SkillEntry[] = daemonRes.status === "fulfilled" && daemonRes.value.ok
              ? (daemonRes.value.skills ?? []).map((s: SkillEntry) => ({ ...s, source: "daemon" as const }))
              : [];
            const localSkills: SkillEntry[] = localRes.status === "fulfilled" && localRes.value.ok
              ? (localRes.value.skills ?? []).map((s: SkillEntry) => ({ ...s, source: "local" as const }))
              : [];
            if (daemonSkills.length > 0 || localSkills.length > 0) {
              const seen = new Set<string>();
              const merged: SkillEntry[] = [];
              for (const s of [...localSkills, ...daemonSkills]) {
                if (!seen.has(s.id)) {
                  seen.add(s.id);
                  merged.push(s);
                }
              }
              setSkills(merged);
              setSkillsLoaded(true);
              setSkillsError(null);
            }

            if (capabilitiesRes.status === "fulfilled" && capabilitiesRes.value.ok) {
              setCapabilities(capabilitiesRes.value.harness_capabilities ?? []);
              setCapabilitiesLoaded(true);
              setCapabilitiesError(null);
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

  const skillsById = useMemo(() => {
    const map = new Map<string, SkillEntry>();
    for (const skill of skills) {
      map.set(skill.id.toLowerCase(), skill);
      map.set(skill.name.toLowerCase(), skill);
    }
    return map;
  }, [skills]);

  const capabilitiesByPlugin = useMemo(() => {
    const map = new Map<string, { harness: string; plugin: HarnessCapabilityManifest["plugins"][number] }[]>();
    for (const manifest of capabilities) {
      for (const plugin of manifest.plugins) {
        for (const key of [plugin.id, plugin.name].map((value) => value.toLowerCase())) {
          const list = map.get(key) ?? [];
          list.push({ harness: manifest.harness_id, plugin });
          map.set(key, list);
        }
      }
    }
    return map;
  }, [capabilities]);

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
                {tab === "plugins" && harnessesLoaded && installedHarnessCount === 0 ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    No harnesses installed yet — install one to get started.
                  </p>
                ) : tab === "plugins" && harnessesLoaded ? (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {installedHarnessCount} of {harnesses.length} harnesses active
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {pageMeta}
                  </p>
                )}
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
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                <RoleGrid
                  items={filteredRoles}
                  loaded={rolesLoaded}
                  error={rolesError}
                  selectedRole={selectedRole}
                  onSelect={setSelectedRole}
                  onToggle={handleRoleToggle}
                />
                <RoleCapabilityMap
                  role={selectedRole}
                  skillsById={skillsById}
                  capabilitiesByPlugin={capabilitiesByPlugin}
                  capabilitiesLoaded={capabilitiesLoaded}
                />
              </div>
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
        <PluginCard key={h.id} harness={h} onClick={onOpenChat} />
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
  selectedRole,
  onSelect,
  onToggle,
}: {
  items: RoleEntry[];
  loaded: boolean;
  error: string | null;
  selectedRole: RoleEntry | null;
  onSelect: (role: RoleEntry) => void;
  onToggle: (role: RoleEntry) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

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
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon name="ph:mask-happy" width={18} className="text-muted-foreground" />
        </span>
        <p className="text-[13px] font-medium text-foreground">No roles installed</p>
        <p className="text-[12px] text-muted-foreground">Add a ROLE.md to a familiar&apos;s workspace to get started.</p>
      </div>
    );
  }

  // Group by familiar
  const groups = new Map<string, RoleEntry[]>();
  for (const r of items) {
    const list = groups.get(r.familiar) ?? [];
    list.push(r);
    groups.set(r.familiar, list);
  }

  const toggleCollapse = (fam: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(fam)) next.delete(fam);
      else next.add(fam);
      return next;
    });

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([fam, roles]) => {
        const isOpen = !collapsed.has(fam);
        const activeCount = roles.filter((r) => r.active).length;
        return (
          <div key={fam}>
            <button
              type="button"
              onClick={() => toggleCollapse(fam)}
              className="mb-2 flex w-full items-center gap-2 text-left"
            >
              <Icon
                name="ph:caret-right-bold"
                width={11}
                className={`shrink-0 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
              />
              <span className="text-[11px] font-semibold capitalize tracking-wide text-[var(--text-secondary)]">
                {fam}
              </span>
              <span className="rounded-full bg-[var(--bg-raised)] px-1.5 py-px text-[10px] text-[var(--text-muted)]">
                {roles.length}
              </span>
              {activeCount > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] text-emerald-300">
                  {activeCount} active
                </span>
              )}
            </button>
            {isOpen && (
              <div className="space-y-1.5">
                {roles.map((r) => (
                  <RoleCard
                    key={`${r.familiar}:${r.id}`}
                    role={r}
                    selected={selectedRole?.id === r.id && selectedRole?.familiar === r.familiar}
                    onSelect={onSelect}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Icon map for well-known chip types
const CHIP_ICON: Record<string, Parameters<typeof Icon>[0]["name"]> = {
  skills:    "ph:sparkle-bold",
  workflows: "ph:list-bullets-bold",
  tools:     "ph:wrench-bold",
  plugins:   "ph:plug-bold",
};

function RoleCard({
  role,
  selected,
  onSelect,
  onToggle,
}: {
  role: RoleEntry;
  selected: boolean;
  onSelect: (role: RoleEntry) => void;
  onToggle: (role: RoleEntry) => Promise<void>;
}) {
  const [toggling, setToggling] = React.useState(false);

  type ChipEntry = { key: string; icon: Parameters<typeof Icon>[0]["name"]; label: string };
  const chips: ChipEntry[] = ([
    role.skills.length > 0    && { key: "skills",    icon: CHIP_ICON.skills,    label: `${role.skills.length} skill${role.skills.length !== 1 ? "s" : ""}` },
    role.workflows.length > 0 && { key: "workflows", icon: CHIP_ICON.workflows, label: `${role.workflows.length} workflow${role.workflows.length !== 1 ? "s" : ""}` },
    role.tools.length > 0     && { key: "tools",     icon: CHIP_ICON.tools,     label: `${role.tools.length} tool${role.tools.length !== 1 ? "s" : ""}` },
    role.plugins.length > 0   && { key: "plugins",   icon: CHIP_ICON.plugins,   label: `${role.plugins.length} plugin${role.plugins.length !== 1 ? "s" : ""}` },
  ].filter(Boolean)) as ChipEntry[];

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);
    try { await onToggle(role); } finally { setToggling(false); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(role)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(role);
        }
      }}
      className={[
        "group flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        selected
          ? "border-[var(--accent-presence)] bg-[var(--accent-presence)]/10"
          : role.active
            ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
            : "border-[var(--border-hairline)] bg-[var(--bg-card)] hover:bg-[var(--bg-raised)]",
      ].join(" ")}
    >
      {/* Glyph */}
      <span className={[
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
        selected
          ? "bg-[var(--accent-presence)]/20 text-[var(--accent-presence)]"
          : role.active
            ? "bg-emerald-500/15 text-emerald-300"
            : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
      ].join(" ")}>
        {role.emoji ?? role.name.slice(0, 2).toUpperCase()}
      </span>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">{role.name}</span>
          {role.active && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-emerald-300">
              active
            </span>
          )}
        </div>
        {role.description ? (
          <p className="mt-px truncate text-[11px] text-[var(--text-muted)]">{role.description}</p>
        ) : chips.length > 0 ? (
          <div className="mt-px flex flex-wrap items-center gap-1">
            {chips.map((c) => (
              <span key={c.key} className="flex items-center gap-0.5 text-[11px] text-[var(--text-muted)]">
                <Icon name={c.icon} width={10} />
                {c.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Chip badges — only shown when description takes the meta slot */}
      {role.description && chips.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {chips.map((c) => (
            <span key={c.key} className="flex items-center gap-0.5 rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              <Icon name={c.icon} width={9} />
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* Toggle */}
      <button
        type="button"
        disabled={toggling}
        onClick={handleToggle}
        className={[
          "ml-auto shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-40",
          role.active
            ? "text-emerald-400 hover:bg-emerald-500/15"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
        ].join(" ")}
        title={role.active ? "Deactivate" : "Activate"}
        aria-label={role.active ? "Deactivate role" : "Activate role"}
      >
        <Icon
          name={toggling ? "ph:arrows-clockwise" : role.active ? "ph:toggle-right-bold" : "ph:toggle-left-bold"}
          width={18}
        />
      </button>
    </div>
  );
}

function RoleCapabilityMap({
  role,
  skillsById,
  capabilitiesByPlugin,
  capabilitiesLoaded,
}: {
  role: RoleEntry | null;
  skillsById: Map<string, SkillEntry>;
  capabilitiesByPlugin: Map<string, { harness: string; plugin: HarnessCapabilityManifest["plugins"][number] }[]>;
  capabilitiesLoaded: boolean;
}) {
  if (!role) {
    return (
      <aside className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center lg:sticky lg:top-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
          <Icon name="ph:cursor-click" width={18} className="text-[var(--text-muted)]" />
        </span>
        <p className="text-[12px] font-medium text-[var(--text-secondary)]">Select a role</p>
        <p className="max-w-[200px] text-[11px] leading-5 text-[var(--text-muted)]">
          Pick a role to inspect its skills, plugins, workflows, and capabilities.
        </p>
      </aside>
    );
  }

  const connectedSkills = role.skills.map((id) => {
    const skill = skillsById.get(id.toLowerCase());
    return {
      id,
      title: skill?.name ?? id,
      detail: skill?.description ?? skill?.path ?? "Declared by this role",
      status: skill ? skill.source ?? "connected" : "declared",
    };
  });

  const connectedPlugins = role.plugins.map((id) => {
    const matches = capabilitiesByPlugin.get(id.toLowerCase()) ?? [];
    return {
      id,
      title: id,
      detail: matches.length > 0
        ? matches.map((m) => `${m.harness}${m.plugin.enabled ? "" : " disabled"}`).join(" · ")
        : capabilitiesLoaded
          ? "Declared by this role"
          : "Capability scan pending",
      status: matches.length > 0 ? "connected" : "declared",
    };
  });

  const workflowItems = role.workflows.map((id) => ({
    id,
    title: id,
    detail: "Role workflow",
    status: "declared",
  }));

  const capabilityItems = [
    ...role.tools.map((id) => ({
      id,
      title: id,
      detail: "Tool or command capability",
      status: "declared",
    })),
    ...role.plugins.flatMap((id) => {
      const matches = capabilitiesByPlugin.get(id.toLowerCase()) ?? [];
      return matches.map((match) => ({
        id: `${id}:${match.harness}`,
        title: match.plugin.name,
        detail: `${match.harness} plugin · ${match.plugin.kind}${match.plugin.command ? ` · ${match.plugin.command}` : ""}`,
        status: match.plugin.enabled ? "connected" : "disabled",
      }));
    }),
  ];

  return (
    <aside className="overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-card)] lg:sticky lg:top-4">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border-hairline)] px-4 py-3">
        <span className={[
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold",
          role.active ? "bg-emerald-500/15 text-emerald-300" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
        ].join(" ")}>
          {role.emoji ?? role.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{role.name}</h3>
            <span className={`shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wide ${
              role.active ? "bg-emerald-500/15 text-emerald-300" : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
            }`}>
              {role.active ? "active" : "available"}
            </span>
          </div>
          <p className="text-[11px] capitalize text-[var(--text-muted)]">{role.familiar}</p>
        </div>
      </div>

      {/* Description */}
      {role.description && (
        <p className="border-b border-[var(--border-hairline)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {role.description}
        </p>
      )}

      {/* Metric strip */}
      <div className="grid grid-cols-4 divide-x divide-[var(--border-hairline)] border-b border-[var(--border-hairline)]">
        <RoleMetric label="Skills"    value={role.skills.length} />
        <RoleMetric label="Plugins"   value={role.plugins.length} />
        <RoleMetric label="Workflows" value={role.workflows.length} />
        <RoleMetric label="Tools"     value={role.tools.length} />
      </div>

      {/* Relation sections */}
      <div className="space-y-3 px-4 py-3">
        <RoleRelationSection title="Skills"       icon="ph:sparkle"        empty="No skills declared."       items={connectedSkills} />
        <RoleRelationSection title="Plugins"      icon="ph:plug"           empty="No plugins declared."      items={connectedPlugins} />
        <RoleRelationSection title="Workflows"    icon="ph:list-bullets"   empty="No workflows declared."   items={workflowItems} />
        <RoleRelationSection title="Capabilities" icon="ph:lightning-bold" empty="No capabilities declared." items={capabilityItems} />
      </div>
    </aside>
  );
}

function RoleMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center py-2.5">
      <p className={`text-[14px] font-semibold tabular-nums ${
        value > 0 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
      }`}>{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function RoleRelationItem({
  item,
}: {
  item: { id: string; title: string; detail: string; status: string };
}) {
  const hasDetail =
    !!item.detail &&
    item.detail !== "Declared by this role" &&
    item.detail !== "Role workflow" &&
    item.detail !== "Tool or command capability";
  const [open, setOpen] = useState(false);

  return (
    <li className="overflow-hidden rounded-md bg-[var(--bg-elevated)]/60">
      <button
        type="button"
        className="flex min-w-0 w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-elevated)]"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={hasDetail ? open : undefined}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          item.status === "connected" || item.status === "local" || item.status === "daemon"
            ? "bg-emerald-400"
            : item.status === "disabled"
              ? "bg-amber-400"
              : "bg-[var(--text-muted)]/40"
        }`} />
        <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">{item.title}</p>
        {hasDetail && (
          <Icon
            name={open ? "ph:caret-up" : "ph:caret-down"}
            width={10}
            className="shrink-0 text-[var(--text-muted)] transition-transform"
          />
        )}
      </button>
      {hasDetail && open && (
        <div className="border-t border-[var(--border-hairline)] px-2.5 py-2">
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{item.detail}</p>
        </div>
      )}
    </li>
  );
}

function RoleRelationSection({
  title,
  icon,
  empty,
  items,
}: {
  title: string;
  icon: IconName;
  empty: string;
  items: { id: string; title: string; detail: string; status: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon name={icon} width={11} className="text-[var(--text-muted)]" />
        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{title}</h4>
        <span className="ml-auto text-[10px] text-[var(--text-muted)]">{items.length}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item) => (
          <RoleRelationItem key={item.id} item={item} />
        ))}
      </ul>
    </section>
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
