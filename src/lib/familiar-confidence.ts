import type { DaemonFamiliar } from "@/app/api/familiars/route";
import type { ContractReport } from "@/lib/familiar-contract";
import type { FamiliarGrowthReport } from "@/lib/familiar-growth-signals";

export type ConfidenceFactor = {
  label: string;
  value: number;
  weight: number;
  contribution: number;
};

export type ConfidenceScore = {
  score: number;
  label: "Low" | "Developing" | "Reliable" | "Trusted";
  factors: ConfidenceFactor[];
};

const CONTRACT_WEIGHT = 0.3;
const ACCEPT_RATE_WEIGHT = 0.4;
const FRESHNESS_WEIGHT = 0.2;
const ACTIVITY_WEIGHT = 0.1;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function labelForScore(score: number): ConfidenceScore["label"] {
  if (score >= 80) return "Trusted";
  if (score >= 60) return "Reliable";
  if (score >= 40) return "Developing";
  return "Low";
}

function totalRetroRuns(report: FamiliarGrowthReport | null): number {
  if (!report) return 0;
  return Object.values(report.trackStats).reduce((sum, stat) => sum + stat.total, 0);
}

function freshnessValue(memoryFreshness: string | null | undefined): number {
  if (memoryFreshness === "fresh") return 100;
  if (memoryFreshness === "aging") return 60;
  if (memoryFreshness === "stale") return 20;
  return 0;
}

function factor(label: string, value: number, weight: number): ConfidenceFactor {
  const safeValue = clampPercent(value);
  return {
    label,
    value: safeValue,
    weight,
    contribution: safeValue * weight,
  };
}

export function deriveConfidenceScore(args: {
  contractReport: ContractReport | null;
  growthReport: FamiliarGrowthReport | null;
  familiar: Pick<DaemonFamiliar, "memory_freshness"> | { memory_freshness?: string | null } | null;
}): ConfidenceScore {
  const propertyCount = args.contractReport?.properties.length ?? 0;
  const passingProperties = args.contractReport?.properties.filter((property) => property.pass).length ?? 0;
  const contractScore = propertyCount > 0 ? (passingProperties / propertyCount) * 100 : 0;

  const retroRuns = totalRetroRuns(args.growthReport);
  const acceptRate = retroRuns >= 3 && args.growthReport?.retroAcceptRate != null
    ? args.growthReport.retroAcceptRate * 100
    : 0;

  const freshnessScore = freshnessValue(args.familiar?.memory_freshness);
  const activityScore = Math.min(Math.max(args.growthReport?.sessionsLast7d ?? 0, 0), 10) * 10;

  const factors = [
    factor("contract_score", contractScore, CONTRACT_WEIGHT),
    factor("accept_rate", acceptRate, ACCEPT_RATE_WEIGHT),
    factor("freshness_score", freshnessScore, FRESHNESS_WEIGHT),
    factor("activity_score", activityScore, ACTIVITY_WEIGHT),
  ];
  const score = Math.round(factors.reduce((sum, item) => sum + item.contribution, 0));

  return {
    score,
    label: labelForScore(score),
    factors,
  };
}
