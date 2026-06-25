import type { EvalLoopState } from "@/components/eval-loop-panel";
import type { ContractReport, ContractViolation } from "@/lib/familiar-contract";
import type { FamiliarGrowthReport, GrowthSignal } from "@/lib/familiar-growth-signals";
import type { BlockerCategory, ThreadSignalsAggregate } from "@/lib/thread-self-report";

export type HealSource = "eval-loop" | "contract" | "growth-signal" | "self-report-aggregate";
export type HealActionKind = "run-eval" | "fix-contract" | "write-memory" | "request-skill" | "manual";

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
  resolved: boolean;
};

const STATIC_CREATED_AT = "1970-01-01T00:00:00.000Z";

const SEVERITY_RANK: Record<SelfHealRequest["severity"], number> = {
  crit: 0,
  warn: 1,
  info: 2,
};

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

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
  evalLoopState: EvalLoopState | null;
  contractReport: ContractReport | null;
  growthReport: FamiliarGrowthReport | null;
}): SelfHealRequest[] {
  const requests: SelfHealRequest[] = [];

  for (const iteration of args.evalLoopState?.iterations ?? []) {
    if (iteration.outcome !== "REVERT") continue;
    requests.push({
      id: `${args.familiarId}:eval-loop:${iteration.id}`,
      familiarId: args.familiarId,
      source: "eval-loop",
      severity: "warn",
      title: `${titleCase(iteration.track)} eval reverted`,
      detail: iteration.notes
        ? `${iteration.change_summary} ${iteration.notes}`
        : iteration.change_summary,
      suggestedAction: `Run a follow-up ${iteration.track} eval iteration.`,
      actionKind: "run-eval",
      createdAt: iteration.timestamp || STATIC_CREATED_AT,
      resolved: false,
    });
  }

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
