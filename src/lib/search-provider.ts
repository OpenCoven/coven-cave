/**
 * search-provider — the contract every search corpus implements, and the
 * registry the coordinator selects from (cave-ychtl.3).
 *
 * A provider does four things and no more: report a fingerprint for its
 * source, emit normalized documents, declare which filters it can honor, and
 * decide whether a given requester may see a document. It never ranks, never
 * decides presentation, and never reaches past its own source. Ranking and the
 * second permission check belong to the coordinator (unit 4) — a provider that
 * pre-ranks makes cross-corpus comparison impossible, which is the entire
 * reason the normalized document exists.
 *
 * Two kinds exist, and the difference is not cosmetic:
 *
 *   - INDEXED providers are collected into the FTS5 store ahead of a query.
 *     They are bounded corpora whose whole content can sit in a local index.
 *   - LIVE providers are queried at request time and never indexed. Project
 *     file bodies are the motivating case: indexing every repository would
 *     duplicate potentially huge workspaces and add watcher and staleness
 *     problems the design explicitly rejects.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 * Plan: docs/superpowers/plans/2026-08-09-global-intelligent-search-implementation.md
 */

import type { SearchDocument } from "./search-document.ts";
import { filterAppliesToEntity, filterDefinition, type SearchFilter } from "./search-filters.ts";

/**
 * What the caller is allowed to see, resolved before any provider runs.
 *
 * Passed IN rather than discovered by each provider, so one provider cannot
 * quietly widen its own scope, and so the coordinator can re-apply the same
 * context after ranking.
 */
export type SearchRequesterContext = {
  /** Project ids the requester may read. `null` means unrestricted. */
  allowedProjectIds: string[] | null;
  /** Absolute project roots the requester may read. `null` means unrestricted. */
  allowedProjectRoots: string[] | null;
  /** The active familiar, when a surface has one. */
  familiarId: string | null;
};

export type SearchProviderQuery = {
  text: string;
  phrases: string[];
  filters: SearchFilter[];
  /** Hard scopes already resolved to ids by the coordinator. */
  projectIds: string[];
  familiarIds: string[];
  entityTypes: string[];
  limit: number;
};

export type SearchProviderDiagnostic = {
  providerId: string;
  /** Safe category, never a raw error or a path. */
  code: "unavailable" | "timeout" | "permission-denied" | "malformed-source";
  message: string;
};

export type SearchProvider = {
  id: string;
  /** Entity types this provider can emit. Drives selection and filtered-empty. */
  entityTypes: string[];
  /** Filter keys this provider can honor. Others make it inapplicable. */
  supportedFilters: string[];
  kind: "indexed" | "live";
  /**
   * Cheap signature of the source. Equal fingerprints let a refresh skip the
   * corpus entirely, so this must change whenever any document would.
   */
  fingerprint(): Promise<string>;
  /** Indexed providers only: the full corpus, normalized. */
  collect?(context: SearchRequesterContext): Promise<unknown[]>;
  /** Live providers only: answer this query directly. */
  query?(
    query: SearchProviderQuery,
    context: SearchRequesterContext,
  ): Promise<{ documents: SearchDocument[]; diagnostics: SearchProviderDiagnostic[] }>;
  /**
   * Whether this requester may see this document.
   *
   * Applied by the provider AND again by the coordinator. The duplication is
   * deliberate: a provider is the only thing that understands its own
   * permission model, and the coordinator is the only thing that cannot be
   * skipped.
   */
  permits(document: SearchDocument, context: SearchRequesterContext): boolean;
};

/**
 * Whether a provider can honor every filter in a query.
 *
 * A provider that cannot honor a filter must be EXCLUDED rather than allowed
 * to ignore it. Ignoring a filter is how a search for `status:blocked` starts
 * returning projects, which have no status — the spec calls that silently
 * widening, and requires a truthful filtered-empty state instead.
 */
export function providerHonorsQuery(
  provider: SearchProvider,
  query: Pick<SearchProviderQuery, "filters" | "entityTypes">,
): boolean {
  if (query.entityTypes.length > 0) {
    const overlap = query.entityTypes.some((type) => provider.entityTypes.includes(type));
    if (!overlap) return false;
  }
  for (const filter of query.filters) {
    if (!provider.supportedFilters.includes(filter.key)) return false;
    const definition = filterDefinition(filter.key);
    if (!definition) continue;
    // The filter must also apply to at least one entity type this provider
    // emits, or honoring it is vacuous.
    const applicable = provider.entityTypes.some((type) =>
      filterAppliesToEntity(definition, type),
    );
    if (!applicable) return false;
  }
  return true;
}

/** Providers applicable to a query, in registration order. */
export function selectProviders(
  providers: readonly SearchProvider[],
  query: Pick<SearchProviderQuery, "filters" | "entityTypes">,
): SearchProvider[] {
  return providers.filter((provider) => providerHonorsQuery(provider, query));
}

/**
 * Default permission check: a document is visible when the requester may read
 * its project, and when a familiar-scoped document belongs to the active
 * familiar.
 *
 * Fails CLOSED on an unknown project — a document naming a project the caller
 * has no entry for is hidden rather than shown, because the alternative leaks
 * the existence of projects the requester cannot open.
 */
export function permitsByProject(
  document: SearchDocument,
  context: SearchRequesterContext,
): boolean {
  if (context.allowedProjectIds !== null && document.projectId !== null) {
    if (!context.allowedProjectIds.includes(document.projectId)) return false;
  }
  if (context.allowedProjectRoots !== null && document.projectRoot !== null) {
    if (!context.allowedProjectRoots.includes(document.projectRoot)) return false;
  }
  for (const permission of document.permissions) {
    if (permission.kind === "project") {
      if (context.allowedProjectIds !== null && !context.allowedProjectIds.includes(permission.id)) {
        return false;
      }
    }
    if (permission.kind === "familiar") {
      if (context.familiarId !== null && context.familiarId !== permission.id) return false;
    }
  }
  return true;
}

export function createProviderRegistry(providers: readonly SearchProvider[]) {
  const ids = providers.map((provider) => provider.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) {
    // Two providers sharing an id would collide on `providerId + docId` in the
    // index, so one would silently overwrite the other's documents.
    throw new Error(`duplicate search provider id: ${duplicate}`);
  }
  return {
    all: () => [...providers],
    byId: (id: string) => providers.find((provider) => provider.id === id) ?? null,
    select: (query: Pick<SearchProviderQuery, "filters" | "entityTypes">) =>
      selectProviders(providers, query),
    indexed: () => providers.filter((provider) => provider.kind === "indexed"),
    live: () => providers.filter((provider) => provider.kind === "live"),
  };
}
