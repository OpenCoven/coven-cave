import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { aggregateThreadSignals, buildThreadSignalReviewQueue, THREAD_SIGNALS_EMPTY_STATE } from "@/lib/thread-self-report";
import type { ThreadSelfReport } from "@/lib/thread-self-report";

const source = readFileSync(new URL("./thread-signals-section.tsx", import.meta.url), "utf8");
const analyticsSource = readFileSync(new URL("./familiar-analytics-view.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "ThreadSignalsSection review actions use the shared Button primitive");
assert.doesNotMatch(source, /<button\b/, "ThreadSignalsSection should not hand-roll button controls");

function report(overrides: Partial<ThreadSelfReport> & { id: string }): ThreadSelfReport {
  return {
    familiarId: "echo",
    sessionId: overrides.id,
    reportedAt: overrides.reportedAt ?? "2026-06-25T12:00:00.000Z",
    overallConfidence: overrides.overallConfidence ?? 80,
    toolReliability: overrides.toolReliability ?? { score: 70, failedTools: [], unreliableTools: [] },
    contextPressure: overrides.contextPressure ?? "adequate",
    skillsUsed: overrides.skillsUsed ?? [],
    skillsNeedingClarity: overrides.skillsNeedingClarity ?? [],
    skillsNeedingAccess: overrides.skillsNeedingAccess ?? [],
    capabilitiesLacking: overrides.capabilitiesLacking ?? [],
    capabilitiesVital: overrides.capabilitiesVital ?? [],
    memoryRecallScore: overrides.memoryRecallScore ?? 75,
    fileLocatabilityScore: overrides.fileLocatabilityScore ?? 85,
    persistentBlockers: overrides.persistentBlockers ?? [],
    ...overrides,
  };
}

describe("aggregateThreadSignals", () => {
  it("returns zero averages for empty reports", () => {
    const agg = aggregateThreadSignals([]);
    assert.equal(agg.averageConfidence, 0);
    assert.equal(agg.averageToolReliability, 0);
    assert.equal(agg.persistentBlockers.length, 0);
  });

  it("computes correct averages", () => {
    const reports = [
      report({ id: "r1", overallConfidence: 60, toolReliability: { score: 80, failedTools: [], unreliableTools: [] }, memoryRecallScore: 70, fileLocatabilityScore: 90 }),
      report({ id: "r2", overallConfidence: 80, toolReliability: { score: 60, failedTools: [], unreliableTools: [] }, memoryRecallScore: 90, fileLocatabilityScore: 70 }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.averageConfidence, 70);
    assert.equal(agg.averageToolReliability, 70);
    assert.equal(agg.averageMemoryRecall, 80);
    assert.equal(agg.averageFileLocatability, 80);
  });

  it("ranks blockers by frequency × impact weight", () => {
    const blocker = (id: string, impact: "low" | "medium" | "high" | "blocking") => ({
      id, title: id, category: "other" as const, impact, detail: "",
    });
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker("a", "low"), blocker("b", "blocking")] }),
      report({ id: "r2", persistentBlockers: [blocker("b", "blocking")] }),
      report({ id: "r3", persistentBlockers: [blocker("b", "blocking")] }),
    ];
    const agg = aggregateThreadSignals(reports);
    // b: frequency=3, weight=4, score=12; a: frequency=1, weight=1, score=1
    assert.equal(agg.persistentBlockers[0].id, "b");
    assert.equal(agg.persistentBlockers[0].frequency, 3);
  });

  it("marks blockers as crit when in >50% of reports", () => {
    const blocker = { id: "x", title: "X", category: "auth" as const, impact: "high" as const, detail: "" };
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker] }),
      report({ id: "r2", persistentBlockers: [blocker] }),
      report({ id: "r3", persistentBlockers: [] }),
    ];
    const agg = aggregateThreadSignals(reports);
    // x appears in 2/3 = 67% → crit
    assert.equal(agg.persistentBlockers[0].crit, true);
  });

  it("does not mark blockers as crit when in ≤50% of reports", () => {
    const blocker = { id: "y", title: "Y", category: "tooling" as const, impact: "medium" as const, detail: "" };
    const reports = [
      report({ id: "r1", persistentBlockers: [blocker] }),
      report({ id: "r2", persistentBlockers: [] }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.persistentBlockers[0].crit, false);
  });

  it("deduplicates skills needing clarity (keeps newest)", () => {
    const reports = [
      report({ id: "r1", reportedAt: "2026-06-24T00:00:00.000Z", skillsNeedingClarity: [{ skillId: "exec", reason: "old" }] }),
      report({ id: "r2", reportedAt: "2026-06-25T00:00:00.000Z", skillsNeedingClarity: [{ skillId: "exec", reason: "new" }] }),
    ];
    const agg = aggregateThreadSignals(reports);
    assert.equal(agg.skillsNeedingClarity.length, 1);
    assert.equal(agg.skillsNeedingClarity[0].reason, "new");
  });

  it("builds a prioritized human review queue for summary thread signals", () => {
    const reports = [
      report({
        id: "r1",
        contextPressure: "critical",
        skillsNeedingAccess: [{ skillId: "github", reason: "token expired" }],
        persistentBlockers: [
          { id: "auth", title: "Auth expired", category: "auth", impact: "blocking", detail: "GitHub auth failed" },
        ],
      }),
      report({
        id: "r2",
        contextPressure: "tight",
        capabilitiesLacking: [{ name: "calendar search", importance: "blocking", detail: "cannot inspect conflicts" }],
      }),
    ];
    const review = buildThreadSignalReviewQueue(aggregateThreadSignals(reports));
    assert.equal(review[0].kind, "blocker");
    assert.equal(review[0].severity, "critical");
    assert.match(review[0].title, /Auth expired/);
    assert.ok(review.some((item) => item.kind === "skill-access" && item.title === "github"));
    assert.ok(review.some((item) => item.kind === "context-pressure" && item.detail.includes("critical")));
  });

  it("renders empty state in source file when no reports", () => {
    assert.match(source, /reports\.length === 0/);
    assert.match(source, /THREAD_SIGNALS_EMPTY_STATE/);
    assert.match(THREAD_SIGNALS_EMPTY_STATE, /No thread reports yet/);
    assert.match(source, /export function ThreadSignalsSection/);
  });

  it("renders a review-first Thread Signals layout in source", () => {
    assert.match(source, /buildThreadSignalReviewQueue/, "component derives a review queue");
    assert.match(source, /Review queue/, "component labels the prioritized review area");
    assert.match(source, /fa-thread-review-list/, "component renders the review queue as a scan-first list");
    assert.match(source, /Latest report/, "component shows recency for the summary");
  });

  it("renders thread signal categories as a task-style grouped table", () => {
    assert.match(source, /tableSections\(aggregate\)/, "component normalizes signal categories into table sections");
    assert.match(source, /className="board-table board-table--grid fa-thread-table"/, "component reuses the task table class stack");
    assert.match(source, /aria-label="Thread signal summary"/, "table has a stable accessible label");
    assert.match(source, /className="board-table-group-row fa-thread-table__group"/, "sections render as task-style grouped rows");
    assert.match(source, /className="fa-thread-table__col-detail"/, "column sizing classes stay separate from cell content classes");
    assert.match(source, /No access gaps\./, "empty category states remain visible inside the table");
    assert.match(source, /\{ key: "signal", label: "Signal" \}[\s\S]*\{ key: "type", label: "Type" \}[\s\S]*\{ key: "state", label: "Status" \}/, "table exposes scan-friendly columns");
    assert.match(source, /<th>Detail<\/th>/, "detail stays a plain column");
  });

  it("is a real data table: sortable columns with an accessible sort state", () => {
    assert.match(source, /aria-sort=\{sortKey === column\.key \? \(sortDir === "asc" \? "ascending" : "descending"\) : undefined\}/, "sorted column exposes aria-sort");
    assert.match(source, /onClick=\{\(\) => toggleSort\(column\.key\)\}/, "headers toggle sorting");
    assert.match(source, /setSortKey\(null\)/, "third press returns to the default category grouping");
    assert.match(source, /localeCompare/, "text columns compare locale-aware");
    assert.match(source, /toggleSort\("count"\)/, "report count is sortable too");
  });

  it("mutates signal rows into board tasks", () => {
    assert.match(source, /fetch\("\/api\/board"/, "row promotion posts to the board API");
    assert.match(source, /taskDraftFromRow/, "rows are shaped into task drafts");
    assert.match(source, /title: `\$\{row\.type\}: \$\{row\.signal\}`/, "task titles carry the signal identity");
    assert.match(source, /labels: \["thread-signal"\]/, "created cards are labeled for provenance");
    assert.match(source, /critical: "urgent",[\s\S]*warning: "high",[\s\S]*info: "medium",/, "severity maps to card priority");
    assert.match(source, /type="checkbox"/, "rows are selectable");
    assert.match(source, /aria-label="Select all signals"/, "bulk selection has an accessible control");
    assert.match(source, /useAnnouncer/, "task creation results are announced to screen readers");
    assert.match(source, /fa-thread-table__row--added/, "promoted rows read as settled");
  });

  it("spans both analytics columns and scrolls under a max height", () => {
    assert.match(
      analyticsSource,
      /id="fa-thread-signals"[\s\S]*?wide=\{model\.threadReports\.length > 0\}/,
      "the Thread signals section spans both fa-grid columns when it has data",
    );
    assert.match(
      globals,
      /\.fa-thread-table-wrap \{[^}]*max-height: 420px;[^}]*overflow: auto;/,
      "the signal table caps its height and scrolls",
    );
    assert.match(
      globals,
      /\.fa-thread-review-list \{[^}]*max-height: 240px;[^}]*overflow-y: auto;/,
      "the review queue caps its height and scrolls",
    );
  });

  it("lets you select a review item to unlock a discussion on the topic", () => {
    assert.match(source, /buildThreadSignalDiscussionPrompt/, "seeds the chat with a topic-specific prompt");
    assert.match(source, /new CustomEvent\("cave:agents-new-chat"/, "opens a new chat with the familiar");
    assert.match(source, /Analytics source: \$\{analyticsPath\}/, "ties the discussion back to the familiar analytics page");
    assert.match(source, /origin: "chat"/, "thread signal discussions stay regular chat threads");
    assert.doesNotMatch(source, /origin: "eval"/, "thread signal discussions are not routed through Evals");
    assert.match(source, /className="fa-thread-review-item"[\s\S]*onClick=\{\(\) => discussReviewItem\(familiarId, item\)\}/, "each review item is a clickable button");
  });
});

describe("thread-signals metric labeling", () => {
  it("uses plain labels + units for the score bars and context pills", () => {
    assert.match(source, /label="Avg file-finding"/, "jargon 'file locatability' is renamed to plain 'file-finding'");
    assert.doesNotMatch(source, /file locatability/, "the 'locatability' jargon is gone from the UI label");
    assert.match(source, /CONTEXT_PRESSURE_HINT/, "context-pressure pills carry a plain-language legend tooltip");
    assert.match(source, /<span className="fa-metric-unit">\/100<\/span>/, "score bars show their /100 unit");
  });
});
