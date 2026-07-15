import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
} from "./familiar-analytics-data.ts";

const source = readFileSync(new URL("./familiar-analytics-view.tsx", import.meta.url), "utf8");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

function mockFetchFor(score: "low" | "trusted") {
  const familiar =
    score === "trusted"
      ? { id: "cody", display_name: "Cody", role: "agent", memory_freshness: "fresh", avatarUrl: "/avatar.png" }
      : { id: "cody", display_name: "Cody", role: "agent", memory_freshness: null };
  const contract =
    score === "trusted"
      ? {
          specVersion: "0.1.0",
          pass: true,
          properties: [
            { property: "Named Identity", pass: true },
            { property: "Defined Purpose", pass: true },
            { property: "Bounded Authority", pass: true },
            { property: "Persistent Memory", pass: true },
            { property: "Human Belonging", pass: true },
          ],
          violations: [],
          warnings: [],
        }
      : {
          specVersion: "0.1.0",
          pass: false,
          properties: [
            { property: "Named Identity", pass: false },
            { property: "Defined Purpose", pass: false },
            { property: "Bounded Authority", pass: false },
            { property: "Persistent Memory", pass: false },
            { property: "Human Belonging", pass: false },
          ],
          violations: [],
          warnings: [],
        };

  const responses = new Map<string, unknown>([
    ["/api/familiars", { ok: true, familiars: [familiar] }],
    ["/api/familiars/cody/contract", { ok: true, report: contract }],
    [
      "/api/sessions/list",
      {
        ok: true,
        sessions: score === "trusted"
          ? Array.from({ length: 10 }, (_, index) => ({
              id: `session-${index}`,
              project_root: "/tmp/cave",
              harness: "codex",
              title: "Session",
              status: "complete",
              exit_code: 0,
              archived_at: null,
              created_at: "2026-06-25T12:00:00.000Z",
              updated_at: "2026-06-25T12:00:00.000Z",
              familiarId: "cody",
            }))
          : [],
      },
    ],
    [
      "/api/coven-memory",
      {
        ok: true,
        entries: score === "trusted"
          ? [
              {
                id: "memory-1",
                familiar_id: "cody",
                title: "Recent memory",
                path: "memory.md",
                updated_at: "2026-06-25T12:00:00.000Z",
              },
            ]
          : [],
      },
    ],
    [
      "/api/retro-runs",
      {
        ok: true,
        snapshot: {
          generatedAt: "2026-06-25T12:00:00.000Z",
          summary: {
            totalRuns: score === "trusted" ? 5 : 0,
            accepted: score === "trusted" ? 5 : 0,
            reverted: 0,
            runningFamiliars: 0,
            familiarsWithData: score === "trusted" ? 1 : 0,
            trackCounts: { synthesis: score === "trusted" ? 5 : 0, prompt: 0, memory: 0 },
            lastRun: null,
          },
          familiars:
            score === "trusted"
              ? [
                  {
                    familiarId: "cody",
                    familiarName: "Cody",
                    familiarRole: "agent",
                    lastRun: "2026-06-25T12:00:00.000Z",
                    running: false,
                    trackCounts: { synthesis: 5, prompt: 0, memory: 0 },
                    totalAccepted: 5,
                    totalReverted: 0,
                    runs: [
                      {
                        id: "run-1",
                        familiarId: "cody",
                        familiarName: "Cody",
                        familiarRole: "agent",
                        iterationId: "iter-1",
                        iteration: 1,
                        timestamp: "2026-06-25T12:00:00.000Z",
                        track: "synthesis",
                        outcome: "ACCEPT",
                        changeSummary: "Accepted",
                        metricBefore: 0,
                        metricAfter: 1,
                        delta: 1,
                        raw: {},
                      },
                      {
                        id: "run-2",
                        familiarId: "cody",
                        familiarName: "Cody",
                        familiarRole: "agent",
                        iterationId: "iter-2",
                        iteration: 2,
                        timestamp: "2026-06-24T12:00:00.000Z",
                        track: "synthesis",
                        outcome: "ACCEPT",
                        changeSummary: "Accepted",
                        metricBefore: 0,
                        metricAfter: 1,
                        delta: 1,
                        raw: {},
                      },
                      {
                        id: "run-3",
                        familiarId: "cody",
                        familiarName: "Cody",
                        familiarRole: "agent",
                        iterationId: "iter-3",
                        iteration: 3,
                        timestamp: "2026-06-23T12:00:00.000Z",
                        track: "synthesis",
                        outcome: "ACCEPT",
                        changeSummary: "Accepted",
                        metricBefore: 0,
                        metricAfter: 1,
                        delta: 1,
                        raw: {},
                      },
                      {
                        id: "run-4",
                        familiarId: "cody",
                        familiarName: "Cody",
                        familiarRole: "agent",
                        iterationId: "iter-4",
                        iteration: 4,
                        timestamp: "2026-06-22T12:00:00.000Z",
                        track: "synthesis",
                        outcome: "ACCEPT",
                        changeSummary: "Accepted",
                        metricBefore: 0,
                        metricAfter: 1,
                        delta: 1,
                        raw: {},
                      },
                      {
                        id: "run-5",
                        familiarId: "cody",
                        familiarName: "Cody",
                        familiarRole: "agent",
                        iterationId: "iter-5",
                        iteration: 5,
                        timestamp: "2026-06-21T12:00:00.000Z",
                        track: "synthesis",
                        outcome: "ACCEPT",
                        changeSummary: "Accepted",
                        metricBefore: 0,
                        metricAfter: 1,
                        delta: 1,
                        raw: {},
                      },
                    ],
                    raw: {},
                  },
                ]
              : [],
          runs: [],
        },
      },
    ],
    [
      "/api/familiars/cody/self-reports?limit=30",
      {
        ok: true,
        total: score === "trusted" ? 1 : 0,
        reports: score === "trusted"
          ? [
              {
                id: "thread-report-1",
                familiarId: "cody",
                sessionId: "session-1",
                reportedAt: "2026-06-25T12:00:00.000Z",
                overallConfidence: 90,
                toolReliability: { score: 85, failedTools: [], unreliableTools: [] },
                contextPressure: "adequate",
                skillsUsed: [],
                skillsNeedingClarity: [],
                skillsNeedingAccess: [],
                capabilitiesLacking: [],
                capabilitiesVital: [],
                memoryRecallScore: 80,
                fileLocatabilityScore: 80,
                persistentBlockers: [],
              },
            ]
          : [],
      },
    ],
    [
      "/api/familiars/cody/self-reports/snapshots",
      {
        ok: true,
        total: score === "trusted" ? 2 : 0,
        snapshots: score === "trusted"
          ? [
              {
                id: "thread-report-0",
                sessionId: "session-0",
                reportedAt: "2026-06-20T12:00:00.000Z",
                confidence: 60,
                toolReliability: 60,
                memoryRecall: 60,
                fileLocatability: 60,
                contextPressure: "adequate",
              },
              {
                id: "thread-report-1",
                sessionId: "session-1",
                reportedAt: "2026-06-25T12:00:00.000Z",
                confidence: 90,
                toolReliability: 85,
                memoryRecall: 80,
                fileLocatability: 80,
                contextPressure: "adequate",
              },
            ]
          : [],
      },
    ],
    [
      "/api/familiars/cody/response-confidence?limit=100",
      {
        ok: true,
        total: 2,
        events: [
          {
            id: "confidence-2",
            familiarId: "cody",
            sessionId: "session-2",
            responseId: "response-2",
            responseAt: "2026-06-25T12:04:00.000Z",
            reportedAt: "2026-06-25T12:04:02.000Z",
            overallConfidence: 90,
            factors: {
              toolUse: { score: 100, weight: 1, reason: "Tools clean.", signals: [] },
              context: { score: 80, weight: 1, reason: "Context enough.", signals: [] },
              skills: { score: 75, weight: 1, reason: "Skill used.", signals: [] },
              permissions: { score: 100, weight: 1, reason: "No block.", signals: [] },
              memory: { score: 60, weight: 1, reason: "Memory partial.", signals: [] },
              instructionFit: { score: 85, weight: 1, reason: "On task.", signals: [] },
              evidence: { score: 80, weight: 1, reason: "Tests present.", signals: [] },
            },
            diagnosticTags: ["needs-source"],
            rubricVersion: "2026-06-28.v1",
          },
          {
            id: "confidence-1",
            familiarId: "cody",
            sessionId: "session-1",
            responseId: "response-1",
            responseAt: "2026-06-25T12:00:00.000Z",
            reportedAt: "2026-06-25T12:00:02.000Z",
            overallConfidence: 50,
            factors: {
              toolUse: { score: 20, weight: 2, reason: "Tool failed.", signals: ["tool-failed"] },
              context: { score: 40, weight: 1, reason: "Context tight.", signals: ["context-tight"] },
              skills: { score: 70, weight: 1, reason: "Skill ok.", signals: [] },
              permissions: { score: 80, weight: 1, reason: "No block.", signals: [] },
              memory: { score: 60, weight: 1, reason: "Memory partial.", signals: [] },
              instructionFit: { score: 90, weight: 1, reason: "Fit.", signals: [] },
              evidence: { score: 30, weight: 1, reason: "Thin evidence.", signals: ["needs-source"] },
            },
            diagnosticTags: ["tool-failed", "needs-source"],
            rubricVersion: "2026-06-28.v1",
          },
        ],
      },
    ],
    [
      "/api/feedback/message?familiarId=cody",
      {
        ok: true,
        rollup: {
          up: 2,
          down: 1,
          total: 3,
          models: [{ key: "claude-sonnet-4", up: 2, down: 1, total: 3, approval: 2 / 3 }],
          runtimes: [{ key: "claude", up: 2, down: 1, total: 3, approval: 2 / 3 }],
        },
      },
    ],
  ]);

  globalThis.fetch = (async (url: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => responses.get(String(url)),
  })) as typeof fetch;
}

describe("FamiliarAnalyticsView", () => {
  it("drops stale load settles and resets to skeleton on a familiar switch (cave-5p5m)", () => {
    // Loads interleave (mount, familiar switch, manual refresh, 60s poll,
    // on-focus refresh); App Router client nav can reuse the component
    // instance across /familiars/A/analytics → /B/analytics, so a slow A
    // response must never land its data — or error, or freshness stamp —
    // under B's URL, and B must open on a skeleton, not A's numbers.
    assert.match(source, /const gen = \+\+generation\.current/);
    assert.match(source, /if \(generation\.current !== gen\) return;/);
    assert.match(source, /if \(generation\.current === gen\) \{\s*setLoading\(false\);/);
    assert.match(source, /setData\(null\);\s*setUpdatedAt\(null\);\s*void load\(\);/, "familiar switch drops the previous model + stamp");
    assert.match(source, /aria-busy=\{loading \|\| refreshing\}/, "busy covers full loads, not just quiet refreshes");
  });

  it("builds a renderable model; with no thread reports confidence is unmeasured, not Low", async () => {
    mockFetchFor("low");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.confidence.hasData, false);
    assert.equal(model.confidence.score, 0);
    assert.equal(model.confidence.reportCount, 0);
    assert.equal(model.responseConfidenceRollup.eventCount, 2);
    assert.equal(model.responseConfidenceRollup.averageConfidence, 70);
    assert.equal(model.responseConfidenceRollup.lowConfidenceCount, 1);
    assert.match(source, /export function FamiliarAnalyticsContent/);
  });

  it("derives the Trusted label from real thread self-report metrics", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    // 90*.35 + 85*.25 + 80*.2 + 80*.2 = 84.75 → 85.
    assert.equal(model.confidence.hasData, true);
    assert.equal(model.confidence.score, 85);
    assert.equal(model.confidence.label, "Trusted");
    assert.equal(model.confidence.reportCount, 1);
  });

  it("derives signal trends from metric snapshots under a fixed clock", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-06-25T20:00:00.000Z"));

    assert.equal(model.signalTrends.granularity, "day");
    assert.equal(model.signalTrends.snapshotCount, 2);
    // Bucket scores: Jun 20 → 60, Jun 25 → 85 (weighted like the headline).
    assert.equal(model.signalTrends.overall.latest, 85);
    assert.equal(model.signalTrends.overall.previous, 60);
    assert.equal(model.signalTrends.overall.direction, "improving");
    assert.ok(model.signalTrends.metrics.every((metric) => metric.direction === "improving"));
  });

  it("keeps trends honestly insufficient with no snapshots", async () => {
    mockFetchFor("low");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-06-25T20:00:00.000Z"));

    assert.equal(model.signalTrends.snapshotCount, 0);
    assert.equal(model.signalTrends.overall.direction, "insufficient");
    assert.equal(model.signalTrends.overall.delta, null);
  });

  it("degrades gracefully when an endpoint fails instead of blanking the view", async () => {
    mockFetchFor("trusted");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "/api/familiars/cody/contract") {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      }
      return realFetch(url);
    }) as typeof fetch;

    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    // The whole load still resolves; the failure is surfaced, not thrown.
    assert.ok(model.errors.some((message) => message.includes("HTTP 500")));
    assert.equal(model.familiar?.id, "cody");
    assert.equal(model.contractReport, null);
  });

  it("renders the heal request count and keeps thread analytics present", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.healRequests.length, 1);
    assert.equal(model.threadReports.length, 1);
    assert.match(source, /escalateBlockers\(model\.familiarId, threadSignalsAggregate, model\.healRequests\)/);
    assert.match(source, /healRequests\.length === 1 \? "request" : "requests"/);
    assert.match(source, /ResponseConfidenceSection/);
    assert.match(source, /<ThreadSignalsSection[\s\S]*reports=\{model\.threadReports\}/);
    assert.doesNotMatch(source, /EvalLoopPanel/);
    assert.doesNotMatch(source, /fa-eval/);
  });

  it("renders a confidence ring and a scannable KPI summary row", () => {
    // Hero confidence ring (radial progress) replaces the flat score box.
    assert.match(source, /<ConfidenceRing confidence=\{model\.confidence\}/, "header uses the confidence ring");
    assert.match(source, /className="fa-ring__value"/, "ring draws a progress arc");
    assert.match(source, /strokeDasharray/, "ring arc length tracks the score");

    // KPI row surfaces growth / contract / heal / thread signals up top.
    assert.match(source, /<FamiliarKpis model=\{model\} healRequestCount=\{healRequests\.length\}/, "KPI row is wired to the model");
    assert.match(source, /function deriveKpis/, "KPIs are derived from the model");
    assert.match(source, /model\.growthReport/, "KPIs read the (previously unsurfaced) growth report");
    assert.match(source, /contract\.properties\.filter\(\(p\) => p\.pass\)/, "contract KPI shows the pass rate");
    assert.match(source, /className=\{`fa-kpi\$\{kpi\.tone/, "KPI tiles tint by tone");
  });

  it("synthesizes a plain-language insight banner above the KPIs", () => {
    assert.match(source, /import \{ deriveAnalyticsInsight \} from "@\/lib\/familiar-analytics-insight"/, "view uses the insight helper");
    assert.match(source, /<AnalyticsInsightBanner model=\{model\} healRequestCount=\{healRequests\.length\}/, "banner is rendered with the model");
    assert.match(source, /deriveAnalyticsInsight\(model, healRequestCount\)/, "banner derives the insight from the model");
    assert.match(source, /fa-insight--\$\{insight\.tone\}/, "banner is tinted by tone");
    assert.match(source, /responseConfidenceRollup\.eventCount/, "KPI row includes response confidence event count");
  });

  it("derives a 14-day session pulse and renders it in the hero", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-06-25T20:00:00.000Z"));

    assert.equal(model.sessionPulse.length, 14);
    // All ten mock sessions land on 2026-06-25 — the newest pulse day.
    assert.equal(model.sessionPulse[13].count, 10);
    assert.equal(model.sessionPulse[13].key, "2026-06-25");
    assert.match(source, /<PulseBars/, "hero renders the pulse bars");
    assert.match(source, /model\.sessionPulse/, "pulse is wired to the model");
  });

  it("surfaces thumbs-vote model/runtime performance from the feedback rollup", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.modelFeedback.total, 3, "the rollup rides the model");
    assert.equal(model.modelFeedback.models[0].key, "claude-sonnet-4");
    assert.equal(model.modelFeedback.runtimes[0].up, 2);
    assert.match(source, /id="fa-model-performance"/, "the view renders a Model performance section");
    assert.match(source, /<ModelFeedbackSection rollup=\{model\.modelFeedback\}/, "section is wired to the rollup");
    assert.match(source, /ph:thumbs-up/, "rows show up-vote counts");
    assert.match(source, /ph:thumbs-down/, "rows show down-vote counts");
  });

  it("makes each KPI tile a drill-through link to the section it summarizes", () => {
    assert.match(source, /href: "#fa-contract"/);
    assert.match(source, /href: "#fa-heal"/);
    assert.match(source, /href: "#fa-thread-signals"/);
    assert.match(source, /href: "#fa-response-confidence"/);
    assert.match(source, /href: "\/dashboard\/familiars\/growth"/, "activity KPI links to the growth page");
    assert.match(source, /href=\{kpi\.href\}/, "tiles render as anchors");
    assert.match(source, /<section id=\{id\}/, "sections carry the ids the tiles target");
  });

  it("charts the response-confidence trend and announces refreshes", () => {
    assert.match(source, /function buildResponseTrend/, "trend is derived from the raw events");
    assert.match(source, /<Sparkline points=\{trend\}/, "trend renders as a sparkline");
    assert.match(source, /useAnnouncer/, "view announces state changes");
    assert.match(source, /announce\("Analytics refreshed\."\)/, "manual refresh is announced");
  });

  it("lays sections out in a container-responsive grid (inspector-pane safe)", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(source, /className="fa-grid"/, "sections are wrapped in the grid");
    assert.match(globals, /\.fa-grid\s*\{/, ".fa-grid rule exists");
    assert.match(globals, /container-name: fa/, ".fa-page is a size container");
    assert.match(globals, /@container fa \(max-width: 880px\)/, "grid collapses by pane width, not viewport");
  });

  it("makes .fa-page own its vertical scroll (html/body are overflow:hidden)", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const block = globals.match(/\.fa-page\s*\{[^}]*\}/);
    assert.ok(block, ".fa-page rule should exist");
    assert.match(block![0], /overflow-y:\s*auto/, ".fa-page must scroll its own content on the full-page route");
    assert.doesNotMatch(block![0], /min-height:\s*100%/, ".fa-page should fill (height:100%), not just min-height, so overflow can trigger");
  });

  it("modernized chrome: sticky freshness topbar, drill flashes, actionable insight (cave UX audit)", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

    // Truthful freshness stamp + visible refresh progress in a sticky topbar.
    assert.match(source, /setUpdatedAt\(new Date\(\)\.toISOString\(\)\)/, "updatedAt is stamped by the load that actually landed");
    assert.match(source, /Updated <RelativeTime iso=\{updatedAt\} \/>/, "topbar renders the freshness stamp");
    assert.match(source, /refreshing \? " is-refreshing" : ""/, "refresh button carries a refreshing state class");
    assert.match(globals, /\.fa-topbar\s*\{[^}]*position:\s*sticky/, "breadcrumb topbar is sticky");
    assert.match(globals, /fa-refresh-spin/, "refresh spins while a quiet reload is in flight");

    // Empty response-confidence never takes the wide hero slot.
    assert.match(
      source,
      /wide=\{model\.responseConfidenceRollup\.eventCount > 0\}/,
      "the response-confidence section only widens when it has data",
    );

    // Drill-throughs glide and flash their landing section.
    assert.match(globals, /\.fa-page\s*\{[^}]*scroll-behavior:\s*smooth/, "in-page drills scroll smoothly");
    assert.match(globals, /\.fa-section\s*\{[^}]*scroll-margin-top/, "sections land clear of the sticky bar");
    assert.match(globals, /\.fa-section:target\s*\{/, "the landing section flashes for orientation");

    // KPI tiles carry a reveal-on-hover drill cue.
    assert.match(source, /className="fa-kpi__go"/, "KPI tiles render the drill chevron");

    // Actionable insight banners carry their own next step.
    assert.match(source, /className="fa-insight__action focus-ring" href="#fa-heal"/, "attention insights link to the heal section");

    // All decorative motion holds still under prefers-reduced-motion.
    assert.match(
      globals,
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.fa-page\s*\{\s*scroll-behavior:\s*auto/,
      "smooth scrolling is disabled under reduced motion",
    );

    // Narrow-pane tier exists (inspector tab / phones).
    assert.match(globals, /@container fa \(max-width: 420px\)/, "a phone-width container tier hardens the narrowest panes");
  });
});

describe("session tracking + tracing (recent sessions, pulse drill, trace overlay)", () => {
  it("exposes the familiar's recent sessions on the model, newest first", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.recentSessions.length, 10, "all mock sessions ride the model");
    assert.ok(
      model.recentSessions.every((session) => session.familiarId === "cody"),
      "sessions are scoped to this familiar",
    );
  });

  it("renders a Recent sessions section with open-thread and trace actions", () => {
    assert.match(source, /id="fa-sessions"/, "the section carries its drill anchor");
    assert.match(source, /<RecentSessionsSection/, "section renders the sessions list");
    assert.match(
      source,
      /href=\{`\/#chat-\$\{encodeURIComponent\(session\.id\)\}`\}/,
      "each row opens its thread via the chat hash deep link",
    );
    assert.match(source, /onTrace\(\{ id: session\.id, title: session\.title \}\)/, "each row can open the trace overlay");
    assert.match(source, /<SessionTraceOverlay target=\{traceTarget\}/, "the overlay is rendered from page state");
    assert.match(source, /Showing \{shown\.length\} of \{filtered\.length\} sessions\./, "truncation is stated, never silent");
  });

  it("makes the hero pulse interactive — a clicked day filters the sessions list", () => {
    assert.match(source, /onSelectDay=\{handleSelectDay\}/, "hero pulse takes the day-select handler");
    assert.match(source, /selectedKey=\{selectedDay\?\.key \?\? null\}/, "selection state rides back into the bars");
    assert.match(source, /sessionDayKey\(session\.updated_at\) === selectedDay\.key/, "the list filters by the pulse's own day bucketing");
    assert.match(source, /getElementById\("fa-sessions"\)\?\.scrollIntoView/, "selecting a day lands the reader on the list");
    assert.match(source, /className="fa-day-chip focus-ring"/, "an active day filter shows a clearable chip");
    // The interactive bars are real buttons with pressed state (not color alone).
    const pulseBars = readFileSync(new URL("./ui/pulse-bars.tsx", import.meta.url), "utf8");
    assert.match(pulseBars, /aria-pressed=\{selected\}/, "selected day is exposed to AT");
    assert.match(pulseBars, /onSelectDay\?: \(day: PulseDay\) => void/, "interactivity is opt-in — existing decorative uses are untouched");
  });

  it("links each response-confidence event back to the session that produced it", () => {
    assert.match(
      source,
      /href=\{`\/#chat-\$\{encodeURIComponent\(event\.sessionId\)\}`\}/,
      "events deep-link into their thread",
    );
    assert.match(source, /RECENT_RESPONSE_EVENTS/, "the raw-event list is capped, not unbounded");
    assert.match(source, /fa-response-score--\$\{confidenceScoreTone\(event\.overallConfidence\)\}/, "score chips tint by the trend thresholds");
    assert.match(source, /onTrace\(\{ id: event\.sessionId, title: event\.threadTitle \}\)/, "events can open the session trace");
  });

  it("keeps the page live with a pausable poll that never spams AT", () => {
    assert.match(source, /import \{ usePausablePoll \} from "@\/lib\/use-pausable-poll"/);
    assert.match(source, /usePausablePoll\(\(\) => void load\(\{ quiet: true, silent: true \}\), 60_000\)/, "background refresh every 60s, hidden-tab safe");
    assert.match(source, /if \(quiet && !silent\) announce\("Analytics refreshed\."\)/, "only manual refreshes announce");
  });
});

describe("confidence from thread analysis + metric labeling", () => {
  it("drives the fa-confidence panel from real thread metrics, not synthetic factors", () => {
    // The synthetic weighted-factor breakdown (familiar-confidence.ts) is gone
    // from this page — the panel renders the self-reported metric averages.
    assert.doesNotMatch(source, /CONFIDENCE_FACTOR_COPY/, "no synthetic factor copy remains");
    assert.doesNotMatch(source, /familiar-confidence/, "the view no longer imports the heuristic lib");
    assert.match(source, /ThreadAnalysisSection/, "the thread-analysis panel replaces the factor list");
    assert.match(source, /id="fa-confidence"/, "the panel keeps the stable fa-confidence anchor");
    assert.match(source, /title="Confidence from thread analysis"/, "the panel is named for its real source");
    assert.match(source, /THREAD_METRIC_COPY/, "each metric carries plain-language meaning");
    assert.match(source, /className="fa-factor-info"/, "an info affordance explains each metric");
    assert.match(source, /adds up to \$\{Math\.round\(weight \* 100\)\} points of the headline score's 100/, "tooltips state each metric's max contribution, not a fixed share");
    assert.match(source, /confidence\.metrics\.map/, "bars render from the derived metric list");
    assert.match(source, /aria-label="Context pressure distribution"/, "the context-pressure mix rides along");
    assert.match(source, /CONTEXT_PRESSURE_HINT/, "context pills carry a plain-language legend tooltip");
  });

  it("teaches enabling self-reporting when there are no thread reports yet", () => {
    assert.match(source, /THREAD_CONFIDENCE_EMPTY_STATE/, "the empty panel uses the teach copy");
    assert.match(source, /headline=\{THREAD_CONFIDENCE_EMPTY_STATE\}/, "the shared enable-CTA empty state is reused");
    assert.match(source, /enabledHeadline="No thread reports yet\."/, "already-enabled familiars get truthful copy");
    assert.match(source, /confidence\.hasData \?/, "the panel branches on real data presence");
  });

  it("renders the changes-over-time trend block with honest verdicts (tokens only)", () => {
    // The verdict chip answers "is the familiar improving?" from the weighted score.
    assert.match(source, /function ThreadTrendBlock/, "the trend block is its own component");
    assert.match(source, /<ThreadTrendBlock trends=\{trends\}/, "the thread-analysis panel renders it");
    assert.match(source, /trends=\{model\.signalTrends\}/, "trends ride the model, computed by the pure lib");
    assert.match(source, /insufficient: "Not enough history yet"/, "insufficient history says so — no invented direction");
    assert.match(source, /fa-trend-verdict--\$\{overall\.direction\}/, "verdict chip carries its direction class");
    // Tokens only: improving = presence accent, regressing = warning.
    assert.match(source, /if \(direction === "improving"\) return "var\(--accent-presence\)"/, "improving uses the presence accent token");
    assert.match(source, /if \(direction === "regressing"\) return "var\(--color-warning\)"/, "regressing uses the warning token");
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, "no hard-coded hex colors in the view");
    // Sparkline reuses the shared primitive (no new chart deps), with gaps kept.
    assert.match(source, /<Sparkline points=\{points\} color=\{trendTokenFor\(overall\.direction\)\}/, "the trend sparkline reuses ui/sparkline");
    assert.match(source, /value: bucket\.score/, "sparkline points come from bucket scores (nulls = honest gaps)");
    assert.match(source, /Trends appear once reports land on two different/, "sparse data explains itself");
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(globals, /\.fa-trend-verdict--improving \{ color: var\(--accent-presence\); \}/, "verdict improving tint is tokenized");
    assert.match(globals, /\.fa-trend-verdict--regressing \{ color: var\(--color-warning\); \}/, "verdict regressing tint is tokenized");
    assert.match(globals, /\.fa-trend-chip--improving \{ color: var\(--accent-presence\); \}/, "chip improving tint is tokenized");
    assert.match(globals, /\.fa-trend-chip--regressing \{ color: var\(--color-warning\); \}/, "chip regressing tint is tokenized");
  });

  it("annotates each metric bar with a delta chip against the previous period", () => {
    assert.match(source, /function TrendDeltaChip/, "delta chips are a dedicated affordance");
    assert.match(source, /if \(trend\.delta === null \|\| trend\.direction === "insufficient"\) return null;/, "no chip without two data buckets");
    assert.match(source, /trend=\{trendByKey\.get\(metric\.key\)\}/, "each metric bar receives its own trend");
    assert.match(source, /vs the previous period/, "chip aria/tooltip names the comparison window");
    assert.match(source, /formatDelta/, "deltas render signed (+8 / -6)");
  });

  it("renders the hero ring from thread confidence with an unmeasured state", () => {
    assert.match(source, /fa-ring--\$\{tier\}/, "ring tier class tracks the derived tier");
    assert.match(source, /confidence\.hasData \? confidenceTier\(confidence\.label\) : "none"/, "no reports → neutral ring, never a fake Low");
    assert.match(source, /Thread confidence not measured yet/, "the unmeasured ring says so to AT");
    assert.match(source, /from \$\{reportPhrase\}/, "the measured ring cites its report count");
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(globals, /\.fa-ring--none\s*\{[^}]*--fa-ring-color:\s*var\(--border-strong\)/, "the unmeasured tier stays neutral (tokens only)");
  });

  it("keeps shared metric-unit styling for 0–100 scores", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    assert.match(source, /className="fa-metric-unit"/, "0–100 scores carry a muted unit suffix");
    assert.match(globals, /\.fa-metric-unit\s*\{/, "the metric-unit style exists");
    assert.match(globals, /\.fa-factor-bar\s*\{[\s\S]*?min-width:\s*44px/, "the metric bar keeps a min-width floor in narrow cells");
    assert.match(globals, /\.fa-thread-analysis\s*\{/, "the thread-analysis panel has its own layout block");
  });

  it("labels the response-confidence tiles + factor grid clearly", () => {
    // 'Low confidence' was a COUNT mislabeled as a score → now unambiguous.
    assert.match(source, /label="Low-confidence responses"/, "the low-confidence COUNT is labeled as responses, not a score");
    assert.match(source, /label="Avg confidence" value=\{rollup\.averageConfidence\} unit="\/100"/, "avg confidence shows its /100 unit");
    assert.match(source, /factorAverages\[key\]\}<span className="fa-metric-unit">\/100<\/span>/, "response factor averages show /100");
  });
});
