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

describe("confidence breakdown + metric labeling", () => {
  it("represents each confidence factor by its influence, with plain labels + units", () => {
    const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    // Human names + descriptions replace the raw snake_case factor keys.
    assert.match(source, /CONFIDENCE_FACTOR_COPY/, "factors get plain-language names + descriptions");
    assert.match(source, /name: "Identity contract"/, "contract_score reads as 'Identity contract'");
    assert.match(source, /name: "Retro acceptance"/, "accept_rate reads as 'Retro acceptance'");
    // Bar TRACK scales to weight → filled length reflects contribution (influence), not raw value.
    assert.match(source, /factor\.weight \/ maxWeight/, "the factor bar track scales to the factor's weight");
    assert.match(source, /function maxContribution/, "max contribution (weight×100) is derived per factor");
    assert.match(source, /of \$\{max\} points/, "the bar aria-label states earned-of-max points");
    assert.match(source, /fa-factor-earned/, "each row shows earned points of its max");
    // Native tooltip carries the plain-language meaning.
    assert.match(source, /className="fa-factor-info"/, "an info affordance explains each factor");
    // Muted '/100' unit marks 0–100 scores; min-width keeps low-weight tracks visible.
    assert.match(source, /className="fa-metric-unit"/, "0–100 scores carry a muted unit suffix");
    assert.match(globals, /\.fa-metric-unit\s*\{/, "the metric-unit style exists");
    assert.match(globals, /\.fa-factor-bar\s*\{[\s\S]*?min-width:\s*44px/, "the factor bar has a min-width floor for low-weight tracks");
  });

  it("labels the response-confidence tiles + factor grid clearly", () => {
    // 'Low confidence' was a COUNT mislabeled as a score → now unambiguous.
    assert.match(source, /label="Low-confidence responses"/, "the low-confidence COUNT is labeled as responses, not a score");
    assert.match(source, /label="Avg confidence" value=\{rollup\.averageConfidence\} unit="\/100"/, "avg confidence shows its /100 unit");
    assert.match(source, /factorAverages\[key\]\}<span className="fa-metric-unit">\/100<\/span>/, "response factor averages show /100");
  });
});
