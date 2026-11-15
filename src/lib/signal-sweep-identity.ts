import { selfReportSourceSessionId, type ThreadSelfReport, type ThreadSignalReviewItem } from "./thread-self-report";
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
  const allowed = new Set(report.persistentBlockers.map((blocker) => signalSweepIdentity({ kind: "blocker", sourceId: blocker.id }, signalReportScope(report))));
  const add = (kind: ThreadSignalReviewItem["kind"], sourceId: string) => allowed.add(signalSweepIdentity({ kind, sourceId }, signalReportScope(report)));
  for (const skill of report.skillsNeedingAccess) add("skill-access", skill.skillId);
  for (const skill of report.skillsNeedingClarity) add("skill-clarity", skill.skillId);
  const linked = (name: string) => report.capabilitiesLacking.some((gap) => gap.name === name && gap.blockerId?.trim()
    && report.persistentBlockers.some((blocker) => blocker.id === gap.blockerId!.trim()));
  for (const capability of report.capabilitiesLacking) if (!linked(capability.name)) add("capability", capability.name);
  for (const capability of report.capabilitiesVital) if (capability.currentState !== "available" && !linked(capability.name)) add("capability", capability.name);
  if (report.contextPressure !== "adequate") add("context-pressure", "context-pressure");
  const scores = { confidence: report.overallConfidence, "tool-reliability": report.toolReliability.score,
    "memory-recall": report.memoryRecallScore, "file-locatability": report.fileLocatabilityScore };
  for (const [sourceId, score] of Object.entries(scores)) if (score >= 0 && score < 60) add("low-score", sourceId);
  // Compare only exact server-generated encodings. Accepting alternate raw or
  // tuple spellings would give the same signal multiple durable receipt keys.
  return allowed.has(identity);
}

/** A queue may show a linked capability whose blocker fell outside its own
 * preview. Its launch still owns the underlying blocker's single receipt. */
export function canonicalSignalSweepItem<T extends Pick<ThreadSignalReviewItem, "kind" | "sourceId">>(item: T, report: ThreadSelfReport): Omit<T, "kind" | "sourceId"> & Pick<ThreadSignalReviewItem, "kind" | "sourceId"> {
  if (item.kind !== "capability") return item;
  const blockerId = report.capabilitiesLacking.find((gap) => gap.name === item.sourceId)?.blockerId?.trim();
  return blockerId && report.persistentBlockers.some((blocker) => blocker.id === blockerId)
    ? { ...item, kind: "blocker", sourceId: blockerId } : item;
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
  return latestSignalReports(reports).find((report) => signalSweepIsPresent(signalSweepIdentity(canonicalSignalSweepItem(item, report), signalReportScope(report)), report)) ?? null;
}
