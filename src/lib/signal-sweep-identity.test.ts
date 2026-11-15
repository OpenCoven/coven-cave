import assert from "node:assert/strict";
import { signalReportScope, signalSweepIsPresent, signalSweepIdentity, signalSweepSource } from "./signal-sweep-identity.ts";
import type { ThreadSelfReport } from "./thread-self-report.ts";

function report(id: string, date: string, patch: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return { id, reportedAt: date, familiarId: "nova", sessionId: "source-a", overallConfidence: 90,
    toolReliability: { score: 90, failedTools: [], unreliableTools: [] }, contextPressure: "adequate",
    skillsUsed: [], skillsNeedingAccess: [], skillsNeedingClarity: [], capabilitiesVital: [], capabilitiesLacking: [],
    memoryRecallScore: 90, fileLocatabilityScore: 90,
    persistentBlockers: [{ id: "auth", title: "Synthetic auth", detail: "Synthetic prerequisite", category: "auth", impact: "blocking" }], ...patch };
}
const first = report("first", "2026-11-01T00:00:00Z");
const repeated = report("repeated", "2026-11-02T00:00:00Z");
const blocker = { kind: "blocker" as const, sourceId: "auth" };
assert.equal(signalSweepIdentity(blocker, signalReportScope(repeated)), signalSweepIdentity(blocker, signalReportScope(first)), "new reports do not create a new familiar-wide receipt");
const healthy = report("healthy", "2026-11-03T00:00:00Z", { persistentBlockers: [] });
assert.equal(signalSweepSource(blocker, [healthy, repeated, first]), null, "a historical signal cannot pretend to belong to the current source report");
const recurrence = report("recurrence", "2026-11-04T00:00:00Z");
assert.equal(signalSweepSource(blocker, [recurrence, healthy, repeated, first])?.id, "recurrence");
assert.equal(signalSweepIdentity(blocker, signalReportScope(recurrence)), signalSweepIdentity(blocker, signalReportScope(first)), "report omission never clears the durable receipt; recurrence uses explicit CAS retry");
const pressure = { kind: "context-pressure" as const, sourceId: "context-pressure" };
const a = report("pressure-a", "2026-11-05T00:00:00Z", { contextPressure: "critical" });
const b = report("pressure-b", "2026-11-06T00:00:00Z", { sessionId: "source-b", contextPressure: "critical" });
assert.notEqual(signalSweepIdentity(pressure, signalReportScope(a)), signalSweepIdentity(pressure, signalReportScope(b)));
assert.equal(signalSweepIsPresent(signalSweepIdentity(pressure, signalReportScope(a)), a), true);
assert.equal(signalSweepIsPresent(signalSweepIdentity(pressure, signalReportScope(a)), b), false, "a client scope cannot claim a different source thread");
assert.equal(signalSweepSource(blocker, [report("healthy-b", "2026-11-08T00:00:00Z", { sessionId: "source-b", persistentBlockers: [] }), first])?.id, "first", "an unrelated newer report neither erases nor blocks the original source");
const linked = report("linked", "2026-11-07T00:00:00Z", { capabilitiesLacking: [{ name: "provider-api", importance: "blocking", detail: "Synthetic dependency", blockerId: "auth" }] });
assert.equal(signalSweepIsPresent("capability:provider-api", linked), false, "a linked capability cannot bypass its blocker identity");
assert.equal(signalSweepIsPresent("blocker:auth", linked), true);
assert.equal(signalSweepSource(blocker, []), null, "missing source history is not new work");
console.log("signal-sweep-identity: ok");
