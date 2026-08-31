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

import { canonicalEntityTypes, SEARCH_QUERY_VERSION, type SearchQueryState } from "./search-filters.ts";
import { normalizeSearchDocument, type SearchDocument } from "./search-document.ts";
import {
  permitsByProject,
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

// Typed as ReadonlySet<unknown> on purpose: these are membership tests against
// values straight off JSON.parse, so the argument IS unknown at the call site.
// Inferred as Set<string> they do not compile — `.has(unknown)` is an error —
// and narrowing the argument first would just be an extra typeof guard saying
// what `.has` already answers.
const FILTER_OPERATORS: ReadonlySet<unknown> = new Set(["is", "has", "after", "before"]);
const FILTER_ORIGINS: ReadonlySet<unknown> = new Set([
  "syntax",
  "natural-language",
  "picker",
  "context",
]);
const SCOPE_DIMENSIONS: ReadonlySet<unknown> = new Set([
  "project",
  "familiar",
  "room",
  "session",
  "runtime",
]);

/** Hard cap on a first page, per the spec's performance budget. */
export const MAX_PAGE = 50;
const MAX_TEXT = 1024;

export type SearchRequest = {
  query: SearchQueryState;
  context: SearchRequesterContext;
  limit?: number;
  /** Opaque page token returned by the previous response; validated by runSearch. */
  cursor?: string | null;
  now?: number;
  /** Aborts the run. A fired signal stops starting providers and marks the rest timed out. */
  signal?: AbortSignal;
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
  | "permission-denied"
  | "provider-unavailable";

export type SearchOutcome =
  | { ok: false; code: "unsupported-version" | "malformed-query" | "query-too-long" | "malformed-cursor"; message: string }
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
  if (types.length > 0 && !canonicalEntityTypes(types).includes(document.entityType)) return false;

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

/** Canonical diagnostic copy per safe code. Providers may not dictate message text. */
const SAFE_DIAGNOSTIC_MESSAGES: Record<SearchProviderDiagnostic["code"], string> = {
  unavailable: "provider could not be searched",
  timeout: "provider timed out",
  "permission-denied": "permission denied",
  "malformed-source": "provider source could not be read",
};

/**
 * Re-emit a provider diagnostic as id + safe category + canonical copy only.
 *
 * This is the coordinator's second permission boundary, in the same spirit as
 * the document re-check: a provider is trusted to classify its own failure but
 * never to write free-form message text, because that text is how a path or a
 * secret reaches the caller. The code is clamped to the safe set; anything
 * else reads as "unavailable".
 */
export function sanitizeProviderDiagnostic(
  providerId: string,
  code: unknown,
): SearchProviderDiagnostic {
  const safe: SearchProviderDiagnostic["code"] =
    code === "timeout" || code === "permission-denied" || code === "malformed-source"
      ? code
      : "unavailable";
  return { providerId, code: safe, message: SAFE_DIAGNOSTIC_MESSAGES[safe] };
}

export type CoordinatorDependencies = {
  providers: readonly SearchProvider[];
  /** Reads indexed documents. Injected so the coordinator never opens a store. */
  readIndexed: (
    provider: SearchProvider,
    query: SearchQueryState,
    limit: number,
  ) => Promise<{ rows: RankableResult[]; stale: boolean; warming?: boolean }>;
};

const ABORTED = Symbol("search-aborted");

/**
 * Race provider work against the request's abort signal.
 *
 * A fired signal rejects with ABORTED so a hanging provider cannot hold the
 * page hostage past the route's timeout; the coordinator then records the
 * provider as timed out and still returns whatever the other providers found.
 */
function raceAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(ABORTED);
      return;
    }
    const onAbort = () => reject(ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Parse the opaque cursor into an offset into the fully ordered result list.
 * Returns null for anything that is not a non-negative integer, so a garbled
 * cursor fails closed with malformed-cursor rather than silently re-paging.
 */
function parseCursor(cursor: string | null | undefined): number | null {
  if (cursor === null || cursor === undefined) return 0;
  if (!/^\d+$/.test(cursor)) return null;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

export async function runSearch(
  request: SearchRequest,
  deps: CoordinatorDependencies,
): Promise<SearchOutcome> {
  const validated = validateQuery(request.query);
  if (!validated.ok) return validated;
  const query = validated.query;

  const offset = parseCursor(request.cursor);
  if (offset === null) {
    return { ok: false, code: "malformed-cursor", message: "cursor must be a non-negative integer" };
  }

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
  let anyWarming = false;
  let failures = 0;

  for (const provider of applicable) {
    // A fired signal stops the run: remaining providers never start, and each
    // one is reported as timed out so the page still says WHY it is short.
    if (request.signal?.aborted) {
      const remaining = applicable.slice(applicable.indexOf(provider));
      for (const rest of remaining) {
        failures += 1;
        diagnostics.push(sanitizeProviderDiagnostic(rest.id, "timeout"));
      }
      break;
    }
    try {
      if (provider.kind === "live" && provider.query) {
        const live = await raceAbort(
          provider.query(
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
          ),
          request.signal,
        );
        // The coordinator re-emits diagnostics itself: provider ids and safe
        // categories only. A provider's free-form message never reaches the
        // caller, because that message is where a path or a secret would hide.
        for (const diagnostic of live.diagnostics) {
          diagnostics.push(sanitizeProviderDiagnostic(provider.id, diagnostic.code));
        }
        for (const document of live.documents) {
          collected.push({ document, relevance: 0, providerId: provider.id });
        }
      } else {
        const indexed = await raceAbort(
          deps.readIndexed(provider, query, limit),
          request.signal,
        );
        if (indexed.stale) anyStale = true;
        if (indexed.warming) anyWarming = true;
        collected.push(...indexed.rows);
      }
    } catch (error) {
      // One provider failing must not take the page down. It becomes a
      // diagnostic and the rest of the results still return.
      failures += 1;
      diagnostics.push(
        sanitizeProviderDiagnostic(provider.id, request.signal?.aborted ? "timeout" : "unavailable"),
      );
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
    if (!permitsByProject(document, request.context)) {
      deniedAny = true;
      continue;
    }
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

  // The cursor pages over the SAME fully ordered list the first page came from,
  // so page N+1 continues exactly where page N stopped and never re-serves or
  // skips a result. Top mode pages the interleaved order; grouped mode pages
  // the ranked order.
  const ordered =
    query.presentation === "top" ? interleaveByType(ranked, ranked.length) : ranked;
  const page = ordered.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  let emptyReason: SearchEmptyReason;
  if (page.length > 0) emptyReason = "none";
  else if (deniedAny) emptyReason = "permission-denied";
  else if (failures > 0) emptyReason = "provider-unavailable";
  else if (query.filters.length > 0 || query.scopes.length > 0) emptyReason = "filtered-empty";
  else emptyReason = "no-matches";

  return {
    ok: true,
    results: page,
    emptyReason,
    facets: facetCounts(ranked),
    diagnostics,
    partial: failures > 0,
    // Opaque offset token for the NEXT page; null when the list is exhausted.
    cursor: nextOffset < ordered.length ? String(nextOffset) : null,
    indexState: anyWarming ? "warming" : anyStale ? "stale" : "ready",
  };
}
