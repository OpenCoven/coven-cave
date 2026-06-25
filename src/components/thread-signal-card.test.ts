import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { topPersistentBlocker } from "@/lib/thread-self-report";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

function report(overrides: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return {
    id: "report-1",
    familiarId: "cody",
    sessionId: "session-1",
    threadTitle: "Test thread",
    reportedAt: "2026-06-25T12:00:00.000Z",
    overallConfidence: 84,
    overallConfidenceReason: "clear path",
    toolReliability: { score: 71, failedTools: [], unreliableTools: [] },
    contextPressure: "adequate",
    skillsUsed: [],
    skillsNeedingClarity: [],
    skillsNeedingAccess: [],
    capabilitiesLacking: [],
    capabilitiesVital: [],
    memoryRecallScore: 63,
    fileLocatabilityScore: 58,
    persistentBlockers: [],
    ...overrides,
  };
}

describe("topPersistentBlocker", () => {
  it("returns null when no blockers", () => {
    assert.equal(topPersistentBlocker(report()), null);
  });

  it("returns the highest-impact blocker", () => {
    const r = report({
      persistentBlockers: [
        { id: "low", title: "Minor cleanup", category: "other", impact: "low", detail: "nice" },
        { id: "blocking", title: "Missing auth", category: "auth", impact: "blocking", detail: "blocked" },
        { id: "medium", title: "Slow tool", category: "tooling", impact: "medium", detail: "slow" },
      ],
    });
    assert.equal(topPersistentBlocker(r)?.title, "Missing auth");
  });

  it("returns the single blocker when only one exists", () => {
    const r = report({
      persistentBlockers: [
        { id: "b1", title: "Auth issue", category: "auth", impact: "high", detail: "detail" },
      ],
    });
    assert.equal(topPersistentBlocker(r)?.id, "b1");
  });

  it("prefers blocking > high > medium > low", () => {
    const r = report({
      persistentBlockers: [
        { id: "h", title: "High", category: "infra", impact: "high", detail: "" },
        { id: "m", title: "Medium", category: "infra", impact: "medium", detail: "" },
        { id: "b", title: "Blocking", category: "infra", impact: "blocking", detail: "" },
      ],
    });
    assert.equal(topPersistentBlocker(r)?.impact, "blocking");
  });
});

describe("thread-signal-card module wiring", () => {
  it("thread-signal-card.tsx exports ThreadSignalCard and topPersistentBlocker", () => {
    const { readFileSync } = require("node:fs");
    const src = readFileSync(new URL("./thread-signal-card.tsx", import.meta.url), "utf8");
    assert.match(src, /export function ThreadSignalCard/);
    assert.match(src, /topPersistentBlocker/);
  });
});
