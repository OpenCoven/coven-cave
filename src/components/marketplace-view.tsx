"use client";

// Marketplace hub — the store and your familiars' setup merged into one
// surface. A section tablist (Browse · Roles · Skills · Capabilities) sits in
// the hero: Browse is the plugin store (collections, categories, cards);
// Roles/Skills/Capabilities are the "what my familiars can do" views that used
// to live on the separate Roles page. Deep links via WorkspaceMode still work —
// the "roles" and "capabilities" modes open the matching section here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/ui/tabs";
import { MarketplaceCard } from "@/components/marketplace/marketplace-card";
import { MarketplaceDetail } from "@/components/marketplace/marketplace-detail";
import { MarketplaceConfigure } from "@/components/marketplace/marketplace-configure";
import { CollectionStrip } from "@/components/marketplace/collection-strip";
import { RolesSection, type RoleEntry } from "@/components/marketplace/roles-section";
import { SkillBrowser, type SkillBrowserEntry } from "@/components/skill-browser";
import {
  SkillDetailDrawer,
  type FamiliarForSkill,
  type SkillEntry as SkillDetailEntry,
} from "@/components/skill-detail-drawer";
import { CapabilitiesViewSurface } from "@/components/capabilities-view";
import {
  categoriesFrom,
  filterPlugins,
  sortPlugins,
  countByKind,
  resolveCollection,
  COLLECTIONS,
  type KindFilter,
  type SortKey,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";

export type MarketplaceSection = "browse" | "roles" | "skills" | "capabilities";

const SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Browse", icon: "ph:storefront-bold" },
  { id: "roles", label: "Roles", icon: "ph:mask-happy" },
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
  { id: "capabilities", label: "Capabilities", icon: "ph:lightning-bold" },
];

// Hero copy per section — one surface, four clearly-named rooms.
const SECTION_COPY: Record<MarketplaceSection, { title: string; subtitle: string }> = {
  browse: {
    title: "Add tools to your familiars",
    subtitle: "Browse MCP servers and skills, then add them to give your familiars new capabilities.",
  },
  roles: {
    title: "Roles",
    subtitle: "Personas your familiars wear — each bundles skills, tools, MCP servers, and workflows.",
  },
  skills: {
    title: "Skills",
    subtitle: "Reusable SKILL.md procedures your familiars can load while they work.",
  },
  capabilities: {
    title: "Capabilities",
    subtitle: "What each harness supports — compare tools and features side by side.",
  },
};

const SEARCH_LABEL: Record<Exclude<MarketplaceSection, "capabilities">, string> = {
  browse: "Search the marketplace",
  roles: "Search roles",
  skills: "Search skills",
};

const KIND_TABS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mcp", label: "MCP servers" },
  { id: "skill", label: "Skills" },
];

const SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "name", label: "Name (A–Z)" },
  { id: "installed", label: "Installed first" },
];

// Map a scanned local skill to the detail drawer's shape (shared by the Skills
// browser and the role-card skill chips).
function toSkillDetail(skill: SkillBrowserEntry): SkillDetailEntry {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    category: skill.kind,
    owner: skill.familiar,
    tags: skill.tags,
    source: skill.path,
  };
}

type Props = {
  /** Which section to land on — deep links from the roles/capabilities modes. */
  initialSection?: MarketplaceSection;
  /** Pre-selects the harness filter on the Capabilities section. */
  activeHarness?: string | null;
  /** Familiars offered by the skill detail drawer's "try it" affordances. */
  familiars?: FamiliarForSkill[];
  /** Opens a chat with the familiar that owns a role. */
  onOpenChat?: (familiarId: string) => void;
};

export function MarketplaceViewSurface({
  initialSection = "browse",
  activeHarness = null,
  familiars = [],
  onOpenChat,
}: Props = {}) {
  const [section, setSection] = useState<MarketplaceSection>(initialSection);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  // Store state (Browse section).
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("All");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [configuringId, setConfiguringId] = useState<string | null>(null);

  // Setup state (Roles / Skills sections).
  const [roles, setRoles] = useState<RoleEntry[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [busyRoleKey, setBusyRoleKey] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillBrowserEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetailEntry | null>(null);
  // Each loader keeps its in-flight controller so a newer load (or unmount)
  // aborts the previous one — a slow response can't land after a fresher one
  // and clobber the list (the useProjects hygiene pattern). A superseded load
  // bails before touching state; only the winning load flips its loaded flag.
  const loadCtl = useRef<AbortController | null>(null);
  const rolesCtl = useRef<AbortController | null>(null);
  const skillsCtl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadCtl.current?.abort();
    const ctl = new AbortController();
    loadCtl.current = ctl;
    setLoaded(false);
    try {
      const res = await fetch("/api/marketplace", { cache: "no-store", signal: ctl.signal });
      const json = (await res.json()) as { ok?: boolean; plugins?: MarketplacePlugin[]; error?: string };
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? `marketplace http ${res.status}`);
      setPlugins(json.plugins ?? []);
      setError(null);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setPlugins([]);
      setError(err instanceof Error ? err.message : "marketplace unavailable");
    } finally {
      if (!ctl.signal.aborted) setLoaded(true);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    rolesCtl.current?.abort();
    const ctl = new AbortController();
    rolesCtl.current = ctl;
    setRolesLoaded(false);
    try {
      const res = await fetch("/api/roles", { cache: "no-store", signal: ctl.signal });
      const json = (await res.json()) as { ok?: boolean; roles?: RoleEntry[]; error?: string };
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? `roles http ${res.status}`);
      setRoles(json.roles ?? []);
      setRolesError(null);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setRoles([]);
      setRolesError(err instanceof Error ? err.message : "roles unavailable");
    } finally {
      if (!ctl.signal.aborted) setRolesLoaded(true);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    skillsCtl.current?.abort();
    const ctl = new AbortController();
    skillsCtl.current = ctl;
    setSkillsLoaded(false);
    try {
      const res = await fetch("/api/skills/local", { cache: "no-store", signal: ctl.signal });
      const json = (await res.json()) as { ok?: boolean; skills?: SkillBrowserEntry[]; error?: string };
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? `skills http ${res.status}`);
      setSkills(json.skills ?? []);
      setSkillsError(null);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setSkills([]);
      setSkillsError(err instanceof Error ? err.message : "skills unavailable");
    } finally {
      if (!ctl.signal.aborted) setSkillsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRoles();
    void loadSkills();
    return () => {
      loadCtl.current?.abort();
      rolesCtl.current?.abort();
      skillsCtl.current?.abort();
    };
  }, [load, loadRoles, loadSkills]);

  // "/" focuses the hub search from anywhere on the surface (unless typing).
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

  // Switch sections (clearing the per-section search). Shared by the tab
  // buttons, the tablist's arrow-key navigation, and cross-section CTAs.
  const selectSection = useCallback((next: MarketplaceSection) => {
    setSection(next);
    setQuery("");
  }, []);

  const categories = useMemo(() => categoriesFrom(plugins), [plugins]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of plugins) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    return counts;
  }, [plugins]);
  const kindCounts = useMemo(() => countByKind(plugins), [plugins]);
  const installedCount = useMemo(() => plugins.filter((p) => p.installed).length, [plugins]);

  const rolesSummary = useMemo(() => {
    const mcpServerNames = new Set<string>();
    let activeRoles = 0;
    for (const role of roles) {
      if (role.active) activeRoles += 1;
      for (const server of role.mcpServers) mcpServerNames.add(server);
    }
    return { activeRoles, totalRoles: roles.length, mcpServers: mcpServerNames.size };
  }, [roles]);

  const activeCollection = useMemo(
    () => COLLECTIONS.find((c) => c.id === collectionId) ?? null,
    [collectionId],
  );
  const collectionIds = useMemo(
    () => (activeCollection ? resolveCollection(plugins, activeCollection).map((p) => p.id) : undefined),
    [plugins, activeCollection],
  );

  const filtered = useMemo(() => {
    const matched = filterPlugins(plugins, {
      query,
      category: activeCollection ? "All" : category,
      kind,
      ids: collectionIds,
    });
    return sortPlugins(matched, sort);
  }, [plugins, query, category, kind, sort, collectionIds, activeCollection]);

  const selectedPlugin = useMemo(() => plugins.find((p) => p.id === selected) ?? null, [plugins, selected]);
  const configuringPlugin = useMemo(() => plugins.find((p) => p.id === configuringId) ?? null, [plugins, configuringId]);

  // The featured strip only makes sense on the unfiltered default landing.
  const showFeatured = !activeCollection && !query && category === "All" && kind === "all";

  const selectCategory = useCallback((cat: string) => {
    setCategory(cat);
    setCollectionId(null);
  }, []);

  const setInstalled = useCallback((id: string, installed: boolean) => {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, installed } : p)));
  }, []);

  const add = useCallback(async (id: string) => {
    setBusyId(id);
    setInstalled(id, true);
    try {
      const res = await fetch("/api/marketplace/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "install failed");
    } catch (err) {
      setInstalled(id, false);
      setError(err instanceof Error ? err.message : "install failed");
    } finally {
      setBusyId(null);
    }
  }, [setInstalled]);

  const remove = useCallback(async (id: string) => {
    setBusyId(id);
    setInstalled(id, false);
    try {
      const res = await fetch("/api/marketplace/uninstall", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "uninstall failed");
    } catch (err) {
      setInstalled(id, true);
      setError(err instanceof Error ? err.message : "uninstall failed");
    } finally {
      setBusyId(null);
    }
  }, [setInstalled]);

  const toggleRole = useCallback(async (role: RoleEntry) => {
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
  }, []);

  // A role-card skill chip opens that skill's detail drawer (resolving the
  // chip's name against the scanned local skills). Unknown/not-yet-loaded
  // skills fall back to the Skills section, pre-filtered to the name.
  const openSkillByName = useCallback(
    (name: string) => {
      const match = skills.find(
        (s) => s.id === name || s.name.toLowerCase() === name.toLowerCase(),
      );
      if (match) {
        setSelectedSkill(toSkillDetail(match));
        return;
      }
      setSection("skills");
      setQuery(name);
    },
    [skills],
  );

  const copy = SECTION_COPY[section];
  const activeError =
    section === "browse" ? error
    : section === "roles" ? rolesError
    : section === "skills" ? skillsError
    : null;

  return (
    // @container/marketplace — layout responds to the PANE width, not the
    // viewport, so the surface also adapts inside a narrow drag-to-split pane
    // on a wide screen (same pattern as chat's chatlist/composer containers).
    <section className="marketplace-view @container/marketplace flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      {/* Hero header — kicker, per-section title/stats, search, section tabs. */}
      <header className="border-b border-[var(--border-hairline)] px-4 py-4 @min-[560px]/marketplace:px-6 @min-[560px]/marketplace:py-5">
        <div className="flex flex-col gap-4 @min-[840px]/marketplace:flex-row @min-[840px]/marketplace:items-start @min-[840px]/marketplace:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Marketplace
            </p>
            <h2 className="mt-0.5 text-[24px] font-semibold leading-tight text-[var(--text-primary)]">
              {copy.title}
            </h2>
            <p className="mt-1 max-w-prose text-[13px] text-[var(--text-muted)]">
              {copy.subtitle}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {section === "browse" ? (
                <>
                  <StatPill icon="ph:plug-bold" label={`${kindCounts.mcp} MCP servers`} />
                  <StatPill icon="ph:sparkle-bold" label={`${kindCounts.skill} skills`} />
                  {installedCount > 0 ? (
                    <StatPill icon="ph:check-circle" label={`${installedCount} added`} accent />
                  ) : null}
                </>
              ) : section === "roles" ? (
                <>
                  <StatPill icon="ph:mask-happy" label={`${rolesSummary.totalRoles} roles`} />
                  {rolesSummary.activeRoles > 0 ? (
                    <StatPill icon="ph:check-circle" label={`${rolesSummary.activeRoles} active`} accent />
                  ) : null}
                  <StatPill icon="ph:plug-bold" label={`${rolesSummary.mcpServers} MCP servers`} />
                </>
              ) : section === "skills" ? (
                <StatPill icon="ph:sparkle-bold" label={`${skills.length} skills`} />
              ) : null}
            </div>
          </div>
          {section !== "capabilities" ? (
            <SearchInput
              ref={searchRef}
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              placeholder={SEARCH_LABEL[section]}
              containerClassName="@min-[840px]/marketplace:w-96"
              aria-label={SEARCH_LABEL[section]}
            />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {/* Section tabs — the merged surface's primary navigation. */}
          <div
            ref={tablistRef}
            role="tablist"
            aria-label="Marketplace sections"
            className="flex flex-wrap gap-1"
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
              e.preventDefault();
              const i = SECTIONS.findIndex((s) => s.id === section);
              const ni =
                e.key === "ArrowRight" ? (i + 1) % SECTIONS.length
                : e.key === "ArrowLeft" ? (i - 1 + SECTIONS.length) % SECTIONS.length
                : e.key === "Home" ? 0
                : SECTIONS.length - 1;
              const next = SECTIONS[ni];
              if (next) {
                selectSection(next.id);
                tablistRef.current?.querySelector<HTMLButtonElement>(`#marketplace-tab-${next.id}`)?.focus();
              }
            }}
          >
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                id={`marketplace-tab-${s.id}`}
                aria-selected={section === s.id}
                aria-controls={`marketplace-panel-${s.id}`}
                tabIndex={section === s.id ? 0 : -1}
                onClick={() => selectSection(s.id)}
                className={`focus-ring flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                  section === s.id
                    ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon name={s.icon} width={14} />
                {s.label}
              </button>
            ))}
          </div>

          {section === "browse" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Tabs
                items={KIND_TABS}
                value={kind}
                onChange={setKind}
                variant="segment"
                size="sm"
                bordered={false}
                ariaLabel="Filter plugins by type"
              />
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <span className="sr-only">Sort plugins</span>
                <Icon name="ph:sort-ascending" width={14} aria-hidden />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  aria-label="Sort plugins"
                  className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>

        {activeError ? (
          <p className="mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
            {activeError}
          </p>
        ) : null}
      </header>

      {section === "browse" ? (
        <div
          role="tabpanel"
          id="marketplace-panel-browse"
          aria-labelledby="marketplace-tab-browse"
          className="flex min-h-0 flex-1"
        >
          {/* Vertical category rail (wide panes) plus a "Your setup" cross-nav
              group, so the store stays aware of what your familiars already
              have. */}
          <aside
            className="hidden w-56 shrink-0 overflow-y-auto border-r border-[var(--border-hairline)] px-3 py-4 @min-[840px]/marketplace:block"
            aria-label="Browse by category"
          >
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Browse
            </p>
            <nav className="flex flex-col gap-0.5">
              {categories.map((cat) => {
                const active = !activeCollection && category === cat;
                const count = cat === "All" ? plugins.length : categoryCounts.get(cat) ?? 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    aria-current={active ? "true" : undefined}
                    className={`focus-ring flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                      active
                        ? "bg-[var(--bg-raised)] font-medium text-[var(--text-primary)]"
                        : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <span className="truncate">{cat}</span>
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${
                        active ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
            <p className="px-2 pb-2 pt-5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Your setup
            </p>
            <nav className="flex flex-col gap-0.5" aria-label="Your setup">
              <SetupRailLink
                icon="ph:mask-happy"
                label="Roles"
                detail={rolesLoaded ? `${rolesSummary.activeRoles}/${rolesSummary.totalRoles}` : undefined}
                onClick={() => selectSection("roles")}
              />
              <SetupRailLink
                icon="ph:sparkle"
                label="Skills"
                detail={skillsLoaded ? String(skills.length) : undefined}
                onClick={() => selectSection("skills")}
              />
              <SetupRailLink
                icon="ph:lightning-bold"
                label="Capabilities"
                onClick={() => selectSection("capabilities")}
              />
            </nav>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 @min-[560px]/marketplace:px-6">
            {/* Category chips — the stand-in for the rail in narrow panes/screens. */}
            <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 @min-[840px]/marketplace:hidden">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => selectCategory(cat)}
                  className={`focus-ring shrink-0 rounded-md px-3 py-1.5 text-[12px] transition-colors ${
                    !activeCollection && category === cat
                      ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {showFeatured && plugins.length > 0 ? (
              <CollectionStrip
                collections={COLLECTIONS}
                plugins={plugins}
                onOpen={(id) => {
                  setCollectionId(id);
                  setCategory("All");
                  setKind("all");
                }}
              />
            ) : null}

            {activeCollection ? (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
                    <Icon name={activeCollection.icon} width={18} className="text-[var(--text-primary)]" />
                  </span>
                  <div>
                    <p className="text-[14px] font-semibold text-[var(--text-primary)]">{activeCollection.title}</p>
                    <p className="text-[12px] text-[var(--text-muted)]">{activeCollection.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCollectionId(null)}
                  className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:arrow-left" width={12} aria-hidden /> All plugins
                </button>
              </div>
            ) : (
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {query
                    ? "Search results"
                    : category === "All" && kind === "all"
                      ? "All plugins"
                      : category !== "All"
                        ? category
                        : KIND_TABS.find((k) => k.id === kind)?.label ?? "Plugins"}
                </h3>
                {loaded ? (
                  <span className="text-[12px] text-[var(--text-muted)] tabular-nums">
                    {filtered.length} {filtered.length === 1 ? "result" : "results"}
                  </span>
                ) : null}
              </div>
            )}

            {!loaded ? (
              <p className="text-[12px] text-[var(--text-muted)]">Loading…</p>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="ph:puzzle-piece-bold"
                headline={query || category !== "All" || kind !== "all" || activeCollection ? "No matching plugins" : "No plugins available"}
                subtitle={query || category !== "All" || kind !== "all" || activeCollection ? "Try a different search, type, or category." : "The catalog is empty."}
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 @min-[560px]/marketplace:grid-cols-2 @min-[1200px]/marketplace:grid-cols-3">
                {filtered.map((plugin) => (
                  <MarketplaceCard
                    key={plugin.id}
                    plugin={plugin}
                    busy={busyId === plugin.id}
                    onOpen={setSelected}
                    onAdd={add}
                    onRemove={remove}
                    onConfigure={setConfiguringId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : section === "roles" ? (
        <div
          role="tabpanel"
          id="marketplace-panel-roles"
          aria-labelledby="marketplace-tab-roles"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 @min-[560px]/marketplace:px-6"
        >
          <RolesSection
            roles={roles}
            loaded={rolesLoaded}
            query={query}
            onClearQuery={() => setQuery("")}
            busyRoleKey={busyRoleKey}
            onToggleRole={(role) => void toggleRole(role)}
            onOpenChat={onOpenChat}
            onOpenSkill={openSkillByName}
            onBrowseMarketplace={() => selectSection("browse")}
          />
        </div>
      ) : section === "skills" ? (
        // Full-bleed 3-column browser that owns its own per-column scrolling.
        <div
          role="tabpanel"
          id="marketplace-panel-skills"
          aria-labelledby="marketplace-tab-skills"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <SkillBrowser
            skills={skills}
            loaded={skillsLoaded}
            query={query}
            onClearQuery={() => setQuery("")}
            onCreateSkill={() => selectSection("capabilities")}
            onChanged={loadSkills}
          />
        </div>
      ) : (
        // Self-contained surface: it owns its own scroll, header, search, and
        // filters, so it renders full-bleed (no shared padding/scroll wrapper).
        <div
          role="tabpanel"
          id="marketplace-panel-capabilities"
          aria-labelledby="marketplace-tab-capabilities"
          className="flex min-h-0 flex-1 flex-col"
        >
          <CapabilitiesViewSurface activeHarness={activeHarness} />
        </div>
      )}

      {selectedPlugin ? (
        <MarketplaceDetail
          plugin={selectedPlugin}
          busy={busyId === selectedPlugin.id}
          onClose={() => setSelected(null)}
          onAdd={() => void add(selectedPlugin.id)}
          onRemove={() => void remove(selectedPlugin.id)}
        />
      ) : null}

      {configuringPlugin ? (
        <MarketplaceConfigure
          pluginId={configuringPlugin.id}
          displayName={configuringPlugin.displayName}
          open={true}
          onClose={() => setConfiguringId(null)}
          onChanged={() => void load()}
        />
      ) : null}

      <SkillDetailDrawer
        skill={selectedSkill}
        familiars={familiars}
        onClose={() => setSelectedSkill(null)}
      />
    </section>
  );
}

function SetupRailLink({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon name={icon} width={13} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      {detail ? (
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">{detail}</span>
      ) : null}
    </button>
  );
}

function StatPill({ icon, label, accent }: { icon: IconName; label: string; accent?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
        accent
          ? "border-[var(--accent-faint)] bg-[var(--accent-faint)] text-[var(--accent)]"
          : "border-[var(--border-hairline)] bg-[var(--bg-panel)] text-[var(--text-secondary)]"
      }`}
    >
      <Icon name={icon} width={12} aria-hidden />
      {label}
    </span>
  );
}
