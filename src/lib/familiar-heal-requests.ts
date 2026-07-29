import type { ContractReport, ContractViolation } from "@/lib/familiar-contract";
import type { FamiliarGrowthReport, GrowthSignal } from "@/lib/familiar-growth-signals";
import type { BlockerCategory, ThreadSignalsAggregate } from "@/lib/thread-self-report";

export type HealSource = "contract" | "growth-signal" | "self-report-aggregate";
export type HealActionKind = "fix-contract" | "write-memory" | "request-skill" | "manual";

export type SelfHealRequest = {
  id: string;
  familiarId: string;
  source: HealSource;
  severity: "info" | "warn" | "crit";
  title: string;
  detail: string;
  suggestedAction: string;
  actionKind: HealActionKind;
  createdAt: string;
  /** Consumers honour this; no producer sets it yet.
   *
   *  Every request in this file is DERIVED — from contract violations, growth
   *  signals, or the thread-signal aggregate — and none is persisted, so
   *  nothing has anywhere to record a resolution and all four construction
   *  sites below set `false`. A request stops existing when the condition that
   *  derived it stops holding, which is why the system works without ever
   *  flipping this.
   *
   *  It is still load-bearing on the read side: familiar-card-insights gates
   *  its "Review heal requests" action on `!resolved` and excludes resolved
   *  requests from the `openHeals` count, with a test pinning that a resolved
   *  request is not counted. So the filter reads as vacuous today but is the
   *  correct behaviour the moment persisted, resolvable requests exist.
   *
   *  Do not "clean this up" as a dead field (cave-7zbup): deleting it changes
   *  tested insight behaviour. Delete it only together with those consumers,
   *  or leave it until resolution is actually implemented. */
  resolved: boolean;
};

const STATIC_CREATED_AT = "1970-01-01T00:00:00.000Z";

const SEVERITY_RANK: Record<SelfHealRequest["severity"], number> = {
  crit: 0,
  warn: 1,
  info: 2,
};

function fromContractViolation(
  familiarId: string,
  violation: ContractViolation,
  index: number,
): SelfHealRequest {
  return {
    id: `${familiarId}:contract:${index}:${violation.file}:${violation.field}`,
    familiarId,
    source: "contract",
    severity: "crit",
    title: `${violation.file} contract violation`,
    detail: violation.message,
    suggestedAction: `Fix ${violation.field} in ${violation.file}.`,
    actionKind: "fix-contract",
    createdAt: STATIC_CREATED_AT,
    resolved: false,
  };
}

function actionKindForGrowthSignal(signal: GrowthSignal): HealActionKind {
  const criticalMemoryKinds = new Set<GrowthSignal["kind"]>(["session-gap", "no-memory", "stale-memory"]);
  if (signal.severity === "crit" && criticalMemoryKinds.has(signal.kind)) return "write-memory";
  return "manual";
}

function actionKindForBlockerCategory(category: BlockerCategory): HealActionKind {
  if (category === "auth") return "fix-contract";
  if (category === "context") return "write-memory";
  if (category === "skill") return "request-skill";
  return "manual";
}

function fromGrowthSignal(familiarId: string, signal: GrowthSignal, index: number): SelfHealRequest | null {
  if (signal.severity !== "crit" && signal.severity !== "warn") return null;
  const actionKind = actionKindForGrowthSignal(signal);
  return {
    id: `${familiarId}:growth-signal:${signal.kind}:${signal.track ?? "all"}:${index}`,
    familiarId,
    source: "growth-signal",
    severity: signal.severity,
    title: signal.label,
    detail: signal.detail,
    suggestedAction: actionKind === "write-memory"
      ? "Write or refresh memory for this familiar."
      : "Review the growth signal and choose the next manual intervention.",
    actionKind,
    createdAt: STATIC_CREATED_AT,
    resolved: false,
  };
}

function sortRequests(requests: SelfHealRequest[]): SelfHealRequest[] {
  return [...requests].sort((a, b) => {
    const severityDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function deriveHealRequests(args: {
  familiarId: string;
  contractReport: ContractReport | null;
  growthReport: FamiliarGrowthReport | null;
}): SelfHealRequest[] {
  const requests: SelfHealRequest[] = [];

  for (const [index, violation] of (args.contractReport?.violations ?? []).entries()) {
    requests.push(fromContractViolation(args.familiarId, violation, index));
  }

  for (const [index, signal] of (args.growthReport?.signals ?? []).entries()) {
    const request = fromGrowthSignal(args.familiarId, signal, index);
    if (request) requests.push(request);
  }

  return sortRequests(requests);
}

export function escalateBlockers(
  familiarId: string,
  aggregate: ThreadSignalsAggregate,
  existingRequests: SelfHealRequest[],
): SelfHealRequest[] {
  const existingIds = new Set(existingRequests.map((request) => request.id));
  return aggregate.persistentBlockers
    .filter((blocker) => blocker.crit && !existingIds.has(blocker.id))
    .map((blocker) => {
      const actionKind = actionKindForBlockerCategory(blocker.category);
      return {
        id: blocker.id,
        familiarId,
        source: "self-report-aggregate" as const,
        severity: "crit" as const,
        title: blocker.title,
        detail: blocker.detail,
        suggestedAction:
          blocker.suggestedResolution ??
          "Review the recurring blocker and choose the next manual intervention.",
        actionKind,
        createdAt: blocker.firstSeenAt ?? STATIC_CREATED_AT,
        resolved: false,
      };
    });
}
