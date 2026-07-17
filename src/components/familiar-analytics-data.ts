import {
  ACTIVITY_DAYS,
  buildFamiliarCardStats,
  type CovenMemoryEntry,
  type FamiliarCardStats,
} from "@/components/familiars-view-stats";
import { deriveThreadConfidence, type ThreadConfidence } from "@/lib/thread-confidence";
import { deriveSignalTrends, type SignalTrends, type ThreadMetricSnapshot } from "@/lib/signal-trends";
import type { ContractReport } from "@/lib/familiar-contract";
import { deriveGrowthReport, type FamiliarGrowthReport } from "@/lib/familiar-growth-signals";
import { deriveHealRequests, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { RetroFamiliarState, RetroRunsSnapshot } from "@/lib/retro-runs";
import { buildSessionPulse, type PulseDay } from "@/lib/session-pulse";
import {
  type ThreadSelfReport,
} from "@/lib/thread-self-report";
import {
  EMPTY_FEEDBACK_ROLLUP,
  type MessageFeedbackRollup,
} from "@/lib/message-feedback-rollup";
import type { Familiar, SessionRow } from "@/lib/types";

type FamiliarsResponse =
  | { ok: true; familiars: Familiar[] }
  | { ok: false; familiars?: Familiar[]; error?: string };

type ContractResponse =
  | { ok: true; report: ContractReport }
  | { ok: false; report?: ContractReport; error?: string };

type SessionsResponse =
  | { ok: true; sessions: SessionRow[] }
  | { ok: false; sessions?: SessionRow[]; error?: string };

type CovenMemoryResponse =
  | { ok: true; entries: CovenMemoryEntry[] }
  | { ok: false; entries?: CovenMemoryEntry[]; error?: string };

type RetroApiResponse =
  | { ok: true; snapshot: RetroRunsSnapshot }
  | { ok: false; snapshot?: RetroRunsSnapshot; error?: string };

type SelfReportsResponse =
  | { ok: true; reports: ThreadSelfReport[]; total: number }
  | { ok: false; reports?: ThreadSelfReport[]; total?: number; error?: string };

type MetricSnapshotsResponse =
  | { ok: true; snapshots: ThreadMetricSnapshot[]; total: number }
  | { ok: false; snapshots?: ThreadMetricSnapshot[]; total?: number; error?: string };

type MessageFeedbackResponse =
  | { ok: true; rollup: MessageFeedbackRollup }
  | { ok: false; rollup?: MessageFeedbackRollup; error?: string };

export type FamiliarAnalyticsData = {
  familiarId: string;
  familiars: Familiar[];
  contractReport: ContractReport | null;
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  retroSnapshot: RetroRunsSnapshot;
  threadReports: ThreadSelfReport[];
  /** Compact per-thread metric snapshots, oldest → newest (signal trends). */
  metricSnapshots: ThreadMetricSnapshot[];
  /** Thumbs-vote aggregates by model/runtime (message-feedback-rollup). */
  modelFeedback: MessageFeedbackRollup;
  errors: string[];
};

export type FamiliarAnalyticsModel = {
  familiarId: string;
  familiar: Familiar | null;
  contractReport: ContractReport | null;
  growthReport: FamiliarGrowthReport | null;
  /** Headline confidence, derived from real thread self-reports. */
  confidence: ThreadConfidence;
  /** Metric changes over time — "is the familiar improving?" */
  signalTrends: SignalTrends;
  healRequests: SelfHealRequest[];
  threadReports: ThreadSelfReport[];
  /** Thumbs-vote aggregates by model/runtime (message-feedback-rollup). */
  modelFeedback: MessageFeedbackRollup;
  /** Per-day session counts for the trailing 14 days (oldest first). */
  sessionPulse: PulseDay[];
  /** This familiar's sessions, newest first, capped for the drill-through list. */
  recentSessions: SessionRow[];
  errors: string[];
};

/** Cap on the drill-through session list — enough history to trace without
 *  turning the analytics page into a full session browser. */
const RECENT_SESSIONS_CAP = 40;

const EMPTY_SNAPSHOT: RetroRunsSnapshot = {
  generatedAt: new Date(0).toISOString(),
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
};

function emptyStats(): FamiliarCardStats {
  return {
    memoryCount: 0,
    latestMemory: null,
    lastSessionAt: null,
    sessionsTotal: 0,
    sessionsLast7d: 0,
    hasActiveSession: false,
    streakDays: 0,
    activity: new Array<number>(ACTIVITY_DAYS).fill(0),
  };
}

type ApiEnvelope = { ok: boolean; error?: string };

/**
 * Fetch a single analytics endpoint without ever rejecting. A non-2xx response
 * or a network/parse error degrades to `fallback` (which carries `ok: false`)
 * so one failing endpoint surfaces in the `errors` banner instead of blanking
 * the whole view.
 */
async function fetchResource<T extends ApiEnvelope>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return { ...fallback, error: `HTTP ${res.status}` } as T;
    }
    // A null/undefined body degrades like a failed endpoint, not a crash.
    return ((await res.json()) ?? { ...fallback, error: "empty response" }) as T;
  } catch (err) {
    return { ...fallback, error: err instanceof Error ? err.message : "request failed" } as T;
  }
}

function retroStateFor(snapshot: RetroRunsSnapshot, familiarId: string): RetroFamiliarState | null {
  return snapshot.familiars.find((state) => state.familiarId === familiarId) ?? null;
}

function responseError(response: { ok: boolean; error?: string }, fallback: string): string | null {
  return response.ok ? null : response.error ?? fallback;
}

export async function loadFamiliarAnalyticsData(familiarId: string): Promise<FamiliarAnalyticsData> {
  const encodedId = encodeURIComponent(familiarId);
  const [
    familiarsJson,
    contractJson,
    sessionsJson,
    memoryJson,
    retroJson,
    selfReportsJson,
    metricSnapshotsJson,
    feedbackJson,
  ] = await Promise.all([
    fetchResource<FamiliarsResponse>("/api/familiars", { ok: false, familiars: [] }),
    fetchResource<ContractResponse>(`/api/familiars/${encodedId}/contract`, { ok: false }),
    fetchResource<SessionsResponse>("/api/sessions/list", { ok: false, sessions: [] }),
    fetchResource<CovenMemoryResponse>("/api/coven-memory", { ok: false, entries: [] }),
    fetchResource<RetroApiResponse>("/api/retro-runs", { ok: false }),
    fetchResource<SelfReportsResponse>(`/api/familiars/${encodedId}/self-reports?limit=30`, { ok: false, reports: [], total: 0 }),
    fetchResource<MetricSnapshotsResponse>(`/api/familiars/${encodedId}/self-reports/snapshots`, { ok: false, snapshots: [], total: 0 }),
    fetchResource<MessageFeedbackResponse>(`/api/feedback/message?familiarId=${encodedId}`, { ok: false }),
  ]);

  const errors = [
    responseError(familiarsJson, "familiars unavailable"),
    responseError(contractJson, "contract unavailable"),
    responseError(sessionsJson, "sessions unavailable"),
    responseError(memoryJson, "memory unavailable"),
    responseError(retroJson, "retro runs unavailable"),
    responseError(metricSnapshotsJson, "metric snapshots unavailable"),
    responseError(feedbackJson, "message feedback unavailable"),
  ].filter((error): error is string => Boolean(error));

  return {
    familiarId,
    familiars: familiarsJson.familiars ?? [],
    contractReport: contractJson.report ?? null,
    sessions: sessionsJson.sessions ?? [],
    covenEntries: memoryJson.entries ?? [],
    retroSnapshot: retroJson.snapshot ?? EMPTY_SNAPSHOT,
    threadReports: selfReportsJson.ok ? selfReportsJson.reports : [],
    metricSnapshots: metricSnapshotsJson.ok ? metricSnapshotsJson.snapshots : [],
    modelFeedback: feedbackJson.ok ? feedbackJson.rollup : EMPTY_FEEDBACK_ROLLUP,
    errors,
  };
}

export function buildFamiliarAnalyticsModel(
  data: FamiliarAnalyticsData,
  now: number = Date.now(),
): FamiliarAnalyticsModel {
  const familiar = data.familiars.find((item) => item.id === data.familiarId) ?? null;
  const familiarSessions = data.sessions.filter((session) => session.familiarId === data.familiarId);
  // Scope the stats computation to the single familiar this view renders rather
  // than bucketing every familiar's sessions/memory just to read one entry.
  const stats = familiar
    ? buildFamiliarCardStats({
        familiars: [familiar],
        sessions: familiarSessions,
        covenEntries: data.covenEntries.filter((entry) => entry.familiar_id === familiar.id),
      }).get(familiar.id) ?? emptyStats()
    : emptyStats();
  const growthReport = familiar
    ? deriveGrowthReport({
        familiar,
        stats,
        retroState: retroStateFor(data.retroSnapshot, familiar.id),
        now,
      })
    : null;
  const confidence = deriveThreadConfidence(data.threadReports);
  const signalTrends = deriveSignalTrends(data.metricSnapshots, now);
  const healRequests = deriveHealRequests({
    familiarId: data.familiarId,
    contractReport: data.contractReport,
    growthReport,
  });

  return {
    familiarId: data.familiarId,
    familiar,
    contractReport: data.contractReport,
    growthReport,
    confidence,
    signalTrends,
    healRequests,
    threadReports: data.threadReports,
    modelFeedback: data.modelFeedback,
    sessionPulse: buildSessionPulse(familiarSessions, data.familiarId, now),
    recentSessions: [...familiarSessions]
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      .slice(0, RECENT_SESSIONS_CAP),
    errors: data.errors,
  };
}
