import type { FlowRunRecord, FlowRunStatus } from "@/lib/flows";

export type FlowExecutionStatusFilter = FlowRunStatus | "all";
export type FlowExecutionStartedFilter = "any" | "hour" | "today" | "week";

export const FLOW_EXECUTION_STATUS_FILTERS: Array<{ value: FlowExecutionStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "preview", label: "Preview" },
];

export const FLOW_EXECUTION_STARTED_FILTERS: Array<{ value: FlowExecutionStartedFilter; label: string }> = [
  { value: "any", label: "Any time" },
  { value: "hour", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
];

export function filterFlowRuns(
  runs: FlowRunRecord[],
  filters: {
    status: FlowExecutionStatusFilter;
    started: FlowExecutionStartedFilter;
    customKey?: string;
    customValue?: string;
    now?: Date;
  },
): FlowRunRecord[] {
  const now = filters.now ?? new Date();
  return runs.filter(
    (run) =>
      matchesStatus(run, filters.status) &&
      matchesStarted(run, filters.started, now) &&
      matchesCustomData(run, filters.customKey, filters.customValue),
  );
}

function matchesStatus(run: FlowRunRecord, status: FlowExecutionStatusFilter): boolean {
  return status === "all" || run.status === status;
}

function matchesStarted(run: FlowRunRecord, started: FlowExecutionStartedFilter, now: Date): boolean {
  if (started === "any") return true;
  const startedAt = new Date(run.startedAt);
  if (Number.isNaN(startedAt.getTime())) return false;
  if (started === "hour") return now.getTime() - startedAt.getTime() <= 60 * 60 * 1000;
  if (started === "week") return now.getTime() - startedAt.getTime() <= 7 * 24 * 60 * 60 * 1000;
  return sameLocalDay(startedAt, now);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function matchesCustomData(run: FlowRunRecord, rawKey: string | undefined, rawValue: string | undefined): boolean {
  const key = rawKey?.trim();
  const value = rawValue?.trim();
  if (!key && !value) return true;
  const customData = run.customData ?? {};
  if (key && value) return customData[key] === value;
  if (key) return Object.hasOwn(customData, key);
  return Object.values(customData).some((entry) => entry === value);
}
