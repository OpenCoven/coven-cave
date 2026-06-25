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
