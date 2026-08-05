/**
 * cave-projects-types.ts
 *
 * Client-safe type definitions and pure helpers extracted from cave-projects.ts.
 * Import these in "use client" components instead of cave-projects.ts directly
 * to avoid pulling node:fs/promises into the browser bundle.
 */

import type { ProjectAccessLevel } from "./project-access-levels.ts";

export type CaveProject = {
  id: string;
  name: string;
  root: string;
  color?: string;
  /** Effective familiar access on familiar-scoped reads; absent on the operator registry view. */
  access?: ProjectAccessLevel;
  /** Canonical GitHub repository link (https://github.com/owner/repo), when tied to one. */
  repoUrl?: string;
  /**
   * The root string as it was persisted, present whenever the server had to
   * re-normalize it to return {@link CaveProject.root} (cave-2x1em).
   *
   * Usually that is a leading `~` being expanded, but native/cross-platform
   * canonicalization can also move a key (for example a trailing separator or
   * a Windows separator spelling). The field is attached for every move.
   *
   * Roots are the KEYS of client-side stores — IDB projectAvatars,
   * cave:chat:project-overrides, comux pins and order — so a record written
   * before the server started expanding (`~/code/app`) keys differently from
   * the same folder added today (`/Users/me/code/app`). Serving one consistent
   * form fixes the split, but it also moves the key out from under whatever
   * was already stored. This field carries the old key so the client can
   * re-key its stores.
   *
   * Persisted retry metadata: the server removes it only after the client
   * acknowledges that every root-keyed store migrated successfully.
   */
  legacyRoot?: string;
  /** Every pre-canonical key collapsed into this project, retained for migration. */
  legacyRoots?: string[];
  /** Project ids of duplicate rows collapsed into this surviving project. */
  legacyProjectIds?: string[];
  createdAt: string;
  updatedAt: string;
};

function hasWindowsPathSyntax(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z]:/.test(trimmed) || /^(?:\\\\|\/\/)/.test(trimmed);
}

/** Normalize display paths without rewriting POSIX filename characters. */
export function normalizeProjectRoot(root: string | null | undefined): string {
  if (root === null || root === undefined) return "/";
  const normalized = hasWindowsPathSyntax(root)
    ? root.trim().replace(/\\/g, "/")
    : root.startsWith("/")
      ? root
      : root.trim().replace(/\\/g, "/");
  if (!normalized) return "/";
  if (/^[A-Za-z]:\/*$/.test(normalized)) return `${normalized.slice(0, 2)}/`;
  let endIndex = normalized.length;
  while (endIndex > 0 && normalized[endIndex - 1] === "/") endIndex--;
  return normalized.slice(0, endIndex) || "/";
}

export type ProjectRelativePath = {
  absolutePath: string;
  relativePath: string;
};

type AbsolutePathParts = {
  flavor: "posix" | "drive" | "unc";
  prefix: string;
  segments: string[];
};

function normalizedPathSegments(value: string): string[] | null {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

function absolutePathParts(value: string): AbsolutePathParts | null {
  if (!value.trim() || /[\0-\x1f\x7f]/.test(value)) return null;
  const windowsSyntax = hasWindowsPathSyntax(value);
  const portable = (windowsSyntax ? value.trim() : value).replace(/\\/g, "/");
  const unc = portable.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (unc) {
    const [, server, share, rest = ""] = unc;
    if (
      !server ||
      !share ||
      server === "." ||
      server === "?" ||
      share === "." ||
      share === ".."
    ) {
      return null;
    }
    const segments = normalizedPathSegments(rest);
    return segments
      ? { flavor: "unc", prefix: `//${server}/${share}`, segments }
      : null;
  }
  if (portable.startsWith("//")) return null;

  const drive = portable.match(/^([A-Za-z]:)\/(.*)$/);
  if (drive) {
    const segments = normalizedPathSegments(drive[2] ?? "");
    return segments
      ? { flavor: "drive", prefix: drive[1]!.toUpperCase(), segments }
      : null;
  }
  if (/^[A-Za-z]:/.test(portable)) return null;

  if (!value.startsWith("/")) return null;
  const segments = normalizedPathSegments(value.slice(1));
  return segments ? { flavor: "posix", prefix: "/", segments } : null;
}

function pathPartEquals(flavor: AbsolutePathParts["flavor"], a: string, b: string): boolean {
  return flavor === "posix" ? a === b : a.toLocaleLowerCase("en-US") === b.toLocaleLowerCase("en-US");
}

function pathPrefixesEqual(a: AbsolutePathParts, b: AbsolutePathParts): boolean {
  return a.flavor === b.flavor && pathPartEquals(a.flavor, a.prefix, b.prefix);
}

/** Compare absolute project roots using the case rules of their path flavor. */
export function projectRootsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = projectPathIdentityKey(a);
  const right = projectPathIdentityKey(b);
  return left !== null && right !== null && left === right;
}

function joinedAbsolutePath(root: AbsolutePathParts, relativeSegments: string[]): string {
  const allSegments = [...root.segments, ...relativeSegments];
  if (root.flavor === "posix") return `/${allSegments.join("/")}`;
  return `${root.prefix}/${allSegments.join("/")}`;
}

/**
 * Stable identity for an absolute project path. Drive and UNC identities use
 * their platform's case-insensitive semantics; POSIX identities remain
 * case-sensitive.
 */
export function projectPathIdentityKey(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) return null;
  const parts = absolutePathParts(value);
  if (!parts) return null;
  const normalized = joinedAbsolutePath(parts, []);
  const identity = parts.flavor === "posix"
    ? normalized
    : normalized.toLocaleLowerCase("en-US");
  return `${parts.flavor}:${identity}`;
}

/**
 * Resolve one absolute or project-relative path against a project root.
 * Structured POSIX/drive/UNC parts prevent sibling-prefix collisions. Windows
 * roots compare case-insensitively, while relative dot segments may never pop
 * above the project boundary.
 */
export function resolvePathWithinProjectRoot(
  projectRoot: string | null | undefined,
  candidatePath: string | null | undefined,
): ProjectRelativePath | null {
  if (
    !projectRoot?.trim() ||
    !candidatePath?.trim() ||
    /[\0-\x1f\x7f]/.test(projectRoot) ||
    /[\0-\x1f\x7f]/.test(candidatePath)
  ) {
    return null;
  }
  const root = absolutePathParts(projectRoot);
  if (!root) return null;

  const normalizedCandidate = root.flavor === "posix"
    ? candidatePath
    : candidatePath.trim().replace(/\\/g, "/");
  const absoluteCandidate = absolutePathParts(candidatePath);
  let candidate: AbsolutePathParts;
  if (absoluteCandidate) {
    candidate = absoluteCandidate;
  } else {
    if (normalizedCandidate.startsWith("/") || /^[A-Za-z]:/.test(normalizedCandidate)) return null;
    const segments = [...root.segments];
    for (const segment of normalizedCandidate.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") {
        if (segments.length === root.segments.length) return null;
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    candidate = { flavor: root.flavor, prefix: root.prefix, segments };
  }

  if (
    !pathPrefixesEqual(candidate, root) ||
    candidate.segments.length <= root.segments.length ||
    root.segments.some(
      (segment, index) => !pathPartEquals(root.flavor, candidate.segments[index] ?? "", segment),
    )
  ) {
    return null;
  }
  const relativeSegments = candidate.segments.slice(root.segments.length);
  return {
    absolutePath: joinedAbsolutePath(root, relativeSegments),
    relativePath: relativeSegments.join("/"),
  };
}

export type GitRelativeProjectTarget = {
  absolutePath: string;
  projectRelativePath: string;
  gitRelativePath: string;
};

/**
 * Resolve a target under its captured project first, then express that exact
 * target relative to the enclosing Git root.
 */
export function resolveProjectPathForGitRoot(
  projectRoot: string | null | undefined,
  gitRoot: string | null | undefined,
  candidatePath: string | null | undefined,
): GitRelativeProjectTarget | null {
  const projectTarget = resolvePathWithinProjectRoot(projectRoot, candidatePath);
  if (!projectTarget) return null;
  const gitTarget = resolvePathWithinProjectRoot(gitRoot, projectTarget.absolutePath);
  if (!gitTarget) return null;
  return {
    absolutePath: projectTarget.absolutePath,
    projectRelativePath: projectTarget.relativePath,
    gitRelativePath: gitTarget.relativePath,
  };
}

/** Client-safe absolute-path classification for POSIX, drive, and UNC paths. */
export function isAbsoluteProjectPath(value: string | null | undefined): value is string {
  return typeof value === "string" && absolutePathParts(value) !== null;
}

/** Deduplicate absolute paths using the case semantics of their path flavor. */
export function dedupeAbsoluteProjectPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  return paths.flatMap((path) => {
    const parts = absolutePathParts(path);
    if (!parts) return [];
    const normalized = joinedAbsolutePath(parts, []);
    const key = projectPathIdentityKey(normalized);
    if (!key) return [];
    if (seen.has(key)) return [];
    seen.add(key);
    return [path];
  });
}

export function compareProjectsAlphabetically(a: CaveProject, b: CaveProject): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  if (byName !== 0) return byName;
  return a.root.localeCompare(b.root, undefined, { sensitivity: "base", numeric: true });
}

function projectTimestamp(project: CaveProject): number {
  const updatedAt = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(project.createdAt);
  return Number.isFinite(createdAt) ? createdAt : Number.NEGATIVE_INFINITY;
}

/**
 * Collapse the list to one project per path. The normalized root is the
 * identity for dedupe purposes — ids are random and can diverge across
 * duplicate rows, but two entries pointing at the same path are the same
 * project. Newest record (by updatedAt, then createdAt) wins. Callers may
 * pass a stricter normalizer (e.g. the server-side tilde-expanding one) so
 * `~/code/app` and its absolute twin collapse too.
 */
export function dedupeProjectsByRoot(
  projects: CaveProject[],
  normalizeRoot: (root: string) => string = normalizeProjectRoot,
  identityKey: (root: string) => string = (root) =>
    projectPathIdentityKey(root) ?? root,
): CaveProject[] {
  const byRoot = new Map<string, CaveProject>();
  for (const project of projects) {
    const root = normalizeRoot(project.root);
    const identity = identityKey(root);
    const existing = byRoot.get(identity);
    if (!existing) {
      byRoot.set(identity, project);
      continue;
    }
    const winner = projectTimestamp(project) > projectTimestamp(existing)
      ? project
      : existing;
    const aliases = new Set([
      ...(existing.legacyRoots ?? []),
      ...(existing.legacyRoot ? [existing.legacyRoot] : []),
      ...(project.legacyRoots ?? []),
      ...(project.legacyRoot ? [project.legacyRoot] : []),
      existing.root,
      project.root,
    ]);
    aliases.delete(winner.root);
    const legacyRoots = [...aliases];
    const merged = { ...winner };
    const loser = winner === existing ? project : existing;
    const legacyProjectIds = [
      ...new Set([
        ...(winner.legacyProjectIds ?? []),
        ...(loser.legacyProjectIds ?? []),
        loser.id,
      ]),
    ].filter((id) => id !== winner.id);
    if (legacyProjectIds.length) merged.legacyProjectIds = legacyProjectIds;
    else delete merged.legacyProjectIds;
    if (legacyRoots.length) {
      merged.legacyRoot = legacyRoots[0];
      merged.legacyRoots = legacyRoots;
    } else {
      delete merged.legacyRoot;
      delete merged.legacyRoots;
    }
    byRoot.set(identity, merged);
  }
  return [...byRoot.values()];
}

/** Deterministic losing-id → survivor map carried by deduplicated projects. */
export function projectIdMigrationMap(
  projects: readonly CaveProject[],
): ReadonlyMap<string, string> {
  const migrations = new Map<string, string>();
  const ambiguous = new Set<string>();
  const currentIds = new Set(projects.map((project) => project.id));
  for (const project of projects) {
    for (const legacyId of project.legacyProjectIds ?? []) {
      if (
        !legacyId ||
        currentIds.has(legacyId) ||
        ambiguous.has(legacyId)
      ) {
        continue;
      }
      const existing = migrations.get(legacyId);
      if (existing && existing !== project.id) {
        migrations.delete(legacyId);
        ambiguous.add(legacyId);
      } else {
        migrations.set(legacyId, project.id);
      }
    }
  }
  return migrations;
}

export function remapProjectId(
  projectId: string,
  migrations: ReadonlyMap<string, string>,
): string {
  return migrations.get(projectId) ?? projectId;
}

export function sortProjectsAlphabetically(projects: CaveProject[]): CaveProject[] {
  return dedupeProjectsByRoot(projects).sort(compareProjectsAlphabetically);
}

/**
 * Resolve a manually typed picker query to one project. Exact project names
 * win; otherwise the first alphabetized name/root match mirrors the visible
 * picker order. Blank or unmatched queries select nothing.
 */
export function projectForPickerQuery(
  projects: CaveProject[],
  query: string,
): CaveProject | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  const visible = sortProjectsAlphabetically(projects).filter(
    (project) =>
      project.name.toLowerCase().includes(normalizedQuery) ||
      project.root.toLowerCase().includes(normalizedQuery),
  );
  return (
    visible.find((project) => project.name.trim().toLowerCase() === normalizedQuery) ??
    visible[0] ??
    null
  );
}
