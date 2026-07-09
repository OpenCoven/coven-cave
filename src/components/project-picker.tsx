"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { ProjectAvatar } from "@/components/project-avatar";
import { addChatProject } from "@/lib/chat-add-project";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import { isTauri } from "@/lib/tauri-platform";

export type AddProjectFlow = {
  /** Open the folder chooser — native dialog on desktop, in-app browser on web. */
  beginAddProject: () => void;
  /** Render once near the caller's root: the web-fallback directory browser. */
  addProjectModal: ReactNode;
  adding: boolean;
  addError: string | null;
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
  createProject: (name: string, root: string) => Promise<CaveProject | null>;
  projects: CaveProject[];
  onAdded: (projectId: string) => void;
}): AddProjectFlow {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const registerRoot = async (dir: string) => {
    const root = dir.trim();
    if (!root) return;
    setAdding(true);
    setAddError(null);
    const existing = args.projects.find((project) => project.root === root);
    const result = await addChatProject({
      root,
      familiarId: args.familiarId,
      createProject: args.createProject,
      existingProjectId: existing?.id ?? null,
    });
    setAdding(false);
    if (result.ok) args.onAdded(result.projectId);
    else setAddError(result.error);
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

  return { beginAddProject, addProjectModal, adding, addError };
}

/** Resolve the effective selection: NO_PROJECT_ID → none; null → first project. */
function selectedProject(value: string | null, sorted: CaveProject[]): CaveProject | null {
  return value === NO_PROJECT_ID
    ? null
    : (value ? sorted.find((project) => project.id === value) ?? sorted[0] : sorted[0]) ?? null;
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
  onAddProject,
  addingProject = false,
  placement = "bottom-start",
  ariaLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  value: string | null;
  onChange: (id: string) => void;
  allowNoProject?: boolean;
  /** Presence enables the "Add project…" row. */
  onAddProject?: () => void;
  addingProject?: boolean;
  placement?: "bottom-start" | "bottom-end";
  ariaLabel: string;
}) {
  const [query, setQuery] = useState("");
  const sortedProjects = useMemo(() => sortProjectsAlphabetically(projects), [projects]);
  const selected = selectedProject(value, sortedProjects);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) || project.root.toLowerCase().includes(q),
    );
  }, [sortedProjects, query]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

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
        {projects.length > 6 ? (
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter projects…"
            aria-label="Filter projects"
            className="cave-project-picker__filter focus-ring-inset"
          />
        ) : null}
        <PopoverLabel>Project</PopoverLabel>
        {allowNoProject ? (
          <PopoverItem
            icon="ph:folder"
            checked={!selected}
            active={!selected}
            onSelect={() => {
              onChange(NO_PROJECT_ID);
              close();
            }}
          >
            No project
          </PopoverItem>
        ) : null}
        {visible.map((entry) => (
          <PopoverItem
            key={entry.id}
            leading={
              <ProjectAvatar name={entry.name} root={entry.root} color={entry.color} size="sm" />
            }
            checked={entry.id === selected?.id}
            active={entry.id === selected?.id}
            onSelect={() => {
              onChange(entry.id);
              close();
            }}
          >
            <span className="cave-project-picker__option">
              <span className="cave-project-picker__option-name">{entry.name}</span>
              <span className="cave-project-picker__option-root">{entry.root}</span>
            </span>
          </PopoverItem>
        ))}
        {query.trim() && visible.length === 0 ? (
          <div className="cave-project-picker__none">No projects match</div>
        ) : null}
        {onAddProject ? (
          <>
            <PopoverSeparator />
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
          </>
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
  familiarId = null,
  createProject,
  disabled = false,
  ariaLabel,
  className,
}: {
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  value: string | null;
  onChange: (id: string) => void;
  allowNoProject?: boolean;
  familiarId?: string | null;
  /** From the caller's useProjects(); presence enables the "Add project…" row. */
  createProject?: (name: string, root: string) => Promise<CaveProject | null>;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sortedProjects = useMemo(() => sortProjectsAlphabetically(projects), [projects]);
  const selected = selectedProject(value, sortedProjects);

  const addFlow = useAddProjectFlow({
    familiarId,
    createProject: createProject ?? (async () => null),
    projects,
    onAdded: onChange,
  });

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        className={`cave-project-picker__trigger focus-ring${className ? ` ${className}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        title={selected ? selected.root : "No project"}
      >
        {selected ? (
          <ProjectAvatar name={selected.name} root={selected.root} color={selected.color} size="sm" />
        ) : (
          <Icon name="ph:folder" width={14} aria-hidden />
        )}
        <span className="cave-project-picker__trigger-label">
          {selected ? selected.name : "No project"}
        </span>
        <Icon name="ph:caret-up-down-bold" width={10} aria-hidden />
      </Button>
      <ProjectPickerPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        projects={projects}
        value={value}
        onChange={onChange}
        allowNoProject={allowNoProject}
        onAddProject={createProject ? addFlow.beginAddProject : undefined}
        addingProject={addFlow.adding}
        ariaLabel={ariaLabel}
      />
      {addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {addFlow.addError}
        </span>
      ) : null}
      {createProject ? addFlow.addProjectModal : null}
    </>
  );
}
