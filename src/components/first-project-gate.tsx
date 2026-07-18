"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import type { CaveProject } from "@/lib/cave-projects-types";
import { addChatProject, type CreateProjectOptions } from "@/lib/chat-add-project";
import {
  canPersistPendingFirstProjectAccessSnapshot,
  clearPendingFirstProjectAccessSnapshot,
  writePendingFirstProjectAccessSnapshot,
  type PendingFirstProjectAccessSnapshot,
} from "@/lib/first-project-gate-retry";
import { isTauri } from "@/lib/tauri-platform";

function pathBasename(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).filter(Boolean).pop() ?? "";
}

function isAbsolutePath(p: string): boolean {
  const trimmed = p.trim();
  return trimmed.startsWith("/") || trimmed.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(trimmed);
}

type FirstProjectGateProps = {
  open: boolean;
  familiarId: string | null;
  pendingGrant: PendingFirstProjectAccessSnapshot | null;
  onPendingGrantChange: (snapshot: PendingFirstProjectAccessSnapshot | null) => void;
  loadingProjects: boolean;
  projectsError: string | null;
  createProjectOrThrow: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  reloadProjects: () => void;
};

const STORAGE_REQUIRED_ERROR =
  "Session storage is disabled or blocked in this browser. Enable session storage, keep this page open, then retry before creating the project.";
const STORAGE_RETRY_ERROR =
  "Project created, but this browser could not save the retry checkpoint needed before access can be granted. Keep this page open, enable session storage, then click Retry access.";

export function FirstProjectGate({
  open,
  familiarId,
  pendingGrant,
  onPendingGrantChange,
  loadingProjects,
  projectsError,
  createProjectOrThrow,
  reloadProjects,
}: FirstProjectGateProps) {
  const { announce } = useAnnouncer();
  const [nameDraft, setNameDraft] = useState("");
  const [rootDraft, setRootDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const wasVisibleRef = useRef(false);
  const titleId = useId();
  const copyId = useId();
  const rootHintId = useId();
  const registeredProject = pendingGrant?.project ?? null;
  const submitFamiliarId = pendingGrant?.familiarId ?? familiarId;
  const lockedProject = registeredProject;
  const submitName = lockedProject?.name ?? nameDraft.trim();
  const submitRoot = lockedProject?.root ?? rootDraft.trim();
  const canSubmit = lockedProject ? true : Boolean(nameDraft.trim() && rootDraft.trim() && isAbsolutePath(rootDraft));

  useEffect(() => {
    if (!open) {
      wasVisibleRef.current = false;
      return;
    }
    if (wasVisibleRef.current) return;

    wasVisibleRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const applyPickedRoot = useCallback((dir: string) => {
    const trimmed = dir.trim();
    if (!trimmed) return;
    setRootDraft(trimmed);
    setNameDraft((current) => (current.trim() ? current : pathBasename(trimmed)));
    setSubmitError(null);
  }, []);

  const createProjectWithRegistration = useCallback(async (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => {
    // Forward options so addChatProject's { emitMutation: false } reaches
    // useProjects — creation stays silent and the registry fans out once,
    // after the bundled grant resolves.
    const project = await createProjectOrThrow(name, root, options);
    if (familiarId) {
      const snapshot: PendingFirstProjectAccessSnapshot = {
        familiarId,
        project: { id: project.id, name: project.name, root: project.root },
      };
      onPendingGrantChange(snapshot);
      if (!writePendingFirstProjectAccessSnapshot(snapshot)) {
        throw new Error(STORAGE_RETRY_ERROR);
      }
    }
    return project;
  }, [createProjectOrThrow, familiarId, onPendingGrantChange]);

  const handleBrowse = useCallback(() => {
    if (isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const picked = await invoke<string | null>("shell_pick_directory");
          if (picked) applyPickedRoot(picked);
        } catch {
          setPickerOpen(true);
        }
      })();
      return;
    }
    setPickerOpen(true);
  }, [applyPickedRoot]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || loadingProjects || Boolean(projectsError)) return;
    if (!lockedProject && !submitName) {
      setSubmitError("Enter a project name.");
      return;
    }
    if (!lockedProject && !submitRoot) {
      setSubmitError("Enter an absolute project root.");
      return;
    }
    if (!lockedProject && !isAbsolutePath(submitRoot)) {
      setSubmitError("Project root must be an absolute path.");
      return;
    }
    if (submitFamiliarId && !pendingGrant && !canPersistPendingFirstProjectAccessSnapshot()) {
      setSubmitError(STORAGE_REQUIRED_ERROR);
      return;
    }
    if (submitFamiliarId && pendingGrant && !writePendingFirstProjectAccessSnapshot(pendingGrant)) {
      setSubmitError(STORAGE_RETRY_ERROR);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await addChatProject({
        root: submitRoot,
        familiarId: submitFamiliarId,
        createProject: createProjectWithRegistration,
        existingProjectId: pendingGrant?.project.id,
        name: submitName,
      });
      if (result.ok) {
        const createdProjectName = registeredProject?.name ?? submitName;
        clearPendingFirstProjectAccessSnapshot();
        onPendingGrantChange(null);
        setSubmitError(null);
        announce(`Created project ${createdProjectName}. Chat is ready.`);
      } else {
        setSubmitError(result.error);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not create that project.");
    } finally {
      setSubmitting(false);
    }
  }, [announce, createProjectWithRegistration, loadingProjects, pendingGrant, projectsError, registeredProject, submitFamiliarId, submitName, submitRoot, submitting, lockedProject, onPendingGrantChange]);

  if (!open) return null;

  return (
    <>
      <section
        role="region"
        aria-labelledby={titleId}
        aria-describedby={copyId}
        className="absolute inset-0 z-[20] overflow-auto bg-black/60 p-4"
      >
        <div className="flex min-h-full items-center justify-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-hairline)] bg-[var(--bg-panel)] shadow-xl">
            <div aria-hidden={pickerOpen || undefined} inert={pickerOpen || undefined}>
              <div className="border-b border-[var(--border-hairline)] px-6 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  Project required
                </p>
                <h2 id={titleId} className="mt-2 text-[26px] font-semibold leading-tight text-[var(--text-primary)]">
                  Create your first project
                </h2>
                <p id={copyId} className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--text-secondary)]">
                  {registeredProject ? (
                    <>
                      Project <span className="font-medium text-[var(--text-primary)]">{registeredProject.name}</span> was
                      created. Retry access so the required familiar can use
                      {" "}
                      <span className="font-mono text-[var(--text-primary)]">{registeredProject.root}</span>
                      {" "}
                      in chat.
                    </>
                  ) : (
                    "Chat requires a project. Add the absolute root for the codebase you want this familiar to use before you start chatting."
                  )}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                {projectsError ? (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
                  >
                    <span className="min-w-0 flex-1">
                      Couldn&apos;t verify your existing projects: {projectsError}. Retry before creating a project so chat doesn&apos;t duplicate a project that may already be registered.
                    </span>
                    <Button
                      variant="danger-ghost"
                      size="xs"
                      onClick={reloadProjects}
                      className="shrink-0 rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] hover:bg-[var(--color-danger)]/15"
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}

                {submitError ? (
                  <div
                    role="alert"
                    className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-[12px] text-[var(--color-danger)]"
                  >
                    {submitError}
                  </div>
                ) : null}

                {loadingProjects ? (
                  <p className="text-[12px] text-[var(--text-muted)]">
                    Checking your project registry before creation…
                  </p>
                ) : null}

                <div className="space-y-2">
                  <label
                    htmlFor="first-project-gate-name"
                    className="block text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]"
                  >
                    Project name
                  </label>
                  <input
                    id="first-project-gate-name"
                    ref={nameInputRef}
                    value={registeredProject?.name ?? nameDraft}
                    onChange={(event) => {
                      setNameDraft(event.target.value);
                      setSubmitError(null);
                    }}
                    placeholder="Project name"
                    disabled={Boolean(registeredProject) || submitting}
                    className="focus-ring h-10 w-full rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="first-project-gate-root"
                    className="block text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]"
                  >
                    Absolute root
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="first-project-gate-root"
                      value={registeredProject?.root ?? rootDraft}
                      onChange={(event) => {
                        setRootDraft(event.target.value);
                        setSubmitError(null);
                      }}
                      placeholder="/absolute/path/to/project"
                      aria-describedby={rootHintId}
                      aria-invalid={rootDraft.trim() ? !isAbsolutePath(rootDraft) : undefined}
                      disabled={Boolean(registeredProject) || submitting}
                      className="focus-ring h-10 min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 font-mono text-[13px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleBrowse()}
                      disabled={Boolean(registeredProject) || submitting}
                      className="h-10 shrink-0 rounded-[var(--radius-control)] border border-[var(--border-hairline)] px-3 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      leadingIcon="ph:folder-open"
                    >
                      Browse
                    </Button>
                  </div>
                  <p id={rootHintId} className="text-[12px] text-[var(--text-muted)]">
                    Pick the repository root you want chat to run inside.
                  </p>
                </div>

                <div className="flex items-center justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={submitting}
                    disabled={submitting || loadingProjects || Boolean(projectsError) || !canSubmit}
                    className="h-10 rounded-[var(--radius-control)] px-4 text-[12px] font-medium disabled:opacity-50"
                  >
                    {registeredProject ? "Retry access" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      <DirectoryPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(dir) => {
          setPickerOpen(false);
          applyPickedRoot(dir);
        }}
      />
    </>
  );
}
