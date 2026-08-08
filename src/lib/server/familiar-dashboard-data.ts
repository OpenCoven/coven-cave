import { loadBoard } from "@/lib/cave-board";
import { loadInbox } from "@/lib/cave-inbox";
import { loadProjects } from "@/lib/cave-projects";
import type { CaveProject } from "@/lib/cave-projects-types";
import {
  canonicalMemoryList,
  canonicalMemoryOverview,
} from "@/lib/server/canonical-memory-gateway";
import type {
  CanonicalMemoryOverview,
  CanonicalMemorySummary,
} from "@/lib/canonical-memory";
import {
  evaluateFamiliarContract,
  type ContractFiles,
  type ContractReport,
} from "@/lib/familiar-contract";
import {
  buildDashboardSection,
  buildFamiliarAnalyticsDigest,
  deriveDashboardHealRequests,
  buildFamiliarOverview,
  buildFamiliarProfile,
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
  type DashboardSourceResult,
  type FamiliarDashboardIssueCode,
  type FamiliarDashboardResponse,
  type FamiliarDashboardSource,
} from "@/lib/familiar-dashboard";
import type { MessageFeedbackRollup } from "@/lib/message-feedback-rollup";
import {
  listAccessibleProjects,
  type ProjectAccessLevel,
} from "@/lib/project-permissions";
import { enrichFamiliar } from "@/lib/server/familiar-enrichment";
import { readFamiliarContractFiles } from "@/lib/server/familiar-contract-files";
import { loadVisibleFamiliarRoster } from "@/lib/server/familiar-roster";
import {
  listDashboardMetricSnapshots,
  listMetricSnapshots,
  listSelfReports,
} from "@/lib/server/familiar-self-reports";
import { loadMessageFeedbackRollup } from "@/lib/server/message-feedback-store";
import {
  loadRetroRunsSnapshot,
  type RetroRunsSnapshotResult,
} from "@/lib/server/retro-runs-snapshot";
import { computeSessionsList } from "@/lib/server/sessions-list";
import type { SessionsListResult } from "@/lib/server/sessions-list-cache";
import type { Familiar } from "@/lib/types";

export type FamiliarDashboardDependencies = {
  now: () => number;
  loadRoster: typeof loadVisibleFamiliarRoster;
  enrichFamiliar: typeof enrichFamiliar;
  loadBoard: typeof loadBoard;
  loadSessions: (
    includeArchived: boolean,
    familiarId: string | null,
    collapseFamiliarWorkspace: boolean,
  ) => Promise<SessionsListResult>;
  loadInbox: typeof loadInbox;
  loadContract: (id: string) => Promise<{
    files: ContractFiles;
    report: ContractReport;
  }>;
  loadAccess: (id: string) => Promise<{
    projects: { project: CaveProject; access: ProjectAccessLevel }[];
  }>;
  loadMemory: () => Promise<{
    entries: CanonicalMemorySummary[];
    overview: CanonicalMemoryOverview;
  }>;
  loadRetro: (args: { familiarId: string }) => Promise<RetroRunsSnapshotResult>;
  loadReports: (id: string) => ReturnType<typeof listSelfReports>;
  loadMetricSnapshots: (id: string) => ReturnType<typeof listMetricSnapshots>;
  loadFeedback: (args: { familiarId: string }) => Promise<MessageFeedbackRollup>;
};

async function capture<T>(
  source: FamiliarDashboardSource,
  code: FamiliarDashboardIssueCode,
  load: () => Promise<T>,
): Promise<DashboardSourceResult<T>> {
  try {
    return { ok: true, data: await load() };
  } catch {
    return { ok: false, source, code };
  }
}

function sourceData<T>(
  result: DashboardSourceResult<T>,
  fallback: T,
): T {
  return result.ok ? result.data : result.data ?? fallback;
}

export const DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES: FamiliarDashboardDependencies = {
  now: Date.now,
  loadRoster: loadVisibleFamiliarRoster,
  enrichFamiliar,
  loadBoard,
  loadSessions: computeSessionsList,
  loadInbox,
  loadContract: async (id) => {
    const { files } = await readFamiliarContractFiles(id);
    return { files, report: evaluateFamiliarContract(files) };
  },
  loadAccess: async (id) => ({
    projects: await listAccessibleProjects(await loadProjects(), id),
  }),
  loadMemory: async () => {
    const [entries, overview] = await Promise.all([
      canonicalMemoryList(),
      canonicalMemoryOverview(),
    ]);
    return { entries, overview };
  },
  loadRetro: ({ familiarId }) => loadRetroRunsSnapshot({ familiarId }),
  loadReports: (id) =>
    listSelfReports(id, { limit: FAMILIAR_DASHBOARD_LIMITS.reports }),
  loadMetricSnapshots: listDashboardMetricSnapshots,
  loadFeedback: ({ familiarId }) =>
    loadMessageFeedbackRollup({
      familiarId,
      bucketLimit: FAMILIAR_DASHBOARD_LIMITS.feedbackBuckets,
    }),
};

export type FamiliarDashboardLoadResult =
  | { kind: "ok"; response: Extract<FamiliarDashboardResponse, { ok: true }> }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export async function loadFamiliarDashboard(
  familiarId: string,
  dependencies: FamiliarDashboardDependencies = DEFAULT_FAMILIAR_DASHBOARD_DEPENDENCIES,
): Promise<FamiliarDashboardLoadResult> {
  let rosterResult: Awaited<ReturnType<typeof dependencies.loadRoster>>;
  try {
    rosterResult = await dependencies.loadRoster();
  } catch {
    return { kind: "unavailable" };
  }
  if (!rosterResult.ok) return { kind: "unavailable" };

  const rosterEntry = rosterResult.roster.find(
    (familiar) => familiar.id === familiarId,
  );
  if (!rosterEntry) return { kind: "not_found" };

  const now = dependencies.now();
  const generatedAt = new Date(now).toISOString();
  const [
    enrichmentSource,
    boardSource,
    sessionsLoadSource,
    inboxSource,
    contractSource,
    accessSource,
    memorySource,
    retroLoadSource,
    reportsSource,
    snapshotsSource,
    feedbackEntriesSource,
  ] = await Promise.all([
    capture(
      "familiar",
      "familiar_enrichment_unavailable",
      () => dependencies.enrichFamiliar(rosterEntry, rosterResult.config),
    ),
    capture("board", "board_unavailable", dependencies.loadBoard),
    capture(
      "sessions",
      "sessions_unavailable",
      () => dependencies.loadSessions(false, familiarId, false),
    ),
    capture("inbox", "inbox_unavailable", dependencies.loadInbox),
    capture(
      "contract",
      "contract_unavailable",
      () => dependencies.loadContract(familiarId),
    ),
    capture(
      "access",
      "access_unavailable",
      () => dependencies.loadAccess(familiarId),
    ),
    capture("memory", "memory_unavailable", dependencies.loadMemory),
    capture(
      "retro",
      "retro_state_unavailable",
      () => dependencies.loadRetro({ familiarId }),
    ),
    capture(
      "self_reports",
      "self_reports_unavailable",
      () => dependencies.loadReports(familiarId),
    ),
    capture(
      "metric_snapshots",
      "metric_snapshots_unavailable",
      () => dependencies.loadMetricSnapshots(familiarId),
    ),
    capture(
      "feedback",
      "feedback_unavailable",
      () => dependencies.loadFeedback({ familiarId }),
    ),
  ]);

  const sessionsSource: DashboardSourceResult<
    Extract<SessionsListResult["payload"], { ok: true }>["sessions"]
  > = sessionsLoadSource.ok
    ? sessionsLoadSource.data.payload.ok
      ? sessionsLoadSource.data.payload.degraded
        ? {
            ok: false,
            source: "sessions",
            code: "sessions_degraded",
            data: sessionsLoadSource.data.payload.sessions,
          }
        : {
            ok: true,
            data: sessionsLoadSource.data.payload.sessions,
          }
      : {
          ok: false,
          source: "sessions",
          code: "sessions_unavailable",
        }
    : {
        ok: false,
        source: "sessions",
        code: "sessions_unavailable",
      };

  const retroSource: DashboardSourceResult<
    RetroRunsSnapshotResult["snapshot"]
  > = retroLoadSource.ok
    ? retroLoadSource.data.ok
      ? { ok: true, data: retroLoadSource.data.snapshot }
      : {
          ok: false,
          source: "retro",
          code: retroLoadSource.data.code,
          data: retroLoadSource.data.snapshot,
        }
    : {
        ok: false,
        source: "retro",
        code: "retro_state_unavailable",
      };

  const feedbackSource: DashboardSourceResult<MessageFeedbackRollup> = feedbackEntriesSource.ok
    ? {
        ok: true,
        data: feedbackEntriesSource.data,
      }
    : {
        ok: false,
        source: "feedback",
        code: "feedback_unavailable",
      };

  const scopedSessions = sourceData(sessionsSource, [])
    .filter((session) => session.familiarId === familiarId)
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    );
  const metricCutoff =
    now - FAMILIAR_DASHBOARD_LIMITS.metricTrailingDays * 24 * 60 * 60_000;
  const boundedSnapshots = sourceData(
    snapshotsSource,
    { snapshots: [], total: 0 },
  ).snapshots
    .filter((snapshot) => {
      const reportedAt = Date.parse(snapshot.reportedAt);
      return reportedAt >= metricCutoff && reportedAt <= now;
    })
    .sort(
      (left, right) =>
        Date.parse(right.reportedAt) - Date.parse(left.reportedAt),
    )
    .slice(0, FAMILIAR_DASHBOARD_LIMITS.metricSnapshots)
    .sort(
      (left, right) =>
        Date.parse(left.reportedAt) - Date.parse(right.reportedAt),
    );

  const board = sourceData(boardSource, { version: 1, cards: [] });
  const inbox = sourceData(inboxSource, { version: 1, items: [] });
  const contract = contractSource.ok
    ? contractSource.data
    : {
        files: { soul: null, identity: null, ward: null, memory: null },
        report: null,
      };
  const access = sourceData(accessSource, { projects: [] });
  const memory = memorySource.ok
    ? memorySource.data
    : { entries: [], overview: null };
  const retroSnapshot = sourceData(retroSource, {
    generatedAt,
    summary: {
      totalRuns: 0,
      accepted: 0,
      reverted: 0,
      runningFamiliars: 0,
      familiarsWithData: 0,
      trackCounts: { synthesis: 0, prompt: 0, memory: 0 },
      lastRun: null,
    },
    familiars: [],
    runs: [],
  });
  const reports = sourceData(reportsSource, { reports: [], total: 0 });
  const feedback = sourceData(feedbackSource, {
    up: 0,
    down: 0,
    total: 0,
    models: [],
    runtimes: [],
  });
  const familiar: Familiar = enrichmentSource.ok
    ? enrichmentSource.data
    : rosterEntry;
  const overviewRequired = [boardSource, sessionsSource, inboxSource];
  const overviewOptional = [
    contractSource,
    memorySource,
    retroSource,
    reportsSource,
  ];
  const profileRequired = [enrichmentSource, contractSource, accessSource];
  const profileOptional = [memorySource];
  const analyticsRequired = [
    sessionsSource,
    reportsSource,
    snapshotsSource,
    memorySource,
  ];
  const analyticsOptional = [contractSource, retroSource, feedbackSource];
  const overviewAvailable = overviewRequired.some((source) => source.ok);
  const analyticsAvailable = analyticsRequired.some((source) => source.ok);
  const familiarRetroState =
    retroSnapshot.familiars.find(
      (state) => state.familiarId === familiarId,
    ) ?? null;
  const rawHealRequests = deriveDashboardHealRequests({
    familiarId,
    familiar,
    sessions: scopedSessions,
    memories: memory.entries,
    memoryAvailability: memorySource.ok ? "ready" : "unavailable",
    retroState: familiarRetroState,
    contractReport: contract.report,
    now,
  });
  const builtAnalytics = buildFamiliarAnalyticsDigest({
    familiarId,
    familiar,
    sessions: scopedSessions,
    reports: reports.reports,
    reportTotal: reports.total,
    snapshots: boundedSnapshots,
    snapshotTotal: sourceData(
      snapshotsSource,
      { snapshots: [], total: 0 },
    ).total,
    memories: memory.entries,
    memoryAvailability: memorySource.ok ? "ready" : "unavailable",
    retroState: familiarRetroState,
    contractReport: contract.report,
    feedback,
    healRequests: rawHealRequests,
    now,
  });
  const analyticsData = analyticsAvailable ? builtAnalytics : null;
  const overviewData = overviewAvailable
    ? buildFamiliarOverview({
        familiarId,
        familiar,
        tasks: board.cards,
        sessions: scopedSessions,
        reminders: inbox.items,
        healRequests: rawHealRequests,
        now,
      })
    : null;
  const profileData = enrichmentSource.ok
    ? buildFamiliarProfile({
        familiar,
        config: rosterResult.config,
        files: contract.files,
        contractReport: contract.report,
        projects: access.projects,
      })
    : null;
  const overview = buildDashboardSection({
    generatedAt,
    required: overviewRequired,
    optional: overviewOptional,
    data: overviewData,
    empty:
      overviewData !== null &&
      overviewData.tasks.total === 0 &&
      overviewData.sessions.totalNonGenerated === 0 &&
      overviewData.reminders.total === 0 &&
      overviewData.attention.total === 0,
  });
  const profile = buildDashboardSection({
    generatedAt,
    required: profileRequired,
    optional: profileOptional,
    data: profileData,
    empty: false,
  });
  const analytics = buildDashboardSection({
    generatedAt,
    required: analyticsRequired,
    optional: analyticsOptional,
    data: analyticsData,
    empty:
      analyticsData !== null &&
      analyticsData.activity.totalSessions === 0 &&
      analyticsData.confidence.sampleCount === 0 &&
      analyticsData.trends.sampleCount === 0 &&
      analyticsData.memory.count === 0,
  });

  const avatarUrl = familiar.avatarUrl ?? null;
  return {
    kind: "ok",
    response: {
      ok: true,
      version: FAMILIAR_DASHBOARD_VERSION,
      familiarId,
      generatedAt,
      identity: {
        id: familiarId,
        displayName: familiar.display_name,
        role: familiar.role,
        pronouns: familiar.pronouns ?? null,
        avatarUrl,
        avatarRevision: avatarUrl
          ? new URL(avatarUrl, "http://cave.local").searchParams.get("v")
          : null,
        presence: familiar.status ?? null,
        lastSeen: familiar.last_seen ?? null,
        activeSessionCount: familiar.active_sessions ?? null,
      },
      sections: { overview, profile, analytics },
    },
  };
}
