"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { Modal } from "@/components/ui/modal";
import { StandardSelect } from "@/components/ui/select";
import type { CanvasArtifactSource } from "@/lib/canvas-artifacts";
import { gitHubRepoSlug, parseGitHubFileUrl } from "@/lib/github-repo-link";
import { useProjects } from "@/lib/use-projects";

const CREATE_PROJECT_VALUE = "__create_project__";

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
  const [projectChoice, setProjectChoice] = useState(CREATE_PROJECT_VALUE);
  const [projectName, setProjectName] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseGitHubFileUrl(fileUrl), [fileUrl]);
  const selectedProject = projects.find((project) => project.id === projectChoice) ?? null;
  const creatingProject = projectChoice === CREATE_PROJECT_VALUE;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!parsed || projectName.trim()) return;
    setProjectName(parsed.repo);
  }, [parsed, projectName]);

  const submit = async () => {
    if (!parsed || busy) return;
    if (creatingProject && (!projectName.trim() || !projectRoot.trim())) {
      setError("Name the project and enter its local folder.");
      return;
    }
    if (!creatingProject && !selectedProject) {
      setError("Choose a Cave project.");
      return;
    }
    const selectedRepoSlug = gitHubRepoSlug(selectedProject?.repoUrl)?.toLowerCase();
    if (selectedRepoSlug && selectedRepoSlug !== `${parsed.owner}/${parsed.repo}`.toLowerCase()) {
      setError(`That project is linked to ${gitHubRepoSlug(selectedProject?.repoUrl)}. Choose a project for ${parsed.owner}/${parsed.repo}.`);
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
        throw new Error(sourceData?.error ?? `GitHub import failed (${sourceResponse.status}).`);
      }

      let project = selectedProject;
      if (creatingProject) {
        project = await createProjectOrThrow(projectName.trim(), projectRoot.trim(), {
          repoUrl: parsed.repoUrl,
        });
      } else if (project && !project.repoUrl) {
        const linked = await updateRepoUrl(project.id, parsed.repoUrl);
        if (!linked) throw new Error("The file loaded, but the Cave project couldn't be linked to its repository.");
        project = { ...project, repoUrl: parsed.repoUrl };
      }
      if (!project) throw new Error("Choose or create a Cave project.");

      onImported({
        code: sourceData.code,
        title: sourceData.title || parsed.filePath.split("/").at(-1) || "GitHub sketch",
        source: { ...sourceData.source, projectId: project.id },
      });
      announce(`Imported ${parsed.filePath} from GitHub.`);
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Couldn't import that GitHub file.";
      setError(message);
      announce(message, "assertive");
    } finally {
      setBusy(false);
    }
  };

  const projectOptions = [
    ...projects.map((project) => ({
      value: project.id,
      label: project.name,
      detail: project.repoUrl ? gitHubRepoSlug(project.repoUrl) ?? project.repoUrl : project.root,
    })),
    {
      value: CREATE_PROJECT_VALUE,
      label: "Create a Cave project",
      detail: "Register a local checkout and link this repository.",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Canvas", "Import from GitHub"]}
      ariaDescribedBy="canvas-github-import-description"
      dismissOnBackdrop={!busy}
      dismissOnEscape={!busy}
      footerActions={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            leadingIcon="ph:download-simple"
            onClick={() => void submit()}
            disabled={!parsed || projectsLoading || busy}
          >
            {busy ? "Importing…" : "Import file"}
          </Button>
        </>
      )}
    >
      <div className="canvas-github-import">
        <p id="canvas-github-import-description" className="canvas-github-import__intro">
          Bring one renderable file into Canvas, then keep its path connected for project commits and pull requests.
        </p>

        <label className="canvas-github-import__field">
          <span>GitHub file</span>
          <input
            className="focus-ring"
            value={fileUrl}
            onChange={(event) => {
              setFileUrl(event.target.value);
              setError(null);
            }}
            placeholder="https://github.com/owner/repo/blob/main/src/App.tsx"
            inputMode="url"
            autoFocus
          />
          <small>HTML, HTM, JSX, or TSX · paste the file’s <strong>blob</strong> URL.</small>
        </label>

        <div className="canvas-github-import__route" aria-label="Sketch delivery path">
          <span data-ready={Boolean(parsed) || undefined}>GitHub file</span>
          <span aria-hidden>→</span>
          <span data-ready={Boolean(projectChoice) || undefined}>Cave project</span>
          <span aria-hidden>→</span>
          <span>Sketch branch</span>
          <span aria-hidden>→</span>
          <span>Pull request</span>
        </div>

        <label className="canvas-github-import__field">
          <span>Cave project</span>
          <StandardSelect
            label="Cave project"
            value={projectChoice}
            onChange={(value) => {
              setProjectChoice(value);
              setError(null);
            }}
            options={projectOptions}
            disabled={projectsLoading}
            placeholder={projectsLoading ? "Loading projects…" : "Choose a project"}
          />
          {selectedProject?.repoUrl ? (
            <small>Linked to {gitHubRepoSlug(selectedProject.repoUrl) ?? selectedProject.repoUrl}</small>
          ) : selectedProject ? (
            <small>This import will link the project to {parsed ? `${parsed.owner}/${parsed.repo}` : "the repository"}.</small>
          ) : null}
        </label>

        {creatingProject ? (
          <div className="canvas-github-import__create">
            <label className="canvas-github-import__field">
              <span>Project name</span>
              <input
                className="focus-ring"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Project name"
              />
            </label>
            <label className="canvas-github-import__field">
              <span>Local project folder</span>
              <input
                className="focus-ring"
                value={projectRoot}
                onChange={(event) => setProjectRoot(event.target.value)}
                placeholder="/Users/you/code/project"
              />
              <small>Use an existing local checkout. Canvas does not clone repositories.</small>
            </label>
          </div>
        ) : null}

        {error ? <div className="canvas-github-import__error" role="alert">{error}</div> : null}
      </div>
    </Modal>
  );
}
