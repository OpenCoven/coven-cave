import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { topPersistentBlocker } from "@/lib/thread-self-report";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

const source = readFileSync(new URL("./thread-signal-card.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../styles/globals/shell-cards-and-controls.css", import.meta.url),
  "utf8",
);

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
    assert.match(source, /export function ThreadSignalCard/);
    assert.match(source, /topPersistentBlocker/);
    assert.match(source, /onClick=\{\(event\) => stopAndRun\(event, onViewFull\)\}/);
    assert.match(source, /onClick=\{\(event\) => stopAndRun\(event, onDismiss\)\}/);
  });

  it("keeps the card compact and switches directly from one to three score columns", () => {
    assert.match(
      styles,
      /\.tsc-card\s*\{[\s\S]*?container-name:\s*thread-signal;[\s\S]*?container-type:\s*inline-size;[\s\S]*?gap:\s*var\(--space-2\);[\s\S]*?padding:\s*var\(--space-2\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
    );
    assert.match(
      styles,
      /\.tsc-scores\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    assert.match(
      styles,
      /\.tsc-score-item\s*\{[\s\S]*?padding:\s*var\(--space-1\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
    );
    assert.match(
      styles,
      /\.tsc-actions button\s*\{[\s\S]*?min-height:\s*var\(--space-6\);/,
    );
    assert.match(
      styles,
      /@container thread-signal \(min-width:\s*560px\)\s*\{[\s\S]*?\.tsc-scores\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
    assert.doesNotMatch(
      styles,
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });
});
