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

import { useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
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

type OpenMenu = null | "hub" | "project" | "model" | "branch";

export function ComposerContextPill({
  projects,
  projectValue,
  onProjectChange,
  allowNoProject = false,
  familiarId = null,
  createProject,
  runtime,
  modelValue,
  modelOptions,
  onPickRuntime,
  onPickModel,
  modelDisabled = false,
  projectRoot,
  onOpenUrl,
  disabled = false,
  ariaLabel,
}: {
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
}) {
  const [menu, setMenu] = useState<OpenMenu>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sortedProjects = useMemo(() => sortProjectsAlphabetically(projects), [projects]);
  const selectedProject =
    projectValue === NO_PROJECT_ID
      ? null
      : (projectValue
          ? sortedProjects.find((project) => project.id === projectValue) ?? sortedProjects[0]
          : sortedProjects[0]) ?? null;

  const addFlow = useAddProjectFlow({
    familiarId,
    createProject: createProject ?? (async () => null),
    projects,
    onAdded: onProjectChange,
  });

  const runtimeName = runtimeDisplayName(runtime);
  const modelLabel = runtimeModelLabel(modelValue, modelOptions);

  // Git context — same source the ComposerGitChip read (status poll + one PR
  // fetch per root/branch pair). Elides entirely for git-less composers.
  const root = projectRoot?.trim() ? projectRoot : undefined;
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
    ...(hasGit ? [branch as string] : []),
  ].join(" · ");

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="cave-context-pill focus-ring"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={menu !== null}
        aria-label={ariaLabel}
        title={summary}
        onClick={() => setMenu((current) => (current === null ? "hub" : null))}
      >
        <span className="cave-context-pill__swatch" aria-hidden>
          {selectedProject ? (
            <ProjectAvatar
              name={selectedProject.name}
              root={selectedProject.root}
              color={selectedProject.color}
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

      {/* Hub — three sections; each row chains to its existing picker. */}
      <Popover
        open={menu === "hub"}
        onOpenChange={(next) => setMenu(next ? "hub" : null)}
        anchorRef={triggerRef}
        placement="top-start"
        minWidth={252}
        ariaLabel={ariaLabel}
        className="cave-context-pill__hub"
      >
        <PopoverBody>
          <PopoverLabel>Project</PopoverLabel>
          <PopoverItem
            leading={
              selectedProject ? (
                <ProjectAvatar
                  name={selectedProject.name}
                  root={selectedProject.root}
                  color={selectedProject.color}
                  size="sm"
                />
              ) : (
                <Icon name="ph:folder" width={13} aria-hidden />
              )
            }
            title={selectedProject ? selectedProject.root : undefined}
            onSelect={() => setMenu("project")}
          >
            {selectedProject ? selectedProject.name : "No project"}
          </PopoverItem>
          <PopoverSeparator />
          <PopoverLabel>Model</PopoverLabel>
          <PopoverItem
            leading={
              <span className="cave-runtime-chip__logo" aria-hidden>
                <RuntimeLogo runtime={runtime} size={13} />
              </span>
            }
            disabled={modelDisabled}
            title={`Runtime: ${runtimeName}${modelLabel ? ` · Model: ${modelLabel}` : ""}`}
            onSelect={() => setMenu("model")}
          >
            {modelLabel ? `${runtimeName} · ${modelLabel}` : runtimeName}
          </PopoverItem>
          {hasGit ? (
            <>
              <PopoverSeparator />
              <PopoverLabel>Branch</PopoverLabel>
              <PopoverItem
                icon="ph:git-branch"
                title={`Branch: ${branch} · ${dirtyLabel}${worktree ? ` · Worktree: ${worktree}` : ""} — switch branch or create a worktree`}
                onSelect={() => setMenu("branch")}
              >
                {branch}
                {count > 0 ? ` · +${count}` : ""}
                {worktree ? ` · ${worktree}` : ""}
              </PopoverItem>
              {pr ? (
                <PopoverItem
                  icon="ph:git-pull-request"
                  title={`Open PR #${pr.number} (${pr.isDraft ? "draft" : pr.state.toLowerCase()})`}
                  onSelect={() => {
                    setMenu(null);
                    if (onOpenUrl) onOpenUrl(pr.url);
                    else window.open(pr.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  PR #{pr.number}
                </PopoverItem>
              ) : null}
              <PopoverItem
                icon="ph:git-diff"
                onSelect={() => {
                  setMenu(null);
                  window.dispatchEvent(new CustomEvent("cave:changes-open"));
                }}
              >
                Open Git changes
              </PopoverItem>
            </>
          ) : null}
        </PopoverBody>
      </Popover>

      <ProjectPickerPopover
        open={menu === "project"}
        onOpenChange={(next) => setMenu(next ? "project" : null)}
        anchorRef={triggerRef}
        projects={projects}
        value={projectValue}
        onChange={onProjectChange}
        allowNoProject={allowNoProject}
        onAddProject={createProject ? addFlow.beginAddProject : undefined}
        addingProject={addFlow.adding}
        ariaLabel="Choose project"
      />
      <ComposerRuntimePopover
        open={menu === "model"}
        onOpenChange={(next) => setMenu(next ? "model" : null)}
        anchorRef={triggerRef}
        runtime={runtime}
        modelValue={modelValue}
        modelOptions={modelOptions}
        onPickRuntime={onPickRuntime}
        onPickModel={onPickModel}
      />
      <GitBranchMenuPopover
        open={menu === "branch"}
        onOpenChange={(next) => setMenu(next ? "branch" : null)}
        anchorRef={triggerRef}
        projectRoot={root}
        onSwitched={reload}
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
