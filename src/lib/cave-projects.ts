import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type { CaveProject } from "./cave-projects-types.ts";
export { normalizeProjectRoot } from "./cave-projects-types.ts";
import type { CaveProject } from "./cave-projects-types.ts";

type ProjectsFile = {
  version: 1;
  projects: CaveProject[];
};

function projectsFilePath(): string {
  return (
    process.env.CAVE_PROJECTS_PATH_OVERRIDE ??
    path.join(homedir(), ".coven", "cave-projects.json")
  );
}

function normalizeRoot(root: string): string {
  const normalized = root.trim().replace(/\\/g, "/");
  let endIndex = normalized.length;
  while (endIndex > 0 && normalized[endIndex - 1] === "/") endIndex--;
  return normalized.slice(0, endIndex) || "/";
}

function nanoid(len = 10): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(len);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function writeProjectsFile(filePath: string, data: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data, "utf8");
}

// Serialize mutating operations so concurrent API calls don't clobber each other.
let writeMutex: Promise<unknown> = Promise.resolve();
function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(fn, fn);
  writeMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function loadProjects(): Promise<CaveProject[]> {
  const raw = await readFileOrNull(projectsFilePath());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectsFile>;
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

async function saveProjects(projects: CaveProject[]): Promise<void> {
  const file: ProjectsFile = { version: 1, projects };
  await writeProjectsFile(projectsFilePath(), JSON.stringify(file, null, 2));
}

export function createProject(input: {
  name: string;
  root: string;
  color?: string;
}): Promise<CaveProject> {
  return withWriteMutex(async () => {
    const projects = await loadProjects();
    const now = new Date().toISOString();
    const project: CaveProject = {
      id: nanoid(),
      name: input.name.trim(),
      root: normalizeRoot(input.root),
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
    await saveProjects([...projects, project]);
    return project;
  });
}

export function patchProject(
  id: string,
  patch: Partial<Pick<CaveProject, "name" | "root" | "color">>,
): Promise<CaveProject | null> {
  return withWriteMutex(async () => {
    const projects = await loadProjects();
    const idx = projects.findIndex((project) => project.id === id);
    if (idx < 0) return null;
    const current = projects[idx];
    const updated: CaveProject = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      root: patch.root !== undefined ? normalizeRoot(patch.root) : current.root,
      updatedAt: new Date().toISOString(),
    };
    const next = [...projects];
    next[idx] = updated;
    await saveProjects(next);
    return updated;
  });
}

export function deleteProject(id: string): Promise<boolean> {
  return withWriteMutex(async () => {
    const projects = await loadProjects();
    const next = projects.filter((project) => project.id !== id);
    if (next.length === projects.length) return false;
    await saveProjects(next);
    return true;
  });
}

export async function seedDefaultProjectsIfEmpty(): Promise<void> {
  // No-op: seeding with hard-coded developer paths makes no sense for other users.
  // Projects are created via the UI or POST /api/projects.
}

export function projectForRoot(
  root: string | null | undefined,
  projects: CaveProject[],
): CaveProject | null {
  if (!root?.trim()) return null;
  const normalized = normalizeRoot(root);
  return projects.find((project) => normalizeRoot(project.root) === normalized) ?? null;
}

export function projectById(
  id: string | null | undefined,
  projects: CaveProject[],
): CaveProject | null {
  if (!id) return null;
  return projects.find((project) => project.id === id) ?? null;
}
