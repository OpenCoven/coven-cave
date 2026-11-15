import { buildThreadSignalRows, selfReportSourceSessionId, type ThreadSelfReport, type ThreadSignalReviewItem } from "./thread-self-report";
import { signalIdentity } from "./thread-signal-dismissals";

/** Persistent prerequisites belong to the familiar; score/context problems
 * belong to the thread that actually experienced them. */
export function signalSweepIdentity(item: Pick<ThreadSignalReviewItem, "kind" | "sourceId">, scope: string): string {
  return item.kind === "context-pressure" || item.kind === "low-score"
    ? JSON.stringify([item.kind, item.sourceId, scope]) : signalIdentity(item);
}
export function signalReportScope(report: ThreadSelfReport): string {
  return selfReportSourceSessionId(report) ?? report.id;
}

/** Validate the requested identity against its actual persisted source.
 * Omission in another thread never proves a familiar-wide blocker resolved. */
export function signalSweepIsPresent(identity: string, report: ThreadSelfReport): boolean {
  let base = identity;
  if (identity.startsWith("[")) {
    try {
      const tuple: unknown = JSON.parse(identity);
      if (!Array.isArray(tuple) || tuple.length !== 3 || !tuple.every((entry) => typeof entry === "string") || tuple[2] !== signalReportScope(report)) return false;
      base = `${tuple[0]}:${tuple[1]}`;
    } catch { return false; }
  }
  return buildThreadSignalRows(report).some((row) => signalIdentity(row) === base)
    || report.capabilitiesVital.some((capability) => capability.currentState !== "available" && `capability:${capability.name}` === base
      && !report.capabilitiesLacking.some((gap) => gap.name === capability.name && gap.blockerId && report.persistentBlockers.some((blocker) => blocker.id === gap.blockerId)));
}

export function latestSignalReports(reports: readonly ThreadSelfReport[]): ThreadSelfReport[] {
  const latest = new Map<string, ThreadSelfReport>();
  for (const report of [...reports].sort((a, b) => Date.parse(b.reportedAt) - Date.parse(a.reportedAt) || b.id.localeCompare(a.id))) {
    const scope = signalReportScope(report);
    if (!latest.has(scope)) latest.set(scope, report);
  }
  return [...latest.values()];
}

/** Analytics may aggregate several threads. Bind each action to a current
 * source that actually contains it, rather than attributing every row to the
 * newest unrelated report. */
export function signalSweepSource(item: Pick<ThreadSignalReviewItem, "kind" | "sourceId">, reports: readonly ThreadSelfReport[]): ThreadSelfReport | null {
  return latestSignalReports(reports).find((report) => signalSweepIsPresent(signalSweepIdentity(item, signalReportScope(report)), report)) ?? null;
}
