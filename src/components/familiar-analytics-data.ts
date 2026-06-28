import type { EvalLoopState } from "@/components/eval-loop-panel";
import {
  buildFamiliarCardStats,
  type CovenMemoryEntry,
  type FamiliarCardStats,
} from "@/components/familiars-view-stats";
import { deriveConfidenceScore, type ConfidenceScore } from "@/lib/familiar-confidence";
import type { ContractReport } from "@/lib/familiar-contract";
import { deriveGrowthReport, type FamiliarGrowthReport } from "@/lib/familiar-growth-signals";
import { deriveHealRequests, type SelfHealRequest } from "@/lib/familiar-heal-requests";
import type { RetroFamiliarState, RetroRunsSnapshot } from "@/lib/retro-runs";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import type { Familiar, SessionRow } from "@/lib/types";

type FamiliarsResponse =
  | { ok: true; familiars: Familiar[] }
  | { ok: false; familiars?: Familiar[]; error?: string };

type ContractResponse =
  | { ok: true; report: ContractReport }
  | { ok: false; report?: ContractReport; error?: string };

type EvalLoopResponse =
  | { ok: true; state: EvalLoopState | null }
  | { ok: false; state?: EvalLoopState | null; error?: string };

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

export type FamiliarAnalyticsData = {
  familiarId: string;
  familiars: Familiar[];
  contractReport: ContractReport | null;
  evalLoopState: EvalLoopState | null;
  sessions: SessionRow[];
  covenEntries: CovenMemoryEntry[];
  retroSnapshot: RetroRunsSnapshot;
  threadReports: ThreadSelfReport[];
  errors: string[];
};

export type FamiliarAnalyticsModel = {
  familiarId: string;
  familiar: Familiar | null;
  contractReport: ContractReport | null;
  evalLoopState: EvalLoopState | null;
  growthReport: FamiliarGrowthReport | null;
  confidence: ConfidenceScore;
  healRequests: SelfHealRequest[];
  threadReports: ThreadSelfReport[];
  errors: string[];
};

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
    sessionsLast7d: 0,
    hasActiveSession: false,
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
    return (await res.json()) as T;
  } catch (err) {
    return { ...fallback, error: err instanceof Error ? err.message : "request failed" } as T;
  }
}

function retroStateFor(snapshot: RetroRunsSnapshot, familiarId: string): RetroFamiliarState | null {
  return snapshot.familiars.find((state) => state.familiarId === familiarId) ?? null;
}

/**
 * The daemon proxy can hand back either an EvalLoopState directly or a wrapped
 * `{ state: EvalLoopState }` envelope (the live daemon double-wraps). Normalize
 * to the inner state so downstream `iterations`/`track_counts` reads are safe.
 */
function normalizeEvalLoopState(raw: EvalLoopState | null | undefined): EvalLoopState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as EvalLoopState & { state?: EvalLoopState | null };
  if (!Array.isArray(candidate.iterations) && candidate.state && typeof candidate.state === "object") {
    return candidate.state;
  }
  return candidate;
}

function responseError(response: { ok: boolean; error?: string }, fallback: string): string | null {
  return response.ok ? null : response.error ?? fallback;
}

export async function loadFamiliarAnalyticsData(familiarId: string): Promise<FamiliarAnalyticsData> {
  const encodedId = encodeURIComponent(familiarId);
  const [
    familiarsJson,
    contractJson,
    evalLoopJson,
    sessionsJson,
    memoryJson,
    retroJson,
    selfReportsJson,
  ] = await Promise.all([
    fetchResource<FamiliarsResponse>("/api/familiars", { ok: false, familiars: [] }),
    fetchResource<ContractResponse>(`/api/familiars/${encodedId}/contract`, { ok: false }),
    fetchResource<EvalLoopResponse>(`/api/skills/eval-loop/${encodedId}`, { ok: false, state: null }),
    fetchResource<SessionsResponse>("/api/sessions/list", { ok: false, sessions: [] }),
    fetchResource<CovenMemoryResponse>("/api/coven-memory", { ok: false, entries: [] }),
    fetchResource<RetroApiResponse>("/api/retro-runs", { ok: false }),
    fetchResource<SelfReportsResponse>(`/api/familiars/${encodedId}/self-reports?limit=30`, { ok: false, reports: [], total: 0 }),
  ]);

  const errors = [
    responseError(familiarsJson, "familiars unavailable"),
    responseError(contractJson, "contract unavailable"),
    responseError(evalLoopJson, "eval-loop unavailable"),
    responseError(sessionsJson, "sessions unavailable"),
    responseError(memoryJson, "memory unavailable"),
    responseError(retroJson, "retro runs unavailable"),
  ].filter((error): error is string => Boolean(error));

  return {
    familiarId,
    familiars: familiarsJson.familiars ?? [],
    contractReport: contractJson.report ?? null,
    evalLoopState: normalizeEvalLoopState(evalLoopJson.state),
    sessions: sessionsJson.sessions ?? [],
    covenEntries: memoryJson.entries ?? [],
    retroSnapshot: retroJson.snapshot ?? EMPTY_SNAPSHOT,
    threadReports: selfReportsJson.ok ? selfReportsJson.reports : [],
    errors,
  };
}

export function buildFamiliarAnalyticsModel(data: FamiliarAnalyticsData): FamiliarAnalyticsModel {
  const familiar = data.familiars.find((item) => item.id === data.familiarId) ?? null;
  // Scope the stats computation to the single familiar this view renders rather
  // than bucketing every familiar's sessions/memory just to read one entry.
  const stats = familiar
    ? buildFamiliarCardStats({
        familiars: [familiar],
        sessions: data.sessions.filter((session) => session.familiarId === familiar.id),
        covenEntries: data.covenEntries.filter((entry) => entry.familiar_id === familiar.id),
      }).get(familiar.id) ?? emptyStats()
    : emptyStats();
  const growthReport = familiar
    ? deriveGrowthReport({
        familiar,
        stats,
        retroState: retroStateFor(data.retroSnapshot, familiar.id),
      })
    : null;
  const confidence = deriveConfidenceScore({
    contractReport: data.contractReport,
    growthReport,
    familiar,
  });
  const healRequests = deriveHealRequests({
    familiarId: data.familiarId,
    evalLoopState: data.evalLoopState,
    contractReport: data.contractReport,
    growthReport,
  });

  return {
    familiarId: data.familiarId,
    familiar,
    contractReport: data.contractReport,
    evalLoopState: data.evalLoopState,
    growthReport,
    confidence,
    healRequests,
    threadReports: data.threadReports,
    errors: data.errors,
  };
}
