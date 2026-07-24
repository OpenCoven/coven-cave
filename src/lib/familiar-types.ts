/**
 * familiar-types — the Cave's explicit familiar Type vocabulary (cave-cc5r).
 *
 * A familiar's *type* is an explicit, user-modifiable vocation that unlocks
 * Role Surface rooms — the same matching machinery the free-text Role label
 * feeds, made visible and deliberate. Each type grants one role token; the
 * room registry (role-surfaces.ts) matches surfaces against the combined set,
 * so types ADD grants and never subtract what a role label already gives.
 *
 * The stored `familiarType` field is a comma-separated list of type ids
 * (e.g. `"coding,research"`). General is the empty state and never appears
 * as a member. Role grants are the union across all selected types.
 *
 * The table is static on purpose: it is the single documented mapping from
 * "what the user picks in Familiar Studio → Identity" to "which room opens",
 * unit-testable without the component registry.
 */

import type { IconName } from "./icon.tsx";

export type FamiliarTypeId =
  | "general"
  | "coding"
  | "research"
  | "review"
  | "writing"
  | "comms"
  | "watch"
  | "planning"
  | "indexing";

export type FamiliarTypeSpec = {
  id: FamiliarTypeId;
  label: string;
  /** The role token this type grants (matched against RoleSurface.role /
   *  aliases after normalizeRoleId). Null for General — no room. */
  roleToken: string | null;
  /** One-line unlock description shown under the Identity-tab picker. */
  description: string;
  iconName: IconName;
};

export const FAMILIAR_TYPES: readonly FamiliarTypeSpec[] = [
  { id: "general", label: "General", roleToken: null, description: "No dedicated room — every shared surface, nothing extra.", iconName: "ph:sparkle" },
  { id: "coding", label: "Coding", roleToken: "coder", description: "Unlocks the Code room — multi-session coding with diffs, files, branches, worktrees, and GitHub.", iconName: "ph:code" },
  { id: "research", label: "Research", roleToken: "researcher", description: "Unlocks the Research Desk — bounded missions, evidence, and durable knowledge artifacts.", iconName: "ph:detective" },
  { id: "review", label: "Review", roleToken: "reviewer", description: "Unlocks the Review Deck — queued change reviews with verdicts and notes.", iconName: "ph:git-branch" },
  { id: "writing", label: "Writing", roleToken: "scribe", description: "Unlocks the Writing Desk — drafts, revisions, and publishing flow.", iconName: "ph:pencil-simple" },
  { id: "comms", label: "Comms", roleToken: "messenger", description: "Unlocks Comms Operations — outbound and inbound communication across channels.", iconName: "ph:paper-plane-tilt" },
  { id: "watch", label: "Watch", roleToken: "sentinel", description: "Unlocks the Watchtower — monitors, alerts, and incident timelines.", iconName: "ph:shield-warning" },
  { id: "planning", label: "Planning", roleToken: "navigator", description: "Unlocks the Chart Room — plans, milestones, and course corrections.", iconName: "ph:compass" },
  { id: "indexing", label: "Indexing", roleToken: "indexer", description: "Unlocks the Index — corpus health, coverage, and retrieval quality.", iconName: "ph:books" },
];

/** The explicit default: a familiar with no stored type is General. */
export const DEFAULT_FAMILIAR_TYPE: FamiliarTypeId = "general";

export function isFamiliarTypeId(value: string): value is FamiliarTypeId {
  return FAMILIAR_TYPES.some((t) => t.id === value);
}

/**
 * Parse a comma-separated type string into an ordered, deduped list of valid
 * type ids. General is the empty state and is never included in the result.
 */
export function parseFamiliarTypeIds(value: string | undefined | null): FamiliarTypeId[] {
  const seen = new Set<FamiliarTypeId>();
  for (const token of (value ?? "").split(",")) {
    const id = token.trim().toLowerCase();
    if (id === "general" || !isFamiliarTypeId(id)) continue;
    seen.add(id);
  }
  return [...seen];
}

/**
 * Resolve a comma-separated type string to an ordered array of specs. Returns
 * an empty array when the value is absent or resolves to no valid types.
 */
export function resolveFamiliarTypes(value: string | undefined | null): FamiliarTypeSpec[] {
  return parseFamiliarTypeIds(value).map((id) => FAMILIAR_TYPES.find((t) => t.id === id)!);
}

/** Stored value → table entry: the first valid type found among the
 *  comma-separated tokens (skipping "general" and unknown/stale ids), or
 *  General when none are valid or the value is absent — so a stale config
 *  never hides the picker or crashes matching. */
export function resolveFamiliarType(value: string | undefined | null): FamiliarTypeSpec {
  return resolveFamiliarTypes(value)[0] ?? FAMILIAR_TYPES[0];
}

/**
 * Role-id grants for a stored type value: unions the type id and role token
 * for every parsed type. General grants nothing.
 */
export function familiarTypeRoleIds(value: string | undefined | null): string[] {
  const grants = new Set<string>();
  for (const spec of resolveFamiliarTypes(value)) {
    grants.add(spec.id);
    if (spec.roleToken) grants.add(spec.roleToken);
  }
  return [...grants];
}
