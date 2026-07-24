/**
 * familiar-types — the Cave's explicit familiar Type vocabulary (cave-cc5r).
 *
 * A familiar's *type* is an explicit, user-modifiable vocation that unlocks
 * Role Surface rooms — the same matching machinery the free-text Role label
 * feeds, made visible and deliberate. Each type grants one role token; the
 * room registry (role-surfaces.ts) matches surfaces against the combined set,
 * so types ADD grants and never subtract what a role label already gives.
 *
 * The table is static on purpose: it is the single documented mapping from
 * "what the user picks in Familiar Studio → Identity" to "which room opens",
 * unit-testable without the component registry.
 *
 * The vocabulary is deliberately small (cave-lgcb): usage evidence trimmed
 * it from nine types to this core set. Retired ids stay resolvable through
 * RETIRED_FAMILIAR_TYPE_SUCCESSORS, and their rooms remain reachable via
 * free-text Role labels and registry aliases.
 */

import type { IconName } from "./icon.tsx";

export type FamiliarTypeId =
  | "general"
  | "coding"
  | "research"
  | "review"
  | "comms";

/**
 * Retired type ids → successor type (familiar-type vocabulary reduction,
 * cave-lgcb, 2026-07-24). Usage evidence showed these four types carried
 * ~2% of sessions combined, so they left the picker. Every retired id maps
 * to a documented successor so stale stored configs resolve safely — the
 * picker never hides and matching never crashes. Their rooms stay
 * registered and reachable through free-text Role labels (the registry
 * carries watch/planning/writing/indexing aliases for exactly this).
 */
export const RETIRED_FAMILIAR_TYPE_SUCCESSORS: Readonly<Record<string, FamiliarTypeId>> = {
  watch: "general",
  planning: "general",
  writing: "general",
  indexing: "general",
};

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
  { id: "comms", label: "Comms", roleToken: "messenger", description: "Unlocks Comms Operations — outbound and inbound communication across channels.", iconName: "ph:paper-plane-tilt" },
];

/** The explicit default: a familiar with no stored type is General. */
export const DEFAULT_FAMILIAR_TYPE: FamiliarTypeId = "general";

export function isFamiliarTypeId(value: string): value is FamiliarTypeId {
  return FAMILIAR_TYPES.some((t) => t.id === value);
}

/** Stored value → table entry; retired ids resolve to their documented
 *  successor, and unknown/absent values resolve to General — so a stale
 *  config never hides the picker or crashes matching. */
export function resolveFamiliarType(value: string | undefined | null): FamiliarTypeSpec {
  const id = (value ?? "").trim().toLowerCase();
  const successor = RETIRED_FAMILIAR_TYPE_SUCCESSORS[id];
  const resolved = successor ?? id;
  return FAMILIAR_TYPES.find((t) => t.id === resolved) ?? FAMILIAR_TYPES[0];
}

/**
 * Role-id grants for a stored type value: the type id itself plus its role
 * token (both already normalizeRoleId-shaped). General grants nothing.
 */
export function familiarTypeRoleIds(value: string | undefined | null): string[] {
  const spec = resolveFamiliarType(value);
  if (!spec.roleToken) return [];
  return [spec.id, spec.roleToken];
}
