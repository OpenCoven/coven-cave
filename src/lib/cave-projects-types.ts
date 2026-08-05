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
   * Usually that is a leading `~` being expanded, but the server normalizer
   * also trims, converts backslashes and drops trailing slashes — any of which
   * moves the key. The field is attached for all of them, not just `~`.
   *
   * Roots are the KEYS of client-side stores — IDB projectAvatars,
   * cave:chat:project-overrides, comux pins and order — so a record written
   * before the server started expanding (`~/code/app`) keys differently from
   * the same folder added today (`/Users/me/code/app`). Serving one consistent
   * form fixes the split, but it also moves the key out from under whatever
   * was already stored. This field carries the old key so the client can
   * re-key its stores.
   *
   * Response-only: `saveProjects` strips it before writing, so it never reaches
   * projects.json. That strip is the enforcement — every mutation path persists
   * the array `loadProjectsUnlocked` returned, so documenting the intent here
   * without stripping there would have written the marker to disk on the first
   * create/patch/delete after an upgrade.
   */
  legacyRoot?: string;
  createdAt: string;
  updatedAt: string;
};

/** Normalise a project root path to a canonical forward-slash, no-trailing-slash form. */
export function normalizeProjectRoot(root: string | null | undefined): string {
  const normalized = root?.trim().replace(/\\/g, "/");
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
  const normalized = value.trim().replace(/\\/g, "/");
  const unc = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
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
  if (normalized.startsWith("//")) return null;

  const drive = normalized.match(/^([A-Za-z]:)\/(.*)$/);
  if (drive) {
    const segments = normalizedPathSegments(drive[2] ?? "");
    return segments
      ? { flavor: "drive", prefix: drive[1]!.toUpperCase(), segments }
      : null;
  }
  if (/^[A-Za-z]:/.test(normalized)) return null;

  if (!normalized.startsWith("/")) return null;
  const segments = normalizedPathSegments(normalized.slice(1));
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
  if (!a?.trim() || !b?.trim()) return false;
  const left = absolutePathParts(a);
  const right = absolutePathParts(b);
  return Boolean(
    left &&
    right &&
    pathPrefixesEqual(left, right) &&
    left.segments.length === right.segments.length &&
    left.segments.every(
      (segment, index) => pathPartEquals(left.flavor, segment, right.segments[index] ?? ""),
    ),
  );
}

function joinedAbsolutePath(root: AbsolutePathParts, relativeSegments: string[]): string {
  const allSegments = [...root.segments, ...relativeSegments];
  if (root.flavor === "posix") return `/${allSegments.join("/")}`;
  return `${root.prefix}/${allSegments.join("/")}`;
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
  if (!projectRoot?.trim() || !candidatePath?.trim() || /[\0\r\n]/.test(candidatePath)) return null;
  const root = absolutePathParts(projectRoot);
  if (!root) return null;

  const normalizedCandidate = candidatePath.trim().replace(/\\/g, "/");
  const absoluteCandidate = absolutePathParts(normalizedCandidate);
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
    const key = parts.flavor === "posix" ? normalized : normalized.toLocaleLowerCase("en-US");
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
): CaveProject[] {
  const byRoot = new Map<string, CaveProject>();
  for (const project of projects) {
    const root = normalizeRoot(project.root);
    const existing = byRoot.get(root);
    if (!existing || projectTimestamp(project) > projectTimestamp(existing)) {
      byRoot.set(root, project);
    }
  }
  return [...byRoot.values()];
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
