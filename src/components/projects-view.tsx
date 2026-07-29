"use client";

// The access page's styling (every `projects-access-*` class) lives in
// projects.css. Import it directly so the surface is always styled — it's
// reachable straight from the Chat → Projects tab, before any other surface
// has ever mounted.
import "@/styles/projects.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/lib/icon";
import { normalizeProjectRoot, type CaveProject } from "@/lib/cave-projects-types";
import type { Familiar, SessionRow } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { CHAT_FOCUS_PROJECT_EVENT } from "@/lib/chat-tab-events";
import { gitHubRepoSlug } from "@/lib/github-repo-link";
import { isSupreme, type ConsoleAccessGroup, type ConsoleGrant } from "@/lib/permissions-console";
import {
  normalizeAccessLevel,
  resolveEffectiveAccess,
  type ProjectAccessLevel,
} from "@/lib/project-access-levels";
import {
  accessCounts,
  accessStateMeta,
  filterProjectsByQuery,
  nextAccessState,
  sectionModels,
  setAllOps,
  type AccessOp,
  type AccessState,
  type SectionModel,
} from "@/lib/projects/access-page";
import {
  accessLedger,
  grantChips,
  isViewMode,
  projectKind,
  sectionMix,
  sectionPeek,
  selectionLabel,
  sortByAccessThenName,
  treeGroups,
  type ProjectViewMode,
} from "@/lib/projects/access-views";
import { smoothScrollBehavior } from "@/lib/use-prefers-reduced-motion";
import { useAnnouncer } from "@/components/ui/live-region";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { StandardSelect } from "@/components/ui/select";
import { ProjectSettingsModal } from "@/components/project-settings-modal";
import { useAddProjectFlow } from "@/components/project-picker";

type ProjectsViewProps = {
  sessions?: SessionRow[];
  /** Familiar roster the access matrix is edited against. */
  familiars?: Familiar[];
  onNewChat?: (projectRoot: string) => void;
  onSessionsChanged?: () => void;
  onSessionsDeleted: (sessionIds: readonly string[]) => void;
  /** Pre-selects that familiar's column of the access matrix. */
  activeFamiliarId?: string | null;
};

type GrantsSnapshot = {
  grants: ConsoleGrant[];
  groups: ConsoleAccessGroup[];
  supremeFamiliarId: string | null;
};

type RowModel = {
  project: CaveProject;
  state: AccessState;
  direct: ProjectAccessLevel | null;
  /** Names of member groups whose grants feed the effective level. */
  groupNames: string[];
};

function familiarLabel(f: Familiar): string {
  return f.display_name || f.name || f.id;
}

async function runAccessOp(familiarId: string, op: AccessOp): Promise<void> {
  const res = await fetch("/api/project-grants", {
    method: op.op === "grant" ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      op.op === "grant"
        ? { targetFamiliarId: familiarId, projectId: op.projectId, access: op.access }
        : { targetFamiliarId: familiarId, projectId: op.projectId },
    ),
  });
  if (!res.ok) throw new Error(String(res.status));
}

/** View preference: "grid" (default) | "rows" | "tree". Replaces the older
 *  grouped/flat boolean — "rows" IS the flat list, and "tree" adds the
 *  by-access-level audit the boolean could not express. */
const VIEW_STORAGE_KEY = "cave:projects:view";

/**
 * The Chat → Projects surface: one familiar's project-access map. Pick a
 * familiar, see every registered project — grouped into workspaces and
 * repositories, or flattened into one list via the toolbar toggle (persisted
 * per profile) — and click a row to cycle its direct grant — no access → read
 * → full → none — against /api/project-grants. Effective levels fold in
 * access-group grants (union-max), and the supreme familiar renders locked
 * at Full everywhere.
 */
export function ProjectsView({ familiars = [], activeFamiliarId = null }: ProjectsViewProps) {
  const { announce } = useAnnouncer();
  const confirm = useConfirm();
  // Unscoped: access is managed over EVERY registered project, not just the
  // ones the active familiar can already see.
  const { projects, loading: projectsLoading, error: projectsError, reload, createProject, updateRepoUrl, renameProject, deleteProject } = useProjects();

  const [grantsData, setGrantsData] = useState<GrantsSnapshot | null>(null);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [mutateError, setMutateError] = useState<string | null>(null);

  const loadGrants = useCallback(async () => {
    try {
      const res = await fetch("/api/project-grants", { cache: "no-store" });
      const data = await res.json();
      setGrantsData({
        grants: Array.isArray(data?.grants) ? (data.grants as ConsoleGrant[]) : [],
        groups: Array.isArray(data?.accessGroups) ? (data.accessGroups as ConsoleAccessGroup[]) : [],
        supremeFamiliarId:
          typeof data?.supremeFamiliarId === "string" ? data.supremeFamiliarId : null,
      });
      setGrantsError(null);
    } catch {
      setGrantsError("Couldn’t load project access. Is the desktop reachable?");
    } finally {
      setGrantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  useRefreshOnFocus(() => {
    reload();
    void loadGrants();
  });

  // ── Familiar picker ────────────────────────────────────────────────────
  const [pickedFamiliarId, setPickedFamiliarId] = useState<string | null>(activeFamiliarId);
  useEffect(() => {
    if (activeFamiliarId) setPickedFamiliarId(activeFamiliarId);
  }, [activeFamiliarId]);
  const familiar = useMemo(
    () => familiars.find((f) => f.id === pickedFamiliarId) ?? familiars[0] ?? null,
    [familiars, pickedFamiliarId],
  );
  const supreme = familiar ? isSupreme(familiar.id, grantsData?.supremeFamiliarId ?? null) : false;

  // ── New project ────────────────────────────────────────────────────────
  // The shared add flow (native folder dialog on desktop, in-app browser on
  // web) registers the root AND grants the picked familiar access, so the new
  // project lands in this matrix already visible to whoever it was added for.
  const addFlow = useAddProjectFlow({
    familiarId: familiar?.id ?? null,
    createProject,
    projects,
    onAdded: () => {
      reload();
      void loadGrants();
      announce("Project added.");
    },
  });

  // ── Per-project settings (GitHub repository link) ──────────────────────
  const [settingsProjectId, setSettingsProjectId] = useState<string | null>(null);
  const settingsProject = useMemo(
    () => projects.find((project) => project.id === settingsProjectId) ?? null,
    [projects, settingsProjectId],
  );
  const saveRepoUrl = useCallback(
    async (id: string, repoUrl: string | null) => {
      const ok = await updateRepoUrl(id, repoUrl);
      if (ok) announce(repoUrl ? "GitHub repository linked." : "GitHub repository unlinked.");
      return ok;
    },
    [updateRepoUrl, announce],
  );
  const renameProjectAndAnnounce = useCallback(
    async (id: string, name: string) => {
      const ok = await renameProject(id, name);
      if (ok) announce("Project renamed.");
      return ok;
    },
    [renameProject, announce],
  );
  const removeProject = useCallback(
    async (id: string) => {
      const ok = await deleteProject(id);
      if (ok) {
        announce("Project removed from the registry.");
        void loadGrants(); // the delete cascade revoked its grants server-side
      }
      return ok;
    },
    [deleteProject, announce, loadGrants],
  );

  // ── Mutation state ─────────────────────────────────────────────────────
  // projectId → optimistic direct level (null = revoked), layered over the
  // server snapshot until the post-mutation refetch lands.
  const [optimistic, setOptimistic] = useState<Map<string, ProjectAccessLevel | null>>(new Map());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [busyAll, setBusyAll] = useState(false);

  // Reset transient edit state when the matrix switches familiars.
  const familiarId = familiar?.id ?? null;
  useEffect(() => {
    setOptimistic(new Map());
    setPendingIds(new Set());
    setMutateError(null);
  }, [familiarId]);

  /** The picked familiar's direct grants with optimistic edits applied. */
  const directByProject = useMemo(() => {
    const map = new Map<string, ProjectAccessLevel>();
    if (!familiar || !grantsData) return map;
    for (const grant of grantsData.grants) {
      if (grant.familiarId !== familiar.id) continue;
      map.set(grant.projectId, normalizeAccessLevel(grant.access));
    }
    for (const [projectId, level] of optimistic) {
      if (level === null) map.delete(projectId);
      else map.set(projectId, level);
    }
    return map;
  }, [familiar, grantsData, optimistic]);

  /** Every project's row model: effective state + where it comes from. */
  const rowByProject = useMemo(() => {
    const map = new Map<string, RowModel>();
    if (!familiar) return map;
    const directGrants = [...directByProject].map(([projectId, access]) => ({
      familiarId: familiar.id,
      projectId,
      access,
    }));
    const groups = grantsData?.groups ?? [];
    for (const project of projects) {
      if (supreme) {
        map.set(project.id, { project, state: "write", direct: "write", groupNames: [] });
        continue;
      }
      const effective = resolveEffectiveAccess({
        directGrants,
        groups,
        familiarId: familiar.id,
        projectId: project.id,
      });
      map.set(project.id, {
        project,
        state: effective.level ?? "none",
        direct: effective.direct,
        groupNames: effective.groups.map((g) => g.groupName),
      });
    }
    return map;
  }, [projects, familiar, directByProject, grantsData, supreme]);

  // Toolbar tally always spans the whole map, never the filtered subset.
  const counts = useMemo(
    () => accessCounts([...rowByProject.values()].map((row) => row.state)),
    [rowByProject],
  );

  // ── Search & view ──────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Grid by default; the preference survives reloads per profile.
  const [view, setView] = useState<ProjectViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      return isViewMode(stored) ? stored : "grid";
    } catch {
      return "grid";
    }
  });
  const pickView = useCallback(
    (next: ProjectViewMode) => {
      setView(next);
      try {
        window.localStorage.setItem(VIEW_STORAGE_KEY, next);
      } catch {
        // Storage failures (private mode) only lose the preference, not the view.
      }
      announce(
        next === "grid"
          ? "Projects shown as cards."
          : next === "rows"
            ? "Projects shown as one dense list."
            : "Projects grouped by access level.",
      );
    },
    [announce],
  );
  const filtered = useMemo(() => filterProjectsByQuery(projects, query), [projects, query]);
  // Grid keeps the workspace/repository split; rows and tree impose their own
  // ordering, so they read from the flat filtered set.
  const sections = useMemo(() => sectionModels(filtered, true), [filtered]);

  /** The header's proportional access bar — always the whole map. */
  const ledger = useMemo(() => accessLedger(counts), [counts]);

  // ── Section collapse ───────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── Card disclosure ────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((projectId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  // ── Bulk selection ─────────────────────────────────────────────────────
  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleBulk = useCallback(() => {
    setBulk((on) => !on);
    setSelected(new Set());
  }, []);
  const toggleSelected = useCallback((projectId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);
  // Leaving a familiar mid-selection would carry checkmarks onto a different
  // access map, so the selection is dropped with the matrix.
  useEffect(() => {
    setSelected(new Set());
    setBulk(false);
  }, [familiarId]);

  // ── Inline rename ──────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const renameRef = useRef<HTMLInputElement | null>(null);
  const startRename = useCallback((project: CaveProject) => {
    setRenamingId(project.id);
    setDraftName(project.name);
    window.requestAnimationFrame(() => {
      renameRef.current?.focus();
      renameRef.current?.select();
    });
  }, []);
  const commitRename = useCallback(async () => {
    const id = renamingId;
    if (!id) return;
    const name = draftName.trim();
    const project = projects.find((p) => p.id === id);
    setRenamingId(null);
    if (!name || !project || name === project.name) return;
    const ok = await renameProject(id, name);
    if (ok) announce("Project renamed.");
    else setMutateError("Couldn’t rename the project.");
  }, [renamingId, draftName, projects, renameProject, announce]);

  // "/" jumps to the search box (unless focus is already in an editable).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Command palette "Open project" → scroll the row into view and flash it.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ root?: string }>).detail;
      if (!detail?.root) return;
      const rootKey = normalizeProjectRoot(detail.root);
      const match = projects.find((p) => normalizeProjectRoot(p.root) === rootKey);
      if (!match) return;
      setQuery("");
      setFlashId(match.id);
      window.requestAnimationFrame(() => {
        document
          .getElementById(`project-access-row:${match.id}`)
          ?.scrollIntoView({ block: "center", behavior: smoothScrollBehavior() });
      });
    };
    window.addEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
    return () => window.removeEventListener(CHAT_FOCUS_PROJECT_EVENT, onFocus);
  }, [projects]);
  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const cycleRow = useCallback(
    async (row: RowModel) => {
      if (!familiar || supreme || pendingIds.has(row.project.id)) return;
      const next = nextAccessState(row.state);
      if (next === "none" && !row.direct) {
        // Nothing to revoke — the level is inherited from a group.
        announce(
          `${row.project.name} keeps ${accessStateMeta(row.state).label} via ${row.groupNames.join(", ") || "an access group"}. Edit the group to change it.`,
        );
        return;
      }
      const op: AccessOp =
        next === "none"
          ? { projectId: row.project.id, op: "revoke" }
          : { projectId: row.project.id, op: "grant", access: next };
      setPendingIds((prev) => new Set(prev).add(row.project.id));
      setOptimistic((prev) => new Map(prev).set(row.project.id, next === "none" ? null : next));
      try {
        await runAccessOp(familiar.id, op);
        setMutateError(null);
        await loadGrants();
        announce(`${row.project.name}: ${accessStateMeta(next).label}`);
      } catch {
        setMutateError(`Couldn’t update access for ${row.project.name}.`);
      } finally {
        // Drop the optimistic layer either way — the snapshot (fresh on
        // success, unchanged on failure) is the truth again.
        setOptimistic((prev) => {
          const copy = new Map(prev);
          copy.delete(row.project.id);
          return copy;
        });
        setPendingIds((prev) => {
          const copy = new Set(prev);
          copy.delete(row.project.id);
          return copy;
        });
      }
    },
    [familiar, supreme, pendingIds, announce, loadGrants],
  );

  const applyOps = useCallback(
    async (ops: AccessOp[], doneMessage: string) => {
      if (!familiar || ops.length === 0 || busyAll) return;
      setBusyAll(true);
      setPendingIds(new Set(ops.map((op) => op.projectId)));
      setOptimistic((prev) => {
        const copy = new Map(prev);
        for (const op of ops) copy.set(op.projectId, op.op === "grant" ? op.access : null);
        return copy;
      });
      let failed = 0;
      // Sequential on purpose: the grants store is a single document, so
      // parallel writes could interleave.
      for (const op of ops) {
        try {
          await runAccessOp(familiar.id, op);
        } catch {
          failed += 1;
        }
      }
      await loadGrants();
      setOptimistic(new Map());
      setPendingIds(new Set());
      setBusyAll(false);
      if (failed > 0) setMutateError(`Couldn’t update ${failed} of ${ops.length} projects.`);
      else {
        setMutateError(null);
        announce(doneMessage);
      }
    },
    [familiar, busyAll, loadGrants, announce],
  );

  const setAllInSection = useCallback(
    (section: SectionModel<CaveProject>, target: AccessState) => {
      const ids = section.projects.map((p) => p.id);
      const ops = setAllOps(ids, directByProject, target);
      if (ops.length === 0) {
        announce("Nothing to change.");
        return;
      }
      void applyOps(
        ops,
        `${section.label}: ${ops.length} ${ops.length === 1 ? "project" : "projects"} set to ${accessStateMeta(target).label}.`,
      );
    },
    [directByProject, applyOps, announce],
  );

  /** Bulk band: apply one level to every checked project. */
  const setSelectedAccess = useCallback(
    (target: AccessState) => {
      const ids = [...selected];
      const ops = setAllOps(ids, directByProject, target);
      if (ops.length === 0) {
        announce("Nothing to change.");
        return;
      }
      void applyOps(
        ops,
        `${ops.length} ${ops.length === 1 ? "project" : "projects"} set to ${accessStateMeta(target).label}.`,
      ).then(() => setSelected(new Set()));
    },
    [selected, directByProject, applyOps, announce],
  );

  const resetAll = useCallback(async () => {
    if (!familiar) return;
    const ops = setAllOps(
      projects.map((p) => p.id),
      directByProject,
      "none",
    );
    if (ops.length === 0) {
      announce("No direct grants to reset.");
      return;
    }
    const ok = await confirm({
      title: `Reset ${familiarLabel(familiar)}’s access?`,
      body: `Removes ${ops.length === 1 ? "its 1 direct project grant" : `all ${ops.length} direct project grants`}. Access inherited from groups stays.`,
      confirmLabel: "Reset all",
      danger: true,
    });
    if (!ok) return;
    void applyOps(ops, `${familiarLabel(familiar)}: all direct grants removed.`);
  }, [familiar, projects, directByProject, confirm, applyOps, announce]);
  // ── Render ─────────────────────────────────────────────────────────────
  const isLoading = (projectsLoading && projects.length === 0) || (grantsLoading && !grantsData);
  const controlsDisabled = !familiar || supreme || busyAll;

  /** One project's full face: registry row + effective access + presentation. */
  const viewRows = useMemo(
    () =>
      filtered.map((project) => {
        const row = rowByProject.get(project.id) ?? {
          project,
          state: "none" as AccessState,
          direct: null,
          groupNames: [],
        };
        const kind = projectKind(project.root);
        return {
          ...row,
          id: project.id,
          name: project.name,
          kind,
          kindLabel: kind === "workspace" ? "coven workspace" : "git repository",
          meta: project.repoUrl ? (gitHubRepoSlug(project.repoUrl) ?? "linked") : kind === "workspace" ? "workspace" : "no remote",
        };
      }),
    [filtered, rowByProject],
  );
  const rowsById = useMemo(() => new Map(viewRows.map((r) => [r.id, r])), [viewRows]);

  /** Access pill — the one control that mutates a row, in every view. */
  const renderPill = (row: (typeof viewRows)[number]) => {
    const meta = accessStateMeta(row.state);
    const pending = pendingIds.has(row.id);
    const viaGroups = row.groupNames.length > 0 && !supreme ? ` — via ${row.groupNames.join(", ")}` : "";
    return (
      <button
        type="button"
        className={`projects-access-pill is-${row.state}${pending ? " is-pending" : ""}`}
        disabled={pending || supreme}
        onClick={() => void cycleRow(row)}
        title={
          supreme
            ? `${row.name} — Full (supreme familiar)`
            : `${row.name} — ${meta.label}${viaGroups}. Click to ${meta.action}.`
        }
        aria-label={`${row.name}: ${meta.label}${viaGroups}. ${supreme ? "Locked for the supreme familiar." : `Click to ${meta.action}.`}`}
      >
        <span className="projects-access-dot" aria-hidden />
        {meta.label}
      </button>
    );
  };

  /** The disclosed face: what this level actually permits, plus the facts. */
  const renderDetail = (row: (typeof viewRows)[number]) => (
    <div className="projects-access-detail">
      <dl className="projects-access-facts">
        <div>
          <dt>path</dt>
          <dd>{row.project.root}</dd>
        </div>
        <div>
          <dt>kind</dt>
          <dd>{row.kindLabel}</dd>
        </div>
        <div>
          <dt>held</dt>
          <dd>
            {supreme
              ? "supreme familiar"
              : row.groupNames.length > 0
                ? `via ${row.groupNames.join(", ")}`
                : row.direct
                  ? "direct grant"
                  : "not granted"}
          </dd>
        </div>
      </dl>
      <ul className={`projects-access-grants is-${row.state}`}>
        {grantChips(row.state).map((chip) => (
          <li key={chip.label} className={chip.on ? "is-on" : undefined}>
            <span className="projects-access-dot" aria-hidden />
            {chip.label}
          </li>
        ))}
      </ul>
    </div>
  );

  const renderCard = (row: (typeof viewRows)[number]) => {
    const open = expanded.has(row.id);
    const checked = selected.has(row.id);
    return (
      <li
        key={row.id}
        className={`projects-access-card is-${row.state}${checked ? " is-checked" : ""}${flashId === row.id ? " is-flash" : ""}`}
        id={`project-access-row:${row.id}`}
      >
        <span className="projects-access-card-bar" aria-hidden />
        {bulk ? (
          <label className="projects-access-check">
            <input
              type="checkbox"
              checked={checked}
              aria-label={`Select ${row.name}`}
              onChange={() => toggleSelected(row.id)}
            />
            <Icon name="ph:check" width={11} aria-hidden />
          </label>
        ) : null}
        <div className="projects-access-card-head">
          <span className={`projects-access-kind is-${row.kind}`} aria-hidden>
            <Icon name={row.kind === "workspace" ? "ph:folder" : "ph:github-logo"} width={13} />
          </span>
          <span className="projects-access-card-id">
            {renamingId === row.id ? (
              <input
                ref={renameRef}
                className="projects-access-rename"
                value={draftName}
                aria-label="Project name"
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
              />
            ) : (
              <span
                className="projects-access-card-name"
                title="Double-click to rename"
                onDoubleClick={() => startRename(row.project)}
              >
                {row.name}
              </span>
            )}
            <span className="projects-access-card-path">{row.project.root}</span>
          </span>
        </div>
        <div className="projects-access-card-foot">
          {renderPill(row)}
          <span className="projects-access-card-meta" title={row.meta}>
            {row.meta}
          </span>
          <button
            type="button"
            className="projects-access-disclose focus-ring"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} details for ${row.name}`}
            onClick={() => toggleExpanded(row.id)}
          >
            <Icon name="ph:caret-down" width={10} aria-hidden />
          </button>
          <button
            type="button"
            className="projects-access-gear focus-ring"
            onClick={() => setSettingsProjectId(row.id)}
            aria-label={`Project settings — ${row.name}`}
            title={
              row.project.repoUrl
                ? `Project settings — linked to ${gitHubRepoSlug(row.project.repoUrl) ?? row.project.repoUrl}`
                : "Project settings — link a GitHub repository"
            }
          >
            <Icon name="ph:gear-six" width={13} aria-hidden />
          </button>
        </div>
        {open ? renderDetail(row) : null}
      </li>
    );
  };

  let body: React.ReactNode;
  if (isLoading) {
    body = <SkeletonRows count={8} className="projects-access-skeleton" />;
  } else if (projectsError || (grantsError && !grantsData)) {
    body = (
      <ErrorState
        headline="Couldn’t load project access"
        subtitle={projectsError ?? grantsError}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              reload();
              setGrantsLoading(true);
              void loadGrants();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  } else if (familiars.length === 0) {
    body = (
      <EmptyState
        icon="ph:users-three"
        headline="No familiars yet"
        subtitle="Summon a familiar first — project access is granted per familiar."
      />
    );
  } else if (projects.length === 0) {
    body = (
      <EmptyState
        icon="ph:folder"
        headline="No projects yet"
        subtitle="Create one here, or register a folder from the chat composer."
        actions={
          <>
            <Button
              variant="primary"
              leadingIcon="ph:plus"
              disabled={addFlow.adding}
              onClick={addFlow.beginAddProject}
            >
              {addFlow.adding ? "Adding project…" : "New project"}
            </Button>
            <Button
              variant="secondary"
              leadingIcon="ph:sparkle"
              onClick={() => window.dispatchEvent(new CustomEvent("cave:salem-open"))}
            >
              Ask Salem
            </Button>
          </>
        }
      />
    );
  } else if (viewRows.length === 0) {
    body = (
      <p className="projects-access-nomatch" role="status">
        No projects match “{query.trim()}”.
      </p>
    );
  } else if (view === "rows") {
    // Dense audit list: strongest access first, then name.
    body = (
      <div className="projects-access-table">
        <div className="projects-access-thead" aria-hidden>
          <span>Project</span>
          <span>Path</span>
          <span>Scope</span>
          <span>Access</span>
        </div>
        <ul className="projects-access-tbody">
          {sortByAccessThenName(viewRows).map((row) => {
            const open = expanded.has(row.id);
            return (
              <li
                key={row.id}
                id={`project-access-row:${row.id}`}
                className={`projects-access-tr is-${row.state}${flashId === row.id ? " is-flash" : ""}`}
              >
                <div className="projects-access-tr-main">
                  <span className="projects-access-tr-name">
                    <span className="projects-access-card-bar" aria-hidden />
                    <span className={`projects-access-kind is-${row.kind}`} aria-hidden>
                      <Icon name={row.kind === "workspace" ? "ph:folder" : "ph:github-logo"} width={12} />
                    </span>
                    <span className="projects-access-card-name">{row.name}</span>
                  </span>
                  <span className="projects-access-tr-path">{row.project.root}</span>
                  <span className="projects-access-tr-scope">{row.kindLabel}</span>
                  {renderPill(row)}
                  <button
                    type="button"
                    className="projects-access-disclose focus-ring"
                    aria-expanded={open}
                    aria-label={`${open ? "Hide" : "Show"} details for ${row.name}`}
                    onClick={() => toggleExpanded(row.id)}
                  >
                    <Icon name="ph:caret-down" width={10} aria-hidden />
                  </button>
                </div>
                {open ? renderDetail(row) : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  } else if (view === "tree") {
    // By access level — the shape an audit actually asks for.
    body = (
      <div className="projects-access-tree">
        {treeGroups(viewRows).map((group) => (
          <section key={group.state} className={`projects-access-level is-${group.state}`}>
            <header>
              <h2>{group.label}</h2>
              <span className="projects-access-level-count">{group.countLabel}</span>
            </header>
            {group.items.length > 0 ? (
              <ul className="projects-access-chips">
                {group.items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      id={`project-access-row:${row.id}`}
                      className={`projects-access-chip${flashId === row.id ? " is-flash" : ""}`}
                      disabled={pendingIds.has(row.id) || supreme}
                      onClick={() => void cycleRow(row)}
                      title={`${row.name} — ${accessStateMeta(row.state).label}. Click to ${accessStateMeta(row.state).action}.`}
                    >
                      <span className={`projects-access-kind is-${row.kind}`} aria-hidden>
                        <Icon name={row.kind === "workspace" ? "ph:folder" : "ph:github-logo"} width={11} />
                      </span>
                      {row.name}
                      <span className="projects-access-chip-meta">{row.meta}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    );
  } else {
    // Grid: cards, split into workspaces and repositories.
    body = (
      <>
        {supreme && familiar ? (
          <p className="projects-access-supreme" role="note">
            <Icon name="ph:lock-simple" width={13} aria-hidden />
            {familiarLabel(familiar)} is the supreme familiar — full access to everything, always.
          </p>
        ) : null}
        {sections.map((section) => {
          const rows = section.projects
            .map((project) => rowsById.get(project.id))
            .filter((row): row is (typeof viewRows)[number] => Boolean(row));
          const isCollapsed = collapsed.has(section.key);
          return (
            <section key={section.key} className="projects-access-section" aria-label={section.label}>
              <header className="projects-access-section-head">
                <button
                  type="button"
                  className="projects-access-section-toggle focus-ring"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleSection(section.key)}
                >
                  <Icon
                    className={`projects-access-caret${isCollapsed ? " is-closed" : ""}`}
                    name="ph:caret-down"
                    width={10}
                    aria-hidden
                  />
                  <h2 className="projects-access-section-title">{section.label}</h2>
                  <span className="projects-access-section-count">{rows.length}</span>
                  {/* Folding a section must never hide that something in it is granted. */}
                  {isCollapsed ? (
                    <>
                      <span className="projects-access-mix">
                        {sectionMix(rows.map((row) => row.state)).map((chip) => (
                          <span
                            key={chip.state}
                            className={`projects-access-mix-chip is-${chip.state}`}
                            title={`${chip.count} ${chip.label}`}
                          >
                            <span className="projects-access-dot" aria-hidden />
                            {chip.count}
                          </span>
                        ))}
                      </span>
                      <span className="projects-access-peek">
                        {sectionPeek(rows.map((row) => row.name))}
                      </span>
                    </>
                  ) : null}
                </button>
                <span className="projects-access-rule" aria-hidden />
                <span className="projects-access-setall">
                  <span className="projects-access-setall-label">Set all:</span>
                  {(["write", "read", "none"] as const).map((target) => (
                    <button
                      key={target}
                      type="button"
                      className={`projects-access-setall-btn is-${target} focus-ring`}
                      disabled={controlsDisabled}
                      title={`Set every project in ${section.label} to ${accessStateMeta(target).label}`}
                      onClick={() => setAllInSection(section, target)}
                    >
                      <span className="projects-access-dot" aria-hidden />
                      {accessStateMeta(target).label}
                    </button>
                  ))}
                </span>
              </header>
              {!isCollapsed ? (
                <ul className="projects-access-grid">{rows.map(renderCard)}</ul>
              ) : null}
            </section>
          );
        })}
      </>
    );
  }

  return (
    <div className="projects-access" data-surface="projects">
      <div className="projects-access-inner">
        <header className="projects-access-header">
          <div className="projects-access-headline">
            <p className="projects-access-eyebrow">Familiars</p>
            <h1 className="projects-access-title">Project access</h1>
            <p className="projects-access-subtitle">
              What {familiar ? familiarLabel(familiar) : "this familiar"} may read and write. Click a
              project’s pill to cycle — none, read, full.
            </p>
          </div>
          {/* A proportional ledger, not three loose numbers: the bar IS the map. */}
          <div
            className="projects-access-ledger"
            title={ledger.map((seg) => `${seg.count} ${seg.label}`).join(" · ")}
          >
            <div className="projects-access-ledger-bar">
              {ledger.map((seg) => (
                <span
                  key={seg.state}
                  className={`is-${seg.state}`}
                  style={{ width: seg.width }}
                  aria-hidden
                />
              ))}
            </div>
            <div className="projects-access-ledger-key">
              {ledger.map((seg) => (
                <span key={seg.state} className={`is-${seg.state}`}>
                  <span className="projects-access-dot" aria-hidden />
                  {seg.count} {seg.label}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="projects-access-toolbar">
          {familiars.length > 0 && familiar ? (
            <StandardSelect
              label="Familiar"
              value={familiar.id}
              onChange={(id) => setPickedFamiliarId(id)}
              options={familiars.map((f) => ({ value: f.id, label: familiarLabel(f) }))}
              className="projects-access-familiar"
            />
          ) : null}
          <label className="projects-access-search">
            <Icon name="ph:magnifying-glass" width={14} aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a project…"
              aria-label="Find a project"
            />
            <kbd aria-hidden>/</kbd>
          </label>
          <div className="projects-access-views" role="group" aria-label="View mode">
            {(
              [
                { mode: "grid", icon: "ph:squares-four", label: "Grid", title: "Cards" },
                { mode: "rows", icon: "ph:rows", label: "Rows", title: "Dense list" },
                { mode: "tree", icon: "ph:stack", label: "Tree", title: "By access level" },
              ] as const
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`projects-access-view focus-ring${view === option.mode ? " is-on" : ""}`}
                aria-pressed={view === option.mode}
                title={option.title}
                onClick={() => pickView(option.mode)}
              >
                <Icon name={option.icon} width={11} aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
          <Button
            variant={bulk ? "primary" : "ghost"}
            size="sm"
            className="projects-access-select"
            leadingIcon="ph:check-square"
            aria-pressed={bulk}
            disabled={controlsDisabled}
            onClick={toggleBulk}
          >
            Select
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="projects-access-reset"
            leadingIcon="ph:arrow-counter-clockwise"
            disabled={controlsDisabled}
            onClick={() => void resetAll()}
          >
            Reset all
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="projects-access-new"
            leadingIcon="ph:plus"
            disabled={addFlow.adding}
            onClick={addFlow.beginAddProject}
          >
            {addFlow.adding ? "Adding…" : "New project"}
          </Button>
        </div>

        {/* Bulk band — present only while selecting. */}
        {bulk ? (
          <div className="projects-access-bulk" role="group" aria-label="Bulk access actions">
            <span className="projects-access-bulk-count">{selectionLabel(selected.size)}</span>
            <span className="projects-access-bulk-sep" aria-hidden />
            {(["write", "read", "none"] as const).map((target) => (
              <button
                key={target}
                type="button"
                className={`projects-access-bulk-btn is-${target} focus-ring`}
                disabled={selected.size === 0 || controlsDisabled}
                onClick={() => setSelectedAccess(target)}
              >
                <span className="projects-access-dot" aria-hidden />
                Set {accessStateMeta(target).label.toLowerCase()}
              </button>
            ))}
            <span className="projects-access-rule" aria-hidden />
            <button type="button" className="projects-access-bulk-done focus-ring" onClick={toggleBulk}>
              Done
            </button>
          </div>
        ) : null}

        {mutateError ? (
          <p className="projects-access-error" role="alert">
            {mutateError}
          </p>
        ) : null}
        {addFlow.addError ? (
          <p className="projects-access-error" role="alert">
            {addFlow.addError}
          </p>
        ) : null}

        {body}
      </div>

      <ProjectSettingsModal
        project={settingsProject}
        onClose={() => setSettingsProjectId(null)}
        onSaveRepoUrl={saveRepoUrl}
        onRename={renameProjectAndAnnounce}
        onDelete={removeProject}
      />
      {addFlow.addProjectModal}
    </div>
  );
}
