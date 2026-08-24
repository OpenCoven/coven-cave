"use client";

import { ProjectPicker } from "@/components/project-picker";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import { Button } from "@/components/ui/button";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

export type WorkspaceContextSwitcherProps = {
  projects: CaveProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  projectLoading: boolean;
  projectError: string | null;
  reloadProjects: () => void;
  project: CaveProject | null;
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  allFamiliars: ResolvedFamiliar[];
  projectCrew: ResolvedFamiliar[];
  projectCrewLoading: boolean;
  projectCrewError: string | null;
  reloadProjectCrew: () => void;
  activeFamiliarId: string | null;
  selectedFamiliarIds: ReadonlySet<string>;
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  contextNotice?: string | null;
  variant?: "rail" | "titlebar";
};

/**
 * The hybrid rail control — project scope first, then familiar scope.
 *
 * Presentational: no data fetching, no routing. Renders the registry-error
 * banner before the two controls so operators can recover without a reload.
 * contextNotice is rendered as a role=note outside FamiliarSwitcher because
 * that prop does not belong to FamiliarSwitcher's public API.
 */
export function WorkspaceContextSwitcher({
  projects,
  projectId,
  onProjectChange,
  projectLoading,
  projectError,
  reloadProjects,
  project,
  createProjectOrThrow,
  allFamiliars,
  projectCrew,
  projectCrewLoading,
  projectCrewError,
  reloadProjectCrew,
  activeFamiliarId,
  selectedFamiliarIds,
  onSelectFamiliar,
  sessions,
  responseNeeded,
  contextNotice,
  variant = "rail",
}: WorkspaceContextSwitcherProps) {
  return (
    <div className={`workspace-context-switcher workspace-context-switcher--${variant}`}>
      {projectError ? (
        <div className="workspace-context-switcher__error" role="alert">
          <span>{projectError}</span>
          <Button variant="ghost" size="sm" onClick={reloadProjects} aria-label="Retry loading projects">
            Retry
          </Button>
        </div>
      ) : null}
      <div className="workspace-context-switcher__project">
        <ProjectPicker
          projects={projects}
          value={projectId}
          onChange={(nextProjectId) => onProjectChange(nextProjectId)}
          defaultToFirst={false}
          allProjectsLabel="All projects"
          onSelectAllProjects={() => onProjectChange(null)}
          familiarId={activeFamiliarId}
          createProjectOrThrow={createProjectOrThrow}
          ariaLabel="Switch project"
          disabled={projectLoading || Boolean(projectError)}
        />
      </div>
      <div className="workspace-context-switcher__crew">
        <FamiliarSwitcher
          familiars={projectId ? projectCrew : allFamiliars}
          activeFamiliarId={activeFamiliarId}
          selectedFamiliarIds={selectedFamiliarIds}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          aggregateLabel={projectId ? "Project crew" : "All familiars"}
          aggregateDescription={projectId ? `${projectCrew.length} with access` : undefined}
          placement="bottom-start"
          labeled
          disabled={projectCrewLoading || Boolean(projectCrewError)}
        />
      </div>
      {projectCrewError ? (
        <div className="workspace-context-switcher__error" role="alert">
          <span>{projectCrewError}</span>
          <Button variant="ghost" size="sm" onClick={reloadProjectCrew} aria-label="Retry loading project crew">
            Retry
          </Button>
        </div>
      ) : null}
      {project && !projectCrewLoading && !projectCrewError && projectCrew.length === 0 ? (
        <div className="workspace-context-switcher__empty" role="status">
          No familiars have access to this project
        </div>
      ) : null}
      {contextNotice ? (
        <div className="workspace-context-switcher__notice" role="note">
          {contextNotice}
        </div>
      ) : null}
    </div>
  );
}
