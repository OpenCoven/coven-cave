import { NextResponse } from "next/server.js";
import {
  MAX_RESEARCH_TOPIC_MISSIONS,
  MAX_RESEARCH_TOPIC_SAVED_LINKS,
  MAX_RESEARCH_TOPIC_X_SOURCES,
  MAX_RESEARCH_TOPIC_SESSIONS,
  recommendResearchTopics,
  researchTopicContextRevision,
} from "../../../../lib/research-topic-recommendations.ts";
import type { SavedLink } from "../../../../lib/link-organizer.ts";
import type { ResearchMission } from "../../../../lib/research-missions.ts";
import {
  isValidFamiliarId,
} from "../../../../lib/server/familiar-id.ts";
import {
  listKnowledgeEntries,
  selectKnowledgeForFamiliar,
  type KnowledgeEntry,
} from "../../../../lib/server/knowledge-vault.ts";
import {
  recordAgenticDiagnostic,
  type AgenticDiagnosticInput,
  type AgenticDiagnosticSink,
} from "../../../../lib/agentic-diagnostics.ts";
import { listResearchMissions } from "../../../../lib/server/research-mission-store.ts";
import { listSavedLinks } from "../../../../lib/server/research-links.ts";
import { listSavedXSources, type SavedXSource } from "../../../../lib/server/x-sources.ts";
import { hasXCapability } from "../../../../lib/server/x-access.ts";
import { rejectNonLocalRequest } from "../../../../lib/server/api-security.ts";
import type { SessionRow } from "../../../../lib/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type ResearchRecommendationsRouteDeps = {
  listMissions: () => Promise<readonly ResearchMission[]>;
  listSavedLinks: () => Promise<readonly SavedLink[]>;
  listSavedXSources: (familiarId: string) => Promise<readonly SavedXSource[]>;
  hasXResearchCapability: (familiarId: string) => Promise<boolean>;
  listVaultEntries: (familiarId: string) => Promise<readonly KnowledgeEntry[]>;
  listSessions: (familiarId: string) => Promise<readonly SessionRow[]>;
  diagnostics?: AgenticDiagnosticSink;
};

const productionDeps: ResearchRecommendationsRouteDeps = {
  listMissions: listResearchMissions,
  listSavedLinks,
  listSavedXSources,
  hasXResearchCapability: (familiarId) => hasXCapability(familiarId, "research"),
  listVaultEntries: async (familiarId) => selectKnowledgeForFamiliar(await listKnowledgeEntries(), familiarId),
  listSessions: async (familiarId) => {
    const [{ computeSessionsList }, { sessionsListCache }] = await Promise.all([
      import("../../../../lib/server/sessions-list.ts"),
      import("../../../../lib/server/sessions-list-cache.ts"),
    ]);
    const cacheKey = `research-recommendations:sessions:active:${familiarId}`;
    const result = await sessionsListCache.get(cacheKey, () =>
      computeSessionsList(false, familiarId, false, {
        sweepArchives: false,
        enrichGit: false,
      })
    );
    return result.payload.ok ? result.payload.sessions : [];
  },
};

function recordResearchDiagnostic(
  diagnostics: AgenticDiagnosticSink | undefined,
  input: Omit<AgenticDiagnosticInput, "surface">,
): void {
  const event = recordAgenticDiagnostic({ surface: "research", ...input });
  try {
    diagnostics?.(event);
  } catch {
    // Read-only recommendation responses must not depend on diagnostics.
  }
}

function cancelled(diagnostics?: AgenticDiagnosticSink): NextResponse {
  recordResearchDiagnostic(diagnostics, { code: "cancelled" });
  return NextResponse.json({ ok: false, error: "request cancelled" }, { status: 499 });
}

function bounded<T extends { id: string }>(values: readonly T[], maximum: number): T[] {
  return [...values]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, maximum);
}

function boundedMissions(values: readonly ResearchMission[]): ResearchMission[] {
  return [...values]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_RESEARCH_TOPIC_MISSIONS);
}

function boundedSessions(values: readonly SessionRow[]): SessionRow[] {
  return [...values]
    .filter((session) => !session.generated)
    .sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id)
    )
    .slice(0, MAX_RESEARCH_TOPIC_SESSIONS);
}

/**
 * Authorize before reading. Saved X sources are X-derived data, so they are
 * readable only for a familiar that holds the X research capability — the same
 * fail-closed grant every `/api/x/*` handler gates on, resolved from persisted
 * config and never from the request. Without the grant the read is not issued
 * at all, rather than issued and filtered afterwards.
 *
 * The rest of this route's context — Research Desk missions, saved links and
 * Vault entries — is not X-scoped, so a disabled capability suppresses the X
 * slice instead of failing the whole recommendation read.
 */
async function readSavedXSourcesIfGranted(
  deps: ResearchRecommendationsRouteDeps,
  familiarId: string,
): Promise<readonly SavedXSource[]> {
  if (!await deps.hasXResearchCapability(familiarId)) return [];
  return deps.listSavedXSources(familiarId);
}

async function readVaultWithOneRetry(
  load: (familiarId: string) => Promise<readonly KnowledgeEntry[]>,
  familiarId: string,
  diagnostics?: AgenticDiagnosticSink,
): Promise<{ entries: readonly KnowledgeEntry[]; reducedContext: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const entries = await load(familiarId);
      if (!Array.isArray(entries)) throw new Error("vault response malformed");
      return { entries, reducedContext: false };
    } catch {
      // A transient local Vault read or malformed result gets one bounded retry.
    }
  }
  recordResearchDiagnostic(diagnostics, {
    code: "vault_context_reduced",
    counts: { attempts: 2 },
  });
  return { entries: [], reducedContext: true };
}

/**
 * Read-only route factory with injected loaders so route tests can exercise
 * cancellation, bounded context, and degraded Vault behavior without stores.
 */
export function createResearchRecommendationsRoute(deps: ResearchRecommendationsRouteDeps) {
  return async function GET(req: Request): Promise<NextResponse> {
    const forbidden = rejectNonLocalRequest(req);
    if (forbidden) return forbidden;
    if (req.signal.aborted) return cancelled(deps.diagnostics);

    const params = new URL(req.url).searchParams;
    const familiarId = params.get("familiarId")?.trim() ?? "";
    if (!familiarId) {
      return NextResponse.json({ ok: false, error: "familiarId required" }, { status: 400 });
    }
    if (!isValidFamiliarId(familiarId)) {
      return NextResponse.json({ ok: false, error: "path not allowed" }, { status: 403 });
    }

    const [missions, savedLinks, xSources, vault, sessions] = await Promise.all([
      deps.listMissions(),
      deps.listSavedLinks(),
      readSavedXSourcesIfGranted(deps, familiarId),
      readVaultWithOneRetry(deps.listVaultEntries, familiarId, deps.diagnostics),
      deps.listSessions(familiarId),
    ]);
    if (req.signal.aborted) return cancelled(deps.diagnostics);

    const recommendationContext = {
      familiarId,
      missions: boundedMissions(
        missions.filter((mission) => mission.familiarId === familiarId && mission.status !== "archived"),
      ),
      savedLinks: bounded(savedLinks, MAX_RESEARCH_TOPIC_SAVED_LINKS),
      xSources: bounded(xSources, MAX_RESEARCH_TOPIC_X_SOURCES),
      vaultEntries: vault.entries,
      sessions: boundedSessions(sessions),
      reducedContext: vault.reducedContext,
    };
    const revision = researchTopicContextRevision(recommendationContext);
    const expectedFingerprint = params.get("contextFingerprint")?.trim();
    if (expectedFingerprint && expectedFingerprint !== revision.contextFingerprint) {
      recordResearchDiagnostic(deps.diagnostics, {
        code: "stale_discarded",
        counts: {
          contextItems:
            recommendationContext.missions.length
            + recommendationContext.savedLinks.length
            + recommendationContext.xSources.length
            + recommendationContext.vaultEntries.length
            + recommendationContext.sessions.length,
        },
      });
      return NextResponse.json({
        ok: false,
        error: "stale context",
        contextFingerprint: revision.contextFingerprint,
      }, { status: 409 });
    }
    if (params.get("revision") === "1") {
      return NextResponse.json({ ok: true, ...revision });
    }

    const result = recommendResearchTopics(recommendationContext);

    return NextResponse.json({
      ok: true,
      recommendations: result.recommendations,
      contextFingerprint: result.contextFingerprint,
      reducedContext: result.reducedContext,
      context: result.context,
    });
  };
}

export const GET = createResearchRecommendationsRoute(productionDeps);
