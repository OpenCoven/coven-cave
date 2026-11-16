import assert from "node:assert/strict";
import { canonicalSignalSweepItem, signalReportScope, signalSweepIsPresent, signalSweepIdentity, signalSweepSource } from "./signal-sweep-identity.ts";
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
const dense = report("dense", "2026-11-09T00:00:00Z", {
  persistentBlockers: Array.from({ length: 7 }, (_, index) => ({ ...first.persistentBlockers[0], id: `blocker-${index}`, title: `Synthetic blocker ${index}` })),
  skillsNeedingAccess: [{ skillId: "access", reason: "Synthetic gap" }],
  skillsNeedingClarity: [{ skillId: "clarity", reason: "Synthetic gap" }],
  capabilitiesLacking: [{ name: "optional", importance: "nice-to-have", detail: "Synthetic gap" }],
  contextPressure: "critical", overallConfidence: 0,
});
for (const identity of ["blocker:blocker-6", "skill-access:access", "skill-clarity:clarity", "capability:optional",
  signalSweepIdentity(pressure, signalReportScope(dense)), signalSweepIdentity({ kind: "low-score", sourceId: "confidence" }, signalReportScope(dense))]) {
  assert.equal(signalSweepIsPresent(identity, dense), true, `the complete report, not the six-row card projection, authorizes ${identity}`);
}
assert.equal(signalSweepSource({ kind: "blocker", sourceId: "blocker-6" }, [dense])?.id, "dense");
assert.equal(signalSweepIsPresent(JSON.stringify(["blocker", "auth", signalReportScope(first)]), first), false, "a scoped encoding cannot bypass a familiar-wide blocker receipt");
assert.equal(signalSweepIsPresent("context-pressure:context-pressure", a), false, "thread-specific signals require their exact canonical scoped identity");
const cutLink = { ...dense, capabilitiesLacking: [{ name: "linked-outside-preview", importance: "blocking" as const, detail: "Synthetic linked gap", blockerId: " blocker-6 " }] };
assert.equal(signalSweepSource({ kind: "capability", sourceId: "linked-outside-preview" }, [cutLink])?.id, "dense", "an analytics queue alias still resolves its canonical blocker beyond the preview limit");
assert.deepEqual(canonicalSignalSweepItem({ kind: "capability", sourceId: "linked-outside-preview" }, cutLink), { kind: "blocker", sourceId: "blocker-6" });
console.log("signal-sweep-identity: ok");
