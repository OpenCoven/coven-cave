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
import { CraftCreateDrawer, type CraftDrawerSeed } from "@/components/marketplace/craft-create-drawer";
import {
  clearCraftArrivalWatch,
  findArrivedDraftId,
  readCraftArrivalWatch,
  type CraftArrivalWatch,
} from "@/lib/craft-arrival";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { MarketplaceConfigure } from "@/components/marketplace/marketplace-configure";
import { CollectionStrip } from "@/components/marketplace/collection-strip";
import { SkillBuilder } from "@/components/marketplace/skill-builder";
import { type SkillBrowserEntry } from "@/components/skill-browser";
import { type FamiliarForSkill } from "@/components/skill-detail-drawer";
import { SkillExploreCard } from "@/components/marketplace/skill-explore-card";
import { SkillExploreDrawer } from "@/components/marketplace/skill-explore-drawer";
import { sourceTarget } from "@/lib/skill-directory";
import {
  categoriesFrom,
  filterPlugins,
  sortPlugins,
  pluginBadgeState,
  normalizeMarketplaceScope,
  resolveCollection,
  COLLECTIONS,
  type KindFilter,
  type SortKey,
  type MarketplacePlugin,
} from "@/lib/marketplace-catalog";
import {
  MARKETPLACE_SEARCH_LABEL as SEARCH_LABEL,
  MARKETPLACE_SECTION_HINT as SECTION_HINT,
  MARKETPLACE_SECTIONS as SECTIONS,
  MARKETPLACE_SORT_OPTIONS as SORT_OPTIONS,
  MARKETPLACE_TYPE_RAIL as TYPE_RAIL,
  MARKETPLACE_STATUS_FILTERS as STATUS_FILTERS,
  type MarketplaceStatusFilter,
  type MarketplaceSection,
} from "@/components/marketplace/marketplace-view-model";
import { useSurfacePreference } from "@/lib/surface-preferences";
import { surfacePreferenceSpecs } from "@/lib/surface-preference-specs";
import { invalidateSurfaceResources, readSurfaceResource } from "@/lib/surface-warmup-registry";

export type { MarketplaceSection } from "@/components/marketplace/marketplace-view-model";

// Roles and Capabilities are hidden from the hub (kept in the
// MarketplaceSection type so `mode === "roles"` / `mode === "capabilities"`
// deep links keep type-checking — they land on Browse). The RolesSection
// component, its CSS, and the addons.roles config flag were removed as dead
// code (cave-vp4h); the Capabilities surface, its normalize helper, and their
// CSS followed (cave-4n7j — git history keeps them). /api/roles and
// /api/capabilities stay intact: they serve live role definitions and the
// familiar-studio Brain tab / inspector capability chips.

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
  const [storedSection, setStoredSection] = useSurfacePreference(surfacePreferenceSpecs.marketplace.section);
  // Alias links are a one-visit destination, not a replacement for a normal
  // return preference.
  const initialDestination = initialSection === "roles" || initialSection === "capabilities" ? "browse" : initialSection;
  const [deepLinkSection, setDeepLinkSection] = useState<MarketplaceSection | null>(
    initialSection === "roles" || initialSection === "capabilities"
      ? "browse"
      : initialDestination === "browse" ? null : initialDestination,
  );
  const section = deepLinkSection ?? storedSection;
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Store state (Browse section).
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useSurfacePreference(surfacePreferenceSpecs.marketplace.category);
  const [kind, setKind] = useSurfacePreference(surfacePreferenceSpecs.marketplace.kind);
  // Explore's rail "Status" segment and its skill "Topics" scope, plus the
  // card/list layout toggle — all durable so Explore reopens as you left it.
  const [status, setStatus] = useSurfacePreference(surfacePreferenceSpecs.marketplace.status);
  const [topic, setTopic] = useSurfacePreference(surfacePreferenceSpecs.marketplace.topic);
  const [viewMode, setViewMode] = useSurfacePreference(surfacePreferenceSpecs.marketplace.view);
  const [sort, setSort] = useSurfacePreference(surfacePreferenceSpecs.marketplace.sort);
  const [collectionId, setCollectionId] = useSurfacePreference(surfacePreferenceSpecs.marketplace.collection);
  const [selected, setSelected] = useState<string | null>(null);
  const [creatingCraft, setCreatingCraft] = useState(false);
  // Editing an existing draft reopens the create drawer pre-seeded (F5).
  const [craftSeed, setCraftSeed] = useState<CraftDrawerSeed | null>(null);
  // Tab-level arrival watch (F2): a dispatched describe-build outlives the
  // drawer, so the hub resumes the wait, shows an in-flight row on Crafts,
  // and opens the draft when it lands.
  const [craftWatch, setCraftWatch] = useState<CraftArrivalWatch | null>(null);
  useEffect(() => {
    setCraftWatch(readCraftArrivalWatch());
  }, [creatingCraft, section]);
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

  // Registry skills merged into Explore's grid (the "Skills" type). The
  // directory feeds both the card pool and the SkillExploreDrawer.
  const [skills, setSkills] = useState<SkillBrowserEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  // The skill opened in the Explore detail drawer.
  const [exploreSkill, setExploreSkill] = useState<SkillBrowserEntry | null>(null);
  // Optimistic install overrides + in-flight ids for registry skills — the
  // catalog's install state is separate from the plugin `busyIds` set.
  const [skillInstalled, setSkillInstalled] = useState<Record<string, boolean>>({});
  const [skillBusyIds, setSkillBusyIds] = useState<ReadonlySet<string>>(new Set());
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

  const load = useCallback(async (force = false) => {
    loadCtl.current?.abort();
    const ctl = new AbortController();
    loadCtl.current = ctl;
    setLoaded(false);
    try {
      const { data: json } = await readSurfaceResource<{ ok?: boolean; plugins?: MarketplacePlugin[]; error?: string }>("marketplace:catalog", force);
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? "marketplace unavailable");
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

  // Resume the arrival wait at the hub level (F2): while a describe-build is
  // in flight, poll the drafts store even with the drawer closed; when the
  // familiar's draft lands, clear the watch, announce, and open it.
  const checkCraftArrival = useCallback(async () => {
    const watch = readCraftArrivalWatch();
    if (!watch) {
      setCraftWatch(null);
      return;
    }
    try {
      const res = await fetch("/api/marketplace/crafts/drafts", { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; drafts?: Array<{ id?: string }> };
      if (!json.ok || !Array.isArray(json.drafts)) return;
      const arrived = findArrivedDraftId(watch, json.drafts.map((draft) => draft.id));
      if (arrived) {
        clearCraftArrivalWatch();
        setCraftWatch(null);
        announce("Your familiar's Craft draft arrived", "polite");
        invalidateSurfaceResources("marketplace:catalog");
        void load(true).then(() => setSelected(arrived));
      }
    } catch {
      // Local API — the next tick retries.
    }
  }, [announce, load]);
  usePausablePoll(() => void checkCraftArrival(), 5000, {
    enabled: craftWatch !== null && !creatingCraft,
  });

  const loadSkills = useCallback(async (search = "") => {
    skillsCtl.current?.abort();
    const ctl = new AbortController();
    skillsCtl.current = ctl;
    setSkillsLoaded(false);
    try {
      const trimmed = search.trim();
      const json = (trimmed
        ? await fetch(`/api/skills/directory?q=${encodeURIComponent(trimmed)}`, { cache: "no-store", signal: ctl.signal }).then((res) => res.json())
        : (await readSurfaceResource("marketplace:skills")).data) as {
        ok?: boolean;
        entries?: SkillBrowserEntry[];
        error?: string;
        source?: string;
        fetchedAt?: string;
      };
      if (ctl.signal.aborted) return;
      if (!json.ok) throw new Error(json.error ?? "skills unavailable");
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

  // Explore searches the registry as you type (the skills half of the pool),
  // debounced so remote results don't thrash. Only while Skills are in view.
  useEffect(() => {
    if (section !== "browse" || kind === "mcp" || kind === "api") return;
    const timeout = window.setTimeout(() => {
      void loadSkills(query);
    }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [section, kind, query, loadSkills]);

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
  // buttons, the tablist's arrow-key navigation, and cross-section CTAs. The
  // retired Skills tab folds into Explore pre-filtered to the Skills type, so
  // its deep links and cross-nav still land somewhere sensible.
  const selectSection = useCallback((next: MarketplaceSection) => {
    setDeepLinkSection(null);
    if (next === "skills") {
      setStoredSection("browse");
      setKind("skill");
    } else {
      setStoredSection(next === "roles" || next === "capabilities" ? "browse" : next);
    }
    setQuery("");
  }, [setStoredSection, setKind]);

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
          s.id === "browse" && loaded && skillsLoaded ? plugins.length + skills.length
          : s.id === "browse" && loaded ? plugins.length
          : s.id === "crafts" && loaded ? plugins.filter((plugin) => plugin.kind === "craft").length
          : undefined,
        title: SECTION_HINT[s.id],
      })),
    [loaded, plugins.length, skillsLoaded, skills.length],
  );

  const activeCollection = useMemo(
    () => COLLECTIONS.find((c) => c.id === collectionId) ?? null,
    [collectionId],
  );
  // Catalog categories are data-driven, so a choice can disappear between
  // visits. Keep durable filters truthful by dropping only the invalid scope
  // after the first catalog response has established the available options.
  useEffect(() => {
    if (!loaded) return;
    const normalized = normalizeMarketplaceScope(categories, category, collectionId);
    if (normalized.category !== category) setCategory(normalized.category);
    if (normalized.collectionId !== collectionId) setCollectionId(normalized.collectionId);
  }, [loaded, categories, category, collectionId, setCategory, setCollectionId]);
  const collectionIds = useMemo(
    () => (activeCollection ? resolveCollection(plugins, activeCollection).map((p) => p.id) : undefined),
    [plugins, activeCollection],
  );

  // Registry-skill install state overlays optimistic local edits on top of the
  // directory entry's own installed flag.
  const skillIsInstalled = useCallback(
    (s: SkillBrowserEntry) => skillInstalled[s.id] ?? Boolean(s.installed ?? s.local?.installed),
    [skillInstalled],
  );

  // Skill "Topics" for the collection rail — derived from the loaded directory
  // (top topics by frequency), so the rail reflects the live catalog.
  const skillTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills) for (const t of s.topics ?? s.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([id, count]) => ({ id, label: id, count }));
    return [{ id: "all", label: "All topics", count: skills.length }, ...top];
  }, [skills]);
  const skillMatchesTopic = useCallback(
    (s: SkillBrowserEntry) => topic === "all" || (s.topics ?? s.tags ?? []).includes(topic),
    [topic],
  );

  // Type filter is the rail's "Type" segment. When Skills is active the
  // category scope doesn't apply (skills carry topics, not plugin categories).
  const showSkillType = kind === "all" || kind === "skill";
  const statusOkPlugin = useCallback(
    (p: MarketplacePlugin) => {
      const state = pluginBadgeState(p);
      if (status === "installed") return state === "added";
      if (status === "needs-setup") return state === "needs-setup";
      return true;
    },
    [status],
  );

  // Plugin pool — connectors (mcp/api) plus plugin-kind skills, honoring the
  // rail's Type + Status + Category/Collection scope and the search box.
  const filteredPlugins = useMemo(() => {
    const matched = filterPlugins(plugins, {
      query,
      category: activeCollection || kind === "skill" ? "All" : category,
      kind,
      ids: collectionIds,
    }).filter(statusOkPlugin);
    return sortPlugins(matched, sort);
  }, [plugins, query, category, kind, sort, collectionIds, activeCollection, statusOkPlugin]);

  // Registry skills join the pool whenever Skills (or All) is the active type;
  // a picked plugin category or "needs-setup" status excludes them.
  const q = query.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!showSkillType) return [] as SkillBrowserEntry[];
    if (status === "needs-setup") return [];
    if (kind !== "skill" && category !== "All" && !activeCollection) return [];
    return skills.filter((s) => {
      if (status === "installed" && !skillIsInstalled(s)) return false;
      if (!skillMatchesTopic(s)) return false;
      if (!q) return true;
      return [s.name, s.description ?? "", s.owner ?? "", (s.topics ?? s.tags ?? []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [skills, showSkillType, status, kind, category, activeCollection, skillMatchesTopic, skillIsInstalled, q]);

  // Explore renders plugins and skills as one card pool. In the default,
  // unfiltered view they split into "Tools & connectors" and "Skills";
  // otherwise they collapse into a single flat section.
  const exploreGroups = useMemo(() => {
    const connectors = filteredPlugins.filter((p) => p.kind === "mcp" || p.kind === "api");
    const pluginSkills = filteredPlugins.filter((p) => p.kind === "skill");
    const otherPlugins = filteredPlugins.filter((p) => p.kind !== "mcp" && p.kind !== "api" && p.kind !== "skill");
    const grouped = kind === "all" && category === "All" && topic === "all" && !q && status === "all" && !activeCollection;
    if (grouped) {
      return [
        { key: "tools", name: "Tools & connectors", sub: "MCP servers and API endpoints your familiars can call.", plugins: connectors, skills: [] as SkillBrowserEntry[] },
        { key: "skills", name: "Skills", sub: "SKILL.md procedures loaded on demand while they work.", plugins: pluginSkills, skills: filteredSkills },
      ].filter((g) => g.plugins.length + g.skills.length > 0);
    }
    return [{ key: "all", name: "", sub: "", plugins: [...connectors, ...pluginSkills, ...otherPlugins], skills: filteredSkills }]
      .filter((g) => g.plugins.length + g.skills.length > 0);
  }, [filteredPlugins, filteredSkills, kind, category, topic, q, status, activeCollection]);
  const exploreCount = useMemo(
    () => exploreGroups.reduce((n, g) => n + g.plugins.length + g.skills.length, 0),
    [exploreGroups],
  );

  // Rail counts (mock parity): Type spans the whole catalog; Status is global.
  const typeCount = useCallback(
    (id: KindFilter) => {
      if (id === "all") return plugins.length + skills.length;
      if (id === "skill") return plugins.filter((p) => p.kind === "skill").length + skills.length;
      return plugins.filter((p) => p.kind === id).length;
    },
    [plugins, skills],
  );
  const statusCount = useCallback(
    (id: MarketplaceStatusFilter) => {
      if (id === "installed") return plugins.filter((p) => pluginBadgeState(p) === "added").length + skills.filter(skillIsInstalled).length;
      if (id === "needs-setup") return plugins.filter((p) => pluginBadgeState(p) === "needs-setup").length;
      return plugins.length + skills.length;
    },
    [plugins, skills, skillIsInstalled],
  );

  const craftPlugins = useMemo(
    () => sortPlugins(filterPlugins(plugins, { query, kind: "craft" }), sort),
    [plugins, query, sort],
  );
  // Lifecycle grouping (docs/craft-ux.md F11): local drafts surface as their
  // own strip above the published catalog instead of interleaving with it.
  const draftCrafts = useMemo(() => craftPlugins.filter((plugin) => plugin.draft), [craftPlugins]);
  const publishedCrafts = useMemo(() => craftPlugins.filter((plugin) => !plugin.draft), [craftPlugins]);

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
      invalidateSurfaceResources("marketplace:catalog");
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
      invalidateSurfaceResources("marketplace:catalog");
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

  // Install / remove a registry skill from an Explore card or the drawer.
  // Optimistic, with revert on failure — mirrors the plugin add/remove flow.
  const toggleSkill = useCallback(async (s: SkillBrowserEntry) => {
    const installedNow = skillInstalled[s.id] ?? Boolean(s.installed ?? s.local?.installed);
    setSkillBusyIds((prev) => new Set(prev).add(s.id));
    setSkillInstalled((prev) => ({ ...prev, [s.id]: !installedNow }));
    try {
      if (installedNow && s.path) {
        const res = await fetch(`/api/skills/local?path=${encodeURIComponent(s.path)}`, { method: "DELETE", cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "remove failed");
        announce("Skill removed", "polite");
      } else if (!installedNow) {
        const res = await fetch("/api/skills/directory/install", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: s.id, source: sourceTarget(s) }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "install failed");
        announce("Skill installed", "polite");
      }
      invalidateSurfaceResources("marketplace:skills");
    } catch (err) {
      setSkillInstalled((prev) => ({ ...prev, [s.id]: installedNow }));
      announce(err instanceof Error ? err.message : "action failed", "assertive");
    } finally {
      setSkillBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
    }
  }, [announce, skillInstalled]);

  const activeError =
    section === "browse" ? error ?? skillsError
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
        <p role="alert" className="mx-4 mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[length:var(--text-sm)] text-[var(--danger-text)]">
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
          {/* Explore rail — Type · Status · Categories/Topics. Type is the
              primary axis (MCP · API · Skill), so tools and skills share one
              grid; the collection group swaps to skill Topics when Skills is
              the active type. Hidden in narrow panes, where the Type chip row
              stands in. */}
          <aside className="mk-rail hidden shrink-0 @min-[840px]/marketplace:block" aria-label="Filter the catalog">
            <p className="mk-rail__label">Type</p>
            <nav className="mk-rail__group" aria-label="Filter by type">
              {TYPE_RAIL.map((t) => (
                <ExploreRailRow
                  key={t.id}
                  icon={t.icon}
                  label={t.label}
                  count={loaded ? typeCount(t.id) : undefined}
                  active={kind === t.id}
                  onClick={() => { setKind(t.id); setSelected(null); setCollectionId(null); }}
                />
              ))}
            </nav>
            <p className="mk-rail__label">Status</p>
            <nav className="mk-rail__group" aria-label="Filter by install status">
              {STATUS_FILTERS.map((s) => (
                <ExploreRailRow
                  key={s.id}
                  icon={s.icon}
                  label={s.label}
                  count={loaded ? statusCount(s.id) : undefined}
                  active={status === s.id}
                  onClick={() => setStatus(s.id)}
                />
              ))}
            </nav>
            {kind === "skill" ? (
              <>
                <p className="mk-rail__label">Topics</p>
                <nav className="mk-rail__group" aria-label="Filter by topic">
                  {skillTopics.map((t) => (
                    <ExploreRailRow
                      key={t.id}
                      label={t.label}
                      count={t.count}
                      active={topic === t.id}
                      onClick={() => setTopic(t.id)}
                    />
                  ))}
                </nav>
              </>
            ) : (
              <>
                <p className="mk-rail__label">Categories</p>
                <nav className="mk-rail__group" aria-label="Filter by category">
                  {categories.map((cat) => (
                    <ExploreRailRow
                      key={cat}
                      label={cat}
                      count={cat === "All" ? plugins.length : categoryCounts.get(cat) ?? 0}
                      active={!activeCollection && category === cat}
                      onClick={() => selectCategory(cat)}
                    />
                  ))}
                </nav>
              </>
            )}
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 @min-[560px]/marketplace:px-6">
            {/* Type chips — the rail's stand-in in narrow panes/screens. */}
            <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 @min-[840px]/marketplace:hidden">
              {TYPE_RAIL.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setKind(t.id); setCollectionId(null); }}
                  className={`focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[length:var(--text-sm)] transition-colors ${
                    kind === t.id
                      ? "bg-[var(--text-primary)] text-[var(--bg-base)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon name={t.icon} width={14} aria-hidden />
                  {t.label}
                  <span className="text-[length:var(--text-xs)] tabular-nums opacity-70">{loaded ? typeCount(t.id) : ""}</span>
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
                    <p className="text-[length:var(--text-md)] font-semibold text-[var(--text-primary)]">{activeCollection.title}</p>
                    <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">{activeCollection.description}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCollectionId(null)}
                  className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:arrow-left" width={12} aria-hidden /> All items
                </button>
              </div>
            ) : null}

            {/* Explore toolbar — result context on the left, a grid/list view
                toggle and sort on the right. */}
            <div className="marketplace-browse-summary mb-4">
              <p className="min-w-0 self-center truncate text-[length:var(--text-sm)] text-[var(--text-muted)]">
                {!loaded ? (
                  <Skeleton variant="text-sm" width={132} className="self-center" />
                ) : (
                  <>
                    {scopeLabel ? (
                      <span className="font-medium text-[var(--text-secondary)]">{scopeLabel} · </span>
                    ) : null}
                    {exploreCount} {exploreCount === 1 ? "listing" : "listings"}
                    {kind !== "all" ? ` · ${TYPE_RAIL.find((t) => t.id === kind)?.label ?? ""}` : null}
                  </>
                )}
              </p>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <div className="mk-viewtoggle" role="group" aria-label="Card layout">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    aria-pressed={viewMode === "grid"}
                    title="Grid view"
                    className={`focus-ring mk-viewtoggle__btn ${viewMode === "grid" ? "is-active" : ""}`}
                  >
                    <Icon name="ph:squares-four" width={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("rows")}
                    aria-pressed={viewMode === "rows"}
                    title="List view"
                    className={`focus-ring mk-viewtoggle__btn ${viewMode === "rows" ? "is-active" : ""}`}
                  >
                    <Icon name="ph:rows" width={15} aria-hidden />
                  </button>
                </div>
                <label className="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  <span className="sr-only">Sort listings</span>
                  <Icon name="ph:sort-ascending" width={14} aria-hidden />
                  <StandardSelect
                    label="Sort listings"
                    value={sort}
                    onChange={(next) => setSort(next as SortKey)}
                    className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-primary)]"
                    options={SORT_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                  />
                </label>
              </div>
            </div>

            {!loaded ? (
              <SkeletonRows count={6} />
            ) : exploreCount === 0 ? (
              <EmptyState
                icon="ph:magnifying-glass-bold"
                headline={query || category !== "All" || kind !== "all" || topic !== "all" || status !== "all" || activeCollection ? "No matches" : "Nothing available"}
                subtitle={query || category !== "All" || kind !== "all" || topic !== "all" || status !== "all" || activeCollection ? "Nothing matches these filters. Try another type, collection, or clear your search." : "The catalog is empty."}
                actions={query || category !== "All" || kind !== "all" || topic !== "all" || status !== "all" || activeCollection ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setCategory("All"); setTopic("all"); setKind("all"); setStatus("all"); setCollectionId(null); setQuery(""); }}
                  >
                    Clear filters
                  </Button>
                ) : undefined}
              />
            ) : (
              <div className="marketplace-category-stack">
                {exploreGroups.map((group) => (
                  <section
                    key={group.key}
                    className="marketplace-category-group"
                    aria-labelledby={group.name ? `marketplace-explore-${group.key}` : undefined}
                    aria-label={group.name ? undefined : "Listings"}
                  >
                    {group.name ? (
                      <div className="marketplace-category-group__head">
                        <div className="min-w-0">
                          <h2 id={`marketplace-explore-${group.key}`}>{group.name}</h2>
                          <p>{group.sub}</p>
                        </div>
                      </div>
                    ) : null}
                    <div className={`marketplace-category-grid ${viewMode === "rows" ? "marketplace-category-grid--rows" : ""}`}>
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
                      {group.skills.map((s) => (
                        <SkillExploreCard
                          key={`skill:${s.id}`}
                          skill={s}
                          installed={skillIsInstalled(s)}
                          busy={skillBusyIds.has(s.id)}
                          onOpen={setExploreSkill}
                          onToggleInstall={toggleSkill}
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
                  onClick={() => {
                    setCraftSeed(null);
                    setCreatingCraft(true);
                  }}
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
              className="focus-ring cursor-pointer rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-primary)]"
              options={SORT_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            />
          </div>

          {craftWatch && !creatingCraft ? (
            <div role="status" className="craft-arrival-banner">
              <Icon
                name="ph:circle-notch-bold"
                width={14}
                aria-hidden
                className="animate-spin motion-reduce:animate-none"
              />
              <span>
                A familiar is drafting a Craft from your description — it opens here when it lands.
              </span>
              <button
                type="button"
                className="focus-ring craft-arrival-banner__stop"
                onClick={() => {
                  clearCraftArrivalWatch();
                  setCraftWatch(null);
                }}
              >
                Stop waiting
              </button>
            </div>
          ) : null}

          {!loaded ? <SkeletonRows count={3} /> : craftPlugins.length === 0 ? (
            <EmptyState
              icon="ph:package-bold"
              headline={query ? "No matching Crafts" : "No public Crafts yet"}
              subtitle={query ? "Try a different Craft name or capability." : "Audited Research Crafts will appear here when they are enabled."}
            />
          ) : (
            <>
              {draftCrafts.length > 0 ? (
                <section className="craft-grid-group" aria-labelledby="craft-drafts-heading">
                  <div className="craft-grid-group__head">
                    <h3 id="craft-drafts-heading">Your drafts</h3>
                    <p>Local and reversible — review, refine, and publish when ready.</p>
                  </div>
                  <div className="marketplace-category-grid" aria-label="Draft Crafts">
                    {draftCrafts.map((plugin) => (
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
              ) : null}
              {publishedCrafts.length > 0 ? (
                <section className="craft-grid-group" aria-labelledby="craft-published-heading">
                  {draftCrafts.length > 0 ? (
                    <div className="craft-grid-group__head">
                      <h3 id="craft-published-heading">Published</h3>
                      <p>Versioned Crafts from the audited catalog, installable and equippable.</p>
                    </div>
                  ) : null}
                  <div className="marketplace-category-grid" aria-label="Available Crafts">
                    {publishedCrafts.map((plugin) => (
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
              ) : null}
            </>
          )}
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
            onSaved={() => {
              invalidateSurfaceResources("marketplace:skills");
              void loadSkills("");
            }}
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
            invalidateSurfaceResources("marketplace:catalog");
            void load(true);
          }}
          onAdjustRoles={(seed) => {
            setSelected(null);
            setCraftSeed(seed);
            setCreatingCraft(true);
          }}
        />
      ) : null}

      {configuringPlugin ? (
        <MarketplaceConfigure
          pluginId={configuringPlugin.id}
          displayName={configuringPlugin.displayName}
          open={true}
          onClose={() => setConfiguringId(null)}
          onChanged={() => { invalidateSurfaceResources("marketplace:catalog"); void load(true); }}
        />
      ) : null}

      <CraftCreateDrawer
        open={creatingCraft}
        seed={craftSeed}
        onClose={() => {
          setCreatingCraft(false);
          setCraftSeed(null);
        }}
        onCreated={(id) => {
          setCreatingCraft(false);
          setCraftSeed(null);
          invalidateSurfaceResources("marketplace:catalog");
          void load(true).then(() => setSelected(id));
          announce("Craft draft saved", "polite");
        }}
      />

      <SkillExploreDrawer
        key={exploreSkill?.id ?? "none"}
        skill={exploreSkill}
        installed={exploreSkill ? skillIsInstalled(exploreSkill) : false}
        busy={exploreSkill ? skillBusyIds.has(exploreSkill.id) : false}
        onClose={() => setExploreSkill(null)}
        onInstallToggle={(s) => void toggleSkill(s)}
        onChanged={() => {
          invalidateSurfaceResources("marketplace:skills");
          void loadSkills(query);
        }}
      />
    </section>
  );
}

// One Explore-rail row: icon (optional — Categories/Topics rows are plain
// text like Browse's), label, and a right-aligned count. The active row
// raises to bg-elevated with an inset accent bar, matching the mock.
function ExploreRailRow({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon?: IconName;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`focus-ring flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
        active
          ? "bg-[var(--bg-elevated)] shadow-[inset_2px_0_0_var(--accent-presence)]"
          : "hover:bg-[var(--bg-raised)]"
      }`}
    >
      {icon ? (
        <Icon
          name={icon}
          width={15}
          aria-hidden
          className={active ? "text-[var(--accent-presence)]" : "text-[var(--text-muted)]"}
        />
      ) : null}
      <span className={`min-w-0 flex-1 truncate text-[length:var(--text-sm)] ${active ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
        {label}
      </span>
      {count !== undefined ? (
        <span className={`shrink-0 text-[length:var(--text-xs)] tabular-nums ${active ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
