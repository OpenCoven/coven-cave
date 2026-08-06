import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type { CaveProject } from "./cave-projects-types.ts";
export {
  dedupeProjectsByRoot,
  normalizeProjectRoot,
  projectPathIdentityKey,
  sortProjectsAlphabetically,
} from "./cave-projects-types.ts";
import type { CaveProject } from "./cave-projects-types.ts";
import {
  dedupeProjectsByRoot as dedupeByRoot,
  legacyProjectRootKey,
  normalizeProjectRoot as normalizeSharedProjectRoot,
  projectPathIdentityKey,
  projectRootMigrationMap,
} from "./cave-projects-types.ts";
import { caveHome } from "./coven-paths.ts";
import { withCaveHomeReconciledStore } from "./server/cave-home-migration.ts";

type ProjectsFile = {
  version: 1;
  /** Persisted once raw-tilde and pre-POSIX-safe keys are migration aliases. */
  rootKeyNormalizerVersion?: 4;
  projects: CaveProject[];
};

function projectsFilePath(): string {
  return (
    process.env.CAVE_PROJECTS_PATH_OVERRIDE ??
    path.join(caveHome(), "projects.json")
  );
}

function isPortableWindowsRoot(root: string): boolean {
  const trimmed = root.trim();
  return (
    /^[A-Za-z]:(?:[\\/]|$)/.test(trimmed) ||
    /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/.test(trimmed)
  );
}

function expandHomeRoot(root: string): string {
  if (root === "~") return homedir();
  if (root.startsWith("~/") || root.startsWith("~\\")) {
    return path.join(homedir(), root.slice(2));
  }
  return root;
}

function isUnexpandedHomeRoot(root: string): boolean {
  const trimmed = root.trim();
  return (
    trimmed === "~" ||
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\")
  );
}

/**
 * Normalize persisted server roots without applying cross-platform display
 * parsing to a native POSIX path. On POSIX, `\` and edge whitespace are valid
 * filename characters; Windows-looking roots retain the portable registry
 * behavior used when displaying projects from another platform. This remains
 * separate from the display normalizer until a migration pass can safely
 * re-key every persisted root consumer.
 */
function normalizeRootExpandingHome(root: string): string {
  const expanded = expandHomeRoot(root);
  if (process.platform === "win32" || isPortableWindowsRoot(expanded)) {
    return normalizeSharedProjectRoot(expanded);
  }

  let native = expanded;
  native = path.posix.normalize(native);
  while (native.length > 1 && native.endsWith("/")) native = native.slice(0, -1);
  return native;
}

function serverProjectRootIdentity(root: string): string {
  const normalized = normalizeRootExpandingHome(root);
  if (process.platform !== "win32" && !isPortableWindowsRoot(normalized)) {
    return `posix:${normalized}`;
  }
  return projectPathIdentityKey(normalized) ?? normalized;
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

function withProjectsStore<T>(operation: () => Promise<T>): Promise<T> {
  if (process.env.CAVE_PROJECTS_PATH_OVERRIDE) return operation();
  return withCaveHomeReconciledStore("cave-projects.json", operation);
}

async function loadProjectsUnlocked(): Promise<CaveProject[]> {
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
    // Serve ONE root form (cave-2x1em). createProject has persisted the
    // expanded root since cave-psp8, but records written before that can still
    // hold a literal `~/...`. Some historical clients persisted that literal
    // spelling while others saw the expanded root, so both are migration
    // aliases. The literal tilde never becomes the served/authorized root.
    //
    // The display normalizer deliberately does NOT expand `~`: it runs in the
    // browser, which has no home directory. So the split is closed here, on
    // the side that knows the homedir, rather than by shipping one to the
    // client. `legacyRoots` carries every collapsed old key so the client can
    // re-key what it already stored. Aliases stay durable until the client
    // explicitly acknowledges that every local migration succeeded.
    const addPreviousCanonicalAliases =
      parsed.rootKeyNormalizerVersion !== 4;
    const normalizedProjects = parsed.projects.map((project) => {
      const expandedRoot = expandHomeRoot(project.root);
      const expanded = normalizeRootExpandingHome(expandedRoot);
      const previousCanonical = addPreviousCanonicalAliases
        ? legacyProjectRootKey(expandedRoot)
        : null;
      const aliases = new Set([
        ...(project.legacyRoots ?? []),
        ...(project.legacyRoot ? [project.legacyRoot] : []),
        ...(isUnexpandedHomeRoot(project.root) ? [project.root] : []),
        ...(expanded === expandedRoot ? [] : [expandedRoot]),
        ...(previousCanonical && previousCanonical !== expanded
          ? [previousCanonical]
          : []),
      ]);
      aliases.delete(expanded);
      const legacyRoots = [...aliases];
      const normalized = { ...project, root: expanded };
      if (legacyRoots.length) {
        normalized.legacyRoot = legacyRoots[0];
        normalized.legacyRoots = legacyRoots;
      } else {
        delete normalized.legacyRoot;
        delete normalized.legacyRoots;
      }
      return normalized;
    });
    const deduped = dedupeByRoot(
      normalizedProjects,
      normalizeRootExpandingHome,
      serverProjectRootIdentity,
    );
    const safeMigrations = projectRootMigrationMap(deduped);
    return deduped.map((project) => {
      const aliases = [
        ...new Set([
          ...(project.legacyRoots ?? []),
          ...(project.legacyRoot ? [project.legacyRoot] : []),
        ]),
      ].filter((root) => safeMigrations.get(root) === project.root);
      const safeProject = { ...project };
      if (aliases.length) {
        safeProject.legacyRoot = aliases[0];
        safeProject.legacyRoots = aliases;
      } else {
        delete safeProject.legacyRoot;
        delete safeProject.legacyRoots;
      }
      return safeProject;
    });
  } catch {
    return [];
  }
}

export async function loadProjects(): Promise<CaveProject[]> {
  return withProjectsStore(loadProjectsUnlocked);
}

/**
 * Coordinate a project-registry snapshot with a dependent durable write.
 *
 * The callback receives a registry snapshot while the same mutex that guards
 * create/patch/delete owns the registry. Consumers that persist a decision
 * based on project IDs must use this rather than loading first and writing a
 * different store later; otherwise a concurrent registration can turn a
 * valid permission record into a stale one between those two operations.
 */
export function withProjectRegistryLock<T>(
  operation: (projects: CaveProject[]) => Promise<T>,
): Promise<T> {
  return withProjectsStore(() => withWriteMutex(async () => operation(await loadProjectsUnlocked())));
}

async function saveProjects(projects: CaveProject[]): Promise<void> {
  const file: ProjectsFile = {
    version: 1,
    rootKeyNormalizerVersion: 4,
    projects,
  };
  await writeProjectsFile(projectsFilePath(), JSON.stringify(file, null, 2));
}

export type ProjectRootMigrationAcknowledgement = {
  projectId: string;
  legacyRoots: string[];
};

/** Remove only aliases the client confirms it migrated successfully. */
export function acknowledgeProjectRootMigrations(
  acknowledgements: readonly ProjectRootMigrationAcknowledgement[],
): Promise<void> {
  return withProjectsStore(() => withWriteMutex(async () => {
    if (!acknowledgements.length) return;
    const projects = await loadProjectsUnlocked();
    let changed = false;
    for (const acknowledgement of acknowledgements) {
      if (
        !acknowledgement ||
        typeof acknowledgement.projectId !== "string" ||
        !Array.isArray(acknowledgement.legacyRoots)
      ) {
        continue;
      }
      const project = projects.find((entry) => entry.id === acknowledgement.projectId);
      if (!project) continue;
      const completed = new Set(
        acknowledgement.legacyRoots.filter(
          (root): root is string => typeof root === "string",
        ),
      );
      const current = [
        ...new Set([
          ...(project.legacyRoots ?? []),
          ...(project.legacyRoot ? [project.legacyRoot] : []),
        ]),
      ];
      const pending = current.filter((root) => !completed.has(root));
      if (pending.length === current.length) continue;
      changed = true;
      if (pending.length) {
        project.legacyRoot = pending[0];
        project.legacyRoots = pending;
      } else {
        delete project.legacyRoot;
        delete project.legacyRoots;
      }
    }
    if (changed) await saveProjects(projects);
  }));
}

export function createProject(input: {
  name: string;
  root: string;
  color?: string;
  /** Canonical GitHub repository link — callers validate/normalize first. */
  repoUrl?: string;
}): Promise<CaveProject> {
  return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked();
    const root = normalizeRootExpandingHome(input.root);
    const rootIdentity = serverProjectRootIdentity(root);
    // One project per root. Creating at an already-registered root would persist
    // a duplicate on disk that the UI hides via dedupeProjectsByRoot but the
    // server (projectById / trustedProjectCwd) can still resolve to — a
    // client/server divergence. Return the existing project idempotently instead
    // ("this folder is already a project → here it is").
    const existing = projects.find(
      (entry) =>
        serverProjectRootIdentity(entry.root) === rootIdentity,
    );
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
    if (input.repoUrl) project.repoUrl = input.repoUrl;
    await saveProjects([...projects, project]);
    return project;
  }));
}

export function patchProject(
  id: string,
  // color: string sets an explicit tint; null clears it (back to the auto
  // root-hash tint); undefined leaves it untouched. repoUrl follows the same
  // string-sets / null-clears / undefined-keeps contract.
  patch: { name?: string; root?: string; color?: string | null; repoUrl?: string | null },
): Promise<CaveProject | null> {
  return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked();
    const idx = projects.findIndex((project) => project.id === id);
    if (idx < 0) return null;
    const current = projects[idx];
    // A root change that would collide with a *different* project is dropped —
    // it keeps the one-project-per-root invariant that createProject enforces, so
    // a rename-onto-another-root can't fork the on-disk store into two entries
    // for one path. Name/color still apply.
    let nextRoot = current.root;
    if (patch.root !== undefined) {
      const candidate = normalizeRootExpandingHome(patch.root);
      const candidateIdentity = serverProjectRootIdentity(candidate);
      const collides = projects.some(
        (entry) =>
          entry.id !== id &&
          serverProjectRootIdentity(entry.root) === candidateIdentity,
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
    if (patch.repoUrl !== undefined) {
      if (patch.repoUrl === null) delete updated.repoUrl;
      else updated.repoUrl = patch.repoUrl;
    }
    const next = [...projects];
    next[idx] = updated;
    await saveProjects(next);
    return updated;
  }));
}

export function deleteProject(id: string): Promise<boolean> {
  return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked();
    const next = projects.filter((project) => project.id !== id);
    if (next.length === projects.length) return false;
    await saveProjects(next);
    return true;
  }));
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
  const normalized = normalizeRootExpandingHome(root);
  const identity = serverProjectRootIdentity(normalized);
  return projects.find((project) => {
    return serverProjectRootIdentity(project.root) === identity;
  }) ?? null;
}

export function projectById(
  id: string | null | undefined,
  projects: CaveProject[],
): CaveProject | null {
  if (!id) return null;
  return (
    projects.find((project) => project.id === id) ??
    projects.find((project) => project.legacyProjectIds?.includes(id) === true) ??
    null
  );
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
