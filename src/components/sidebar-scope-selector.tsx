"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { ProjectAvatar } from "@/components/project-avatar";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
} from "@/components/ui/popover";
import { Icon } from "@/lib/icon";
import {
  sortProjectsAlphabetically,
  type CaveProject,
} from "@/lib/cave-projects-types";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";

export type SidebarScopeSelectorProps = {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  projectLoading: boolean;
  projectError: string | null;
  reloadProjects: () => void;
  project: CaveProject | null;
  allFamiliars: ResolvedFamiliar[];
  projectCrew: ResolvedFamiliar[];
  projectCrewLoading: boolean;
  projectCrewError: string | null;
  reloadProjectCrew: () => void;
  activeFamiliarId: string | null;
  selectedFamiliarIds: ReadonlySet<string>;
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  contextNotice?: string | null;
};

export function SidebarScopeSelector({
  projects,
  projectId,
  onProjectChange,
  projectLoading,
  projectError,
  reloadProjects,
  project,
  allFamiliars,
  projectCrew,
  projectCrewLoading,
  projectCrewError,
  reloadProjectCrew,
  activeFamiliarId,
  selectedFamiliarIds,
  onSelectFamiliar,
  contextNotice,
}: SidebarScopeSelectorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sortedProjects = useMemo(
    () => sortProjectsAlphabetically(projects),
    [projects],
  );
  const availableFamiliars = projectId ? projectCrew : allFamiliars;
  const activeFamiliar =
    availableFamiliars.find((familiar) => familiar.id === activeFamiliarId) ??
    null;
  const multiScope =
    selectedFamiliarIds.size >= 2 ? selectedFamiliarIds : null;
  const familiarLabel = multiScope
    ? `${multiScope.size} familiars`
    : activeFamiliar?.display_name ??
      (projectId ? "Project crew" : "All familiars");
  const projectLabel = project?.name ?? "All projects";
  const scopeLabel = `${projectLabel} · ${familiarLabel}`;
  const disabled = projectLoading && projectCrewLoading;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const closeAnd = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div className="sidebar-scope-selector">
      <button
        ref={triggerRef}
        type="button"
        className="sidebar-scope-selector__trigger focus-ring"
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-label={`Switch project or familiar — current: ${scopeLabel}`}
        title={scopeLabel}
        disabled={disabled}
      >
        <span className="sidebar-scope-selector__project" aria-hidden>
          {project ? (
            <ProjectAvatar
              name={project.name}
              root={project.root}
              color={project.color}
              size="sm"
            />
          ) : (
            <Icon name="ph:globe" width={14} />
          )}
        </span>
        <span className="sidebar-scope-selector__familiar">
          <span className="sidebar-scope-selector__icon" aria-hidden>
            {activeFamiliar && !multiScope ? (
              <FamiliarAvatar familiar={activeFamiliar} size="sm" />
            ) : (
              <Icon name="ph:sparkle" width={14} />
            )}
          </span>
          <span className="sidebar-scope-selector__label">{familiarLabel}</span>
        </span>
      </button>

      <Popover
        open={open && !disabled}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        placement="bottom-start"
        minWidth={280}
        className="sidebar-scope-selector__popover"
        ariaLabel="Switch project or familiar"
      >
        <PopoverBody role="menu" ariaLabel="Workspace scope">
          <PopoverLabel>Projects</PopoverLabel>
          {projectError ? (
            <PopoverItem icon="ph:arrow-clockwise" onSelect={reloadProjects}>
              Retry loading projects
            </PopoverItem>
          ) : (
            <>
              <PopoverItem
                icon="ph:squares-four"
                checked={projectId === null}
                active={projectId === null}
                disabled={projectLoading}
                onSelect={() => closeAnd(() => onProjectChange(null))}
              >
                All projects
              </PopoverItem>
              {sortedProjects.map((entry) => (
                <PopoverItem
                  key={entry.id}
                  leading={
                    <ProjectAvatar
                      name={entry.name}
                      root={entry.root}
                      color={entry.color}
                      size="sm"
                    />
                  }
                  checked={entry.id === projectId}
                  active={entry.id === projectId}
                  disabled={projectLoading}
                  title={entry.root}
                  onSelect={() => closeAnd(() => onProjectChange(entry.id))}
                >
                  <span className="sidebar-scope-selector__item-copy">
                    <span>{entry.name}</span>
                    <span className="sidebar-scope-selector__item-meta">
                      {entry.root}
                    </span>
                  </span>
                </PopoverItem>
              ))}
            </>
          )}

          <PopoverSeparator />
          <PopoverLabel>Familiars</PopoverLabel>
          {projectCrewError ? (
            <PopoverItem
              icon="ph:arrow-clockwise"
              onSelect={reloadProjectCrew}
            >
              Retry loading familiars
            </PopoverItem>
          ) : (
            <>
              <PopoverItem
                icon="ph:sparkle"
                checked={!multiScope && activeFamiliarId === null}
                active={!multiScope && activeFamiliarId === null}
                disabled={projectCrewLoading}
                onSelect={() => closeAnd(() => onSelectFamiliar(null))}
              >
                {projectId ? "Project crew" : "All familiars"}
              </PopoverItem>
              {availableFamiliars.map((familiar) => {
                const selected = multiScope
                  ? multiScope.has(familiar.id)
                  : familiar.id === activeFamiliarId;
                return (
                  <PopoverItem
                    key={familiar.id}
                    leading={
                      <FamiliarAvatar familiar={familiar} size="sm" />
                    }
                    checked={selected}
                    active={selected}
                    disabled={projectCrewLoading}
                    onSelect={() =>
                      closeAnd(() => onSelectFamiliar(familiar.id))
                    }
                  >
                    <span className="sidebar-scope-selector__item-copy">
                      <span>{familiar.display_name}</span>
                      {familiar.role ? (
                        <span className="sidebar-scope-selector__item-meta">
                          {familiar.role}
                        </span>
                      ) : null}
                    </span>
                  </PopoverItem>
                );
              })}
              {projectId &&
              !projectCrewLoading &&
              availableFamiliars.length === 0 ? (
                <div className="sidebar-scope-selector__empty" role="status">
                  No familiars have access to this project
                </div>
              ) : null}
            </>
          )}
          {contextNotice ? (
            <div className="sidebar-scope-selector__notice" role="note">
              {contextNotice}
            </div>
          ) : null}
        </PopoverBody>
      </Popover>
    </div>
  );
}
