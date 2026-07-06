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
        total: 1,
        reports: [
          {
            id: "thread-report-1",
            familiarId: "cody",
            sessionId: "session-1",
            reportedAt: "2026-06-25T12:00:00.000Z",
            overallConfidence: 80,
            toolReliability: { score: 70, failedTools: [], unreliableTools: [] },
            contextPressure: "adequate",
            skillsUsed: [],
            skillsNeedingClarity: [],
            skillsNeedingAccess: [],
            capabilitiesLacking: [],
            capabilitiesVital: [],
            memoryRecallScore: 65,
            fileLocatabilityScore: 60,
            persistentBlockers: [],
          },
        ],
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
  ]);

  globalThis.fetch = (async (url: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => responses.get(String(url)),
  })) as typeof fetch;
}

describe("FamiliarAnalyticsView", () => {
  it("builds a renderable model with mocked fetch responses and shows the Low label", async () => {
    mockFetchFor("low");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.confidence.label, "Low");
    assert.equal(model.responseConfidenceRollup.eventCount, 2);
    assert.equal(model.responseConfidenceRollup.averageConfidence, 70);
    assert.equal(model.responseConfidenceRollup.lowConfidenceCount, 1);
    assert.match(source, /export function FamiliarAnalyticsContent/);
  });

  it("shows the Trusted label for high-data mocks", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.confidence.label, "Trusted");
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
});
