import { redactSecretsDeep } from "./secret-redaction.ts";

export type RetroTrack = "synthesis" | "prompt" | "memory";
export type RetroOutcome = "ACCEPT" | "REVERT";

export type RetroFamiliarInput = {
  id: string;
  displayName: string;
  role?: string;
};

export type RetroRun = {
  id: string;
  familiarId: string;
  familiarName: string;
  familiarRole?: string;
  iterationId: string;
  iteration: number;
  timestamp: string;
  track: RetroTrack;
  outcome: RetroOutcome;
  changeSummary: string;
  metricBefore: number;
  metricAfter: number;
  delta: number;
  notes?: string;
  raw: unknown;
};

export type RetroFamiliarState = {
  familiarId: string;
  familiarName: string;
  familiarRole?: string;
  lastRun: string | null;
  running: boolean;
  trackCounts: Record<RetroTrack, number>;
  totalAccepted: number;
  totalReverted: number;
  runs: RetroRun[];
  raw: unknown;
};

export type RetroRunsSnapshot = {
  generatedAt: string;
  summary: {
    totalRuns: number;
    accepted: number;
    reverted: number;
    runningFamiliars: number;
    familiarsWithData: number;
    trackCounts: Record<RetroTrack, number>;
    lastRun: string | null;
  };
  familiars: RetroFamiliarState[];
  runs: RetroRun[];
};

const TRACKS: RetroTrack[] = ["synthesis", "prompt", "memory"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asTrack(value: unknown): RetroTrack {
  return TRACKS.includes(value as RetroTrack) ? (value as RetroTrack) : "synthesis";
}

function asOutcome(value: unknown): RetroOutcome {
  return value === "REVERT" ? "REVERT" : "ACCEPT";
}

function emptyTrackCounts(): Record<RetroTrack, number> {
  return { synthesis: 0, prompt: 0, memory: 0 };
}

function normalizeTrackCounts(value: unknown): Record<RetroTrack, number> {
  const record = asRecord(value);
  return {
    synthesis: asNumber(record.synthesis),
    prompt: asNumber(record.prompt),
    memory: asNumber(record.memory),
  };
}

export function normalizeRetroRunState({
  familiar,
  state,
}: {
  familiar: RetroFamiliarInput;
  state: unknown;
}): RetroFamiliarState {
  const safeState = redactSecretsDeep(state);
  const record = asRecord(safeState);
  const iterations = Array.isArray(record.iterations) ? record.iterations : [];

  const runs = iterations.map((rawIteration, index): RetroRun => {
    const iteration = asRecord(rawIteration);
    const iterationId = asString(iteration.id, `${index + 1}`);
    const track = asTrack(iteration.track);
    const timestamp = asString(iteration.timestamp, asString(record.last_run, ""));
    const metricBefore = asNumber(iteration.metric_before);
    const metricAfter = asNumber(iteration.metric_after);
    const delta = asNumber(iteration.delta, metricAfter - metricBefore);
    return {
      id: `${familiar.id}:${iterationId}`,
      familiarId: familiar.id,
      familiarName: redactSecretsDeep(familiar.displayName),
      familiarRole: familiar.role ? redactSecretsDeep(familiar.role) : undefined,
      iterationId,
      iteration: asNumber(iteration.iteration, index + 1),
      timestamp,
      track,
      outcome: asOutcome(iteration.outcome),
      changeSummary: asString(iteration.change_summary, "Iteration recorded"),
      metricBefore,
      metricAfter,
      delta,
      notes: typeof iteration.notes === "string" ? iteration.notes : undefined,
      raw: rawIteration,
    };
  });

  const fallbackCounts = emptyTrackCounts();
  for (const run of runs) fallbackCounts[run.track] += 1;

  const declaredCounts = normalizeTrackCounts(record.track_counts);
  const trackCounts = TRACKS.some((track) => declaredCounts[track] > 0)
    ? declaredCounts
    : fallbackCounts;

  return {
    familiarId: familiar.id,
    familiarName: redactSecretsDeep(familiar.displayName),
    familiarRole: familiar.role ? redactSecretsDeep(familiar.role) : undefined,
    lastRun: typeof record.last_run === "string" ? record.last_run : null,
    running: asBool(record.running),
    trackCounts,
    totalAccepted: asNumber(record.total_accepted, runs.filter((run) => run.outcome === "ACCEPT").length),
    totalReverted: asNumber(record.total_reverted, runs.filter((run) => run.outcome === "REVERT").length),
    runs,
    raw: safeState,
  };
}

export function buildRetroRunsSnapshot(familiars: RetroFamiliarState[]): RetroRunsSnapshot {
  const runs = familiars
    .flatMap((familiar) => familiar.runs)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const trackCounts = emptyTrackCounts();
  for (const run of runs) trackCounts[run.track] += 1;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalRuns: runs.length,
      accepted: runs.filter((run) => run.outcome === "ACCEPT").length,
      reverted: runs.filter((run) => run.outcome === "REVERT").length,
      runningFamiliars: familiars.filter((familiar) => familiar.running).length,
      familiarsWithData: familiars.filter((familiar) => familiar.runs.length > 0).length,
      trackCounts,
      lastRun: runs[0]?.timestamp ?? null,
    },
    familiars,
    runs,
  };
}
