/**
 * search-coordinator — provider selection, scope enforcement, permission
 * re-checks, ranking and diagnostics for global search (cave-ychtl.4).
 *
 * The coordinator is the only place that sees every corpus at once, so it owns
 * the things a single provider cannot be trusted with:
 *
 *   - HARD SCOPES are applied before scoring, never after. Filtering a ranked
 *     page would return fewer results than the caller asked for and make the
 *     cursor meaningless.
 *   - PERMISSIONS are re-checked here even though every provider already
 *     checked them. The duplication is deliberate: a provider is the only
 *     thing that understands its own permission model, and this is the only
 *     thing that cannot be skipped.
 *   - PARTIAL FAILURE stays visible. A provider that could not be searched
 *     produces a diagnostic and the rest of the page still returns; it never
 *     degrades into a convincing empty result set.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import { SEARCH_QUERY_VERSION, type SearchQueryState } from "./search-filters.ts";
import { normalizeSearchDocument, type SearchDocument } from "./search-document.ts";
import {
  selectProviders,
  type SearchProvider,
  type SearchProviderDiagnostic,
  type SearchRequesterContext,
} from "./search-provider.ts";
import {
  dedupeResults,
  facetCounts,
  interleaveByType,
  rankResults,
  type RankableResult,
  type RankedResult,
} from "./search-ranking.ts";

const FILTER_OPERATORS = new Set(["is", "has", "after", "before"]);
const FILTER_ORIGINS = new Set(["syntax", "natural-language", "picker", "context"]);
const SCOPE_DIMENSIONS = new Set(["project", "familiar", "room", "session", "runtime"]);

/** Hard cap on a first page, per the spec's performance budget. */
export const MAX_PAGE = 50;
const MAX_TEXT = 1024;

export type SearchRequest = {
  query: SearchQueryState;
  context: SearchRequesterContext;
  limit?: number;
  cursor?: string | null;
  now?: number;
};

/**
 * Why a page came back empty. These are deliberately distinct: collapsing them
 * into one empty array is what makes a search surface feel broken rather than
 * honest — "nothing matched" and "no provider can honor that filter" call for
 * different words in the UI.
 */
export type SearchEmptyReason =
  | "none"
  | "no-matches"
  | "filtered-empty"
  | "permission-denied";

export type SearchOutcome =
  | { ok: false; code: "unsupported-version" | "malformed-query" | "query-too-long"; message: string }
  | {
      ok: true;
      results: RankedResult[];
      emptyReason: SearchEmptyReason;
      facets: Record<string, number>;
      diagnostics: SearchProviderDiagnostic[];
      /** True when at least one provider could not be searched. */
      partial: boolean;
      cursor: string | null;
      indexState: "ready" | "warming" | "stale";
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchFilter(value: unknown): value is SearchQueryState["filters"][number] {
  return (
    isPlainObject(value) &&
    typeof value.key === "string" &&
    FILTER_OPERATORS.has(value.operator) &&
    (typeof value.value === "string" || typeof value.value === "boolean") &&
    FILTER_ORIGINS.has(value.origin)
  );
}

function isSearchScope(value: unknown): value is SearchQueryState["scopes"][number] {
  return (
    isPlainObject(value) &&
    SCOPE_DIMENSIONS.has(value.dimension) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.implicit === "boolean"
  );
}

/**
 * Validate an incoming query AST.
 *
 * An unknown VERSION is refused rather than coerced: applying filters whose
 * meaning may have changed between versions is worse than refusing, and the
 * client already knows how to fall back to plain text.
 */
export type QueryValidation =
  | { ok: false; code: "unsupported-version" | "malformed-query" | "query-too-long"; message: string }
  | { ok: true; query: SearchQueryState };

export function validateQuery(value: unknown): QueryValidation {
  if (!isPlainObject(value)) {
    return { ok: false, code: "malformed-query", message: "query must be an object" };
  }
  if (value.version !== SEARCH_QUERY_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      message: `unsupported query version ${String(value.version)}`,
    };
  }
  const text = typeof value.text === "string" ? value.text : "";
  if (text.length > MAX_TEXT) {
    return { ok: false, code: "query-too-long", message: "query text exceeds the limit" };
  }
  const query: SearchQueryState = {
    version: SEARCH_QUERY_VERSION,
    text,
    phrases: Array.isArray(value.phrases)
      ? value.phrases.filter((p): p is string => typeof p === "string")
      : [],
    filters: Array.isArray(value.filters) ? value.filters.filter(isSearchFilter) : [],
    scopes: Array.isArray(value.scopes) ? value.scopes.filter(isSearchScope) : [],
    presentation: value.presentation === "grouped" ? "grouped" : "top",
  };
  return { ok: true, query };
}

const scopeIds = (query: SearchQueryState, dimension: string): string[] =>
  query.scopes.filter((scope) => scope.dimension === dimension).map((scope) => scope.id);

const filterValues = (query: SearchQueryState, key: string): string[] =>
  query.filters.filter((f) => f.key === key).map((f) => String(f.value));

/**
 * Whether a document satisfies every HARD scope and filter.
 *
 * Applied before scoring. A document failing any of these is not a low-ranked
 * result, it is not a result at all.
 */
export function satisfiesHardConstraints(
  document: SearchDocument,
  query: SearchQueryState,
): boolean {
  const projectScopes = [...scopeIds(query, "project"), ...filterValues(query, "project")];
  if (projectScopes.length > 0 && (!document.projectId || !projectScopes.includes(document.projectId))) {
    return false;
  }
  const familiarScopes = [...scopeIds(query, "familiar"), ...filterValues(query, "familiar")];
  if (familiarScopes.length > 0) {
    // Case-insensitive: `for Cody` infers a label, not an id.
    const wanted = familiarScopes.map((value) => value.toLowerCase());
    if (!document.familiarId || !wanted.includes(document.familiarId.toLowerCase())) return false;
  }
  const types = filterValues(query, "type");
  if (types.length > 0 && !types.includes(document.entityType)) return false;

  const statuses = filterValues(query, "status");
  if (statuses.length > 0 && (!document.status || !statuses.includes(document.status))) return false;

  const tags = filterValues(query, "tag");
  if (tags.length > 0 && !tags.every((tag) => document.tags.includes(tag))) return false;

  for (const filter of query.filters) {
    if (filter.operator === "after" || filter.operator === "before") {
      const stamp = document.updatedAt ?? document.createdAt;
      if (!stamp) return false;
      const at = Date.parse(stamp);
      const bound = Date.parse(`${String(filter.value)}T00:00:00Z`);
      if (Number.isNaN(at) || Number.isNaN(bound)) return false;
      if (filter.operator === "after" && at < bound) return false;
      if (filter.operator === "before" && at > bound) return false;
    }
  }
  return true;
}

export type CoordinatorDependencies = {
  providers: readonly SearchProvider[];
  /** Reads indexed documents. Injected so the coordinator never opens a store. */
  readIndexed: (
    provider: SearchProvider,
    query: SearchQueryState,
    limit: number,
  ) => Promise<{ rows: RankableResult[]; stale: boolean }>;
};

export async function runSearch(
  request: SearchRequest,
  deps: CoordinatorDependencies,
): Promise<SearchOutcome> {
  const validated = validateQuery(request.query);
  if (!validated.ok) return validated;
  const query = validated.query;

  const limit = Math.max(1, Math.min(request.limit ?? MAX_PAGE, MAX_PAGE));
  const now = request.now ?? 0;
  const entityTypes = filterValues(query, "type");

  const applicable = selectProviders(deps.providers, { filters: query.filters, entityTypes });
  if (applicable.length === 0) {
    // Every provider was excluded because none can honor the filters. That is
    // a truthful filtered-empty, NOT "nothing matched" — the distinction is
    // what stops the UI claiming the corpus is empty.
    return {
      ok: true, results: [], emptyReason: "filtered-empty", facets: {},
      diagnostics: [], partial: false, cursor: null, indexState: "ready",
    };
  }

  const diagnostics: SearchProviderDiagnostic[] = [];
  const collected: RankableResult[] = [];
  let anyStale = false;
  let failures = 0;

  for (const provider of applicable) {
    try {
      if (provider.kind === "live" && provider.query) {
        const live = await provider.query(
          {
            text: query.text,
            phrases: query.phrases,
            filters: query.filters,
            projectIds: scopeIds(query, "project"),
            familiarIds: scopeIds(query, "familiar"),
            entityTypes,
            limit,
          },
          request.context,
        );
        diagnostics.push(...live.diagnostics);
        for (const document of live.documents) {
          collected.push({ document, relevance: 0, providerId: provider.id });
        }
      } else {
        const indexed = await deps.readIndexed(provider, query, limit);
        if (indexed.stale) anyStale = true;
        collected.push(...indexed.rows);
      }
    } catch (error) {
      // One provider failing must not take the page down. It becomes a
      // diagnostic and the rest of the results still return.
      failures += 1;
      diagnostics.push({
        providerId: provider.id,
        code: "unavailable",
        message: "provider failed",
      });
    }
  }

  const permitted: RankableResult[] = [];
  let deniedAny = false;
  for (const row of collected) {
    const document = normalizeSearchDocument(row.document);
    if (!document) continue;
    if (!satisfiesHardConstraints(document, query)) continue;
    const provider = applicable.find((candidate) => candidate.id === row.providerId);
    // The second permission check. A provider already ran its own; this one
    // cannot be skipped, and it is what makes a provider bug a missing result
    // rather than a leak.
    if (provider && !provider.permits(document, request.context)) {
      deniedAny = true;
      continue;
    }
    permitted.push({ ...row, document });
  }

  const ranked = dedupeResults(
    rankResults(permitted, {
      text: query.text,
      phrases: query.phrases,
      now,
      formerContextProjectIds: query.scopes
        .filter((scope) => scope.dimension === "project" && scope.implicit)
        .map((scope) => scope.id),
      formerContextFamiliarIds: query.scopes
        .filter((scope) => scope.dimension === "familiar" && scope.implicit)
        .map((scope) => scope.id),
    }),
  );

  const page =
    query.presentation === "top" ? interleaveByType(ranked, limit) : ranked.slice(0, limit);

  let emptyReason: SearchEmptyReason;
  if (page.length > 0) emptyReason = "none";
  else if (deniedAny) emptyReason = "permission-denied";
  else if (query.filters.length > 0 || query.scopes.length > 0) emptyReason = "filtered-empty";
  else emptyReason = "no-matches";

  return {
    ok: true,
    results: page,
    emptyReason,
    facets: facetCounts(ranked),
    diagnostics,
    partial: failures > 0,
    cursor: ranked.length > page.length ? String(page.length) : null,
    indexState: anyStale ? "stale" : "ready",
  };
}
