"use client";

// Marketplace hub — the store and your familiars' setup merged into one
// surface. A single slim header row holds the section tabs (Browse · Crafts ·
// Skills · Build, with live counts) and the scoped search — no
// hero. Browse is the plugin store (collections, categories, cards);
// Crafts sits between Role context and effective capabilities; Skills is
// the "what my familiars can do" view that used
// to live on the separate Roles page; Build authors a new SKILL.md into a
// local skill root. Deep links via WorkspaceMode still work —
// "roles" and "capabilities" land on Browse while those sections are hidden.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { MarketplaceCard } from "@/components/marketplace/marketplace-card";
import { MarketplaceDetail } from "@/components/marketplace/marketplace-detail";
import type { CraftActionError } from "@/components/marketplace/craft-detail";
import { CraftCreateDrawer } from "@/components/marketplace/craft-create-drawer";
import { MarketplaceConfigure } from "@/components/marketplace/marketplace-configure";
import { CollectionStrip } from "@/components/marketplace/collection-strip";
import { SkillBuilder } from "@/components/marketplace/skill-builder";
import { SkillBrowser, type SkillBrowserEntry } from "@/components/skill-browser";
import {
  SkillDetailDrawer,
  type FamiliarForSkill,
  type SkillEntry as SkillDetailEntry,
} from "@/components/skill-detail-drawer";
import {
  categoriesFrom,
  filterPlugins,
  sortPlugins,
  countByKind,
  groupPluginsByCategory,
  resolveCollection,
  COLLECTIONS,
  type KindFilter,
  type SortKey,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";

export type MarketplaceSection = "browse" | "crafts" | "roles" | "skills" | "build" | "capabilities";

// Roles and Capabilities are hidden from the hub (kept in the
// MarketplaceSection type so `mode === "roles"` / `mode === "capabilities"`
// deep links keep type-checking — they land on Browse). The RolesSection
// component, its CSS, and the addons.roles config flag were removed as dead
// code (cave-vp4h); the Capabilities surface, its normalize helper, and their
// CSS followed (cave-4n7j — git history keeps them). /api/roles and
// /api/capabilities stay intact: they serve live role definitions and the
// familiar-studio Brain tab / inspector capability chips.
const SECTIONS: ReadonlyArray<{ id: MarketplaceSection; label: string; icon: IconName }> = [
  { id: "browse", label: "Browse", icon: "ph:storefront-bold" },
  { id: "crafts", label: "Crafts", icon: "ph:package-bold" },
  { id: "skills", label: "Skills", icon: "ph:sparkle" },
  { id: "build", label: "Build", icon: "ph:hammer" },
];

// One-line hint per section — surfaces as the tab tooltip (the old hero
// subtitle, demoted so the header stays a single row).
const SECTION_HINT: Record<MarketplaceSection, string> = {
  browse: "The catalog — add MCP servers, connected APIs, skills, and prompt packs to your Cave.",
  crafts: "Versioned Role loadouts — preview, verify, equip, update, and detach Craft bundles.",
  roles: "Personas your familiars wear — each bundles skills, tools, MCP servers, and workflows.",
  skills: "Skills already in your Cave — reusable SKILL.md procedures familiars load while they work.",
  build: "Author a new skill — write the SKILL.md your familiars load, straight into a local skill root.",
  capabilities: "What each runtime you've installed can do — retired from the hub; deep links land on Browse.",
};

// Build owns its surface end-to-end, so the hub search hides there and this
// record only types the searchable sections.
const SEARCH_LABEL: Record<Exclude<MarketplaceSection, "capabilities" | "build">, string> = {
  browse: "Search the marketplace",
  crafts: "Search Crafts",
  roles: "Search roles",
  skills: "Search skills",
};

const KIND_TABS: ReadonlyArray<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "api", label: "APIs" },
  { id: "mcp", label: "MCP servers" },
  { id: "skill", label: "Skills" },
  { id: "prompt", label: "Prompts" },
  { id: "knowledge-pack", label: "Knowledge packs" },
  { id: "craft", label: "Crafts" },
];

const SORT_OPTIONS: ReadonlyArray<{ id: SortKey; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "name", label: "Name (A–Z)" },
  { id: "installed", label: "Installed first" },
];

// Map a scanned local skill to the detail drawer's shape (shared by the Skills
// browser and the role-card skill chips).
function toSkillDetail(skill: SkillBrowserEntry): SkillDetailEntry {
  const owner = skill.owner && skill.repo ? `${skill.owner}/${skill.repo}` : skill.owner;
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.local?.version,
    category: skill.installed ? "Installed" : "Directory",
    owner,
    tags: [...new Set([...(skill.tags ?? []), ...(skill.topics ?? [])])],
    source: skill.path,
  };
}

type Props = {
  /** Which section to land on — deep links from the roles/capabilities modes. */
  initialSection?: MarketplaceSection;
  /** Familiars offered by the skill detail drawer's "try it" affordances. */
  familiars?: FamiliarForSkill[];
  /** Opens a chat with the familiar that owns a role. Unused while the Roles
   *  section is hidden; kept so re-enabling Roles is a UI-only change. */
  onOpenChat?: (familiarId: string) => void;
};

export function MarketplaceViewSurface({
  initialSection = "browse",
  familiars = [],
}: Props = {}) {
  // Roles and Capabilities are hidden: their deep links land on Browse.
  const [section, setSection] = useState<MarketplaceSection>(
    initialSection === "roles" || initialSection === "capabilities" ? "browse" : initialSection,
  );
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Store state (Browse section).
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("All");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<SortKey>("recommended");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creatingCraft, setCreatingCraft] = useState(false);
  const [craftErrors, setCraftErrors] = useState<Record<string, CraftActionError | undefined>>({});
  // Ids with an install/uninstall in flight. A Set (not a scalar) so two
  // concurrent installs each keep their own busy state — with a scalar, the
  // second click overwrote the first and whichever settled first cleared the
  // other's spinner. The ref mirror lets load() read the in-flight set without
  // re-creating the loader.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyIdsRef = useRef<ReadonlySet<string>>(busyIds);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const markBusy = useCallback((id: string, busy: boolean) => {
    const next = new Set(busyIdsRef.current);
    if (busy) next.add(id);
    else next.delete(id);
    busyIdsRef.current = next;
    setBusyIds(next);
  }, []);

  // Setup state (Skills section).
  const [skills, setSkills] = useState<SkillBrowserEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetailEntry | null>(null);
  // Each loader keeps its in-flight controller so a newer load (or unmount)
  // aborts the previous one — a slow response can't land after a fresher one
  // and clobber the list (the useProjects hygiene pattern). A superseded load
  // bails before touching state; only the winning load flips its loaded flag.
  const loadCtl = useRef<AbortController | null>(null);
  const skillsCtl = useRef<AbortController | null>(null);
  // Install / remove / role-toggle / configure surface their outcome as
  // visual-only <p> banners (not toasts), so mirror success + errors to the
  // shared live region — otherwise these core actions are silent to AT.
  const { announce } = useAnnouncer();

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
      // A reload can land while an install/uninstall is still writing (e.g.
      // the configure dialog fires onChanged → load()). For those ids, keep
      // the optimistic `installed` — the response was snapshotted before the
      // write finished and would silently revert the button.
      setPlugins((prev) => {
        const next = json.plugins ?? [];
        if (busyIdsRef.current.size === 0) return next;
        const prevById = new Map(prev.map((p) => [p.id, p]));
        return next.map((p) => {
          const pending = busyIdsRef.current.has(p.id) ? prevById.get(p.id) : undefined;
          return pending ? { ...p, installed: pending.installed } : p;
        });
      });
      setError(null);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setPlugins([]);
      setError(err instanceof Error ? err.message : "marketplace unavailable");
    } finally {
      if (!ctl.signal.aborted) setLoaded(true);
    }
  }, []);

  const loadSkills = useCallback(async (search = "") => {
    skillsCtl.current?.abort();
    const ctl = new AbortController();
    skillsCtl.current = ctl;
    setSkillsLoaded(false);
    try {
      const trimmed = search.trim();
      const url = trimmed ? `/api/skills/directory?q=${encodeURIComponent(trimmed)}` : "/api/skills/directory";
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
      const json = (await res.json()) as {
        ok?: boolean;
        entries?: SkillBrowserEntry[];
        error?: string;
        source?: string;
        fetchedAt?: string;
      };
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? `skills http ${res.status}`);
      setSkills(json.entries ?? []);
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
    void loadSkills();
    return () => {
      loadCtl.current?.abort();
      skillsCtl.current?.abort();
    };
  }, [load, loadSkills]);

  useEffect(() => {
    if (section !== "skills") return;
    const timeout = window.setTimeout(() => {
      void loadSkills(query);
    }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [section, query, loadSkills]);

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

  // The slim header's tab items — label plus a live count per section. Counts
  // appear once their loader settles so the header never flashes a stale 0;
  // the old hero subtitle survives as the tab tooltip.
  const sectionTabs = useMemo<ReadonlyArray<TabItem<MarketplaceSection>>>(
    () =>
      SECTIONS.map((s) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        count:
          s.id === "browse" && loaded ? plugins.length
          : s.id === "crafts" && loaded ? plugins.filter((plugin) => plugin.kind === "craft").length
          : s.id === "skills" && skillsLoaded ? skills.length
          : undefined,
        title: SECTION_HINT[s.id],
      })),
    [loaded, plugins.length, skillsLoaded, skills.length],
  );

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
  const groupedFiltered = useMemo(() => groupPluginsByCategory(filtered), [filtered]);
  const groupedKindCounts = useMemo(() => countByKind(filtered), [filtered]);
  const craftPlugins = useMemo(
    () => sortPlugins(filterPlugins(plugins, { query, kind: "craft" }), sort),
    [plugins, query, sort],
  );

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
    const plugin = plugins.find((entry) => entry.id === id);
    if (!plugin) return;
    const isCraft = plugin.kind === "craft";
    markBusy(id, true);
    if (!isCraft) setInstalled(id, true);
    setError(null); // a fresh attempt clears any prior failure banner (it's only
                    // set on error and was otherwise never cleared without a reload)
    setCraftErrors((current) => ({ ...current, [id]: undefined }));
    try {
      const endpoint = plugin.kind === "craft"
        ? "/api/marketplace/crafts/install"
        : "/api/marketplace/install";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        installedAt?: string;
        verifiedAt?: string;
        runtime?: string;
        craftVersion?: string;
        diagnostic?: CraftActionError;
      };
      if (!json.ok) {
        const message = json.error ?? "install failed";
        if (isCraft) {
          setCraftErrors((current) => ({
            ...current,
            [id]: {
              message,
              code: json.code,
              affectedRoles: json.diagnostic?.affectedRoles,
              affectedRoleCount: json.diagnostic?.affectedRoleCount,
              affectedRolesTruncated: json.diagnostic?.affectedRolesTruncated,
            },
          }));
        } else {
          setInstalled(id, false);
          setError(message);
        }
        announce(message, "assertive");
        return;
      }
      if (isCraft) {
        setPlugins((current) => current.map((entry) => entry.id === id ? {
          ...entry,
          installed: true,
          updateAvailable: false,
          installation: {
            version: json.craftVersion ?? entry.version,
            source: "catalog",
            installedAt: json.installedAt ?? new Date().toISOString(),
            runtime: json.runtime,
            verifiedAt: json.verifiedAt,
            craftVersion: json.craftVersion ?? entry.version,
          },
        } : entry));
        announce("Craft installed and verified", "polite");
      } else {
        announce("Added to your setup", "polite");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "install failed";
      if (isCraft) setCraftErrors((current) => ({ ...current, [id]: { message: msg } }));
      else {
        setInstalled(id, false);
        setError(msg);
      }
      announce(msg, "assertive");
    } finally {
      markBusy(id, false);
    }
  }, [announce, markBusy, plugins, setInstalled]);

  const remove = useCallback(async (id: string) => {
    const plugin = plugins.find((entry) => entry.id === id);
    if (!plugin) return;
    const isCraft = plugin.kind === "craft";
    markBusy(id, true);
    if (!isCraft) setInstalled(id, false);
    setError(null); // clear any prior failure banner on a fresh attempt
    setCraftErrors((current) => ({ ...current, [id]: undefined }));
    try {
      const endpoint = plugin.kind === "craft"
        ? "/api/marketplace/crafts/uninstall"
        : "/api/marketplace/uninstall";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        diagnostic?: CraftActionError;
      };
      if (!json.ok) {
        const message = json.error ?? "uninstall failed";
        if (isCraft) {
          setCraftErrors((current) => ({
            ...current,
            [id]: {
              message,
              code: json.code,
              affectedRoles: json.diagnostic?.affectedRoles,
              affectedRoleCount: json.diagnostic?.affectedRoleCount,
              affectedRolesTruncated: json.diagnostic?.affectedRolesTruncated,
            },
          }));
        } else {
          setInstalled(id, true);
          setError(message);
        }
        announce(message, "assertive");
        return;
      }
      if (isCraft) {
        setPlugins((current) => current.map((entry) => {
          if (entry.id !== id) return entry;
          const { installation: _installation, ...withoutInstallation } = entry;
          return { ...withoutInstallation, installed: false, updateAvailable: false };
        }));
        announce("Craft removed", "polite");
      } else {
        setInstalled(id, false);
        announce("Removed from your setup", "polite");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "uninstall failed";
      if (isCraft) setCraftErrors((current) => ({ ...current, [id]: { message: msg } }));
      else {
        setInstalled(id, true);
        setError(msg);
      }
      announce(msg, "assertive");
    } finally {
      markBusy(id, false);
    }
  }, [announce, markBusy, plugins, setInstalled]);

  const activeError =
    section === "browse" ? error
    : section === "skills" ? skillsError
    : null;

  // Browse toolbar context — names the active scope only when it isn't the
  // default landing (the rail highlight and search box already show it, and
  // the collection banner names an open collection).
  const scopeLabel = activeCollection
    ? null
    : query.trim()
      ? "Search results"
      : category !== "All"
        ? category
        : null;

  return (
    // @container/marketplace — layout responds to the PANE width, not the
    // viewport, so the surface also adapts inside a narrow drag-to-split pane
    // on a wide screen (same pattern as chat's chatlist/composer containers).
    <section className="marketplace-view @container/marketplace flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
      {/* Compact header — one slim topmost band (shared .surface-compact
          chrome with Rituals and the GitHub surface): small title, size-sm
          segment section tabs (live counts, subtitle as tooltip), scoped
          search on the right. The shared Tabs primitive supplies
          role=tablist/tab, roving tabindex, and the marketplace-tab / panel
          aria wiring via idPrefix. */}
      <header className="surface-compact-header">
        <h1 className="surface-compact-title">Marketplace</h1>
        <Tabs
          items={sectionTabs}
          value={section}
          onChange={selectSection}
          ariaLabel="Marketplace sections"
          idPrefix="marketplace"
          variant="segment"
          size="sm"
          className="surface-compact-tabs"
        />
        <div className="surface-compact-actions">
          {section !== "capabilities" && section !== "build" ? (
            <SearchInput
              ref={searchRef}
              value={query}
              onValueChange={setQuery}
              onClear={() => setQuery("")}
              placeholder={SEARCH_LABEL[section]}
              containerClassName="surface-compact-search"
              aria-label={SEARCH_LABEL[section]}
            />
          ) : null}
        </div>
      </header>
      {activeError ? (
        <p role="alert" className="mx-4 mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[12px] text-[var(--danger-text)]">
          {activeError}
        </p>
      ) : null}

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
            className="hidden w-60 shrink-0 overflow-y-auto border-r border-[var(--border-hairline)] px-3 py-4 @min-[840px]/marketplace:block"
            aria-label="Browse by category"
          >
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Categories
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
                icon="ph:package-bold"
                label="Crafts"
                detail={loaded ? String(plugins.filter((plugin) => plugin.kind === "craft").length) : undefined}
                onClick={() => selectSection("crafts")}
              />
              <SetupRailLink
                icon="ph:sparkle"
                label="Skills"
                detail={skillsLoaded ? String(skills.length) : undefined}
                onClick={() => selectSection("skills")}
              />
              <SetupRailLink
                icon="ph:hammer"
                label="Build a skill"
                onClick={() => selectSection("build")}
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
                  <span className="ml-2 text-[11px] opacity-70">
                    {cat === "All" ? plugins.length : categoryCounts.get(cat) ?? 0}
                  </span>
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
            ) : null}

            {/* Browse toolbar — result context on the left, kind filter + sort
                on the right (moved out of the header so it stays one row). */}
            <div className="marketplace-browse-summary mb-4">
              <p className="min-w-0 self-center truncate text-[12px] text-[var(--text-muted)]">
                {!loaded ? (
                  // One loading language per surface: the grid below already
                  // shows skeleton rows, so the count line shimmers too instead
                  // of mixing in a "Loading…" string (cave-5qmm).
                  <Skeleton variant="text-sm" width={132} className="self-center" />
                ) : (
                  <>
                    {scopeLabel ? (
                      <span className="font-medium text-[var(--text-secondary)]">{scopeLabel} · </span>
                    ) : null}
                    {filtered.length} {filtered.length === 1 ? "tool" : "tools"}
                    {kind === "all" && filtered.length > 0
                      ? ` · ${groupedKindCounts.mcp} MCP · ${groupedKindCounts.api} API · ${groupedKindCounts.skill} ${groupedKindCounts.skill === 1 ? "skill" : "skills"}`
                      : null}
                  </>
                )}
              </p>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
                  <StandardSelect
                    label="Sort plugins"
                    value={sort}
                    onChange={(next) => setSort(next as SortKey)}
                    className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
                    options={SORT_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                  />
                </label>
              </div>
            </div>

            {!loaded ? (
              <SkeletonRows count={6} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="ph:puzzle-piece-bold"
                headline={query || category !== "All" || kind !== "all" || activeCollection ? "No matching plugins" : "No plugins available"}
                subtitle={query || category !== "All" || kind !== "all" || activeCollection ? "Try a different search, type, or category." : "The catalog is empty."}
              />
            ) : (
              <div className="marketplace-category-stack">
                {groupedFiltered.map((group) => (
                  <section key={group.category} className="marketplace-category-group" aria-labelledby={`marketplace-category-${group.category.replace(/\W+/g, "-").toLowerCase()}`}>
                    <div className="marketplace-category-group__head">
                      <div className="min-w-0">
                        <h2 id={`marketplace-category-${group.category.replace(/\W+/g, "-").toLowerCase()}`}>
                          {group.category}
                        </h2>
                        <p>
                          {group.plugins.length} {group.plugins.length === 1 ? "tool" : "tools"} · {group.counts.mcp} MCP · {group.counts.api} API · {group.counts.skill} skills
                        </p>
                      </div>
                    </div>
                    <div className="marketplace-category-grid">
                      {group.plugins.map((plugin) => (
                        <MarketplaceCard
                          key={plugin.id}
                          plugin={plugin}
                          busy={busyIds.has(plugin.id)}
                          onOpen={setSelected}
                          onAdd={add}
                          onRemove={remove}
                          onConfigure={setConfiguringId}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : section === "crafts" ? (
        <div
          role="tabpanel"
          id="marketplace-panel-crafts"
          aria-labelledby="marketplace-tab-crafts"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 @min-[640px]/marketplace:px-7"
        >
          <section className="craft-loadout-intro" aria-labelledby="craft-loadout-heading">
            <div>
              <p className="craft-loadout-intro__eyebrow">Role loadouts</p>
              <h2 id="craft-loadout-heading">Equip a way of working</h2>
              <p>A Craft is a versioned bundle of skills, prompts, workflows, and runtime capabilities that a Role equips as one unit.</p>
              <div className="mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  leadingIcon="ph:package-bold"
                  onClick={() => setCreatingCraft(true)}
                >
                  Create Craft
                </Button>
              </div>
            </div>
            <div className="craft-loadout-path" role="list" aria-label="Craft capability hierarchy">
              {[
                ["Familiar", "Who acts"],
                ["Role", "How they show up"],
                ["Craft", "What they equip"],
                ["Capabilities", "What becomes effective"],
              ].map(([label, detail], index) => (
                <span key={label} role="listitem">
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{label}</strong>
                  <em>{detail}</em>
                  {index < 3 ? <Icon name="ph:arrow-right-bold" width={12} aria-hidden /> : null}
                </span>
              ))}
            </div>
          </section>

          <div className="craft-loadout-toolbar">
            <p>{craftPlugins.length} {craftPlugins.length === 1 ? "Craft" : "Crafts"}</p>
            <StandardSelect
              label="Sort Crafts"
              value={sort}
              onChange={(next) => setSort(next as SortKey)}
              className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[12px] text-[var(--text-primary)]"
              options={SORT_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>

          {!loaded ? <SkeletonRows count={3} /> : craftPlugins.length === 0 ? (
            <EmptyState
              icon="ph:package-bold"
              headline={query ? "No matching Crafts" : "No public Crafts yet"}
              subtitle={query ? "Try a different Craft name or capability." : "Audited Research Crafts will appear here when they are enabled."}
            />
          ) : (
            <div className="marketplace-category-grid" aria-label="Available Crafts">
              {craftPlugins.map((plugin) => (
                <MarketplaceCard
                  key={plugin.id}
                  plugin={plugin}
                  busy={busyIds.has(plugin.id)}
                  onOpen={setSelected}
                  onAdd={add}
                  onRemove={remove}
                  onConfigure={setConfiguringId}
                />
              ))}
            </div>
          )}
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
            onCreateSkill={() => selectSection("build")}
            onChanged={() => void loadSkills(query)}
          />
        </div>
      ) : (
        // Authoring surface: form + live SKILL.md preview, own scroll.
        <div
          role="tabpanel"
          id="marketplace-panel-build"
          aria-labelledby="marketplace-tab-build"
          className="flex min-h-0 flex-1 flex-col"
        >
          <SkillBuilder
            familiars={familiars}
            onSaved={() => void loadSkills("")}
            onViewSkills={() => selectSection("skills")}
          />
        </div>
      )}

      {selectedPlugin ? (
        <MarketplaceDetail
          // Keyed so switching plugins remounts the drawer — otherwise the
          // previous plugin's connection-test result lingers under the new
          // plugin's header.
          key={selectedPlugin.id}
          plugin={selectedPlugin}
          busy={busyIds.has(selectedPlugin.id)}
          actionError={craftErrors[selectedPlugin.id]}
          onActionCleared={() => setCraftErrors((current) => ({ ...current, [selectedPlugin.id]: undefined }))}
          onClose={() => setSelected(null)}
          onAdd={() => void add(selectedPlugin.id)}
          onRemove={() => void remove(selectedPlugin.id)}
          onDraftDeleted={() => {
            setSelected(null);
            void load();
          }}
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

      <CraftCreateDrawer
        open={creatingCraft}
        onClose={() => setCreatingCraft(false)}
        onCreated={(id) => {
          setCreatingCraft(false);
          void load().then(() => setSelected(id));
          announce("Craft draft saved", "polite");
        }}
      />

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
