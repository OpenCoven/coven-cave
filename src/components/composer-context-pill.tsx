"use client";

import "@/styles/cave-composer.css";

// ComposerContextPill — the composer's one quiet context control (chat revamp
// 1d): a single pill showing "Project · Model · branch" that replaces the
// visible ProjectPicker + ComposerRuntimeChip + ComposerGitChip row. Clicking
// it opens a hub popover with three sections; each section chains to the
// existing picker popover (ProjectPickerPopover, ComposerRuntimePopover,
// GitBranchMenuPopover) anchored to this same pill, so every existing flow —
// project switching + add-project, runtime/model switching, branch switch /
// new worktree / PR open / git-changes drill-through — survives relocation.

import { useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
  type PopoverItemSemantic,
} from "@/components/ui/popover";
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
  /** Enables the Branch section for repo-rooted chats (undefined/non-repo
   *  roots elide it, git-chip parity). */
  projectRoot?: string;
  /** Opens the branch PR in the app's browser pane; falls back to window.open. */
  onOpenUrl?: (url: string) => void;
  disabled?: boolean;
  ariaLabel: string;
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

export function ComposerContextActionRows({
  context,
  onOpenProject,
  onOpenModel,
  onOpenBranch,
  onClose,
  showLabels = false,
  itemSemantic,
}: {
  context: ComposerContextController;
  onOpenProject: () => void;
  onOpenModel: () => void;
  onOpenBranch: () => void;
  onClose: () => void;
  showLabels?: boolean;
  itemSemantic?: PopoverItemSemantic;
}) {
  return (
    <>
      {showLabels ? <PopoverLabel>Project</PopoverLabel> : null}
      <PopoverItem
        semantic={itemSemantic}
        leading={
          context.selectedProject ? (
            <ProjectAvatar
              name={context.selectedProject.name}
              root={context.selectedProject.root}
              color={context.selectedProject.color}
              size="sm"
            />
          ) : (
            <Icon name="ph:folder" width={13} aria-hidden />
          )
        }
        title={context.selectedProject?.root}
        onSelect={onOpenProject}
      >
        {context.selectedProject?.name ?? "No project"}
      </PopoverItem>
      {showLabels ? (
        <>
          <PopoverSeparator />
          <PopoverLabel>Model</PopoverLabel>
        </>
      ) : null}
      <PopoverItem
        semantic={itemSemantic}
        leading={
          <span className="cave-runtime-chip__logo" aria-hidden>
            <RuntimeLogo runtime={context.config.runtime} size={13} />
          </span>
        }
        disabled={context.config.modelDisabled}
        title={`Runtime: ${context.runtimeName}${context.modelLabel ? ` · Model: ${context.modelLabel}` : ""}`}
        onSelect={onOpenModel}
      >
        {context.modelLabel
          ? `${context.runtimeName} · ${context.modelLabel}`
          : context.runtimeName}
      </PopoverItem>
      {context.hasGit ? (
        <>
          {showLabels ? (
            <>
              <PopoverSeparator />
              <PopoverLabel>Branch</PopoverLabel>
            </>
          ) : null}
          <PopoverItem
            semantic={itemSemantic}
            icon="ph:git-branch"
            title={`Branch: ${context.branch} · ${context.dirtyLabel}${context.worktree ? ` · Worktree: ${context.worktree}` : ""} — switch branch or create a worktree`}
            onSelect={onOpenBranch}
          >
            {context.branch}
            {context.count > 0 ? ` · +${context.count}` : ""}
            {context.worktree ? ` · ${context.worktree}` : ""}
          </PopoverItem>
          {context.pr ? (
            <PopoverItem
              semantic={itemSemantic}
              icon="ph:git-pull-request"
              title={`Open PR #${context.pr.number} (${context.pr.isDraft ? "draft" : context.pr.state.toLowerCase()})`}
              onSelect={() => {
                onClose();
                if (context.config.onOpenUrl) context.config.onOpenUrl(context.pr!.url);
                else window.open(context.pr!.url, "_blank", "noopener,noreferrer");
              }}
            >
              PR #{context.pr.number}
            </PopoverItem>
          ) : null}
          <PopoverItem
            semantic={itemSemantic}
            icon="ph:git-diff"
            onSelect={() => {
              onClose();
              window.dispatchEvent(new CustomEvent("cave:changes-open"));
            }}
          >
            Open Git changes
          </PopoverItem>
        </>
      ) : null}
    </>
  );
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

export function ComposerContextPill(props: ComposerContextProps) {
  const [menu, setMenu] = useState<"hub" | ComposerContextView>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const context = useComposerContextActions(props);
  const summary = [
    context.summary,
    ...(context.hasGit && context.branch ? [context.branch] : []),
  ].join(" · ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cave-context-pill focus-ring"
        disabled={props.disabled}
        aria-haspopup="dialog"
        aria-expanded={menu !== null}
        aria-label={props.ariaLabel}
        title={summary}
        onClick={() => setMenu((current) => (current === null ? "hub" : null))}
      >
        <span className="cave-context-pill__swatch" aria-hidden>
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
        <span className="cave-context-pill__text">{summary}</span>
        <Icon
          name="ph:caret-down"
          width={10}
          aria-hidden
          className="cave-context-pill__chevron"
        />
      </button>

      <Popover
        open={menu === "hub"}
        onOpenChange={(open) => setMenu(open ? "hub" : null)}
        anchorRef={triggerRef}
        placement="top-start"
        minWidth={252}
        ariaLabel={props.ariaLabel}
        className="cave-context-pill__hub"
      >
        <PopoverBody>
          <ComposerContextActionRows
            context={context}
            onOpenProject={() => setMenu("project")}
            onOpenModel={() => setMenu("model")}
            onOpenBranch={() => setMenu("branch")}
            onClose={() => setMenu(null)}
            showLabels
          />
        </PopoverBody>
      </Popover>

      <ComposerContextPickers
        view={menu === "hub" ? null : menu}
        onViewChange={setMenu}
        anchorRef={triggerRef}
        context={context}
      />
    </>
  );
}
