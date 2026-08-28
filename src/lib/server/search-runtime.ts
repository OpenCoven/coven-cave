/**
 * search-runtime — the real provider registry and index reader behind
 * POST /api/search (cave-ychtl.6).
 *
 * Units 3/3b built the provider factories and the store; this is where they
 * are wired to real sources and the route stops answering with an empty
 * provider set. The route's own comment named this step: "unit 6 wires the
 * real registry and the index reader."
 *
 * Two deliberate boundaries:
 *
 *   - PROVIDERS ARE BUILT PER REQUEST. The live file provider must know the
 *     query's project scope before it exists, and holding request state in a
 *     module singleton would race. Building the (cheap) provider list per
 *     request is race-free; the expensive parts — the FTS5 index file — stay
 *     in a lazy per-process singleton that refreshes only when a provider
 *     fingerprint moves.
 *   - THE COMPATIBILITY PROVIDER IS NOT REGISTERED HERE. Its corpora
 *     (commands, destinations, settings, memories) are client-warm palette
 *     data, and the palette itself still serves them — the spec's rule that a
 *     deferred provider must not cost the user a feature. Permanent adapters
 *     do not yet cover those corpora, so retirement (unit 7) is not due; the
 *     factories remain available for the client surface and tests.
 *
 * Permissions: allowed project ids are resolved from the saved project store
 * (the server authority) and re-applied by the coordinator. The familiar id
 * may come from the request but is never treated as authority — it only
 * narrows familiar-scoped rows.
 *
 * Spec: docs/superpowers/specs/2026-08-03-global-intelligent-search-design.md
 */

import { loadProjects, type CaveProject } from "@/lib/cave-projects";
import { loadBoard } from "@/lib/cave-board";
import { listConversations, type ConversationSummary } from "@/lib/cave-conversations";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import { daemonSessionRoots } from "@/lib/server/session-project-roots";
import {
  createCompatibilityProvider,
  createFamiliarsProvider,
  createProjectsProvider,
  createSessionsProvider,
  createTasksProvider,
  type CompatibilityRow,
} from "@/lib/search-indexed-providers";
import { createFileSearchProvider } from "@/lib/search-file-provider";
import { openSearchIndex, type SearchIndex, type SearchIndexQuery } from "@/lib/search-index-store";
import type { SearchProvider, SearchRequesterContext } from "@/lib/search-provider";
import { canonicalEntityTypes, type SearchQueryState } from "@/lib/search-filters";
import type { RankableResult } from "@/lib/search-ranking";
import { SLASH_COMMANDS } from "@/lib/slash-commands";
import { paletteDestinations } from "@/lib/workspace-destination-policy";
import { SETTINGS_INDEX } from "@/components/settings-sections";

export type ServerSearchSetup = {
  providers: SearchProvider[];
  requesterContext: SearchRequesterContext;
  readIndexed: (
    provider: SearchProvider,
    query: SearchQueryState,
    limit: number,
  ) => Promise<{ rows: RankableResult[]; stale: boolean }>;
};

/** Loaders, injectable so tests drive the registry without a live cave. */
export type SearchRuntimeLoaders = {
  loadProjects?: () => Promise<CaveProject[]>;
  loadCards?: () => Promise<Awaited<ReturnType<typeof loadBoard>>["cards"]>;
  listConversations?: () => Promise<ConversationSummary[]>;
  listFamiliars?: () => Promise<
    { id: string; display_name?: string | null; name?: string | null; description?: string | null }[]
  >;
  sessionRoots?: () => Promise<string[]>;
  /** Injectable ripgrep runner for the file provider (tests). */
  runFileSearch?: (cwd: string, args: string[]) => Promise<{ stdout: string; code: number }>;
};

const scopeIds = (query: SearchQueryState, dimension: string): string[] =>
  query.scopes.filter((scope) => scope.dimension === dimension).map((scope) => scope.id);

const filterValues = (query: SearchQueryState, key: string): string[] =>
  query.filters.filter((filter) => filter.key === key).map((filter) => String(filter.value));

function compatibilityRows(): CompatibilityRow[] {
  const rows: CompatibilityRow[] = [];
  for (const command of SLASH_COMMANDS) {
    rows.push({
      id: command.name,
      kind: "command",
      title: command.name,
      body: [command.hint, command.description].filter(Boolean).join(" "),
    });
  }
  for (const destination of paletteDestinations()) {
    rows.push({
      id: destination.id,
      kind: "destination",
      title: destination.title,
      body: [destination.description, destination.kbd ?? ""].filter(Boolean).join(" "),
    });
  }
  for (const setting of SETTINGS_INDEX) {
    rows.push({
      id: setting.section + ":" + (setting.group ?? "general"),
      kind: "setting",
      title: setting.section + (setting.group ? " › " + setting.group : ""),
      body: setting.keywords,
    });
  }
  return rows;
}

/**
 * Build the provider registry and requester context for one search request.
 *
 * The file provider is scoped to the query's first project scope — the spec's
 * "current-project files" boundary. No project scope means no file corpus,
 * which is not an error: a file result cannot exist without a project to
 * search.
 */
export async function createServerSearchSetup(
  query: SearchQueryState,
  input: { familiarId?: string | null; familiarIds?: string[] | null } = {},
  loaders: SearchRuntimeLoaders = {},
): Promise<ServerSearchSetup> {
  const loadProjectList = loaders.loadProjects ?? loadProjects;
  const loadCardList = loaders.loadCards ?? (async () => (await loadBoard()).cards);
  const loadConversations = loaders.listConversations ?? listConversations;
  const loadRoster = loaders.listFamiliars ?? (async () => {
    const result = await loadVisibleFamiliarRoster();
    return result.ok ? result.roster : [];
  });
  const readSessionRoots = loaders.sessionRoots ?? daemonSessionRoots;

  const projects = await loadProjectList();
  const allowedProjectIds = projects.map((project) => project.id);
  const requesterContext: SearchRequesterContext = {
    allowedProjectIds,
    allowedProjectRoots: null,
    familiarId: input.familiarId ?? null,
    ...(input.familiarIds !== undefined ? { familiarIds: input.familiarIds } : {}),
  };

  // The file provider needs the roots resolved BEFORE the coordinator asks,
  // because its closures are fixed at creation. Resolving them once per
  // request is the same cost the project-search route already pays.
  const sessionRoots = await readSessionRoots();
  const scopedProjectId = scopeIds(query, "project")[0];
  const scopedProject = scopedProjectId
    ? projects.find((project) => project.id === scopedProjectId)
    : null;

  const providers: SearchProvider[] = [
    createProjectsProvider({ loadProjects: loadProjectList }),
    createTasksProvider({ loadCards: loadCardList }),
    createSessionsProvider({ listConversations: loadConversations }),
    createFamiliarsProvider({ listFamiliars: loadRoster }),
    createCompatibilityProvider({ loadRows: async () => compatibilityRows() }),
    createFileSearchProvider({
      activeProjectRoot: () => scopedProject?.root ?? null,
      activeProjectId: () => scopedProject?.id ?? null,
      sessionRoots: () => sessionRoots,
      ...(loaders.runFileSearch ? { runSearch: loaders.runFileSearch } : {}),
    }),
  ];

  const readIndexed = async (
    provider: SearchProvider,
    currentQuery: SearchQueryState,
    limit: number,
  ): Promise<{ rows: RankableResult[]; stale: boolean }> => {
    const index = await getServerSearchIndex();
    const fingerprint = await provider.fingerprint();
    // The provider's collect is async; the store's refresh takes a sync
    // iterable. Await the corpus first, then hand it over — passing the
    // promise itself would make refreshProvider throw "not iterable" and
    // every provider would come back stale.
    const documents = provider.collect ? await provider.collect(requesterContext) : [];
    const refresh = index.refreshProvider(provider.id, fingerprint, () => documents);
    const storeQuery: SearchIndexQuery = {
      text: currentQuery.text,
      phrases: currentQuery.phrases,
      entityTypes: canonicalEntityTypes(filterValues(currentQuery, "type")),
      projectIds: [...scopeIds(currentQuery, "project"), ...filterValues(currentQuery, "project")],
      familiarIds: [...scopeIds(currentQuery, "familiar"), ...filterValues(currentQuery, "familiar")],
      statuses: filterValues(currentQuery, "status"),
      providerIds: [provider.id],
      limit,
    };
    const rows = index.match(storeQuery).map((row) => ({
      document: row.document,
      relevance: row.relevance,
      providerId: provider.id,
      stale: row.stale,
    }));
    return { rows, stale: refresh.stale };
  };

  return { providers, requesterContext, readIndexed };
}

/* ---------------------------------------------------------------------- */
/* Lazy per-process index singleton                                       */
/* ---------------------------------------------------------------------- */

let indexPromise: Promise<SearchIndex> | null = null;

/** Open (once) the derivative FTS5 index. Callers that need isolation reset it. */
export function getServerSearchIndex(): Promise<SearchIndex> {
  if (!indexPromise) {
    indexPromise = openSearchIndex().catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

/** Test-only: drop the singleton so a fresh (or temp-path) index is opened. */
export async function resetServerSearchIndexForTests(): Promise<void> {
  if (indexPromise) {
    const index = await indexPromise;
    index.close();
  }
  indexPromise = null;
}

