"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { ProjectRootWorkspaceNotice } from "@/components/project-root-workspace-notice";
import {
  RECENT_SECTION_SIZE,
  loadFrecencyStore,
  rankProjectsByFrecency,
  rememberProjectPick,
} from "@/lib/project-frecency";
import { ProjectAvatar } from "@/components/project-avatar";
import { addChatProject, type CreateProjectOptions } from "@/lib/chat-add-project";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import {
  projectForPickerQuery,
  sortProjectsAlphabetically,
  type CaveProject,
} from "@/lib/cave-projects-types";
import { projectAccessLabel } from "@/lib/project-access-levels";
import { isTauri } from "@/lib/tauri-platform";
import { resolveProjectPickerSelection } from "@/lib/project-picker-selection";

const PROJECT_PREVIEW_SIZE = 8;

export type AddProjectFlow = {
  /** Open the folder chooser — native dialog on desktop, in-app browser on web. */
  beginAddProject: () => void;
  /** Render once near the caller's root: the web-fallback directory browser. */
  addProjectModal: ReactNode;
  adding: boolean;
  addError: string | null;
  /** Stable server code of the last add failure, when the API returned one. */
  addErrorCode: string | null;
};

/**
 * The one shared add-project flow. Registering a root only makes the access
 * check resolve to a project id; the familiar still needs a grant — so this
 * always goes through addChatProject (register + grant, already unit-tested),
 * the same helper the chat 403-recovery uses. Every entry point is a direct
 * human click, which is what the grant route requires.
 */
export function useAddProjectFlow(args: {
  familiarId: string | null;
  createProject?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  projects: CaveProject[];
  onAdded: (projectId: string) => void;
}): AddProjectFlow {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addErrorCode, setAddErrorCode] = useState<string | null>(null);

  const registerRoot = async (dir: string) => {
    const root = dir.trim();
    if (!root) return;
    setAdding(true);
    setAddError(null);
    setAddErrorCode(null);
    const existing = args.projects.find((project) => project.root === root);
    const result = await addChatProject({
      root,
      familiarId: args.familiarId,
      createProject: args.createProject ?? (async () => null),
      createProjectOrThrow: args.createProjectOrThrow,
      existingProjectId: existing?.id ?? null,
    });
    setAdding(false);
    if (result.ok) args.onAdded(result.projectId);
    else {
      setAddError(result.error);
      setAddErrorCode(result.code ?? null);
    }
  };

  const beginAddProject = () => {
    if (isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const picked = await invoke<string | null>("shell_pick_directory");
          if (picked) await registerRoot(picked);
        } catch {
          // Native dialog unavailable on this build — fall back to the web browser.
          setPickerOpen(true);
        }
      })();
      return;
    }
    setPickerOpen(true);
  };

  const addProjectModal = (
    <DirectoryPickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onSelect={(dir) => {
        setPickerOpen(false);
        void registerRoot(dir);
      }}
    />
  );

  return { beginAddProject, addProjectModal, adding, addError, addErrorCode };
}


/**
 * Controlled popover half of the shared project picker — the filterable list,
 * No-project row, and optional Add-project row, anchored to any caller-owned
 * trigger. ProjectPicker mounts it behind its chip; the chat session kebab
 * anchors it to the kebab trigger so switching projects is one compact row
 * instead of a full inline list.
 */
export function ProjectPickerPopover({
  open,
  onOpenChange,
  anchorRef,
  projects,
  value,
  onChange,
  allowNoProject = false,
  defaultToFirst = true,
  onAddProject,
  addingProject = false,
  registerCurrentRoot,
  onRegisterCurrentRoot,
  placement = "bottom-start",
  ariaLabel,
  allProjectsLabel,
  onSelectAllProjects,
  familiarLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  value: string | null;
  onChange: (id: string) => void;
  allowNoProject?: boolean;
  /** False keeps null rendered as "Choose project" until a durable id is selected. */
  defaultToFirst?: boolean;
  /** Presence enables the "Add project…" row. */
  onAddProject?: () => void;
  addingProject?: boolean;
  /** Ad-hoc root the current chat runs in (spec 2026-07-24) — presence with
   *  onRegisterCurrentRoot enables the in-place "Register this folder" row. */
  registerCurrentRoot?: string;
  onRegisterCurrentRoot?: () => void;
  placement?: "bottom-start" | "bottom-end";
  ariaLabel: string;
  /** When both are provided, renders an "All projects" row before the No project row. */
  allProjectsLabel?: string;
  onSelectAllProjects?: () => void;
  /** Display name of the familiar currently in scope. Its presence enables the
   *  familiar-scoped section between Recent and the A-Z list; omit it (or pass
   *  null in an All-familiars scope) and that section is not rendered. */
  familiarLabel?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [showAllProjects, setShowAllProjects] = useState(false);
  const sortedProjects = useMemo(() => sortProjectsAlphabetically(projects), [projects]);
  const { selected, allProjectsEnabled, allProjectsSelected, noProjectSelected } =
    resolveProjectPickerSelection({
      sorted: sortedProjects, value, noProjectId: NO_PROJECT_ID,
      allowNoProject, defaultToFirst,
      allProjectsLabel, hasAllProjectsAction: Boolean(onSelectAllProjects),
    });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) || project.root.toLowerCase().includes(q),
    );
  }, [sortedProjects, query]);
  const displayedProjects = useMemo(() => {
    if (query.trim() || showAllProjects || visible.length <= PROJECT_PREVIEW_SIZE) {
      return visible;
    }
    const preview = visible.slice(0, PROJECT_PREVIEW_SIZE);
    if (selected && !preview.some((project) => project.id === selected.id)) {
      return [...preview, selected];
    }
    return preview;
  }, [query, selected, showAllProjects, visible]);
  const hiddenProjectCount = visible.length - displayedProjects.length;

  // Sampled when the popover OPENS, not on every render: picking a project
  // must not reshuffle the section under the cursor mid-interaction, and a
  // clock tick should not either. Suppressed while filtering — a query is
  // already a narrower answer than "what you use a lot" (cave-ow9f).
  const recent = useMemo(() => {
    if (!open || query.trim()) return [];
    return rankProjectsByFrecency(
      sortedProjects,
      loadFrecencyStore(),
      Date.now(),
      RECENT_SECTION_SIZE,
    ).recent;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is the sampling edge.
  }, [open, sortedProjects, query]);

  // The scoped familiar's own projects, between Recent and the A-Z list.
  // `access` is only populated on familiar-scoped reads (see CaveProject), so
  // its presence IS the "this familiar can reach this project" signal — there
  // is no separate membership list to consult.
  //
  // Sampled on the same `open` edge as Recent so the two sections cannot
  // reshuffle independently mid-interaction, and suppressed while filtering for
  // the same reason Recent is: a query is already the narrower answer.
  //
  // Recent entries are excluded here (unlike the A-Z list, which deliberately
  // stays complete) purely to stop the top of the popover repeating itself two
  // rows apart. A-Z below still holds every project.
  const familiarProjects = useMemo(() => {
    if (!open || query.trim() || !familiarLabel) return [];
    const recentIds = new Set(recent.map((entry) => entry.id));
    return sortedProjects.filter((entry) => entry.access && !recentIds.has(entry.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is the sampling edge.
  }, [open, sortedProjects, query, familiarLabel, recent]);

  const renderProjectRow = (entry: CaveProject, key: string) => (
    <PopoverItem
      key={key}
      leading={<ProjectAvatar name={entry.name} root={entry.root} color={entry.color} size="sm" />}
      checked={entry.id === selected?.id}
      active={entry.id === selected?.id}
      title={`${entry.root}${entry.access ? ` · ${projectAccessLabel(entry.access)} access` : ""}`}
      onSelect={() => pick(entry)}
    >
      <span className="cave-project-picker__option">
        <span className="cave-project-picker__option-heading">
          <span className="cave-project-picker__option-name">{entry.name}</span>
          {entry.access ? (
            <span className="cave-project-picker__option-access">
              {projectAccessLabel(entry.access)}
            </span>
          ) : null}
        </span>
        <span className="cave-project-picker__option-root">{entry.root}</span>
      </span>
    </PopoverItem>
  );

  const pick = (project: { id: string; root: string }) => {
    rememberProjectPick(project.root);
    onChange(project.id);
    close();
  };

  const close = () => {
    onOpenChange(false);
    setQuery("");
    setShowAllProjects(false);
  };

  // Parents may close the picker by flipping `open` directly (e.g. the trigger
  // chip toggles, or a shared-anchor sibling closes it) — those paths never go
  // through close(), so the filter must also reset on the prop itself or the
  // next open shows a stale pre-filtered list.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setShowAllProjects(false);
    }
  }, [open]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      anchorRef={anchorRef}
      placement={placement}
      minWidth={260}
      className="cave-project-picker__popover"
      ariaLabel={ariaLabel}
    >
      <PopoverBody>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            const match = projectForPickerQuery(sortedProjects, query);
            if (!match) return;
            // Same path as clicking a row: typing a project's name and pressing
            // Enter is a pick, and frecency has to learn from it too.
            pick(match);
          }}
          placeholder="Filter projects…"
          aria-label="Filter projects"
          className="cave-project-picker__filter focus-ring-inset"
        />
        <PopoverLabel>Project</PopoverLabel>
        {allProjectsEnabled ? (
          <PopoverItem
            icon="ph:squares-four"
            // checked/active only when the all-projects scope is selected.
            checked={allProjectsSelected}
            active={allProjectsSelected}
            onSelect={() => {
              onSelectAllProjects?.();
              close();
            }}
          >
            {allProjectsLabel}
          </PopoverItem>
        ) : null}
        {allowNoProject ? (
          <PopoverItem
            icon="ph:folder"
            checked={noProjectSelected}
            active={noProjectSelected}
            onSelect={() => {
              onChange(NO_PROJECT_ID);
              close();
            }}
          >
            No project
          </PopoverItem>
        ) : null}
        {/* cave-ow9f: a capped Recent section pins on top. The A-Z list below
            is unchanged and still holds every project — the section is
            additive, so a list you have learned the shape of never reorders
            under your cursor and never develops holes. */}
        {recent.length > 0 ? (
          <>
            <PopoverLabel>Recent</PopoverLabel>
            {recent.map((entry) => renderProjectRow(entry, `recent-${entry.id}`))}
            <PopoverSeparator />
          </>
        ) : null}
        {familiarProjects.length > 0 ? (
          <>
            <PopoverLabel>{`${familiarLabel}'s projects`}</PopoverLabel>
            {familiarProjects.map((entry) => renderProjectRow(entry, `familiar-${entry.id}`))}
            <PopoverSeparator />
          </>
        ) : null}
        {recent.length > 0 || familiarProjects.length > 0 ? (
          <PopoverLabel>All projects</PopoverLabel>
        ) : null}
        {displayedProjects.map((entry) => renderProjectRow(entry, entry.id))}
        {!query.trim() && (showAllProjects || hiddenProjectCount > 0) ? (
          <PopoverItem
            key="project-list-toggle"
            icon={showAllProjects ? "ph:caret-up" : "ph:caret-down"}
            onSelect={() => setShowAllProjects((current) => !current)}
          >
            {showAllProjects
              ? "Show fewer projects"
              : `Show ${hiddenProjectCount} more project${hiddenProjectCount === 1 ? "" : "s"}`}
          </PopoverItem>
        ) : null}
        {query.trim() && visible.length === 0 ? (
          <div className="cave-project-picker__none">No projects match</div>
        ) : null}
        {(onRegisterCurrentRoot && registerCurrentRoot) || onAddProject ? (
          <PopoverSeparator />
        ) : null}
        {onRegisterCurrentRoot && registerCurrentRoot ? (
          <PopoverItem
            icon="ph:folder-plus"
            onSelect={() => {
              close();
              onRegisterCurrentRoot();
            }}
          >
            <span className="cave-project-picker__option">
              <span className="cave-project-picker__option-name">
                Register this folder as a project…
              </span>
              <span className="cave-project-picker__option-root">{registerCurrentRoot}</span>
            </span>
          </PopoverItem>
        ) : null}
        {onAddProject ? (
          <PopoverItem
            icon="ph:plus"
            disabled={addingProject}
            onSelect={() => {
              close();
              onAddProject();
            }}
          >
            {addingProject ? "Adding project…" : "Add project…"}
          </PopoverItem>
        ) : null}
      </PopoverBody>
    </Popover>
  );
}

/**
 * Shared project picker: one trigger chip + popover for every surface that
 * lets the user choose the project a conversation runs in. Replaces the
 * per-surface mix of native selects and ad-hoc lists so selection reads the
 * same everywhere, and folds the add flow in so an empty registry is an
 * onboarding affordance instead of a dead end.
 */
export function ProjectPicker({
  projects,
  value,
  onChange,
  allowNoProject = false,
  defaultToFirst = true,
  familiarId = null,
  createProject,
  createProjectOrThrow,
  disabled = false,
  ariaLabel,
  className,
  allProjectsLabel,
  onSelectAllProjects,
  familiarLabel,
}: {
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  value: string | null;
  onChange: (id: string) => void;
  allowNoProject?: boolean;
  /** False keeps null rendered as "Choose project" until a durable id is selected. */
  defaultToFirst?: boolean;
  familiarId?: string | null;
  /** From the caller's useProjects(); either creator enables the "Add project…" row. */
  createProject?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  /** Throwing creator from the caller's useProjects(); preserves server guidance. */
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  /** When both are provided, renders an "All projects" row before the No project row. */
  allProjectsLabel?: string;
  onSelectAllProjects?: () => void;
  /** Scoped familiar's display name — enables the familiar-scoped section. */
  familiarLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Gate the visible popover: never open while the control is disabled.
  const popoverOpen = open && !disabled;

  // Clear stored open state when the control becomes disabled so the popover
  // does not reappear the moment the control is re-enabled.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const sortedProjects = useMemo(() => sortProjectsAlphabetically(projects), [projects]);
  const { selected, emptyLabel } = resolveProjectPickerSelection({
      sorted: sortedProjects, value, noProjectId: NO_PROJECT_ID,
      allowNoProject, defaultToFirst,
      allProjectsLabel, hasAllProjectsAction: Boolean(onSelectAllProjects),
    });
  const selectedAccess = selected?.access ? projectAccessLabel(selected.access) : null;
  const selectedAccessibleLabel = selected
    ? `${selected.name}${selectedAccess ? `, ${selectedAccess} access` : ""}`
    : emptyLabel;

  const addFlow = useAddProjectFlow({
    familiarId,
    createProject: createProject ?? (async () => null),
    createProjectOrThrow,
    projects,
    onAdded: onChange,
  });
  const canAddProject = Boolean(createProject || createProjectOrThrow);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        className={`cave-project-picker__trigger focus-ring${className ? ` ${className}` : ""}`}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={`${ariaLabel}: ${selectedAccessibleLabel}`}
        disabled={disabled}
        title={
          selected
            ? `${selected.root}${selectedAccess ? ` · ${selectedAccess} access` : ""}`
            : emptyLabel
        }
      >
        {selected ? (
          <ProjectAvatar name={selected.name} root={selected.root} color={selected.color} size="sm" />
        ) : (
          <Icon name="ph:folder" width={14} aria-hidden />
        )}
        <span className="cave-project-picker__trigger-label">
          {selected ? `${selected.name}${selectedAccess ? ` · ${selectedAccess}` : ""}` : emptyLabel}
        </span>
        <Icon name="ph:caret-up-down-bold" width={10} aria-hidden className="cave-project-picker__trigger-caret" />
      </Button>
      <ProjectPickerPopover
        open={popoverOpen}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        projects={projects}
        value={value}
        onChange={onChange}
        allowNoProject={allowNoProject}
        defaultToFirst={defaultToFirst}
        onAddProject={canAddProject ? addFlow.beginAddProject : undefined}
        addingProject={addFlow.adding}
        ariaLabel={ariaLabel}
        allProjectsLabel={allProjectsLabel}
        onSelectAllProjects={onSelectAllProjects}
        familiarLabel={familiarLabel}
      />
      {addFlow.addError ? (
        <ProjectRootWorkspaceNotice
          as="span"
          className="cave-project-picker__error"
          code={addFlow.addErrorCode}
          error={addFlow.addError}
        />
      ) : null}
      {canAddProject ? addFlow.addProjectModal : null}
    </>
  );
}
