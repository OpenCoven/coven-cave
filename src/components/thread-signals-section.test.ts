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

  it("orders the queue severity-first — a rank-boosted warning never outranks a critical", () => {
    // A high-frequency, high-impact blocker in 9 of 20 reports (45% — below
    // the >50% crit flip) stays a WARNING but accrues rankScore 9×3=27 →
    // rank 97, which beat critical skill-access items (rank 85) under the
    // old rank-only ordering.
    const mixed = [
      ...Array.from({ length: 9 }, (_, index) =>
        report({
          id: `w${index}`,
          persistentBlockers: [
            { id: "flaky", title: "Flaky proxy", category: "infra", impact: "high", detail: "drops" },
          ],
        })),
      ...Array.from({ length: 11 }, (_, index) => report({ id: `p${index}` })),
    ];
    mixed[9] = report({ id: "p0", skillsNeedingAccess: [{ skillId: "github", reason: "token expired" }] });
    const review = buildThreadSignalReviewQueue(aggregateThreadSignals(mixed));
    const flaky = review.find((item) => item.title === "Flaky proxy");
    const access = review.find((item) => item.title === "github");
    assert.equal(flaky?.severity, "warning", "the boosted blocker stays a warning");
    assert.equal(access?.severity, "critical", "the access gap stays critical");
    assert.ok(
      review.indexOf(access!) < review.indexOf(flaky!),
      "the critical access gap sorts before the rank-boosted warning blocker",
    );
    const severities = review.map((item) => item.severity);
    const firstWarning = severities.indexOf("warning");
    assert.ok(
      firstWarning === -1 || !severities.slice(firstWarning).includes("critical"),
      "every critical sorts before every warning",
    );
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

  it("launches a resolution thread from a review item, primed with an auto-sent fix prompt", () => {
    assert.match(source, /buildThreadSignalResolutionPrompt/, "seeds the thread with a resolution-directive prompt");
    assert.match(source, /requestAgentsNewChat\(\{/, "opens a new chat thread via the cross-page launcher");
    assert.doesNotMatch(
      source,
      /new CustomEvent\("cave:agents-new-chat"/,
      "no raw dispatch — this section renders on standalone routes where no listener is mounted (cave-hbpb)",
    );
    assert.match(source, /Analytics source: \$\{analyticsPath\}/, "ties the thread back to the familiar analytics page");
    assert.match(source, /origin: "chat"/, "thread signal resolutions stay regular chat threads");
    assert.doesNotMatch(source, /origin: "eval"/, "thread signal resolutions are not routed through Evals");
    assert.match(source, /className="fa-thread-review-item"[\s\S]*onClick=\{\(\) => launchResolutionThread\(familiarId, item\)\}/, "each review item is a clickable button");
    assert.match(source, /Launch a thread to resolve/, "the affordance says it launches a resolution thread");
  });

  it("launches a resolution thread from actionable table rows", () => {
    assert.match(source, /function resolveRow\(familiarId: string, row: ThreadSignalTableRow\)/, "rows are shaped into review items");
    assert.match(source, /if \(!row\.kind\) return;/, "purely informational rows (skills used most) cannot launch a resolution");
    assert.match(source, /onClick=\{\(\) => resolveRow\(familiarId, row\)\}/, "row action launches the resolution thread");
    assert.match(source, /kind: "blocker",/, "blocker rows carry a review kind");
    assert.match(source, /kind: "skill-access",/, "access-gap rows carry a review kind");
    assert.match(source, /kind: "skill-clarity",/, "clarity-gap rows carry a review kind");
    assert.match(source, /kind: "capability",/, "capability rows carry a review kind");
    assert.match(source, />\s*Resolve\s*<\/Button>/, "row affordance is labeled Resolve");
  });
});

describe("thread-signals metric ownership", () => {
  it("leaves the metric averages + context mix to the fa-confidence panel (no duplication)", () => {
    // The score bars and context-pressure pills moved to the "Confidence from
    // thread analysis" section (familiar-analytics-view.tsx) — this section
    // owns the review queue + signal table only.
    assert.doesNotMatch(source, /fa-thread-score-grid/, "no duplicate metric grid in the signals section");
    assert.doesNotMatch(source, /fa-thread-contexts/, "no duplicate context pills in the signals section");
    assert.doesNotMatch(source, /file locatability/, "the 'locatability' jargon stays out of UI labels");
    assert.match(source, /fa-confidence/, "the section comments point readers at the metrics' new home");
  });
});

describe("review queue UX — filters, dismiss with undo, keyboard parity", () => {
  it("filters the queue by signal kind with pressed-state chips and announcements", () => {
    assert.match(source, /KIND_CHIP_ORDER\.filter\(\(kind\) => kindCounts\.has\(kind\)\)/, "chips render only for kinds present");
    assert.match(source, /aria-pressed=\{kindFilter === kind\}/, "chips expose pressed state");
    assert.match(source, /aria-label="Filter review queue by signal kind"/, "the chip row is a named group");
    assert.match(source, /announce\(\s*next\s*\?\s*`Filtered to /, "filter changes are announced");
    assert.match(source, /if \(kindFilter && !kindCounts\.has\(kindFilter\)\) setKindFilter\(null\);/, "a filter never points at an empty kind");
    assert.match(source, /No signals of this kind — pick another filter\./, "a filtered-empty queue explains itself");
  });

  it("dismisses (acknowledges) items behind an undo toast, persisted per familiar", () => {
    assert.match(source, /useUndoDelete<ThreadSignalReviewItem>/, "dismissal rides the shared undo-delete controller");
    assert.match(source, /<UndoToast/, "a pending dismissal shows the shared undo toast");
    assert.match(source, /addSignalDismissal\(familiarId, item, safeLocalStorage\(\)\)/, "committing persists via the pure dismissals lib");
    assert.match(source, /partitionDismissedSignals\(queue, dismissals\)/, "the queue splits visible vs dismissed");
    assert.match(source, /signalIdentity\(item\) !== pendingIdentity/, "the pending item hides during the undo window");
    assert.match(source, /Restore \{dismissed\.length\} dismissed/, "acknowledged signals stay restorable — no black hole");
    assert.match(source, /clearSignalDismissals\(familiarId, safeLocalStorage\(\)\)/, "restore clears the persisted map");
    assert.match(source, /Every review item is acknowledged — restore them above/, "an all-dismissed queue explains itself");
    assert.match(source, /aria-label=\{`Dismiss \$\{item\.title\}`\}/, "each dismiss control names its signal");
  });

  it("gives the queue roving-tabindex keyboard parity with Delete-to-dismiss", () => {
    assert.match(source, /import \{ useRovingTabIndex \} from "@\/lib\/use-roving-tabindex"/, "uses the shared roving hook");
    assert.match(source, /itemSelector: "\.fa-thread-review-item"/, "the resolve buttons are the roving items");
    assert.match(source, /orientation: "vertical"/, "arrows move vertically through the queue");
    assert.match(source, /event\.key !== "Delete" && event\.key !== "Backspace"/, "Delete/Backspace dismisses the focused item");
    assert.match(source, /data-signal-identity/, "keyboard dismissal resolves the item by its stable identity");
    assert.match(source, /aria-describedby=\{`fa-review-keys-\$\{familiarId\}`\}/, "the list points AT users at the key help");
    assert.match(source, /Press Enter to open a resolution/, "sr-only copy teaches the keys");
    assert.match(source, /tabIndex=\{-1\}/, "dismiss buttons stay out of the tab order (one tab stop per list)");
  });

  it("announces queue count changes via an aria-live region", () => {
    assert.match(source, /<span aria-live="polite">/, "the item count is a live region");
    assert.match(source, /\$\{shown\.length\} of \$\{queue\.length\} item/, "a filtered count states shown-of-total");
  });

  it("severity-first ordering is pinned in the lib", () => {
    const lib = readFileSync(new URL("../lib/thread-self-report.ts", import.meta.url), "utf8");
    assert.match(lib, /REVIEW_SEVERITY_ORDER\[a\.severity\] - REVIEW_SEVERITY_ORDER\[b\.severity\]/, "queue sorts by severity tier before rank");
  });
});

describe("signal table UX — sticky header, coarse-pointer overflow, empty discipline", () => {
  it("pins the header row while the wrap scrolls", () => {
    assert.match(
      globals,
      /\.fa-thread-table thead th \{[^}]*position: sticky;[^}]*top: 0;[^}]*background: var\(--bg-raised\);/,
      "thead cells stick to the top of the scrolling wrap on a solid token background",
    );
  });

  it("collapses row actions into one overflow menu on coarse pointers", () => {
    assert.match(source, /const coarsePointer = useIsCoarsePointer\(\);/, "consolidation keys on (pointer: coarse), not viewport");
    assert.match(source, /coarsePointer \? \(/, "coarse pointers take the consolidated branch");
    assert.match(source, /<OverflowMenu ariaLabel=\{`Actions for signal \$\{row\.signal\}`\}/, "the ⋯ trigger names its signal");
    assert.match(source, /Resolve in a thread/, "menu carries the resolve action");
    assert.match(source, /Add task to board/, "menu carries the task action");
    assert.match(source, /Task already on board/, "settled rows read as settled inside the menu");
  });

  it("shows one empty state when the aggregate carries no signals at all", () => {
    assert.match(source, /if \(allRows\.length === 0\)/, "an all-empty table collapses to a single empty state");
    assert.match(source, /No signals in these reports\./, "the empty state names the real condition");
    assert.match(source, /No access gaps\./, "per-category empties survive for partially-filled tables");
  });
});
