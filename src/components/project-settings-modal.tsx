"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects-types";
import { gitHubRepoSlug, normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Per-project settings sheet — the registry-management surface behind both the
 * Chat → Projects rows and the Settings → Familiars → Projects tab. Renames the
 * project, ties it to a GitHub repository (any spelling normalizeGitHubRepoUrl
 * understands; the canonical https link persists via updateRepoUrl), and removes
 * it from the registry (with a two-step confirm; the DELETE cascade revokes the
 * project's grants server-side). All writes go through PUT/DELETE
 * /api/projects/[id] via the caller's useProjects handlers.
 */
export function ProjectSettingsModal({
  project,
  onClose,
  onSaveRepoUrl,
  onRename,
  onDelete,
}: {
  /** The project being edited, or null when the modal is closed. */
  project: CaveProject | null;
  onClose: () => void;
  /** From useProjects().updateRepoUrl — null unlinks. Resolves false on failure. */
  onSaveRepoUrl: (id: string, repoUrl: string | null) => Promise<boolean>;
  /** From useProjects().renameProject. Omit to hide the name field. */
  onRename?: (id: string, name: string) => Promise<boolean>;
  /** From useProjects().deleteProject. Omit to hide the remove action. */
  onDelete?: (id: string) => Promise<boolean>;
}) {
  const [nameDraft, setNameDraft] = useState("");
  const [repoDraft, setRepoDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-seed the fields whenever a (different) project opens the sheet.
  const projectId = project?.id ?? null;
  const projectName = project?.name ?? "";
  const projectRepoUrl = project?.repoUrl ?? "";
  useEffect(() => {
    setNameDraft(projectName);
    setRepoDraft(projectRepoUrl);
    setError(null);
    setSaving(false);
    setConfirmingDelete(false);
    setDeleting(false);
  }, [projectId, projectName, projectRepoUrl]);

  if (!project) return null;

  const trimmedRepo = repoDraft.trim();
  const normalizedRepo = trimmedRepo ? normalizeGitHubRepoUrl(trimmedRepo) : null;
  const linkedSlug = project.repoUrl ? gitHubRepoSlug(project.repoUrl) : null;
  const trimmedName = nameDraft.trim();
  const busy = saving || deleting;

  const save = async () => {
    if (busy) return;
    if (onRename && !trimmedName) {
      setError("Give the project a name.");
      return;
    }
    if (trimmedRepo && !normalizedRepo) {
      setError("That doesn’t look like a GitHub repository. Try owner/repo or a https://github.com/owner/repo link.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (onRename && trimmedName !== project.name) {
        const ok = await onRename(project.id, trimmedName);
        if (!ok) {
          setError("Couldn’t rename the project. Is the desktop reachable?");
          return;
        }
      }
      if ((trimmedRepo ? normalizedRepo : null) !== (project.repoUrl ?? null)) {
        const ok = await onSaveRepoUrl(project.id, trimmedRepo ? normalizedRepo : null);
        if (!ok) {
          setError("Couldn’t save the repository link. Is the desktop reachable?");
          return;
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busy || !onDelete) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setError(null);
      return;
    }
    setDeleting(true);
    setError(null);
    const ok = await onDelete(project.id);
    setDeleting(false);
    if (ok) onClose();
    else {
      setConfirmingDelete(false);
      setError("Couldn’t remove the project. Is the desktop reachable?");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Projects", project.name]}
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={deleting}>
            Save
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="ph:folder" width={13} aria-hidden />
        <span className="truncate" title={project.root}>
          {project.root}
        </span>
      </div>

      {onRename ? (
        <label className="mb-4 block">
          <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-muted-foreground">
            Name
          </div>
          <input
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              }
            }}
            placeholder="Project name"
            aria-label="Project name"
            className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
          />
        </label>
      ) : null}

      <label className="block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-muted-foreground">
          GitHub repository
        </div>
        <input
          value={repoDraft}
          onChange={(e) => {
            setRepoDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="owner/repo or https://github.com/owner/repo"
          aria-label="GitHub repository"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-border-strong"
        />
      </label>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Ties this project to a repository — leave empty to unlink.
        {trimmedRepo && normalizedRepo && normalizedRepo !== project.repoUrl ? (
          <>
            {" "}
            Will link <span className="text-foreground">{gitHubRepoSlug(normalizedRepo)}</span>.
          </>
        ) : null}
      </p>

      {linkedSlug && project.repoUrl ? (
        <a
          href={project.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Icon name="ph:github-logo" width={13} aria-hidden />
          {linkedSlug}
          <Icon name="ph:arrow-square-out" width={11} aria-hidden />
        </a>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-[var(--radius-control)] border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground" role="alert">
          {error}
        </p>
      ) : null}

      {onDelete ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <div className="min-w-0">
            <div className="text-[length:var(--text-sm)] text-foreground">Remove from registry</div>
            <p className="text-xs text-muted-foreground">
              Unregisters the project and revokes its access grants. The folder on disk is untouched.
            </p>
          </div>
          {confirmingDelete ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" leadingIcon="ph:trash" loading={deleting} onClick={() => void remove()}>
                Remove
              </Button>
            </div>
          ) : (
            <Button
              variant="danger-ghost"
              size="sm"
              leadingIcon="ph:trash"
              className="shrink-0"
              onClick={() => void remove()}
              disabled={busy}
            >
              Remove project
            </Button>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
