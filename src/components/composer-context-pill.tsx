"use client";

import "@/styles/cave-composer.css";

// ComposerContextChips — the composer footer's context controls (cave-g21f):
// project, model, and (for repo-rooted chats) branch ride as separate,
// individually labelled chips. Each opens its own picker popover anchored to
// the chip itself (ProjectPickerPopover, ComposerRuntimePopover,
// GitBranchMenuPopover), so every existing flow — project switching +
// add-project, runtime/model switching, branch switch / new worktree / PR
// open / git-changes drill-through — stays one click away. This replaced the
// combined "Project · Model · branch" pill and its hub popover (2026-07-22)
// on both the chat and home composers.

import { useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "@/lib/icon";
import { ProjectAvatar } from "@/components/project-avatar";
import { ProjectPickerPopover, useAddProjectFlow } from "@/components/project-picker";
import {
  ComposerRuntimePopover,
  runtimeModelLabel,
} from "@/components/composer-runtime-chip";
import { GitBranchMenuPopover, useBranchPr } from "@/components/composer-git-chip";
import { RuntimeLogo, runtimeDisplayName } from "@/components/runtime-logo";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { NO_PROJECT_ID } from "@/lib/chat-projects";
import { sortProjectsAlphabetically, type CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
import type { RuntimeModelOption } from "@/lib/runtime-models";

export type ComposerContextView = null | "project" | "model" | "branch";

export type ComposerContextProps = {
  projects: CaveProject[];
  /** Project id, NO_PROJECT_ID, or null (null falls back to the first project). */
  projectValue: string | null;
  onProjectChange: (id: string) => void;
  allowNoProject?: boolean;
  familiarId?: string | null;
  /** From the caller's useProjects(); presence enables the "Add project…" row. */
  createProject?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject | null>;
  runtime: string;
  modelValue: string;
  modelOptions: RuntimeModelOption[];
  onPickRuntime: (runtime: string) => void;
  onPickModel: (id: string) => void;
  /** Chat disables model switching while streaming (runtime-chip parity). */
  modelDisabled?: boolean;
  /** Enables the branch chip for repo-rooted chats (undefined/non-repo
   *  roots elide it, git-chip parity). */
  projectRoot?: string;
  /** Opens the branch PR in the app's browser pane; falls back to window.open. */
  onOpenUrl?: (url: string) => void;
  disabled?: boolean;
};

export type ComposerContextController = ReturnType<typeof useComposerContextActions>;

export function useComposerContextActions(config: ComposerContextProps) {
  const sortedProjects = useMemo(
   () => sortProjectsAlphabetically(config.projects),
   [config.projects],
  );
  const selectedProject =
   config.projectValue === NO_PROJECT_ID
     ? null
     : (config.projectValue
         ? sortedProjects.find((project) => project.id === config.projectValue) ?? sortedProjects[0]
         : sortedProjects[0]) ?? null;

  const addFlow = useAddProjectFlow({
   familiarId: config.familiarId ?? null,
   createProject: config.createProject ?? (async () => null),
   projects: config.projects,
   onAdded: config.onProjectChange,
  });

  const runtimeName = runtimeDisplayName(config.runtime);
  const modelLabel = runtimeModelLabel(config.modelValue, config.modelOptions);

  const root = config.projectRoot?.trim() ? config.projectRoot : undefined;
  const { loaded, notARepo, branch, count, worktree, reload } = useChangesSummary(
    root,
    Boolean(root),
  );
  const pr = useBranchPr(root, branch);
  const hasGit = Boolean(root && loaded && !notARepo && branch);

  const dirtyLabel =
    count > 0 ? `${count} uncommitted change${count === 1 ? "" : "s"}` : "clean";
  const summary = [
    selectedProject ? selectedProject.name : "No project",
    modelLabel ?? runtimeName,
  ].join(" · ");

  return {
   config,
   sortedProjects,
   selectedProject,
   addFlow,
    runtimeName,
    modelLabel,
    root,
    loaded,
    notARepo,
    branch,
    count,
    worktree,
    reload,
    pr,
    hasGit,
    dirtyLabel,
    summary,
  };
}

// The branch menu's footer rows (PR · Git changes) — shared by the footer's
// branch chip and the actions-menu "Branch…" flow so both keep parity with
// the retired hub's git section.
function branchPopoverExtras(context: ComposerContextController) {
  return {
    pr: context.pr,
    onOpenPr: (url: string) => {
      if (context.config.onOpenUrl) context.config.onOpenUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    onOpenChanges: () => window.dispatchEvent(new CustomEvent("cave:changes-open")),
  };
}

export function ComposerContextPickers({
  view,
  onViewChange,
  anchorRef,
  context,
}: {
  view: ComposerContextView;
  onViewChange: (view: ComposerContextView) => void;
  anchorRef: RefObject<HTMLElement | null>;
  context: ComposerContextController;
}) {
  return (
    <>
      <ProjectPickerPopover
        open={view === "project"}
        onOpenChange={(open) => onViewChange(open ? "project" : null)}
        anchorRef={anchorRef}
        projects={context.config.projects}
        value={context.config.projectValue}
        onChange={context.config.onProjectChange}
        allowNoProject={context.config.allowNoProject}
        onAddProject={context.config.createProject ? context.addFlow.beginAddProject : undefined}
        addingProject={context.addFlow.adding}
        ariaLabel="Choose project"
      />
      <ComposerRuntimePopover
        open={view === "model"}
        onOpenChange={(open) => onViewChange(open ? "model" : null)}
        anchorRef={anchorRef}
        runtime={context.config.runtime}
        modelValue={context.config.modelValue}
        modelOptions={context.config.modelOptions}
        onPickRuntime={context.config.onPickRuntime}
        onPickModel={context.config.onPickModel}
      />
      <GitBranchMenuPopover
        open={view === "branch"}
        onOpenChange={(open) => onViewChange(open ? "branch" : null)}
        anchorRef={anchorRef}
        projectRoot={context.root}
        onSwitched={context.reload}
        {...branchPopoverExtras(context)}
      />
      {context.addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {context.addFlow.addError}
        </span>
      ) : null}
      {context.config.createProject ? context.addFlow.addProjectModal : null}
    </>
  );
}

export function ComposerContextChips(props: ComposerContextProps) {
  const [menu, setMenu] = useState<ComposerContextView>(null);
  const projectRef = useRef<HTMLButtonElement | null>(null);
  const modelRef = useRef<HTMLButtonElement | null>(null);
  const branchRef = useRef<HTMLButtonElement | null>(null);
  const context = useComposerContextActions(props);
  const projectLabel = context.selectedProject?.name ?? "No project";
  const modelLabel = context.modelLabel ?? context.runtimeName;

  return (
    <>
      <button
        ref={projectRef}
        type="button"
        className="cave-context-chip focus-ring"
        disabled={props.disabled}
        aria-haspopup="dialog"
        aria-expanded={menu === "project"}
        aria-label={`Project: ${projectLabel} — change project`}
        title={context.selectedProject?.root ?? "No project selected"}
        onClick={() => setMenu((c) => (c === "project" ? null : "project"))}
      >
        <span className="cave-context-chip__lead" aria-hidden>
          {context.selectedProject ? (
            <ProjectAvatar
              name={context.selectedProject.name}
              root={context.selectedProject.root}
              color={context.selectedProject.color}
              size="sm"
            />
          ) : (
            <Icon name="ph:folder" width={13} aria-hidden />
          )}
        </span>
        <span className="cave-context-chip__text">{projectLabel}</span>
        <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
      </button>
      <button
        ref={modelRef}
        type="button"
        className="cave-context-chip focus-ring"
        disabled={props.disabled || context.config.modelDisabled}
        aria-haspopup="dialog"
        aria-expanded={menu === "model"}
        aria-label={`Model: ${modelLabel} — change model`}
        title={`Runtime: ${context.runtimeName}${context.modelLabel ? ` · Model: ${context.modelLabel}` : ""}`}
        onClick={() => setMenu((c) => (c === "model" ? null : "model"))}
      >
        <span className="cave-context-chip__lead cave-runtime-chip__logo" aria-hidden>
          <RuntimeLogo runtime={context.config.runtime} size={13} />
        </span>
        <span className="cave-context-chip__text">{modelLabel}</span>
        <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
      </button>
      {context.hasGit ? (
        <button
          ref={branchRef}
          type="button"
          className="cave-context-chip focus-ring"
          disabled={props.disabled}
          aria-haspopup="menu"
          aria-expanded={menu === "branch"}
          aria-label={`Branch: ${context.branch} — switch branch or create a worktree`}
          title={`Branch: ${context.branch} · ${context.dirtyLabel}${context.worktree ? ` · Worktree: ${context.worktree}` : ""}`}
          onClick={() => setMenu((c) => (c === "branch" ? null : "branch"))}
        >
          <span className="cave-context-chip__lead" aria-hidden>
            <Icon name="ph:git-branch" width={13} aria-hidden />
          </span>
          <span className="cave-context-chip__text">
            {context.branch}
            {context.count > 0 ? ` · +${context.count}` : ""}
            {context.worktree ? ` · ${context.worktree}` : ""}
          </span>
          <Icon name="ph:caret-down" width={9} aria-hidden className="cave-context-chip__chevron" />
        </button>
      ) : null}

      <ProjectPickerPopover
        open={menu === "project"}
        onOpenChange={(open) => setMenu(open ? "project" : null)}
        anchorRef={projectRef}
        projects={context.config.projects}
        value={context.config.projectValue}
        onChange={context.config.onProjectChange}
        allowNoProject={context.config.allowNoProject}
        onAddProject={context.config.createProject ? context.addFlow.beginAddProject : undefined}
        addingProject={context.addFlow.adding}
        ariaLabel="Choose project"
      />
      <ComposerRuntimePopover
        open={menu === "model"}
        onOpenChange={(open) => setMenu(open ? "model" : null)}
        anchorRef={modelRef}
        runtime={context.config.runtime}
        modelValue={context.config.modelValue}
        modelOptions={context.config.modelOptions}
        onPickRuntime={context.config.onPickRuntime}
        onPickModel={context.config.onPickModel}
      />
      {context.hasGit ? (
        <GitBranchMenuPopover
          open={menu === "branch"}
          onOpenChange={(open) => setMenu(open ? "branch" : null)}
          anchorRef={branchRef}
          projectRoot={context.root}
          onSwitched={context.reload}
          {...branchPopoverExtras(context)}
        />
      ) : null}
      {context.addFlow.addError ? (
        <span className="cave-project-picker__error" role="alert">
          {context.addFlow.addError}
        </span>
      ) : null}
      {context.config.createProject ? context.addFlow.addProjectModal : null}
    </>
  );
}
