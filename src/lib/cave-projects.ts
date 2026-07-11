import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type { CaveProject } from "./cave-projects-types.ts";
export {
  dedupeProjectsByRoot,
  normalizeProjectRoot,
  sortProjectsAlphabetically,
} from "./cave-projects-types.ts";
import type { CaveProject } from "./cave-projects-types.ts";
import { dedupeProjectsByRoot as dedupeByRoot } from "./cave-projects-types.ts";

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
  let trimmed = root.trim();
  // Expand a leading ~ — a manually-typed ~/code/app was stored literally and
  // never matched the daemon's absolute project_root, so Sessions/Git/Tasks
  // stayed empty and the project looked dead (cave-psp8).
  if (trimmed === "~") trimmed = homedir();
  else if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    trimmed = path.join(homedir(), trimmed.slice(2));
  }
  const normalized = trimmed.replace(/\\/g, "/");
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
    if (!Array.isArray(parsed.projects)) return [];
    // Dedupe at the source of truth: the normalized path IS the project
    // identity. createProject/patchProject keep new writes one-per-root, but
    // duplicates persisted before that guard (or written by hand) would
    // otherwise leak into every server consumer (projectById,
    // trustedProjectCwd, permission filtering) while the UI hid them via
    // dedupeProjectsByRoot — a client/server divergence. Newest record wins;
    // the next mutation persists the deduped list, self-healing the file.
    return dedupeByRoot(parsed.projects, normalizeRoot);
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
    const root = normalizeRoot(input.root);
    // One project per root. Creating at an already-registered root would persist
    // a duplicate on disk that the UI hides via dedupeProjectsByRoot but the
    // server (projectById / trustedProjectCwd) can still resolve to — a
    // client/server divergence. Return the existing project idempotently instead
    // ("this folder is already a project → here it is").
    const existing = projects.find((entry) => normalizeRoot(entry.root) === root);
    if (existing) return existing;
    const now = new Date().toISOString();
    const project: CaveProject = {
      id: nanoid(),
      name: input.name.trim(),
      root,
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
  // color: string sets an explicit tint; null clears it (back to the auto
  // root-hash tint); undefined leaves it untouched.
  patch: { name?: string; root?: string; color?: string | null },
): Promise<CaveProject | null> {
  return withWriteMutex(async () => {
    const projects = await loadProjects();
    const idx = projects.findIndex((project) => project.id === id);
    if (idx < 0) return null;
    const current = projects[idx];
    // A root change that would collide with a *different* project is dropped —
    // it keeps the one-project-per-root invariant that createProject enforces, so
    // a rename-onto-another-root can't fork the on-disk store into two entries
    // for one path. Name/color still apply.
    let nextRoot = current.root;
    if (patch.root !== undefined) {
      const candidate = normalizeRoot(patch.root);
      const collides = projects.some(
        (entry) => entry.id !== id && normalizeRoot(entry.root) === candidate,
      );
      if (!collides) nextRoot = candidate;
    }
    const updated: CaveProject = {
      ...current,
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      root: nextRoot,
      updatedAt: new Date().toISOString(),
    };
    if (patch.color !== undefined) {
      if (patch.color === null) delete updated.color;
      else updated.color = patch.color;
    }
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

/**
 * The server-trusted working directory for a card assigned to `projectId`: the
 * project's own root, loaded server-side. A card's `cwd` must never be taken
 * from a client body alongside a `projectId` — the two could contradict, and a
 * mismatched cwd then feeds board search (`cwd:` token), display, and the
 * no-project chat fallback (cave-pw83). Returns `{ ok: false }` when the id
 * doesn't resolve so the caller can reject with a 409.
 */
export async function trustedProjectCwd(
  projectId: string,
): Promise<{ ok: true; root: string } | { ok: false }> {
  const project = projectById(projectId, await loadProjects());
  return project ? { ok: true, root: project.root } : { ok: false };
}
