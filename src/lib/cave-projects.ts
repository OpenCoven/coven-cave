import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
import { caveHome } from "./coven-paths.ts";
import {
  caveHomeStoreNeedsRecoveryNormalization,
  markCaveHomeStoreRecoveryNormalized,
  withCaveHomeReconciledStore,
} from "./server/cave-home-migration.ts";
import { writeJsonAtomic } from "./server/atomic-write.ts";
import { invalidateSessionsListCache } from "./server/sessions-list-cache.ts";
import { withProjectAuthorizationGuard } from "./server/project-authorization-lock.ts";

type ProjectsFile = {
  version: 1;
  projects: CaveProject[];
  /**
   * Cross-process session-list cache visibility nonce (Task 5/7 finding —
   * see `@/lib/project-permissions.ts`'s `ProjectPermissionsFile.visibilityGeneration`
   * for the full rationale, mirrored exactly here for the project registry).
   * Regenerated inside `saveProjects`'s SAME atomic write only when effective
   * visibility changes (create/delete/re-root), so metadata-only and no-op
   * writes keep it stable and a failed write never advances it. Absent on every store written before
   * this field existed — a fixed sentinel, never a freshly random value, so
   * an unmutated legacy file keeps producing the SAME cache key on every
   * read.
   */
  visibilityGeneration: string;
};

const MISSING_PROJECTS_VISIBILITY_GENERATION = "missing";

export class ProjectRegistryIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectRegistryIntegrityError";
  }
}

function projectsFilePath(): string {
  return (
    process.env.CAVE_PROJECTS_PATH_OVERRIDE ??
    path.join(caveHome(), "projects.json")
  );
}

/**
 * Server-side project root: {@link normalizeProjectRoot} PLUS `~` expansion.
 *
 * Deliberately NOT merged into the display normalizer (cave-zz12). Expanding
 * `~` changes what a root normalizes to, and roots are the keys of persisted
 * stores — IDB projectAvatars, cave:chat:project-overrides, comux pins and
 * order — so folding this into the shared normalizer silently re-keys them and
 * avatars and pins vanish for existing users. Unifying the two needs a
 * migration pass, tracked separately; until then the divergence is explicit
 * and named rather than an anonymous private duplicate.
 *
 * Not a security boundary either: resolveAllowedProjectPath / trustedProjectCwd
 * do their own validation and must not be routed through any display path.
 */
function normalizeRootExpandingHome(root: string): string {
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ProjectRegistryIntegrityError(`Unable to read project registry: ${filePath}`, {
      cause: error,
    });
  }
}

function isStrictProject(value: unknown): value is CaveProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "id",
    "name",
    "root",
    "createdAt",
    "updatedAt",
    "color",
    "repoUrl",
  ]);
  return (
    Object.keys(project).every((key) => allowedKeys.has(key)) &&
    typeof project.id === "string" &&
    project.id.length > 0 &&
    typeof project.name === "string" &&
    typeof project.root === "string" &&
    project.root.length > 0 &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    (project.color === undefined || typeof project.color === "string") &&
    (project.repoUrl === undefined || typeof project.repoUrl === "string") &&
    project.legacyRoot === undefined &&
    project.access === undefined
  );
}

function parseStrictProjects(raw: string): ProjectsFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectRegistryIntegrityError("Project registry contains invalid JSON.", {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProjectRegistryIntegrityError("Project registry has an invalid schema.");
  }
  const file = parsed as Record<string, unknown>;
  const allowedKeys = new Set(["version", "projects", "visibilityGeneration"]);
  if (
    !Object.keys(file).every((key) => allowedKeys.has(key)) ||
    file.version !== 1 ||
    !Array.isArray(file.projects) ||
    !file.projects.every(isStrictProject) ||
    typeof file.visibilityGeneration !== "string" ||
    !file.visibilityGeneration ||
    file.visibilityGeneration === "unversioned"
  ) {
    throw new ProjectRegistryIntegrityError("Project registry has an invalid schema.");
  }
  return file as ProjectsFile;
}

function normalizeRecoveredProjects(raw: string): CaveProject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectRegistryIntegrityError("Recovered project registry contains invalid JSON.", {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProjectRegistryIntegrityError("Recovered project registry has an invalid schema.");
  }
  const projects = (parsed as { version?: unknown; projects?: unknown }).projects;
  if ((parsed as { version?: unknown }).version !== 1 || !Array.isArray(projects) || !projects.every(isStrictProject)) {
    throw new ProjectRegistryIntegrityError("Recovered project registry has an invalid schema.");
  }
  return projects;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * True when `record` is the genuine durable legacy (pre-`visibilityGeneration`)
 * project registry shape: version 1, ONLY the `version`/`projects` keys (no
 * `visibilityGeneration` key present at all — not merely one holding an
 * invalid value), and every project entry independently passes the exact
 * same strict per-project validation {@link isStrictProject} enforces for
 * the current schema.
 *
 * This is a pure content check. It is deliberately never combined with, or
 * gated by, `caveHomeStoreNeedsRecoveryNormalization`'s process-local marker
 * or whether the file was previously absent — those are process-local
 * signals that a DIFFERENT process (or an earlier cold start of this same
 * one) can never have set. Detecting the legacy shape from the actual bytes
 * on disk is what makes normalization work identically whether another
 * process already performed the physical cave-home migration move (this
 * process never ran it, so it has no marker for it) or a legacy-schema file
 * simply already sits at the canonical path on a cold start.
 *
 * Anything else — extra or missing top-level keys, the wrong `version`, or
 * even a single project entry that fails strict validation — is NOT legacy
 * here; it falls through to {@link parseStrictProjects}, which fails closed.
 * An arbitrary missing field is never mistaken for this specific, fully
 * validated legacy shape.
 */
function isLegacyProjectsRecord(
  record: Record<string, unknown>,
): record is { version: 1; projects: CaveProject[] } {
  const allowedLegacyKeys = new Set(["version", "projects"]);
  return (
    Object.keys(record).every((key) => allowedLegacyKeys.has(key)) &&
    record.version === 1 &&
    Array.isArray(record.projects) &&
    record.projects.every(isStrictProject)
  );
}

/**
 * Content-only detection, never throwing: malformed JSON or a non-object top
 * level simply means "not legacy" here — the strict parse path is what
 * reports those failures to the caller.
 */
function isLegacyProjectsSchema(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return isRecord(parsed) && isLegacyProjectsRecord(parsed);
}

/** Assumes {@link isLegacyProjectsSchema} already returned true for `raw`. */
function normalizeLegacyProjectsFile(raw: string): ProjectsFile {
  const record = JSON.parse(raw) as { version: 1; projects: CaveProject[] };
  return {
    version: 1,
    projects: record.projects,
    // A fresh cryptographic generation — this file has never had one.
    visibilityGeneration: randomUUID(),
  };
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

async function loadProjectsUnlocked(options: { normalizeRecovered?: boolean } = {}): Promise<CaveProject[]> {
  const raw = await readFileOrNull(projectsFilePath());
  if (!raw) {
    if (options.normalizeRecovered) {
      await writeJsonAtomic(projectsFilePath(), {
        version: 1,
        projects: [],
        visibilityGeneration: randomUUID(),
      } satisfies ProjectsFile);
      markCaveHomeStoreRecoveryNormalized("cave-projects.json");
      invalidateSessionsListCache();
    }
    return [];
  }
  let parsed: ProjectsFile;
  if (isLegacyProjectsSchema(raw)) {
    // Durable legacy normalization: this branch is reached purely from the
    // ACTUAL on-disk bytes at the canonical path — never from
    // `caveHomeStoreNeedsRecoveryNormalization`'s process-local marker or
    // from the file having been absent (`options.normalizeRecovered` below
    // is a SEPARATE, more lenient fallback for the explicit recover-legacy
    // flow). It therefore fires identically whether another process already
    // performed the physical cave-home migration move (this process never
    // ran that migration, so it has no marker) or the legacy-schema file
    // simply already sits at the canonical path on a cold start. Every
    // concurrent reader that observes legacy bytes here runs the SAME
    // parse+regenerate+persist while holding the SAME project-authorization
    // lock (`loadProjects`/`projectsVisibilityGeneration` route through it
    // whenever this content shape is detected), so racing readers normalize
    // exactly once: the loser re-reads the now-current schema on its own
    // turn instead of clobbering the winner's write.
    parsed = normalizeLegacyProjectsFile(raw);
    await writeJsonAtomic(projectsFilePath(), parsed);
    markCaveHomeStoreRecoveryNormalized("cave-projects.json");
    invalidateSessionsListCache();
  } else if (options.normalizeRecovered) {
    parsed = {
      version: 1 as const,
      projects: normalizeRecoveredProjects(raw),
      visibilityGeneration: randomUUID(),
    };
    await writeJsonAtomic(projectsFilePath(), parsed);
    markCaveHomeStoreRecoveryNormalized("cave-projects.json");
    invalidateSessionsListCache();
  } else {
    parsed = parseStrictProjects(raw);
  }
    // Dedupe at the source of truth: the normalized path IS the project
    // identity. createProject/patchProject keep new writes one-per-root, but
    // duplicates persisted before that guard (or written by hand) would
    // otherwise leak into every server consumer (projectById,
    // trustedProjectCwd, permission filtering) while the UI hid them via
    // dedupeProjectsByRoot — a client/server divergence. Newest record wins;
    // the next mutation persists the deduped list, self-healing the file.
    // Serve ONE root form (cave-2x1em). createProject has persisted the
    // expanded root since cave-psp8, but records written before that still
    // hold a literal `~/...`, so the same folder reaches clients as two
    // different strings depending on when it was added — and roots are the
    // keys of the client's avatar, chat-override and comux stores.
    //
    // The display normalizer deliberately does NOT expand `~`: it runs in the
    // browser, which has no home directory. So the split is closed here, on
    // the side that knows the homedir, rather than by shipping one to the
    // client. `legacyRoot` carries the old key so the client can re-key what
    // it already stored; it is response-only and never written back.
  return dedupeByRoot(parsed.projects, normalizeRootExpandingHome).map((project) => {
      const expanded = normalizeRootExpandingHome(project.root);
      if (expanded === project.root) return project;
      return { ...project, root: expanded, legacyRoot: project.root };
    });
}

/**
 * Whether the registry needs a normalizing pass under the project-
 * authorization lock before it can be read on the fast (lock-free) path:
 * the file is absent, or its on-disk bytes are the genuine durable legacy
 * shape {@link isLegacyProjectsRecord} describes. Content-based, not marker-
 * based — see `loadProjectsUnlocked`'s legacy branch for why that matters.
 */
async function projectsRegistryNeedsAuthorizedNormalization(): Promise<boolean> {
  const raw = await readFileOrNull(projectsFilePath());
  return raw === null || isLegacyProjectsSchema(raw);
}

export async function loadProjects(): Promise<CaveProject[]> {
  if (!(await projectsRegistryNeedsAuthorizedNormalization())) {
    return withProjectsStore(loadProjectsUnlocked);
  }
  return withProjectAuthorizationGuard(
    () => loadProjectsAlreadyAuthorized(),
    "project-registry-recovery",
  );
}

/** Read/recover the registry for a caller that already holds project authorization. */
export async function loadProjectsAlreadyAuthorized(): Promise<CaveProject[]> {
  const wasMissing = (await readFileOrNull(projectsFilePath())) === null;
  return withProjectsStore(() =>
    loadProjectsUnlocked({
      normalizeRecovered:
        wasMissing || caveHomeStoreNeedsRecoveryNormalization("cave-projects.json"),
    }),
  );
}

async function readProjectsVisibilityGenerationUnlocked(): Promise<string> {
  const raw = await readFileOrNull(projectsFilePath());
  if (!raw) return MISSING_PROJECTS_VISIBILITY_GENERATION;
  return parseStrictProjects(raw).visibilityGeneration;
}

/**
 * The current cross-process session-list cache visibility nonce for the
 * project registry — see `ProjectsFile.visibilityGeneration`'s doc comment.
 * Read by `@/lib/server/client-v1/read-model.ts` ahead of every canonical
 * sessions-list cache lookup so a project create/rename/delete committed by
 * ANOTHER process is observed on this process's very next read.
 */
export async function projectsVisibilityGeneration(): Promise<string> {
  if (await projectsRegistryNeedsAuthorizedNormalization()) {
    await withProjectAuthorizationGuard(
      () => loadProjectsAlreadyAuthorized(),
      "project-registry-recovery",
    );
  }
  return withProjectsStore(readProjectsVisibilityGenerationUnlocked);
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
  return withProjectAuthorizationGuard(async () => {
    const wasMissing = (await readFileOrNull(projectsFilePath())) === null;
    return withProjectsStore(() =>
      withWriteMutex(async () => operation(await loadProjectsUnlocked({
        normalizeRecovered:
          wasMissing || caveHomeStoreNeedsRecoveryNormalization("cave-projects.json"),
      }))),
    );
  }, "project-registry");
}

async function saveProjects(projects: CaveProject[], visibilityChanged: boolean): Promise<void> {
  // Strip legacyRoot before it reaches disk. loadProjectsUnlocked attaches it
  // in memory so the client can follow a moved root, and every mutation path
  // (create/patch/delete) writes back the array that load returned — so without
  // this the transitional marker would be persisted, and then re-attached on
  // the next read of a record that no longer needs it. A response-only field
  // has to be stripped at the boundary that writes, not merely documented as
  // response-only.
  const file: ProjectsFile = {
    version: 1,
    projects: projects.map(({ legacyRoot: _legacyRoot, ...project }) => project),
    // Cross-process cache-visibility nonce: regenerated in THIS SAME write
    // only for create/delete/re-root. Metadata and no-op writes retain it.
    visibilityGeneration: visibilityChanged
      ? randomUUID()
      : await readProjectsVisibilityGenerationUnlocked(),
  };
  await writeJsonAtomic(projectsFilePath(), file);
  // Adding/removing a project or changing its root can change which sessions
  // fall into a known (grant-checked) project vs. the always-visible
  // "(no project)" bucket (session-project-scope.ts), so it can change
  // effective visibility just like a permission-file change can. Invalidate
  // the shared sessions-list cache HERE — the one function every registry
  // mutation (createProject/patchProject/deleteProject) funnels through —
  // AFTER `writeProjectsFile` succeeds (it throws on failure), so a failed
  // write never busts a cache that still correctly reflects the unchanged
  // on-disk registry.
  if (visibilityChanged) invalidateSessionsListCache();
}

export function createProject(input: {
  name: string;
  root: string;
  color?: string;
  /** Canonical GitHub repository link — callers validate/normalize first. */
  repoUrl?: string;
}): Promise<CaveProject> {
  return withProjectAuthorizationGuard(async () => {
    const wasMissing = (await readFileOrNull(projectsFilePath())) === null;
    return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked({
      normalizeRecovered:
        wasMissing || caveHomeStoreNeedsRecoveryNormalization("cave-projects.json"),
    });
    const root = normalizeRootExpandingHome(input.root);
    // One project per root. Creating at an already-registered root would persist
    // a duplicate on disk that the UI hides via dedupeProjectsByRoot but the
    // server (projectById / trustedProjectCwd) can still resolve to — a
    // client/server divergence. Return the existing project idempotently instead
    // ("this folder is already a project → here it is").
    const existing = projects.find((entry) => normalizeRootExpandingHome(entry.root) === root);
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
    await saveProjects([...projects, project], true);
    return project;
    }));
  }, "project-registry");
}

export function patchProject(
  id: string,
  // color: string sets an explicit tint; null clears it (back to the auto
  // root-hash tint); undefined leaves it untouched. repoUrl follows the same
  // string-sets / null-clears / undefined-keeps contract.
  patch: { name?: string; root?: string; color?: string | null; repoUrl?: string | null },
): Promise<CaveProject | null> {
  return withProjectAuthorizationGuard(async () => {
    const wasMissing = (await readFileOrNull(projectsFilePath())) === null;
    return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked({
      normalizeRecovered:
        wasMissing || caveHomeStoreNeedsRecoveryNormalization("cave-projects.json"),
    });
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
      const collides = projects.some(
        (entry) => entry.id !== id && normalizeRootExpandingHome(entry.root) === candidate,
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
    await saveProjects(next, nextRoot !== current.root);
    return updated;
    }));
  }, "project-registry");
}

export async function deleteProjectAlreadyAuthorized(id: string): Promise<boolean> {
  const wasMissing = (await readFileOrNull(projectsFilePath())) === null;
  return withProjectsStore(() => withWriteMutex(async () => {
    const projects = await loadProjectsUnlocked({
      normalizeRecovered:
        wasMissing || caveHomeStoreNeedsRecoveryNormalization("cave-projects.json"),
    });
    const next = projects.filter((project) => project.id !== id);
    if (next.length === projects.length) return false;
    await saveProjects(next, true);
    return true;
  }));
}

export function deleteProject(id: string): Promise<boolean> {
  return withProjectAuthorizationGuard(
    () => deleteProjectAlreadyAuthorized(id),
    "project-registry",
  );
}

export async function seedDefaultProjectsIfEmpty(): Promise<void> {
  // No-op: seeding with hard-coded developer paths makes no sense for other users.
  // Projects are created via the UI or POST /api/projects.
}

export function projectForRoot(
  root: string | null | undefined,
  projects: readonly CaveProject[],
): CaveProject | null {
  if (!root?.trim()) return null;
  const normalized = normalizeRootExpandingHome(root);
  return projects.find((project) => normalizeRootExpandingHome(project.root) === normalized) ?? null;
}

export function projectById(
  id: string | null | undefined,
  projects: readonly CaveProject[],
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
