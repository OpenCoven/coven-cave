"use client";

import { useEffect, useState } from "react";

import { Icon } from "@/lib/icon";
import type { CaveProject } from "@/lib/cave-projects-types";
import { gitHubRepoSlug, normalizeGitHubRepoUrl } from "@/lib/github-repo-link";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * Per-project settings sheet, opened from the Chat → Projects rows. Its one
 * job today: tie the project to a GitHub repository. Input accepts any
 * spelling normalizeGitHubRepoUrl understands (owner/repo, full URL, SSH
 * remote); the canonical https link is what gets persisted via the caller's
 * updateRepoUrl (PUT /api/projects/[id]). Clearing the field unlinks.
 */
export function ProjectSettingsModal({
  project,
  onClose,
  onSaveRepoUrl,
}: {
  /** The project being edited, or null when the modal is closed. */
  project: CaveProject | null;
  onClose: () => void;
  /** From useProjects().updateRepoUrl — null unlinks. Resolves false on failure. */
  onSaveRepoUrl: (id: string, repoUrl: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed the field whenever a (different) project opens the sheet.
  const projectId = project?.id ?? null;
  const projectRepoUrl = project?.repoUrl ?? "";
  useEffect(() => {
    setDraft(projectRepoUrl);
    setError(null);
    setSaving(false);
  }, [projectId, projectRepoUrl]);

  if (!project) return null;

  const trimmed = draft.trim();
  const normalized = trimmed ? normalizeGitHubRepoUrl(trimmed) : null;
  const linkedSlug = project.repoUrl ? gitHubRepoSlug(project.repoUrl) : null;

  const save = async () => {
    if (saving) return;
    if (trimmed && !normalized) {
      setError("That doesn’t look like a GitHub repository. Try owner/repo or a https://github.com/owner/repo link.");
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await onSaveRepoUrl(project.id, trimmed ? normalized : null);
    setSaving(false);
    if (ok) onClose();
    else setError("Couldn’t save the repository link. Is the desktop reachable?");
  };

  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Projects", project.name]}
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
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

      <label className="block">
        <div className="mb-1.5 text-[length:var(--text-2xs)] uppercase tracking-widest text-muted-foreground">
          GitHub repository
        </div>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
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
        {trimmed && normalized && normalized !== project.repoUrl ? (
          <>
            {" "}
            Will link <span className="text-foreground">{gitHubRepoSlug(normalized)}</span>.
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
    </Modal>
  );
}
