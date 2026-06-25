export type ContextPressure = "adequate" | "tight" | "excess" | "critical";
export type CapabilityState = "available" | "degraded" | "missing";
export type BlockerCategory = "auth" | "tooling" | "permission" | "infra" | "context" | "skill" | "other";
export type BlockerImpact = "low" | "medium" | "high" | "blocking";
export type CapabilityImportance = "nice-to-have" | "important" | "blocking";

export type ThreadSelfReport = {
  id: string;
  familiarId: string;
  sessionId: string;
  threadTitle?: string;
  reportedAt: string;

  overallConfidence: number;
  overallConfidenceReason?: string;

  toolReliability: {
    score: number;
    failedTools: string[];
    unreliableTools: string[];
    notes?: string;
  };

  contextPressure: ContextPressure;
  contextNotes?: string;

  skillsUsed: string[];
  skillsNeedingClarity: { skillId: string; reason: string }[];
  skillsNeedingAccess: { skillId: string; reason: string }[];

  capabilitiesLacking: {
    name: string;
    importance: CapabilityImportance;
    detail: string;
  }[];
  capabilitiesVital: {
    name: string;
    currentState: CapabilityState;
    notes?: string;
  }[];

  memoryRecallScore: number;
  memoryRecallNotes?: string;
  fileLocatabilityScore: number;
  fileLocatabilityNotes?: string;

  persistentBlockers: {
    id: string;
    title: string;
    category: BlockerCategory;
    firstSeenAt?: string;
    impact: BlockerImpact;
    detail: string;
    suggestedResolution?: string;
  }[];
};

export function deriveThreadScore(report: ThreadSelfReport): number {
  return Math.round(
    report.overallConfidence * 0.35 +
    report.toolReliability.score * 0.25 +
    report.memoryRecallScore * 0.2 +
    report.fileLocatabilityScore * 0.2,
  );
}

export function contextPressureLabel(pressure: ContextPressure): { label: string; severity: "ok" | "warn" | "crit" } {
  if (pressure === "critical") return { label: "Critical", severity: "crit" };
  if (pressure === "tight") return { label: "Tight", severity: "warn" };
  if (pressure === "excess") return { label: "Excess", severity: "warn" };
  return { label: "Adequate", severity: "ok" };
}

// ── Pure logic helpers (used by components + tests without JSX) ────────────

const IMPACT_WEIGHT_LIB: Record<BlockerImpact, number> = { low: 1, medium: 2, high: 3, blocking: 4 };

export function topPersistentBlocker(
  report: ThreadSelfReport,
): ThreadSelfReport["persistentBlockers"][number] | null {
  return (
    [...report.persistentBlockers].sort(
      (a, b) => IMPACT_WEIGHT_LIB[b.impact] - IMPACT_WEIGHT_LIB[a.impact],
    )[0] ?? null
  );
}

export type RankedBlocker = ThreadSelfReport["persistentBlockers"][number] & {
  frequency: number;
  rankScore: number;
  crit: boolean;
};

export type ThreadSignalsAggregate = {
  averageConfidence: number;
  averageToolReliability: number;
  averageMemoryRecall: number;
  averageFileLocatability: number;
  contextCounts: Record<ContextPressure, number>;
  skillsUsedMost: { skillId: string; count: number }[];
  skillsNeedingClarity: ThreadSelfReport["skillsNeedingClarity"];
  skillsNeedingAccess: ThreadSelfReport["skillsNeedingAccess"];
  capabilitiesVital: ThreadSelfReport["capabilitiesVital"];
  capabilitiesLacking: ThreadSelfReport["capabilitiesLacking"];
  persistentBlockers: RankedBlocker[];
};

const IMPORTANCE_WEIGHT: Record<CapabilityImportance, number> = { "nice-to-have": 1, important: 2, blocking: 3 };
const STATE_WEIGHT: Record<CapabilityState, number> = { available: 1, degraded: 2, missing: 3 };

function libAvg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}
function libIncrement(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function aggregateThreadSignals(reports: ThreadSelfReport[]): ThreadSignalsAggregate {
  const contextCounts: Record<ContextPressure, number> = { adequate: 0, tight: 0, excess: 0, critical: 0 };
  const skillsUsed = new Map<string, number>();
  const clarity = new Map<string, { skillId: string; reason: string }>();
  const access = new Map<string, { skillId: string; reason: string }>();
  const capVital = new Map<string, { name: string; currentState: CapabilityState; notes?: string }>();
  const capLacking = new Map<string, { name: string; importance: CapabilityImportance; detail: string }>();
  const blockerFreq = new Map<string, number>();
  const blockerData = new Map<string, ThreadSelfReport["persistentBlockers"][number]>();

  const sorted = [...reports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());

  for (const r of sorted) {
    contextCounts[r.contextPressure]++;
    for (const s of r.skillsUsed) libIncrement(skillsUsed, s);
    for (const s of r.skillsNeedingClarity) if (!clarity.has(s.skillId)) clarity.set(s.skillId, s);
    for (const s of r.skillsNeedingAccess) if (!access.has(s.skillId)) access.set(s.skillId, s);
    for (const c of r.capabilitiesVital) {
      const prev = capVital.get(c.name);
      if (!prev || STATE_WEIGHT[c.currentState] > STATE_WEIGHT[prev.currentState]) capVital.set(c.name, c);
    }
    for (const c of r.capabilitiesLacking) {
      const prev = capLacking.get(c.name);
      if (!prev || IMPORTANCE_WEIGHT[c.importance] > IMPORTANCE_WEIGHT[prev.importance]) capLacking.set(c.name, c);
    }
    for (const b of r.persistentBlockers) {
      libIncrement(blockerFreq, b.id);
      if (!blockerData.has(b.id)) blockerData.set(b.id, b);
    }
  }

  const total = reports.length || 1;
  const rankedBlockers: RankedBlocker[] = [...blockerFreq.entries()]
    .map(([id, frequency]) => {
      const data = blockerData.get(id)!;
      return { ...data, frequency, rankScore: frequency * IMPACT_WEIGHT_LIB[data.impact], crit: frequency / total > 0.5 };
    })
    .sort((a, b) => b.rankScore - a.rankScore);

  return {
    averageConfidence: libAvg(reports.map((r) => r.overallConfidence)),
    averageToolReliability: libAvg(reports.map((r) => r.toolReliability.score)),
    averageMemoryRecall: libAvg(reports.map((r) => r.memoryRecallScore)),
    averageFileLocatability: libAvg(reports.map((r) => r.fileLocatabilityScore)),
    contextCounts,
    skillsUsedMost: [...skillsUsed.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([skillId, count]) => ({ skillId, count })),
    skillsNeedingClarity: [...clarity.values()],
    skillsNeedingAccess: [...access.values()],
    capabilitiesVital: [...capVital.values()],
    capabilitiesLacking: [...capLacking.values()],
    persistentBlockers: rankedBlockers,
  };
}
