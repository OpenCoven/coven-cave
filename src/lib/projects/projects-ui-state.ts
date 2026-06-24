// Pure, framework-free persistence helpers for the Projects tab's UI state
// (which project cards are expanded + the list density). Kept self-contained —
// no React, no direct localStorage — so the parse/serialize/normalize logic can
// be unit-tested under the strip-types runner. The React glue lives in the
// `use-projects-ui-state` hook, which calls these.

/** localStorage key holding the JSON array of expanded project ids. */
export const PROJECTS_EXPANDED_KEY = "cave:projects:expanded";
/** localStorage key holding the list density preference. */
export const PROJECTS_DENSITY_KEY = "cave:projects:density";

/** Row density: "comfortable" is the spacious default; "compact" tightens it. */
export type ProjectsDensity = "comfortable" | "compact";

/** Parse the persisted expanded-ids blob into a clean string[] (ignores junk). */
export function parseExpandedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Serialize a set of expanded ids back to the stored JSON form. */
export function serializeExpandedIds(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)]);
}

/** Toggle one id in the expanded set, returning a new array (stable order). */
export function toggleExpandedId(ids: Iterable<string>, id: string, next: boolean): string[] {
  const set = new Set(ids);
  if (next) set.add(id);
  else set.delete(id);
  return [...set];
}

/** Coerce any stored/unknown value to a valid density (defaults to comfortable). */
export function normalizeDensity(raw: string | null | undefined): ProjectsDensity {
  return raw === "compact" ? "compact" : "comfortable";
}
