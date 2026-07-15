/**
 * project-access-levels.ts
 *
 * Client-safe access-level primitives for the project-permissions protocol.
 * Both the server-side enforcement chokepoint (project-permissions.ts) and the
 * client-side Permissions console shaping (permissions-console.ts) import the
 * SAME union-max resolver from here, so the effective-access rule cannot
 * diverge between what the UI shows and what the server enforces.
 */

export type ProjectAccessLevel = "read" | "write";

export const PROJECT_ACCESS_LEVELS: readonly ProjectAccessLevel[] = ["read", "write"];

export type ProjectPermissionSurface =
  | "chat"
  | "session-launch"
  | "shell"
  | "file-browse"
  | "file-read"
  | "file-write"
  | "project-api"
  | "mobile"
  | "project-picker";

/**
 * Surfaces that require "write" access. Everything else — including chat and
 * session-launch — needs only "read": an agent running in a read project is
 * still constrained by these file/shell API chokepoints when it tries to
 * mutate, which is exactly the boundary this split hardens.
 */
const WRITE_SURFACES: ReadonlySet<ProjectPermissionSurface> = new Set(["file-write", "shell"]);

export function requiredAccessLevel(surface: ProjectPermissionSurface): ProjectAccessLevel {
  return WRITE_SURFACES.has(surface) ? "write" : "read";
}

export function accessLevelSatisfies(
  actual: ProjectAccessLevel | null | undefined,
  required: ProjectAccessLevel,
): boolean {
  if (!actual) return false;
  return actual === "write" || required === "read";
}

/** Coerce an untrusted value to a level; anything unrecognised means "write"
 *  because v1 grants (which predate levels) unlocked every surface. */
export function normalizeAccessLevel(value: unknown): ProjectAccessLevel {
  return value === "read" ? "read" : "write";
}

/** Max of two levels under read < write. */
export function maxAccessLevel(
  a: ProjectAccessLevel | null,
  b: ProjectAccessLevel | null,
): ProjectAccessLevel | null {
  if (a === "write" || b === "write") return "write";
  return a ?? b;
}

export type DirectGrantShape = {
  familiarId: string;
  projectId: string;
  access?: ProjectAccessLevel;
};

export type AccessGroupGrantShape = {
  projectId: string;
  access?: ProjectAccessLevel;
};

export type AccessGroupShape = {
  id: string;
  name: string;
  memberFamiliarIds: string[];
  projectGrants: AccessGroupGrantShape[];
};

export type EffectiveAccessGroupSource = {
  groupId: string;
  groupName: string;
  access: ProjectAccessLevel;
};

export type EffectiveProjectAccess = {
  /** Union-max of direct + group levels; null when no grant applies. */
  level: ProjectAccessLevel | null;
  /** Level of the familiar's own direct grant, if any. */
  direct: ProjectAccessLevel | null;
  /** Every member group that grants this project, with its level. */
  groups: EffectiveAccessGroupSource[];
};

/**
 * Resolve a familiar's effective access to one project: the most permissive of
 * its direct grant and every access-group grant it inherits through membership
 * (union-max precedence — there are no deny overrides).
 */
export function resolveEffectiveAccess(args: {
  directGrants: DirectGrantShape[];
  groups: AccessGroupShape[];
  familiarId: string;
  projectId: string;
}): EffectiveProjectAccess {
  const direct = args.directGrants.find(
    (grant) => grant.familiarId === args.familiarId && grant.projectId === args.projectId,
  );
  const directLevel = direct ? normalizeAccessLevel(direct.access) : null;

  const groups: EffectiveAccessGroupSource[] = [];
  for (const group of args.groups) {
    if (!group.memberFamiliarIds.includes(args.familiarId)) continue;
    const grant = group.projectGrants.find((entry) => entry.projectId === args.projectId);
    if (!grant) continue;
    groups.push({
      groupId: group.id,
      groupName: group.name,
      access: normalizeAccessLevel(grant.access),
    });
  }

  let level = directLevel;
  for (const source of groups) level = maxAccessLevel(level, source.access);

  return { level, direct: directLevel, groups };
}
