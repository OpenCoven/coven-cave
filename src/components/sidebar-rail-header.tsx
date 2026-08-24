"use client";

/**
 * SidebarRailHeader — the siderail's shared top: workspace context + New chat.
 *
 * Both rail sections render this. Home (`SidebarMinimal`) and Chat
 * (`WorkspaceSidebar`) are separate components with separate stylesheets, and
 * for a long time each re-declared this header's chrome by hand — the only
 * parity contract being a `/* Matches .cnav__new on the Chat rail *\/` comment
 * in one of them. The copies drifted (a hardcoded 10px radius against
 * `var(--radius-control)`, `--text-sm` against `--text-base`, 32px against
 * 34px), so toggling Home ↔ Chat visibly restyled controls that never move.
 *
 * The design gates could not catch it: every drifted value was token-legal, and
 * nothing checks that two components which must look identical picked the SAME
 * token. One component with one namespace is the fix — see
 * docs/specs/2026-08-06-sidebar-rail-parity-design.md.
 *
 * Presentational only: no data fetching, no mode knowledge. Section-specific
 * chrome (Chat's Organize menu, Home's brand mark) stays with its own sidebar.
 *
 * New project/crew props are optional with safe defaults so existing Task 6
 * callers (WorkspaceSidebar, SidebarMinimal) compile before they are wired.
 * Report: once Task 6 wires the callers, all optional defaults become required.
 */

import type { ReactNode } from "react";
import { WorkspaceContextSwitcher } from "@/components/workspace-context-switcher";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

// Module-level stable identities — creating arrays/sets/functions during render
// gives consumers new references on every call, forcing downstream re-renders.
const EMPTY_PROJECTS: CaveProject[] = [];
const EMPTY_CREW: ResolvedFamiliar[] = [];
const EMPTY_SELECTED_FAMILIAR_IDS: ReadonlySet<string> = new Set<string>();
const NOOP_PROJECT_CHANGE = (_projectId: string | null): void => {};
const NOOP_RELOAD = (): void => {};

export type SidebarRailHeaderProps = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  /** Multiselect scope (≥2 ids) — the trigger summarizes the count. */
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** `null` scopes to "All familiars". */
  onSelectFamiliar: (id: string | null, opts?: { multi?: boolean }) => void;
  onNewChat: () => void;
  /** Native tooltip on the New-chat button — Chat names its ⌘N shortcut. */
  newChatTitle?: string;
  /** Trailing slot inside the New-chat button. Chat puts its ⌘N hint here
   *  rather than forking the button, which is how the two drifted before. */
  newChatTrailing?: ReactNode;
  // ── Project / workspace context (wired by Task 6 callers) ─────────────────
  projects?: CaveProject[];
  projectId?: string | null;
  onProjectChange?: (projectId: string | null) => void;
  projectLoading?: boolean;
  projectError?: string | null;
  reloadProjects?: () => void;
  project?: CaveProject | null;
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  projectCrew?: ResolvedFamiliar[];
  projectCrewLoading?: boolean;
  projectCrewError?: string | null;
  reloadProjectCrew?: () => void;
  contextNotice?: string | null;
  contextMode?: "all" | "mobile" | "hidden";
};

export function SidebarRailHeader({
  familiars,
  activeFamiliarId = null,
  selectedFamiliarIds,
  sessions,
  responseNeeded,
  onSelectFamiliar,
  onNewChat,
  newChatTitle = "New chat",
  newChatTrailing,
  // Task 6 props — optional for the transitional period. No inline defaults:
  // undefined means "not yet wired"; null/false is a valid supplied value.
  projects,
  projectId,
  onProjectChange,
  projectLoading,
  projectError,
  reloadProjects,
  project,
  createProjectOrThrow,
  projectCrew,
  projectCrewLoading,
  projectCrewError,
  reloadProjectCrew,
  contextNotice,
  contextMode = "all",
}: SidebarRailHeaderProps) {
  // Context is ready when every required Task6 prop has been supplied. A prop
  // that is null or false is supplied; undefined means the caller has not wired
  // it yet. createProjectOrThrow is excluded: creation can legitimately be
  // unavailable without the context being unready.
  const workspaceContextReady =
    projects !== undefined &&
    projectId !== undefined &&
    onProjectChange !== undefined &&
    projectLoading !== undefined &&
    projectError !== undefined &&
    reloadProjects !== undefined &&
    project !== undefined &&
    projectCrew !== undefined &&
    projectCrewLoading !== undefined &&
    projectCrewError !== undefined &&
    reloadProjectCrew !== undefined;

  return (
    <div className="rail-header">
      {contextMode !== "hidden" ? <div className={`rail-header__scope${contextMode === "mobile" ? " rail-header__scope--mobile" : ""}`}>
        <WorkspaceContextSwitcher
          projects={workspaceContextReady ? projects! : EMPTY_PROJECTS}
          projectId={workspaceContextReady ? projectId! : null}
          onProjectChange={workspaceContextReady ? onProjectChange! : NOOP_PROJECT_CHANGE}
          projectLoading={!workspaceContextReady || Boolean(projectLoading)}
          projectError={workspaceContextReady ? projectError! : null}
          reloadProjects={workspaceContextReady ? reloadProjects! : NOOP_RELOAD}
          project={workspaceContextReady ? project! : null}
          createProjectOrThrow={createProjectOrThrow}
          allFamiliars={familiars}
          projectCrew={workspaceContextReady ? projectCrew! : EMPTY_CREW}
          projectCrewLoading={!workspaceContextReady || Boolean(projectCrewLoading)}
          projectCrewError={workspaceContextReady ? projectCrewError! : null}
          reloadProjectCrew={workspaceContextReady ? reloadProjectCrew! : NOOP_RELOAD}
          activeFamiliarId={activeFamiliarId}
          selectedFamiliarIds={selectedFamiliarIds ?? EMPTY_SELECTED_FAMILIAR_IDS}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          contextNotice={contextNotice}
        />
      </div> : null}
      <div className="rail-header__actions">
        <button type="button" className="rail-header__new focus-ring" onClick={onNewChat} title={newChatTitle}>
          <Icon
            name="ph:note-pencil"
            className="rail-header__new-icon"
            width={CAVE_ICON_SIZE.sidePanelAction}
            height={CAVE_ICON_SIZE.sidePanelAction}
            aria-hidden
          />
          <span className="rail-header__new-label">New chat</span>
          {newChatTrailing}
        </button>
      </div>
    </div>
  );
}
