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
  SECTION_LABELS,
  SECTION_ORDER,
  accessCounts,
  accessStateMeta,
  filterProjectsByQuery,
  nextAccessState,
  setAllOps,
  splitProjectsBySection,
  type AccessOp,
  type AccessState,
  type ProjectSection,
} from "@/lib/projects/access-page";
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

/**
 * The Chat → Projects surface: one familiar's project-access map. Pick a
 * familiar, see every registered project split into workspaces and
 * repositories, and click a row to cycle its direct grant — no access → read
 * → full → none — against /api/project-grants. Effective levels fold in
 * access-group grants (union-max), and the supreme familiar renders locked
 * at Full everywhere.
 */
export function ProjectsView({ familiars = [], activeFamiliarId = null }: ProjectsViewProps) {
  const { announce } = useAnnouncer();
  const confirm = useConfirm();
  // Unscoped: access is managed over EVERY registered project, not just the
  // ones the active familiar can already see.
  const { projects, loading: projectsLoading, error: projectsError, reload, createProject, updateRepoUrl } = useProjects();

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

  // ── Search ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filtered = useMemo(() => filterProjectsByQuery(projects, query), [projects, query]);
  const sections = useMemo(() => splitProjectsBySection(filtered), [filtered]);

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
    (section: ProjectSection, target: AccessState) => {
      const ids = sections[section].map((p) => p.id);
      const ops = setAllOps(ids, directByProject, target);
      if (ops.length === 0) {
        announce("Nothing to change.");
        return;
      }
      void applyOps(
        ops,
        `${SECTION_LABELS[section]}: ${ops.length} ${ops.length === 1 ? "project" : "projects"} set to ${accessStateMeta(target).label}.`,
      );
    },
    [sections, directByProject, applyOps, announce],
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
  } else {
    const visibleSections = SECTION_ORDER.filter((section) => sections[section].length > 0);
    body = (
      <>
        {supreme && familiar ? (
          <p className="projects-access-supreme" role="note">
            <Icon name="ph:lock-simple" width={13} aria-hidden />
            {familiarLabel(familiar)} is the supreme familiar — full access to everything, always.
          </p>
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
        {visibleSections.length === 0 ? (
          <p className="projects-access-nomatch" role="status">
            No projects match “{query.trim()}”.
          </p>
        ) : (
          visibleSections.map((section) => (
            <section key={section} className="projects-access-section" aria-label={SECTION_LABELS[section]}>
              <header className="projects-access-section-head">
                <h2 className="projects-access-section-title">
                  {SECTION_LABELS[section]}
                  <span className="projects-access-section-count">{sections[section].length}</span>
                </h2>
                <span className="projects-access-rule" aria-hidden />
                <span className="projects-access-setall">
                  <span className="projects-access-setall-label">Set all:</span>
                  {(["none", "read", "write"] as const).map((target) => (
                    <button
                      key={target}
                      type="button"
                      className="projects-access-setall-btn"
                      disabled={controlsDisabled}
                      onClick={() => setAllInSection(section, target)}
                    >
                      {target === "none" ? "None" : accessStateMeta(target).label}
                    </button>
                  ))}
                </span>
              </header>
              <ul className="projects-access-list">
                {sections[section].map((project) => {
                  const row = rowByProject.get(project.id) ?? {
                    project,
                    state: "none" as AccessState,
                    direct: null,
                    groupNames: [],
                  };
                  const meta = accessStateMeta(row.state);
                  const pending = pendingIds.has(project.id);
                  const viaGroups =
                    row.groupNames.length > 0 && !supreme
                      ? ` — via ${row.groupNames.join(", ")}`
                      : "";
                  return (
                    <li key={project.id}>
                      <div className="projects-access-rowwrap">
                        <button
                          id={`project-access-row:${project.id}`}
                          type="button"
                          className={`projects-access-row is-${row.state}${pending ? " is-pending" : ""}${flashId === project.id ? " is-flash" : ""}`}
                          disabled={pending || supreme}
                          onClick={() => void cycleRow(row)}
                          title={
                            supreme
                              ? `${project.name} — Full (supreme familiar)`
                              : `${project.name} — ${meta.label}${viaGroups}. Click to ${accessStateMeta(row.state).action}.`
                          }
                          aria-label={`${project.name}: ${meta.label}${viaGroups}. ${supreme ? "Locked for the supreme familiar." : `Click to ${meta.action}.`}`}
                        >
                          <Icon className="projects-access-row-icon" name="ph:folder" width={15} aria-hidden />
                          <span className="projects-access-row-name">{project.name}</span>
                          {project.repoUrl ? (
                            <Icon
                              className="projects-access-row-repo"
                              name="ph:github-logo"
                              width={13}
                              aria-hidden
                            />
                          ) : null}
                          {row.groupNames.length > 0 && !supreme ? (
                            <Icon
                              className="projects-access-row-group"
                              name="ph:users-three"
                              width={13}
                              aria-hidden
                            />
                          ) : null}
                          <span className={`projects-access-pill is-${row.state}`}>
                            <span className="projects-access-dot" aria-hidden />
                            {meta.label}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="projects-access-row-settings focus-ring"
                          onClick={() => setSettingsProjectId(project.id)}
                          aria-label={`Project settings — ${project.name}`}
                          title={
                            project.repoUrl
                              ? `Project settings — linked to ${gitHubRepoSlug(project.repoUrl) ?? project.repoUrl}`
                              : "Project settings — link a GitHub repository"
                          }
                        >
                          <Icon name="ph:gear-six" width={14} aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </>
    );
  }

  return (
    <div className="projects-access" data-surface="projects">
      <div className="projects-access-inner">
        <header className="projects-access-header">
          <p className="projects-access-eyebrow">Familiars</p>
          <h1 className="projects-access-title">Project access</h1>
          <p className="projects-access-subtitle">
            Choose what each familiar can see and touch. Click any project to cycle its access —
            none, read, or full.
          </p>
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
          </label>
          <span className="projects-access-counts" title={`${counts.none} without access · ${counts.read} read · ${counts.write} full`}>
            <span className="projects-access-count is-none">
              <span className="projects-access-dot" aria-hidden />
              {counts.none}
            </span>
            <span className="projects-access-count is-read">
              <span className="projects-access-dot" aria-hidden />
              {counts.read}
            </span>
            <span className="projects-access-count is-write">
              <span className="projects-access-dot" aria-hidden />
              {counts.write}
            </span>
            <span className="sr-only">{`${counts.none} without access, ${counts.read} read, ${counts.write} full`}</span>
          </span>
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

        {body}
      </div>

      <ProjectSettingsModal
        project={settingsProject}
        onClose={() => setSettingsProjectId(null)}
        onSaveRepoUrl={saveRepoUrl}
      />
      {addFlow.addProjectModal}
    </div>
  );
}
