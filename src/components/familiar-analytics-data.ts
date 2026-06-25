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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json()) as T;
}

async function getOptionalJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return await getJson<T>(url);
  } catch {
    return fallback;
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
    evalLoopJson,
    sessionsJson,
    memoryJson,
    retroJson,
    selfReportsJson,
  ] = await Promise.all([
    getJson<FamiliarsResponse>("/api/familiars"),
    getJson<ContractResponse>(`/api/familiars/${encodedId}/contract`),
    getJson<EvalLoopResponse>(`/api/skills/eval-loop/${encodedId}`),
    getJson<SessionsResponse>("/api/sessions/list"),
    getJson<CovenMemoryResponse>("/api/coven-memory"),
    getJson<RetroApiResponse>("/api/retro-runs"),
    getOptionalJson<SelfReportsResponse>(`/api/familiars/${encodedId}/self-reports?limit=30`, { ok: true, reports: [], total: 0 }),
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
    evalLoopState: evalLoopJson.state ?? null,
    sessions: sessionsJson.sessions ?? [],
    covenEntries: memoryJson.entries ?? [],
    retroSnapshot: retroJson.snapshot ?? EMPTY_SNAPSHOT,
    threadReports: selfReportsJson.ok ? selfReportsJson.reports : [],
    errors,
  };
}

export function buildFamiliarAnalyticsModel(data: FamiliarAnalyticsData): FamiliarAnalyticsModel {
  const familiar = data.familiars.find((item) => item.id === data.familiarId) ?? null;
  const statsByFamiliar = buildFamiliarCardStats({
    familiars: data.familiars,
    sessions: data.sessions,
    covenEntries: data.covenEntries,
  });
  const growthReport = familiar
    ? deriveGrowthReport({
        familiar,
        stats: statsByFamiliar.get(familiar.id) ?? emptyStats(),
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
