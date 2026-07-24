import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadProjects, projectById } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import { caveHome } from "@/lib/coven-paths";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "@/lib/server/project-paths";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

type QueueProjectFile = {
  version: 1;
  projectId: string;
};

export type QueueProjectReadinessCode =
  | "ready"
  | "needs-beads"
  | "no-project"
  | "project-missing"
  | "project-not-allowed"
  | "not-git-repository";

export type QueueProjectReadiness = {
  ok: boolean;
  code: QueueProjectReadinessCode;
  message: string;
  project: Pick<CaveProject, "id" | "name" | "root"> | null;
  /** A valid repository can be generated into when it has no Beads workspace. */
  canGenerate: boolean;
};

function queueProjectFilePath(): string {
  return process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE ?? path.join(caveHome(), "queue-project.json");
}

async function readSelectedProjectId(): Promise<string | null> {
  try {
    const raw = await readFile(queueProjectFilePath(), "utf8");
    const value = JSON.parse(raw) as Partial<QueueProjectFile>;
    return typeof value.projectId === "string" && value.projectId.trim() ? value.projectId.trim() : null;
  } catch {
    return null;
  }
}

export async function selectQueueProject(projectId: string): Promise<CaveProject | null> {
  const project = projectById(projectId, await loadProjects());
  if (!project) return null;
  const file = queueProjectFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, projectId: project.id } satisfies QueueProjectFile, null, 2), "utf8");
  return project;
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await stat(value)).isDirectory();
  } catch {
    return false;
  }
}

async function gitTopLevel(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      timeout: GIT_TIMEOUT_MS,
    });
    const top = stdout.trim();
    return top || null;
  } catch {
    return null;
  }
}

function projectShape(project: CaveProject): Pick<CaveProject, "id" | "name" | "root"> {
  return { id: project.id, name: project.name, root: project.root };
}

/**
 * The Queue has a deliberately separate default project. A packaged sidecar's
 * cwd is application data, never a user workspace; callers must use this
 * readiness result instead of falling back to process.cwd().
 */
export async function queueProjectReadiness(): Promise<QueueProjectReadiness> {
  const projectId = await readSelectedProjectId();
  if (!projectId) {
    return {
      ok: false,
      code: "no-project",
      message: "Choose a Git project for the Queue before loading work.",
      project: null,
      canGenerate: false,
    };
  }

  const project = projectById(projectId, await loadProjects());
  if (!project) {
    return {
      ok: false,
      code: "project-missing",
      message: "The Queue project is no longer registered. Choose a project again.",
      project: null,
      canGenerate: false,
    };
  }
  const selected = projectShape(project);

  // A project created on another OS can be syntactically non-absolute on this
  // host (for example C:\\work on Linux). Treat it as stale rather than feeding
  // it to git, so the UI can offer a real recovery path.
  if (!path.isAbsolute(project.root) || !(await isDirectory(project.root))) {
    return {
      ok: false,
      code: "project-missing",
      message: `The Queue project path is unavailable on this computer: ${project.root}. Choose a project again.`,
      project: selected,
      canGenerate: false,
    };
  }
  if (!isAllowedNewProjectRoot(project.root)) {
    return {
      ok: false,
      code: "project-not-allowed",
      message: "The Queue project is no longer an allowed project folder. Choose a specific project folder again.",
      project: selected,
      canGenerate: false,
    };
  }
  const validated = validateCaveProjectRoot(project.root);
  if (!validated.ok) {
    return {
      ok: false,
      code: "project-missing",
      message: "The Queue project folder is unavailable. Choose a project again.",
      project: selected,
      canGenerate: false,
    };
  }
  const repoRoot = await gitTopLevel(validated.root);
  if (!repoRoot) {
    return {
      ok: false,
      code: "not-git-repository",
      message: `The selected Queue project is not a Git repository: ${validated.root}. Choose a Git project.`,
      project: selected,
      canGenerate: false,
    };
  }

  if (!(await isDirectory(path.join(repoRoot, ".beads")))) {
    return {
      ok: false,
      code: "needs-beads",
      message: `Queue is ready to generate in ${repoRoot}. Generate will initialize its local Beads workspace.`,
      project: { ...selected, root: repoRoot },
      canGenerate: true,
    };
  }
  return {
    ok: true,
    code: "ready",
    message: "Queue project is ready.",
    project: { ...selected, root: repoRoot },
    canGenerate: false,
  };
}
