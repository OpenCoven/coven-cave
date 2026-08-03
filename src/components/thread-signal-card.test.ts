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
  it("exports the card and drives it off the single-report builders", () => {
    assert.match(source, /export function ThreadSignalCard/);
    assert.match(source, /buildThreadSignalScoreTiles\(report\)/);
    assert.match(source, /buildThreadSignalRows\(report\)/);
    assert.match(source, /onClick=\{onViewFull\}/);
  });

  it("launches resolution threads through the shared prompt + cross-page launcher", () => {
    assert.match(source, /requestAgentsNewChat\(/);
    assert.match(source, /buildThreadSignalResolutionPrompt\(targets\[0\]\)/);
    assert.match(source, /buildThreadSignalBatchResolutionPrompt\(targets\)/);
    // One thread for all remaining criticals, not one per signal.
    assert.match(source, /launch\(\s*openCriticals,/);
  });

  it("defers the dismissal upward so Undo can restore the card", () => {
    assert.match(source, /const \[dismissed, setDismissed\] = useState\(false\)/);
    assert.match(source, /setTimeout\(\(\) => onDismissRef\.current\(\), DISMISS_UNDO_MS\)/);
    assert.match(source, /setDismissed\(false\);\s*\n\s*announce\("Thread Signal restored\."\)/);
    assert.match(source, /setDismissed\(true\);\s*\n\s*announce\("Thread Signal dismissed/);
  });

  it("resets per-report state when a newer report lands on the same instance", () => {
    // chat-view reuses this instance via setThreadSignalReport, and launched/
    // tasked are keyed by kind:sourceId — keys that repeat across reports.
    // Without the reset the new report's rows render as already actioned.
    assert.match(source, /const \[renderedReportId, setRenderedReportId\] = useState\(report\.id\)/);
    assert.match(source, /if \(renderedReportId !== report\.id\) \{/);
    for (const setter of [
      /setRenderedReportId\(report\.id\)/,
      /setSelectedTile\(weakestTileId\(tiles\)\)/,
      /setOpenRow\(null\)/,
      /setLaunched\(new Set\(\)\)/,
      /setTasked\(new Set\(\)\)/,
      /setTaskPending\(new Set\(\)\)/,
      /setDismissed\(false\)/,
    ]) {
      assert.match(source, setter);
    }
  });

  it("keeps every interactive element keyboard-reachable and announced", () => {
    assert.match(source, /useAnnouncer\(\)/);
    assert.match(source, /className="tsc-row-btn focus-ring-inset"/);
    assert.match(source, /tsc-tile focus-ring/);
    assert.match(source, /aria-expanded=\{open\}/);
    // Escape closes an open row overlay.
    assert.match(source, /event\.key !== "Escape"/);
  });

  it("keeps the card compact and grows the tile grid from two to three columns", () => {
    assert.match(
      styles,
      /\.tsc-card\s*\{[\s\S]*?container-name:\s*thread-signal;[\s\S]*?container-type:\s*inline-size;[\s\S]*?gap:\s*var\(--space-2\);[\s\S]*?padding:\s*var\(--space-2\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
    );
    assert.match(
      styles,
      /\.tsc-tiles\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
    );
    assert.match(
      styles,
      /\.tsc-tile\s*\{[\s\S]*?padding:\s*var\(--space-1\);[\s\S]*?border-radius:\s*var\(--radius-sm\);/,
    );
    assert.match(
      styles,
      /@container thread-signal \(min-width:\s*300px\)\s*\{[\s\S]*?\.tsc-tiles\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
    );
  });

  it("floats the row detail above the row so the card height never changes", () => {
    assert.match(styles, /\.tsc-row\s*\{[\s\S]*?position:\s*relative;/);
    assert.match(
      styles,
      /\.tsc-pop\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*calc\(100% \+ var\(--space-1\)\);/,
    );
    // An inline expansion would push the transcript; the overlay must not be
    // converted back to one.
    assert.doesNotMatch(styles, /\.tsc-pop\s*\{[\s\S]*?position:\s*static;/);
  });

  it("carries severity on shared tone utilities rather than per-element colors", () => {
    for (const rule of [
      /\.tsc-tone--ok\s*\{\s*color:\s*var\(--color-success\);/,
      /\.tsc-tone--warn\s*\{\s*color:\s*var\(--color-warning\);/,
      /\.tsc-tone--crit\s*\{\s*color:\s*var\(--color-danger\);/,
      /\.tsc-fill--crit\s*\{\s*background:\s*var\(--color-danger\);/,
    ]) {
      assert.match(styles, rule);
    }
  });
});
