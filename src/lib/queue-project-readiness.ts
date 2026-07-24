import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { loadProjects, projectById } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import { caveHome } from "@/lib/coven-paths";
import { isAllowedNewProjectRoot, validateCaveProjectRoot } from "@/lib/server/project-paths";
import { runBdCommand, type BdResult } from "@/lib/server/beads-cli";

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
  | "not-git-repository"
  | "git-unavailable"
  | "git-error"
  | "project-not-git-root"
  | "project-storage-error";

export type QueueProjectReadiness = {
  ok: boolean;
  code: QueueProjectReadinessCode;
  message: string;
  project: Pick<CaveProject, "id" | "name" | "root"> | null;
  /** A valid repository can be generated into when it has no Beads workspace. */
  canGenerate: boolean;
};

type BeadsProbe = (repoRoot: string, beadsDir: string, args: string[]) => Promise<BdResult>;
type QueueProjectReadinessOptions = { beadsProbe?: BeadsProbe };
const READY_PROBE_TTL_MS = 2_000;
const readyProbeCache = new Map<string, { expiresAt: number; result: BdResult }>();

export class QueueProjectStorageError extends Error {
  constructor(message = "Cave could not read or save the Queue project selection.") {
    super(message);
    this.name = "QueueProjectStorageError";
  }
}

function queueProjectFilePath(): string {
  // The data directory is chosen at runtime. Keep it out of Next's output
  // tracing so a packaged Queue check does not pull the checkout into the
  // sidecar archive.
  return process.env.CAVE_QUEUE_PROJECT_PATH_OVERRIDE ?? path.join(/* turbopackIgnore: true */ caveHome(), "queue-project.json");
}

let selectionWriteTail: Promise<void> = Promise.resolve();

async function writeSelectedProjectId(file: string, projectId: string): Promise<void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const previous = selectionWriteTail;
  selectionWriteTail = next;
  await previous;
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      /* turbopackIgnore: true */ temporary,
      JSON.stringify({ version: 1, projectId } satisfies QueueProjectFile, null, 2),
      "utf8",
    );
    // Rename is atomic within the Cave home directory: concurrent readers see
    // either the old valid selection or the complete new selection.
    await rename(/* turbopackIgnore: true */ temporary, file);
  } finally {
    release();
  }
}

async function readSelectedProjectId(): Promise<string | null> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ queueProjectFilePath(), "utf8");
    const value = JSON.parse(raw) as Partial<QueueProjectFile>;
    if (value.version !== 1 || typeof value.projectId !== "string" || !value.projectId.trim()) {
      throw new QueueProjectStorageError("The saved Queue project selection is invalid. Choose the project again.");
    }
    return value.projectId.trim();
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code === "ENOENT") return null;
    if (cause instanceof QueueProjectStorageError) throw cause;
    throw new QueueProjectStorageError("Cave could not read the saved Queue project selection. Check Cave home permissions and try again.");
  }
}

export async function selectQueueProject(projectId: string): Promise<CaveProject | null> {
  const project = projectById(projectId, await loadProjects());
  if (!project) return null;
  const file = queueProjectFilePath();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await writeSelectedProjectId(file, project.id);
  return project;
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await stat(/* turbopackIgnore: true */ value)).isDirectory();
  } catch {
    return false;
  }
}

type GitTopLevel =
  | { ok: true; root: string }
  | { ok: false; code: "not-git-repository" | "git-unavailable" | "git-error"; message: string };

async function gitTopLevel(root: string): Promise<GitTopLevel> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: /* turbopackIgnore: true */ root,
      timeout: GIT_TIMEOUT_MS,
    });
    const top = stdout.trim();
    if (!top) return { ok: false, code: "not-git-repository", message: "The selected Queue project is not a Git repository." };
    return { ok: true, root: await realpath(/* turbopackIgnore: true */ top) };
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return { ok: false, code: "git-unavailable", message: "Git is required to use the Queue project. Install Git and try again." };
    }
    return {
      ok: false,
      code: "git-error",
      message: "Git could not validate the Queue project. Check Git permissions and repository trust, then try again.",
    };
  }
}

async function hasUsableBeadsWorkspace(repoRoot: string, probe: BeadsProbe): Promise<boolean> {
  const beadsDir = path.join(/* turbopackIgnore: true */ repoRoot, ".beads");
  try {
    const entry = await lstat(/* turbopackIgnore: true */ beadsDir);
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
    const canonicalBeads = await realpath(/* turbopackIgnore: true */ beadsDir);
    if (canonicalBeads !== beadsDir && !canonicalBeads.startsWith(repoRoot + path.sep)) return false;
  } catch {
    return false;
  }
  // Directory presence alone is not a workspace: a failed bd init can leave an
  // empty .beads behind. A read-only probe keeps Generate available to repair it.
  const result = await probe(repoRoot, beadsDir, ["ready", "--json"]);
  if (result.ok) readyProbeCache.set(repoRoot, { expiresAt: Date.now() + READY_PROBE_TTL_MS, result });
  return result.ok;
}

/** Let the immediately-following Queue list read reuse its verified bd ready output. */
export function takeQueueReadyProbe(repoRoot: string): BdResult | null {
  const cached = readyProbeCache.get(repoRoot);
  if (!cached || cached.expiresAt < Date.now()) {
    readyProbeCache.delete(repoRoot);
    return null;
  }
  readyProbeCache.delete(repoRoot);
  return cached.result;
}

function projectShape(project: CaveProject): Pick<CaveProject, "id" | "name" | "root"> {
  return { id: project.id, name: project.name, root: project.root };
}

/**
 * The Queue has a deliberately separate default project. A packaged sidecar's
 * cwd is application data, never a user workspace; callers must use this
 * readiness result instead of falling back to process.cwd().
 */
export async function queueProjectReadiness(options: QueueProjectReadinessOptions = {}): Promise<QueueProjectReadiness> {
  let projectId: string | null;
  try {
    projectId = await readSelectedProjectId();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Cave could not read the Queue project selection.";
    return { ok: false, code: "project-storage-error", message, project: null, canGenerate: false };
  }
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
  const gitRoot = await gitTopLevel(validated.root);
  if (!gitRoot.ok) {
    return {
      ok: false,
      code: gitRoot.code,
      message: gitRoot.code === "not-git-repository"
        ? `The selected Queue project is not a Git repository: ${validated.root}. Choose a Git project.`
        : gitRoot.message,
      project: selected,
      canGenerate: false,
    };
  }
  // Project selection is intentionally a repository boundary, not a loose
  // subdirectory hint. Never replace a selected/authorized path with a Git
  // parent that the project registry has not approved.
  if (gitRoot.root !== validated.root) {
    return {
      ok: false,
      code: "project-not-git-root",
      message: `Choose the Git repository root for Queue work, not a subdirectory: ${gitRoot.root}.`,
      project: selected,
      canGenerate: false,
    };
  }

  if (!(await hasUsableBeadsWorkspace(gitRoot.root, options.beadsProbe ?? runBdCommand))) {
    return {
      ok: false,
      code: "needs-beads",
      message: `Queue is ready to generate in ${gitRoot.root}. Generate will initialize or repair its local Beads workspace.`,
      project: { ...selected, root: gitRoot.root },
      canGenerate: true,
    };
  }
  return {
    ok: true,
    code: "ready",
    message: "Queue project is ready.",
    project: { ...selected, root: gitRoot.root },
    canGenerate: false,
  };
}
