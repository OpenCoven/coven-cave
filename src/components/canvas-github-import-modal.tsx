"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { StandardSelect } from "@/components/ui/select";
import type { CanvasArtifactSource } from "@/lib/canvas-artifacts";
import {
  CREATE_CANVAS_IMPORT_PROJECT,
  canvasGitHubImportFileName,
  canvasImportProjectGroups,
  defaultCanvasImportProjectChoice,
  isSupportedCanvasGitHubFile,
} from "@/lib/canvas-github-import";
import {
  gitHubRepoSlug,
  parseGitHubFileUrl,
} from "@/lib/github-repo-link";
import { Icon } from "@/lib/icon";
import { projectErrorCode } from "@/lib/project-errors";
import {
  PROJECT_ROOT_WORKSPACE_HELP,
  projectRootRejectionMessage,
} from "@/lib/project-root-guidance";
import { isTauri } from "@/lib/tauri-platform";
import { useProjects } from "@/lib/use-projects";

type ImportedGitHubSketch = {
  code: string;
  title: string;
  source: CanvasArtifactSource;
};

export function CanvasGitHubImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (result: ImportedGitHubSketch) => void;
}) {
  const { announce } = useAnnouncer();
  const {
    projects,
    loading: projectsLoading,
    createProjectOrThrow,
    updateRepoUrl,
  } = useProjects({ enabled: open });
  const [fileUrl, setFileUrl] = useState("");
  const [fileUrlBlurred, setFileUrlBlurred] = useState(false);
  const [projectChoice, setProjectChoice] = useState(
    CREATE_CANVAS_IMPORT_PROJECT,
  );
  const [projectChoiceTouched, setProjectChoiceTouched] = useState(false);
  const [projectRoot, setProjectRoot] = useState("");
  const [nativeFolderPickerAvailable, setNativeFolderPickerAvailable] =
    useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGitHubFileUrl(fileUrl), [fileUrl]);
  const supported = parsed
    ? isSupportedCanvasGitHubFile(parsed.filePath)
    : false;
  const sourceReady = Boolean(parsed && supported);
  const fileName = parsed ? canvasGitHubImportFileName(parsed) : "file";
  const projectGroups = useMemo(
    () =>
      parsed
        ? canvasImportProjectGroups(projects, parsed)
        : { linked: [], unlinked: [] },
    [parsed, projects],
  );
  const compatibleProjects = [
    ...projectGroups.linked,
    ...projectGroups.unlinked,
  ];
  const selectedProject =
    compatibleProjects.find((project) => project.id === projectChoice) ?? null;
  const creatingProject =
    projectChoice === CREATE_CANVAS_IMPORT_PROJECT;
  const sourceError =
    fileUrlBlurred && fileUrl.trim()
      ? !parsed
        ? "Paste a GitHub blob URL, such as github.com/owner/repo/blob/main/src/App.tsx."
        : !supported
          ? "Canvas can import HTML, HTM, JSX, or TSX files."
          : null
      : null;
  const projectReady = creatingProject
    ? Boolean(projectRoot.trim())
    : Boolean(selectedProject);
  const canSubmit =
    sourceReady && projectReady && !projectsLoading && !busy;

  useEffect(() => {
    if (!open) return;
    setFileUrl("");
    setFileUrlBlurred(false);
    setProjectChoice(CREATE_CANVAS_IMPORT_PROJECT);
    setProjectChoiceTouched(false);
    setProjectRoot("");
    setNativeFolderPickerAvailable(isTauri());
    setBusy(false);
    setError(null);
  }, [open]);

  const repositoryKey = parsed
    ? `${parsed.owner}/${parsed.repo}`.toLowerCase()
    : null;

  useEffect(() => {
    setProjectChoiceTouched(false);
    setProjectRoot("");
    setError(null);
  }, [repositoryKey]);

  useEffect(() => {
    if (
      !parsed ||
      projectsLoading ||
      projectChoiceTouched
    ) {
      return;
    }
    setProjectChoice(defaultCanvasImportProjectChoice(projects, parsed));
  }, [parsed, projectChoiceTouched, projects, projectsLoading]);

  const browseForProjectRoot = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const picked = await invoke<string | null>("shell_pick_directory");
      if (picked) {
        setProjectRoot(picked);
        setError(null);
      }
    } catch {
      setError(
        "Couldn’t open the folder picker. Enter the local checkout path.",
      );
    }
  };

  const submit = async () => {
    if (!parsed || !supported || busy) return;
    setFileUrlBlurred(true);
    if (!projectReady) {
      setError(
        creatingProject
          ? "Enter the local checkout for this repository."
          : "Choose a Cave project.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const sourceResponse = await fetch("/api/canvas/github-source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: fileUrl }),
      });
      const sourceData = (await sourceResponse.json().catch(() => null)) as {
        error?: string;
        code?: string;
        title?: string;
        source?: Omit<CanvasArtifactSource, "projectId">;
      } | null;
      if (!sourceResponse.ok || !sourceData?.code || !sourceData.source) {
        throw new Error(
          sourceData?.error ??
            `GitHub import failed (${sourceResponse.status}).`,
        );
      }

      let project = selectedProject;
      if (creatingProject) {
        project = await createProjectOrThrow(
          parsed.repo,
          projectRoot.trim(),
          { repoUrl: parsed.repoUrl },
        );
      } else if (project && !project.repoUrl) {
        const linked = await updateRepoUrl(project.id, parsed.repoUrl);
        if (!linked) {
          throw new Error(
            "The file loaded, but the Cave project couldn’t be linked to its repository.",
          );
        }
        project = { ...project, repoUrl: parsed.repoUrl };
      }
      if (!project) throw new Error("Choose or register a Cave project.");

      onImported({
        code: sourceData.code,
        title:
          sourceData.title ||
          parsed.filePath.split("/").at(-1) ||
          "GitHub sketch",
        source: { ...sourceData.source, projectId: project.id },
      });
      announce(`Loaded ${parsed.filePath} from GitHub.`);
      onClose();
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Couldn’t load that GitHub file.";
      setError(projectRootRejectionMessage(projectErrorCode(caught), message));
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const projectOptions = [
    ...(projectGroups.linked.length
      ? [{
          label: "Linked to this repository",
          options: projectGroups.linked.map((project) => ({
            value: project.id,
            label: project.name,
            detail: project.root,
            icon: "ph:check-circle-fill" as const,
          })),
        }]
      : []),
    ...(projectGroups.unlinked.length
      ? [{
          label: "Available to link",
          options: projectGroups.unlinked.map((project) => ({
            value: project.id,
            label: project.name,
            detail: project.root,
            icon: "ph:folder" as const,
          })),
        }]
      : []),
    {
      value: CREATE_CANVAS_IMPORT_PROJECT,
      label: "Register local checkout",
      detail: parsed
        ? `Add ${parsed.owner}/${parsed.repo} from a folder on this Mac.`
        : "Register an existing local checkout.",
      icon: "ph:folder-plus" as const,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Canvas", "Import GitHub file"]}
      ariaDescribedBy="canvas-github-import-description"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footerActions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leadingIcon="ph:download-simple"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy ? "Loading…" : `Load ${fileName}`}
          </Button>
        </>
      )}
    >
      <div className="canvas-github-import">
        <p
          id="canvas-github-import-description"
          className="canvas-github-import__intro"
        >
          Paste a link to one HTML or React file. You’ll review it in Canvas before saving.
        </p>

        <label className="canvas-github-import__field">
          <span>GitHub file URL</span>
          <input
            className="focus-ring"
            value={fileUrl}
            onChange={(event) => {
              setFileUrl(event.target.value);
              setFileUrlBlurred(false);
              setError(null);
            }}
            onBlur={() => setFileUrlBlurred(true)}
            placeholder="https://github.com/owner/repo/blob/main/src/App.tsx"
            inputMode="url"
            autoComplete="url"
            autoFocus
            aria-invalid={Boolean(sourceError) || undefined}
            aria-describedby={
              sourceError
                ? "canvas-github-import-url-error"
                : "canvas-github-import-url-help"
            }
          />
          {sourceError ? (
            <small
              id="canvas-github-import-url-error"
              className="canvas-github-import__field-error"
            >
              {sourceError}
            </small>
          ) : (
            <small id="canvas-github-import-url-help">
              Use the file’s GitHub <strong>blob</strong> URL.
            </small>
          )}
        </label>

        {parsed && supported ? (
          <>
            <div
              className="canvas-github-import__source"
              role="status"
              aria-label="GitHub file ready"
            >
              <span className="canvas-github-import__source-icon">
                <Icon name="ph:github-logo" aria-hidden />
              </span>
              <span className="canvas-github-import__source-copy">
                <strong>{fileName}</strong>
                <span>
                  {parsed.owner}/{parsed.repo} · {parsed.ref}
                </span>
                <code>{parsed.filePath}</code>
              </span>
              <Icon
                name="ph:check-circle-fill"
                className="canvas-github-import__source-ready"
                aria-hidden
              />
            </div>

            <section
              className="canvas-github-import__section"
              aria-labelledby="canvas-github-import-project-heading"
            >
              <div className="canvas-github-import__section-heading">
                <h3 id="canvas-github-import-project-heading">
                  Connect a Cave project
                </h3>
                <p>
                  Canvas uses the local checkout for later commits and pull
                  requests.
                </p>
              </div>

              <label className="canvas-github-import__field">
                <span>Cave project</span>
                <StandardSelect
                  label="Cave project"
                  value={projectChoice}
                  onChange={(value) => {
                    setProjectChoice(value);
                    setProjectChoiceTouched(true);
                    setError(null);
                  }}
                  options={projectOptions}
                  disabled={projectsLoading}
                  placeholder={
                    projectsLoading
                      ? "Loading projects…"
                      : "Choose a project"
                  }
                />
                {selectedProject?.repoUrl ? (
                  <small>
                    Linked to{" "}
                    {gitHubRepoSlug(selectedProject.repoUrl) ??
                      selectedProject.repoUrl}
                  </small>
                ) : selectedProject ? (
                  <small>
                    This import will link {selectedProject.name} to{" "}
                    {parsed.owner}/{parsed.repo}.
                  </small>
                ) : null}
              </label>

              {creatingProject ? (
                <label className="canvas-github-import__field">
                  <span>Local checkout</span>
                  <span className="canvas-github-import__folder">
                    <input
                      className="focus-ring"
                      value={projectRoot}
                      onChange={(event) => {
                        setProjectRoot(event.target.value);
                        setError(null);
                      }}
                      placeholder="/Users/you/code/project"
                    />
                    {nativeFolderPickerAvailable ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        leadingIcon="ph:folder-open"
                        onClick={() => void browseForProjectRoot()}
                      >
                        Browse…
                      </Button>
                    ) : null}
                  </span>
                  <small>
                    Choose an existing checkout for {parsed.owner}/{parsed.repo}.
                    Canvas doesn’t clone repositories.
                  </small>
                  <small>{PROJECT_ROOT_WORKSPACE_HELP}</small>
                </label>
              ) : null}
            </section>
          </>
        ) : null}

        {error ? (
          <div className="canvas-github-import__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
