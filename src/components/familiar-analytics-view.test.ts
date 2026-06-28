import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
} from "./familiar-analytics-data.ts";

const source = readFileSync(new URL("./familiar-analytics-view.tsx", import.meta.url), "utf8");

const highEvalState = {
  familiar_id: "cody",
  last_run: "2026-06-25T12:00:00.000Z",
  iterations: [
    {
      id: "revert-1",
      timestamp: "2026-06-25T12:00:00.000Z",
      track: "prompt",
      iteration: 1,
      change_summary: "Prompt change reverted",
      metric_before: 0.7,
      metric_after: 0.5,
      delta: -0.2,
      outcome: "REVERT",
    },
  ],
  track_counts: { synthesis: 0, prompt: 1, memory: 0 },
  total_accepted: 0,
  total_reverted: 1,
  running: false,
};

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
    ["/api/skills/eval-loop/cody", { ok: true, state: score === "trusted" ? highEvalState : null }],
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

  it("renders the heal request count and keeps EvalLoopPanel present", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.healRequests.length, 1);
    assert.equal(model.threadReports.length, 1);
    assert.match(source, /escalateBlockers\(model\.familiarId, threadSignalsAggregate, model\.healRequests\)/);
    assert.match(source, /healRequests\.length === 1 \? "request" : "requests"/);
    assert.match(source, /<ThreadSignalsSection[\s\S]*reports=\{model\.threadReports\}/);
    assert.match(source, /<EvalLoopPanel[\s\S]*familiarId=\{model\.familiar\.id\}/);
  });

  it("renders a confidence ring and a scannable KPI summary row", () => {
    // Hero confidence ring (radial progress) replaces the flat score box.
    assert.match(source, /<ConfidenceRing confidence=\{model\.confidence\}/, "header uses the confidence ring");
    assert.match(source, /className="fa-ring__value"/, "ring draws a progress arc");
    assert.match(source, /strokeDasharray/, "ring arc length tracks the score");

    // KPI row surfaces growth / eval / contract / heal signals up top.
    assert.match(source, /<FamiliarKpis model=\{model\} healRequestCount=\{healRequests\.length\}/, "KPI row is wired to the model");
    assert.match(source, /function deriveKpis/, "KPIs are derived from the model");
    assert.match(source, /model\.growthReport/, "KPIs read the (previously unsurfaced) growth report");
    assert.match(source, /contract\.properties\.filter\(\(p\) => p\.pass\)/, "contract KPI shows the pass rate");
    assert.match(source, /className=\{`fa-kpi\$\{kpi\.tone/, "KPI tiles tint by tone");
  });

  it("makes .fa-page own its vertical scroll (html/body are overflow:hidden)", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const block = globals.match(/\.fa-page\s*\{[^}]*\}/);
    assert.ok(block, ".fa-page rule should exist");
    assert.match(block![0], /overflow-y:\s*auto/, ".fa-page must scroll its own content on the full-page route");
    assert.doesNotMatch(block![0], /min-height:\s*100%/, ".fa-page should fill (height:100%), not just min-height, so overflow can trigger");
  });
});
