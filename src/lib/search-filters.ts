/**
 * search-filters — the versioned query state and the declarative filter
 * registry behind global intelligent search (cave-ychtl.1).
 *
 * The registry is the point of the design: adding a status, an entity type, or
 * a whole new filter key is a DATA change here, not another branch in the
 * parser and not another special case in the React surface. Anything that has
 * to know what a filter means — the parser, the URL serializer, completions,
 * chip labels, provider applicability — reads it from this table.
 *
 * Pure module: no I/O, no React, no clock. Callers that need "now" (relative
 * dates) pass it in, so every rule here is deterministic and unit-testable.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 * Plan: docs/superpowers/plans/2026-08-09-global-intelligent-search-implementation.md
 */

/** Query-state version. Bump only with a migration and a fail-closed path. */
export const SEARCH_QUERY_VERSION = 1;

export type SearchFilterOperator = "is" | "has" | "after" | "before";

/**
 * Where a filter came from. This is not bookkeeping — it drives behavior:
 * Command/Control+Enter removes only `context` scopes, and the surface renders
 * `natural-language` chips so an inferred filter is visible and removable
 * rather than a hidden reinterpretation of what the user typed.
 */
export type SearchFilterOrigin = "syntax" | "natural-language" | "picker" | "context";

export type SearchFilter = {
  key: string;
  operator: SearchFilterOperator;
  value: string | boolean;
  origin: SearchFilterOrigin;
};

export type SearchScopeDimension = "project" | "familiar" | "room" | "session" | "runtime";

export type SearchScope = {
  dimension: SearchScopeDimension;
  id: string;
  label: string;
  /** Derived from the active workspace rather than asked for. */
  implicit: boolean;
};

export type SearchPresentation = "top" | "grouped";

export type SearchQueryState = {
  version: typeof SEARCH_QUERY_VERSION;
  text: string;
  phrases: string[];
  filters: SearchFilter[];
  scopes: SearchScope[];
  presentation: SearchPresentation;
};

export type SearchFilterValueKind = "enum" | "text" | "date";

export type SearchFilterDefinition = {
  key: string;
  /** Accepted spellings in `key:value` syntax, besides `key` itself. */
  aliases: string[];
  operator: SearchFilterOperator;
  valueKind: SearchFilterValueKind;
  /** Whether the registry permits the same key more than once. */
  multiple: boolean;
  /** Completion values. Authoritative for `enum`; advisory for `text`. */
  values: string[];
  /** Entity types this filter can narrow, or "all". Drives filtered-empty. */
  entityTypes: string[] | "all";
  /** Stable URL parameter name; never the raw key, so keys can be renamed. */
  urlKey: string;
  chipLabel: (value: string | boolean) => string;
};

/** MVP entity types. Later provider slices add to this list, not to the parser. */
export const SEARCH_ENTITY_TYPES = [
  "project",
  "familiar",
  "task",
  "session",
  "chat",
  "file",
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** Statuses the MVP providers can express. Data, not parser branches. */
export const SEARCH_STATUS_VALUES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "closed",
  "failed",
  "running",
] as const;

/** Signals reachable through `has:` — "with errors", "needs a decision". */
export const SEARCH_HAS_VALUES = [
  "errors",
  "decision",
  "attachment",
  "files",
] as const;

const title = (value: string) =>
  value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;

const readableStatus = (value: string | boolean) =>
  typeof value === "string" ? title(value.replaceAll("_", " ")) : String(value);

export const SEARCH_FILTER_DEFINITIONS: readonly SearchFilterDefinition[] = Object.freeze([
  {
    key: "type",
    aliases: ["kind", "is"],
    operator: "is",
    valueKind: "enum",
    multiple: true,
    values: [...SEARCH_ENTITY_TYPES],
    entityTypes: "all",
    urlKey: "type",
    chipLabel: (value) => title(String(value)),
  },
  {
    key: "status",
    aliases: ["state"],
    operator: "is",
    valueKind: "enum",
    multiple: true,
    values: [...SEARCH_STATUS_VALUES],
    entityTypes: ["task", "session", "chat"],
    urlKey: "status",
    chipLabel: (value) => readableStatus(value),
  },
  {
    key: "project",
    aliases: ["repo", "workspace"],
    operator: "is",
    valueKind: "text",
    multiple: true,
    values: [],
    entityTypes: "all",
    urlKey: "project",
    chipLabel: (value) => `Project: ${String(value)}`,
  },
  {
    key: "familiar",
    aliases: ["agent", "who"],
    operator: "is",
    valueKind: "text",
    multiple: true,
    values: [],
    entityTypes: ["task", "session", "chat", "familiar"],
    urlKey: "familiar",
    chipLabel: (value) => `Familiar: ${String(value)}`,
  },
  {
    key: "room",
    aliases: [],
    operator: "is",
    valueKind: "text",
    multiple: false,
    values: [],
    entityTypes: ["session", "chat"],
    urlKey: "room",
    chipLabel: (value) => `Room: ${String(value)}`,
  },
  {
    key: "runtime",
    aliases: ["harness"],
    operator: "is",
    valueKind: "text",
    multiple: false,
    values: [],
    entityTypes: ["session", "chat"],
    urlKey: "runtime",
    chipLabel: (value) => `Runtime: ${String(value)}`,
  },
  {
    key: "source",
    aliases: [],
    operator: "is",
    valueKind: "text",
    multiple: true,
    values: [],
    entityTypes: "all",
    urlKey: "source",
    chipLabel: (value) => `Source: ${String(value)}`,
  },
  {
    key: "has",
    aliases: ["with"],
    operator: "has",
    valueKind: "enum",
    multiple: true,
    values: [...SEARCH_HAS_VALUES],
    entityTypes: "all",
    urlKey: "has",
    chipLabel: (value) => `Has ${String(value)}`,
  },
  {
    key: "after",
    aliases: ["since"],
    operator: "after",
    valueKind: "date",
    multiple: false,
    values: [],
    entityTypes: "all",
    urlKey: "after",
    chipLabel: (value) => `After ${String(value)}`,
  },
  {
    key: "before",
    aliases: ["until"],
    operator: "before",
    valueKind: "date",
    multiple: false,
    values: [],
    entityTypes: "all",
    urlKey: "before",
    chipLabel: (value) => `Before ${String(value)}`,
  },
  {
    key: "tag",
    aliases: ["label"],
    operator: "is",
    valueKind: "text",
    multiple: true,
    values: [],
    entityTypes: "all",
    urlKey: "tag",
    chipLabel: (value) => `#${String(value)}`,
  },
]);

const BY_LOOKUP: ReadonlyMap<string, SearchFilterDefinition> = (() => {
  const map = new Map<string, SearchFilterDefinition>();
  for (const definition of SEARCH_FILTER_DEFINITIONS) {
    map.set(definition.key, definition);
    for (const alias of definition.aliases) map.set(alias, definition);
  }
  return map;
})();

const BY_URL_KEY: ReadonlyMap<string, SearchFilterDefinition> = new Map(
  SEARCH_FILTER_DEFINITIONS.map((definition) => [definition.urlKey, definition]),
);

/** Resolve a typed key or alias, case-insensitively. */
export function filterDefinition(key: string): SearchFilterDefinition | null {
  return BY_LOOKUP.get(key.trim().toLowerCase()) ?? null;
}

export function filterDefinitionForUrlKey(urlKey: string): SearchFilterDefinition | null {
  return BY_URL_KEY.get(urlKey) ?? null;
}

/** ISO calendar date, the only date shape `after`/`before` accept. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Whether `value` is acceptable for `definition`.
 *
 * A rejection is never an error: the caller leaves the token in searchable text
 * and offers completions instead. That is what keeps the spec's promise that
 * search never fails because someone typed a colon.
 */
export function isValidFilterValue(
  definition: SearchFilterDefinition,
  value: string,
): boolean {
  if (value.length === 0) return false;
  if (definition.valueKind === "enum") {
    return definition.values.includes(value.toLowerCase());
  }
  if (definition.valueKind === "date") return isIsoCalendarDate(value);
  return true;
}

/** Completions for a partially typed key, in registry order. */
export function completeFilterKeys(prefix: string): SearchFilterDefinition[] {
  const needle = prefix.trim().toLowerCase();
  return SEARCH_FILTER_DEFINITIONS.filter(
    (definition) =>
      definition.key.startsWith(needle) ||
      definition.aliases.some((alias) => alias.startsWith(needle)),
  );
}

/** Completions for a partially typed value of a known key. */
export function completeFilterValues(
  definition: SearchFilterDefinition,
  prefix: string,
): string[] {
  const needle = prefix.trim().toLowerCase();
  return definition.values.filter((value) => value.startsWith(needle));
}

/** Whether a filter can narrow an entity type at all — drives filtered-empty. */
export function filterAppliesToEntity(
  definition: SearchFilterDefinition,
  entityType: string,
): boolean {
  return definition.entityTypes === "all" || definition.entityTypes.includes(entityType);
}

export function chipLabelFor(filter: SearchFilter): string {
  const definition = filterDefinition(filter.key);
  return definition ? definition.chipLabel(filter.value) : `${filter.key}: ${String(filter.value)}`;
}

export function emptySearchQueryState(): SearchQueryState {
  return {
    version: SEARCH_QUERY_VERSION,
    text: "",
    phrases: [],
    filters: [],
    scopes: [],
    presentation: "top",
  };
}
