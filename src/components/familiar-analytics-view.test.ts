import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import {
  buildFamiliarAnalyticsModel,
  loadFamiliarAnalyticsData,
} from "./familiar-analytics-data.ts";
import { deriveScopedActivityCadence, withinWindow } from "../lib/analytics-window.ts";
import { deriveThreadConfidence } from "../lib/thread-confidence.ts";
import { deriveSignalTrends, snapshotFromReport } from "../lib/signal-trends.ts";
import { aggregateThreadSignals, buildThreadSignalReviewQueue, type ThreadSelfReport } from "../lib/thread-self-report.ts";
import { clearCanonicalMemoryResources } from "../lib/canonical-memory-resources.ts";
import type { SessionRow } from "../lib/types.ts";

// The workbench is three files: the view owns loading, the content composes
// the frame + stage, and the dock is the fixed identity column. `source` is the
// whole surface; `dockSource` / `stageSource` pin the pieces that must live in
// a specific file (the dock is what stays on screen behind every overlay).
const dockSource = readFileSync(new URL("./familiar-analytics-dock.tsx", import.meta.url), "utf8");
const stageSource = readFileSync(new URL("./familiar-analytics-stage.tsx", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("./familiar-analytics-content.tsx", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("./familiar-analytics-data.ts", import.meta.url), "utf8");
const source = [
  readFileSync(new URL("./familiar-analytics-view.tsx", import.meta.url), "utf8"),
  contentSource,
  dockSource,
  stageSource,
].join("\n");

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCanonicalMemoryResources();
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
      "/api/sessions/list?includeArchived=1&familiarId=cody",
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
                familiarId: "cody",
                title: "Recent memory",
                updatedAt: "2026-06-25T12:00:00.000Z",
                relativeUpdatedAt: "recently",
                excerpt: "A recent verified memory",
                source: { kind: "familiar-memory", label: "Familiar memory" },
                privacy: { classification: null, revealRequired: null },
                verification: { state: "verified" },
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
      "/api/familiars/cody/self-reports?limit=all",
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

  it("derives progression from familiar stats and omits it for a missing familiar", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-06-25T20:00:00.000Z"));

    assert.equal(model.progression?.renown.score, 13, "ten sessions plus one memory earns 13 renown");
    assert.equal(model.progression?.renown.tier.key, "adept");
    assert.equal(model.progression?.renown.next?.remaining, 37);
    assert.equal(model.progression?.renown.progress, 3 / 40);
    assert.equal(model.progression?.streakDays, 1);

    const missing = buildFamiliarAnalyticsModel({ ...data, familiars: [] });
    assert.equal(missing.progression, null);
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

  it("keeps an unavailable canonical list distinct from a confirmed zero", async () => {
    mockFetchFor("trusted");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "/api/coven-memory") {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            ok: false,
            code: "canonical_memory_unavailable",
          }),
        } as unknown as Response;
      }
      return realFetch(url);
    }) as typeof fetch;

    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(data.covenEntries.length, 0);
    assert.equal(data.memoryAvailability, "unavailable");
    assert.ok(model.errors.some((message) => message.includes("memory unavailable")));
    assert.equal(model.progression?.memoryAvailability, "unavailable");
    assert.ok(
      !model.growthReport?.signals.some((signal) => signal.kind === "no-memory"),
      "a failed list must not invent a no-memory growth signal",
    );
  });

  it("renders the heal request count and keeps thread analytics present", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    // Pin the clock nine days after the fixture's June 25 activity: this keeps
    // the intended session-gap request without eventually adding stale memory.
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-07-04T20:00:00.000Z"));

    assert.equal(model.healRequests.length, 1);
    assert.equal(model.threadReports.length, 1);
    assert.match(source, /escalateBlockers\(model\.familiarId, threadSignalsAggregate, model\.healRequests\)/);
    assert.match(stageSource, /request\{healRequests\.length === 1 \? "" : "s"\}/, "the self-heal stat pluralizes its count");
    assert.doesNotMatch(source, /ResponseConfidenceSection/, "response confidence analytics retired (cave-7ku5)");
    assert.match(source, /<ThreadSignalsSection[\s\S]*reports=\{windowReports\}/);
    assert.doesNotMatch(source, /EvalLoopPanel/);
    assert.doesNotMatch(source, /fa-eval/);
  });

  it("renders a trust ring in the dock and a scannable stat band on the stage", () => {
    // The trust ring (radial progress) is the dock's headline read.
    assert.match(dockSource, /<TrustRing confidence=\{confidence\}/, "the dock renders the trust ring");
    assert.match(dockSource, /className="fa-ring__value"/, "ring draws a progress arc");
    assert.match(dockSource, /strokeDasharray/, "ring arc length tracks the score");

    // The stat band replaces the KPI row: activity / contract / self-heal flip
    // cards, plus the signals entry and the pulse.
    assert.match(contentSource, /<StatBand[\s\S]*model=\{model\}/, "the stat band is wired to the model");
    assert.match(stageSource, /export const StatBand/, "the band is its own component");
    assert.match(stageSource, /contract\.properties\.filter\(\(property\) => property\.pass\)/, "the contract stat shows the pass rate");
    assert.match(stageSource, /className=\{`fa-stat__value\$\{/, "stat values tint by tone");
    assert.match(stageSource, /aria-pressed=\{flipped\}/, "a flipped card exposes its state to AT");
  });

  it("synthesizes a plain-language needs-attention card in the dock", () => {
    assert.match(dockSource, /import \{ deriveAnalyticsInsight \} from "@\/lib\/familiar-analytics-insight"/, "the dock uses the insight helper");
    assert.match(dockSource, /deriveAnalyticsInsight\(model, healRequestCount\)/, "the card derives its lede from the model");
    assert.match(dockSource, /fa-insight--\$\{insight\.tone\}/, "the card is tinted by tone");
    assert.match(dockSource, /className="fa-attention__lede">\{insight\.text\}/, "the plain-language line is the insight's own text");
    // Prioritized actions come from the same heal requests the strip shows.
    assert.match(contentSource, /function deriveNextActions/, "the dock's actions are derived from the heal requests");
    assert.match(contentSource, /actions=\{nextActions\}/, "the dock receives them");
    assert.match(dockSource, /className="fa-attention__list"/, "the card renders the prioritized list");
  });

  it("gives progression its own dock card, under the identity and above trust", () => {
    assert.match(
      dockSource,
      /<RenownCard progression=\{model\.progression\} \/>[\s\S]*className="fa-trust-card focus-ring"/,
      "renown sits between the identity card and the trust ring",
    );
    assert.match(dockSource, /Top of the ladder/, "top-tier accessible copy remains explicit");
    assert.match(dockSource, /A session today starts a streak/, "zero streaks use invitational copy");
    assert.match(dockSource, /Renown unavailable/, "an unreadable canonical memory says so rather than showing a fake zero");
  });

  it("derives a 14-day session pulse and renders it in the hero", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data, Date.parse("2026-06-25T20:00:00.000Z"));

    assert.equal(model.sessionPulse.length, 14);
    // All ten mock sessions land on 2026-06-25 — the newest pulse day.
    assert.equal(model.sessionPulse[13].count, 10);
    assert.equal(model.sessionPulse[13].key, "2026-06-25");
    assert.match(stageSource, /<PulseBars/, "the stat band renders the pulse bars");
    assert.match(stageSource, /const pulse = model\.sessionPulse/, "pulse is wired to the model");
  });

  it("surfaces thumbs-vote model/runtime performance from the feedback rollup", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const model = buildFamiliarAnalyticsModel(data);

    assert.equal(model.modelFeedback.total, 3, "the rollup rides the model");
    assert.equal(model.modelFeedback.models[0].key, "claude-sonnet-4");
    assert.equal(model.modelFeedback.runtimes[0].up, 2);
    assert.match(contentSource, /<b>Model performance<\/b>/, "the footer carries a Model performance deep dive");
    assert.match(contentSource, /openOverlay\("model"\)/, "the deep dive opens the full-stage view");
    assert.match(source, /<ModelFeedbackSection rollup=\{model\.modelFeedback\}/, "the panel is wired to the rollup");
    assert.match(source, /ph:thumbs-up/, "rows show up-vote counts");
    assert.match(source, /ph:thumbs-down/, "rows show down-vote counts");
  });

  it("makes every stat tile a drill-through into the evidence behind it", () => {
    // The band's tiles no longer scroll the page — the workbench has no page
    // scroll — so each one opens the surface that proves its number.
    assert.match(stageSource, /onOpenSignals\}/, "the Signals tile opens the thread-signals overlay");
    assert.match(stageSource, /onTogglePulse\}/, "the pulse tile expands the activity detail");
    assert.match(contentSource, /id="fa-confidence"/, "the confidence panel keeps its stable anchor");
    assert.match(contentSource, /id="fa-sessions"/, "the sessions panel keeps its stable anchor");
    assert.match(contentSource, /<div className="fa-panel-slot" id=\{id\}>/, "panels carry the ids the drills target");
    assert.match(dockSource, /href="\/dashboard\/familiars\/growth"/, "the dock breadcrumb still reaches the roster");
  });

  it("announces refreshes to assistive tech", () => {
    assert.match(source, /useAnnouncer/, "view announces state changes");
    assert.match(source, /announce\("Analytics refreshed\."\)/, "manual refresh is announced");
  });

  it("collapses the two-pane workbench in tiers rather than letting it clip", () => {
    // The .fa-* surface CSS is component-imported (not in the global bundle) per
    // #3264, so these rules live in src/styles/familiar-analytics.css.
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    assert.match(contentSource, /className="fa-stage-grid"/, "the two panels share the stage grid");
    assert.match(faCss, /\.fa-stage-grid \{/, ".fa-stage-grid rule exists");
    assert.match(faCss, /@media \(max-width: 1180px\)/, "tablet tier folds the stage grid to one column");
    assert.match(faCss, /@media \(max-width: 900px\)/, "narrow tier stacks the whole frame");
    // The rail is a different tree than the expanded dock, so the fold has to
    // be real state — CSS cannot hide a branch that was never rendered.
    assert.match(
      contentSource,
      /window\.matchMedia\("\(min-width: 901px\) and \(max-width: 1180px\)"\)[\s\S]*setDockCollapsed\(query\.matches\)/,
      "the dock collapse is driven by matchMedia, not by CSS alone",
    );
    const tablet = faCss.slice(
      faCss.indexOf("@media (max-width: 1180px)"),
      faCss.indexOf("@media (max-width: 900px)"),
    );
    assert.match(
      tablet,
      /\.fa-stage \{[^}]*overflow-y: auto/,
      "the fixed-height tablet stage provides a scroll path for both stacked evidence panels",
    );
    assert.match(
      tablet,
      /\.fa-stage-grid \{[^}]*flex: 0 0 auto/,
      "the stacked tablet grid keeps its content height instead of shrinking two 320px panels into the viewport",
    );
    // It is a BAND, not a ceiling. Below 900px the frame stacks into a page, so
    // the rail saves nothing — and a rail stretched across the width turns the
    // avatar into a smear. The full dock has to come back.
    assert.match(faCss, /\.fa-dock--rail > \* \{ flex: none; \}/, "rail marks never stretch, whatever tier they land in");
  });

  it("orders the stage scope → stats → open queue → evidence panels", () => {
    const stage = contentSource.slice(
      contentSource.indexOf('<div className="fa-stage">'),
      contentSource.indexOf("{pulseOpen ?"),
    );
    const scope = stage.indexOf("<ScopeBar");
    const stats = stage.indexOf("<StatBand");
    const heal = stage.indexOf("<SelfHealStrip");
    const panels = stage.indexOf('className="fa-stage-grid"');
    assert.ok(scope >= 0 && scope < stats, "the lens/window scope leads — it governs everything under it");
    assert.ok(stats < heal, "the headline stats read before the queue they summarize");
    assert.ok(heal >= 0 && heal < panels, "the actionable self-heal queue precedes the evidence panels");
    // The contract lives in the dock now (the claim), not the stage (the proof).
    assert.match(dockSource, /aria-label="Contract compliance"/, "the contract check rides the identity dock");
    assert.match(contentSource, /<ContractPanel/, "expanding it opens the anchored detail panel");
  });

  it("stretches panels and centers empty states so a short empty panel leaves no hole", () => {
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    const grid = faCss.match(/\.fa-stage-grid \{[^}]*\}/);
    assert.ok(grid, ".fa-stage-grid rule should exist");
    assert.doesNotMatch(
      grid![0],
      /align-items:/,
      "grid rows stretch (the default), so a panel fills its row instead of floating over a blank gap",
    );
    assert.match(
      faCss,
      /\.fa-panel__body > \.ui-empty-state,\s*\.fa-panel__body > \.fa-thread-empty \{ margin-block: auto; \}/,
      "empty states center vertically inside a stretched panel",
    );
  });

  it("offers a direct review launch when the contract fails", () => {
    // Same flow as the Studio Contract tab: seed a chat with the shared,
    // deterministic rehabilitation brief. No confirm modal — direct launch.
    assert.match(
      source,
      /import \{ buildRehabilitationBrief \} from "@\/lib\/familiar-rehabilitation";/,
      "content reuses the shared rehabilitation brief builder",
    );
    assert.match(
      source,
      /buildRehabilitationBrief\(familiarName, model\.contractReport\)/,
      "the review thread is seeded with the brief for this familiar's failing report",
    );
    assert.match(
      source,
      /\{!report\.pass \? \([\s\S]*?Review and resolve[\s\S]*?\) : null\}/,
      "the Review and resolve button renders only for failing reports",
    );
    assert.match(
      source,
      /onReview=\{reviewContract\}/,
      "the contract section is wired to the parent-owned launch callback",
    );
    assert.match(
      source,
      /const reviewContract = useCallback\(\(\) => \{[\s\S]*?requestAgentsNewChat\(\{[\s\S]*?familiarId: model\.familiarId,[\s\S]*?origin: "chat"/,
      "review launches a familiar-scoped working thread via the agents-new-chat bridge",
    );
    assert.match(
      source,
      /announce\(`Opening a review thread to repair \$\{familiarName\}'s contract\.`\)/,
      "the launch is announced to assistive tech",
    );
  });

  it("keeps the workbench inside the viewport and scrolls the panes, not the page", () => {
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    const page = faCss.match(/\.fa-page \{[^}]*\}/);
    assert.ok(page, ".fa-page rule should exist");
    assert.match(page![0], /height: 100%/, ".fa-page fills its definite-height parent (html/body are overflow:hidden)");
    const frame = faCss.match(/\.fa-frame \{[^}]*\}/);
    assert.ok(frame, ".fa-frame rule should exist");
    assert.match(frame![0], /overflow: hidden/, "the frame never scrolls as a whole — its panes do");
    assert.match(faCss, /\.fa-dock \{[^}]*overflow-y: auto/, "the dock scrolls its own column");
    assert.match(faCss, /\.fa-panel__body \{[^}]*overflow-y: auto/, "each panel scrolls its own body");
    // Below the narrow breakpoint the workbench gives up and becomes a page.
    assert.match(
      faCss,
      /@media \(max-width: 900px\) \{[\s\S]*\.fa-page \{[^}]*overflow-y: auto/,
      "the narrow tier hands scrolling back to the page",
    );
  });

  it("workbench chrome: truthful freshness, refresh progress, degradation band (cave UX audit)", () => {
    // All .fa-* surface rules — including the reduced-motion and narrow-width
    // overrides — are component-imported (#3264), so they live in the
    // familiar-analytics sheet, not the global facade.
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");

    // Truthful freshness stamp + visible refresh progress.
    assert.match(source, /setUpdatedAt\(new Date\(\)\.toISOString\(\)\)/, "updatedAt is stamped by the load that actually landed");
    assert.match(contentSource, /Updated <RelativeTime iso=\{updatedAt\} \/>/, "the footer renders the freshness stamp");
    assert.match(dockSource, /refreshing \? " is-refreshing" : ""/, "the refresh button carries a refreshing state class");
    assert.match(faCss, /\.fa-icon-btn\.is-refreshing svg \{ animation: fa-spin/, "refresh spins while a quiet reload is in flight");

    // A partial load degrades into a dismissible band, never a blank surface.
    assert.match(contentSource, /className="fa-error-band" role="alert"/, "partial failures announce themselves");
    assert.match(contentSource, /everything else is from the last good read/, "the band says what is still trustworthy");
    assert.match(contentSource, /setErrorDismissed\(true\)/, "the band is dismissible");

    // Deep dives cover the stage, never the dock — the identity stays put.
    assert.match(contentSource, /covers the stage — the dock stays put/, "the overlay states its own scope");
    assert.match(faCss, /\.fa-overlay \{[^}]*position: absolute/, "the overlay is scoped to the stage, not the viewport");
    assert.match(contentSource, /useFocusTrap\(true, ref, \{ onEscape: onClose \}\)/, "stage overlays trap focus and close on Esc");
    // Two live focus traps would fight over the tab ring, so opening the top
    // layer retires the anchored panels underneath it first.
    assert.match(
      contentSource,
      /const openOverlay = useCallback\(\(next: Exclude<Overlay, null>\) => \{\s*setContractOpen\(false\);\s*setPulseOpen\(false\);/,
      "opening a stage overlay retires the contract panel and the pulse",
    );
    assert.match(
      contentSource,
      /const openAction = useCallback\(\(request: SelfHealRequest\) => \{\s*setBoardOpen\(false\);\s*setActionModal\(buildActionModal\(request\)\);/,
      "opening board action detail retires the board before activating the next modal focus trap",
    );

    // A face turned away is hidden to the eye by backface-visibility, but that
    // alone leaves its buttons in the tab order.
    assert.match(
      faCss,
      /\.fa-panel-pivot:not\(\.is-flipped\) > \.fa-panel--back,\s*\.fa-panel-pivot\.is-flipped > \.fa-panel:not\(\.fa-panel--back\) \{ visibility: hidden; \}/,
      "the away-facing panel leaves the tab order, not just the screen",
    );
    assert.match(
      faCss,
      /\.fa-panel \{ transition: visibility 0s linear var\(--duration-slow\); \}/,
      "the retirement waits for the flip so the face never vanishes mid-turn",
    );

    // All decorative motion holds still under prefers-reduced-motion.
    assert.match(
      faCss,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.fa-panel-pivot \{ transition: none/,
      "panel flips are instant under reduced motion",
    );
    assert.match(
      faCss,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.fa-renown__shine \{ animation: none/,
      "the renown sheen stops under reduced motion",
    );
  });
});

describe("session tracking + tracing (recent sessions, pulse drill, trace overlay)", () => {
  it("derives the Activity breakdown from the selected session window", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    const session = (id: string, updated_at: string) => ({ id, updated_at, familiarId: "cody" }) as SessionRow;
    const sessions = [
      session("current", "2026-08-02T12:00:00.000Z"),
      session("older-a", "2026-07-26T12:00:00.000Z"),
      session("older-b", "2026-07-26T13:00:00.000Z"),
    ];
    const sevenDays = sessions.filter((entry) => withinWindow(entry.updated_at, "7d", now));

    const recentCadence = deriveScopedActivityCadence(sevenDays, now, 7);
    const allCadence = deriveScopedActivityCadence(sessions, now, null);

    assert.equal(recentCadence.perWeek, 1);
    assert.equal(recentCadence.busiest?.count, 1);
    assert.equal(allCadence.perWeek, 3);
    assert.equal(allCadence.busiest?.count, 2);
    assert.equal(recentCadence.lastActive, "2026-08-02T12:00:00.000Z");
  });

  it("keeps the complete archived session history for the ALL evidence window", async () => {
    mockFetchFor("trusted");
    const data = await loadFamiliarAnalyticsData("cody");
    const template = data.sessions[0]!;
    const sessions = Array.from({ length: 41 }, (_, index) => ({
      ...template,
      id: `historic-session-${index}`,
      archived_at: "2026-06-01T00:00:00.000Z",
      updated_at: new Date(Date.parse("2026-06-25T12:00:00.000Z") - index * 24 * 60 * 60_000).toISOString(),
    }));
    const model = buildFamiliarAnalyticsModel({ ...data, sessions });

    assert.equal(model.recentSessions.length, 41, "the ALL session ledger is not capped at the newest 40 rows");
    assert.match(
      dataSource,
      /\/api\/sessions\/list\?includeArchived=1&familiarId=\$\{encodedId\}/,
      "the evidence read includes archived sessions instead of silently omitting history",
    );
  });

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
    assert.match(contentSource, /id="fa-sessions"/, "the panel carries its drill anchor");
    assert.match(contentSource, /<RecentSessionsBody/, "the panel front renders the sessions list");
    assert.match(contentSource, /<SessionLog sessions=\{windowSessions\}/, "its other face is the full session log");
    assert.match(
      source,
      /href=\{`\/#chat-\$\{encodeURIComponent\(session\.id\)\}`\}/,
      "each row opens its thread via the chat hash deep link",
    );
    assert.match(source, /onTrace\(\{ id: session\.id, title: session\.title \}\)/, "each row can open the trace overlay");
    assert.match(source, /<SessionTraceOverlay target=\{traceTarget\}/, "the overlay is rendered from page state");
    assert.match(source, /className="fa-pager"/, "history is walked with a pager rather than silently truncated");
    assert.match(source, /aria-label="Next page of sessions"/, "the pager exposes an accessible next-page control");
  });

  it("makes the pulse interactive — a clicked day filters the sessions list", () => {
    assert.match(contentSource, /onSelectDay=\{handleSelectDay\}/, "the stat band's pulse takes the day-select handler");
    assert.match(contentSource, /selectedDayKey=\{selectedDay\?\.key \?\? null\}/, "selection state rides back into the bars");
    assert.match(contentSource, /sessionDayKey\(session\.updated_at\) === selectedDay\.key/, "the list filters by the pulse's own day bucketing");
    // The panel is always on screen in the workbench, so a day filter has
    // nothing to scroll to — it must instead un-flip the panel showing the log.
    assert.match(contentSource, /setSessionsFlipped\(false\)/, "selecting a day turns the sessions panel to the filtered list");
    assert.match(contentSource, /className="fa-day-chip focus-ring"/, "an active day filter shows a clearable chip");
    // The interactive bars are real buttons with pressed state (not color alone).
    const pulseBars = readFileSync(new URL("./ui/pulse-bars.tsx", import.meta.url), "utf8");
    assert.match(pulseBars, /aria-pressed=\{selected\}/, "selected day is exposed to AT");
    assert.match(pulseBars, /onSelectDay\?: \(day: PulseDay\) => void/, "interactivity is opt-in — existing decorative uses are untouched");
  });

  it("keeps the page live with a pausable poll that never spams AT", () => {
    assert.match(source, /import \{ usePausablePoll \} from "@\/lib\/use-pausable-poll"/);
    assert.match(source, /usePausablePoll\(\(\) => void load\(\{ quiet: true, silent: true \}\), 60_000\)/, "background refresh every 60s, hidden-tab safe");
    assert.match(source, /if \(quiet && !silent\) announce\("Analytics refreshed\."\)/, "only manual refreshes announce");
  });
});

describe("confidence from thread analysis + metric labeling", () => {
  it("keeps confidence, trends, counts, queue, and evidence on the same window", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    const report = (id: string, reportedAt: string, score: number, contextPressure: ThreadSelfReport["contextPressure"]): ThreadSelfReport => ({
      id,
      familiarId: "cody",
      sessionId: `session-${id}`,
      reportedAt,
      overallConfidence: score,
      toolReliability: { score, failedTools: [], unreliableTools: [] },
      contextPressure,
      skillsUsed: [],
      skillsNeedingClarity: [],
      skillsNeedingAccess: [],
      capabilitiesLacking: [],
      capabilitiesVital: [],
      memoryRecallScore: score,
      fileLocatabilityScore: score,
      persistentBlockers: [],
    });
    const reports = [
      report("current", "2026-08-02T12:00:00.000Z", 90, "adequate"),
      report("older", "2026-07-26T12:00:00.000Z", 20, "critical"),
      report("history", "2026-06-07T12:00:00.000Z", 30, "critical"),
      report("future", "2026-08-04T12:00:00.000Z", 10, "critical"),
    ];
    const snapshots = reports.map(snapshotFromReport);
    const sessions = [
      { id: "current", updated_at: "2026-08-02T12:00:00.000Z" },
      { id: "older", updated_at: "2026-07-26T12:00:00.000Z" },
      { id: "history", updated_at: "2026-06-07T12:00:00.000Z" },
      { id: "future", updated_at: "2026-08-04T12:00:00.000Z" },
    ];
    const scoped = (windowId: "7d" | "14d" | "8w" | "all") => {
      const visibleReports = reports.filter((entry) => withinWindow(entry.reportedAt, windowId, now));
      const visibleSnapshots = snapshots.filter((entry) => withinWindow(entry.reportedAt, windowId, now));
      const aggregate = aggregateThreadSignals(visibleReports);
      return {
        confidence: deriveThreadConfidence(visibleReports),
        trends: deriveSignalTrends(visibleSnapshots, now, undefined, {
          days: { "7d": 7, "14d": 14, "8w": 56, all: null }[windowId],
          label: windowId,
        }),
        queue: buildThreadSignalReviewQueue(aggregate),
        evidenceCount: visibleReports.length,
        sessionCount: sessions.filter((entry) => withinWindow(entry.updated_at, windowId, now)).length,
      };
    };

    const sevenDays = scoped("7d");
    const fourteenDays = scoped("14d");
    const eightWeeks = scoped("8w");
    const all = scoped("all");

    for (const window of [sevenDays, fourteenDays, eightWeeks, all]) {
      assert.equal(window.confidence.reportCount, window.trends.snapshotCount);
      assert.equal(window.confidence.reportCount, window.evidenceCount);
      assert.equal(window.confidence.reportCount, window.sessionCount);
    }

    assert.equal(sevenDays.confidence.reportCount, 1);
    assert.equal(fourteenDays.confidence.reportCount, 2);
    assert.equal(sevenDays.trends.snapshotCount, 1);
    assert.equal(fourteenDays.trends.snapshotCount, 2);
    assert.equal(sevenDays.trends.overall.direction, "insufficient");
    assert.equal(fourteenDays.trends.overall.direction, "improving");
    assert.equal(sevenDays.queue.length, 0);
    assert.ok(fourteenDays.queue.some((item) => item.sourceId === "context-pressure"));
    assert.equal(sevenDays.evidenceCount, 1);
    assert.equal(fourteenDays.evidenceCount, 2);
    assert.equal(sevenDays.sessionCount, 1);
    assert.equal(fourteenDays.sessionCount, 2);
    assert.equal(eightWeeks.confidence.reportCount, 2);
    assert.equal(eightWeeks.trends.snapshotCount, 2);
    assert.equal(eightWeeks.evidenceCount, 2);
    assert.equal(eightWeeks.sessionCount, 2);
    assert.equal(all.confidence.reportCount, 3);
    assert.equal(all.trends.snapshotCount, 3);
    assert.equal(all.evidenceCount, 3);
    assert.equal(all.sessionCount, 3);
  });

  it("applies the selected time window to every thread-report analytic on the stage", () => {
    assert.match(
      contentSource,
      /const windowConfidence = useMemo\(\s*\(\) => deriveThreadConfidence\(windowReports\),\s*\[windowReports\],\s*\);/,
      "headline confidence is recomputed from the visible report window",
    );
    assert.match(
      contentSource,
      /model\.metricSnapshots\.filter\(\(snapshot\) => withinWindow\(snapshot\.reportedAt, windowId, now\)\)/,
      "the complete persisted trend history is filtered to the visible window",
    );
    assert.match(
      contentSource,
      /const windowSpec = ANALYTICS_WINDOWS\.find\(\(entry\) => entry\.id === windowId\)[\s\S]*deriveSignalTrends\(windowSnapshots, now, undefined, \{[\s\S]*days: windowSpec\.days,[\s\S]*label: windowSpec\.title,/,
      "trend buckets retain the selected window's complete persisted history",
    );
    assert.match(
      contentSource,
      /windowReports\.length > 0 \? aggregateThreadSignals\(windowReports\) : null/,
      "signal aggregation uses only reports in the visible window",
    );
    assert.match(
      contentSource,
      /<ThreadAnalysisBody\s+confidence=\{windowConfidence\}\s+trends=\{windowSignalTrends\}/,
      "the confidence panel renders the scoped confidence and trends",
    );
    assert.match(
      contentSource,
      /<FamiliarAnalyticsDock\s+model=\{model\}\s+confidence=\{windowConfidence\}/,
      "the dock trust ring uses the same scoped confidence as the stage",
    );
    assert.match(
      contentSource,
      /<TrustModal\s+confidence=\{windowConfidence\}\s+trends=\{windowSignalTrends\}/,
      "the trust modal uses the same scoped confidence and trends as the stage",
    );

    assert.match(
      contentSource,
      /<ThreadSignalsSection familiarId=\{model\.familiarId\} reports=\{windowReports\} \/>/,
      "the full signal view receives the same scoped reports as its counts and queue",
    );
    assert.doesNotMatch(
      contentSource,
      /\{model\.threadReports\.length\} · \{reviewQueue\.length\} queued/,
      "signal summaries do not pair a lifetime report count with a windowed queue",
    );
  });

  it("drives the fa-confidence panel from real thread metrics, not synthetic factors", () => {
    // The synthetic weighted-factor breakdown (familiar-confidence.ts) is gone
    // from this page — the panel renders the self-reported metric averages.
    assert.doesNotMatch(source, /CONFIDENCE_FACTOR_COPY/, "no synthetic factor copy remains");
    assert.doesNotMatch(source, /familiar-confidence/, "the view no longer imports the heuristic lib");
    assert.match(source, /ThreadAnalysisBody/, "the thread-analysis panel replaces the factor list");
    assert.match(contentSource, /id="fa-confidence"/, "the panel keeps the stable fa-confidence anchor");
    assert.match(contentSource, /title="Confidence from thread analysis"/, "the panel is named for its real source");
    assert.match(contentSource, /<ReportLedger reports=\{windowReports\}/, "its other face is the report-by-report ledger");
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
    assert.match(source, /trends=\{windowSignalTrends\}/, "trends use the selected window's persisted evidence");
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
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    assert.match(faCss, /\.fa-trend-verdict--improving \{ color: var\(--accent-presence\); \}/, "verdict improving tint is tokenized");
    assert.match(faCss, /\.fa-trend-verdict--regressing \{ color: var\(--color-warning\); \}/, "verdict regressing tint is tokenized");
    assert.match(faCss, /\.fa-trend-chip--improving \{ color: var\(--accent-presence\); \}/, "chip improving tint is tokenized");
    assert.match(faCss, /\.fa-trend-chip--regressing \{ color: var\(--color-warning\); \}/, "chip regressing tint is tokenized");
  });

  it("annotates each metric bar with a delta chip against the previous period", () => {
    assert.match(source, /function TrendDeltaChip/, "delta chips are a dedicated affordance");
    assert.match(source, /if \(trend\.delta === null \|\| trend\.direction === "insufficient"\) return null;/, "no chip without two data buckets");
    assert.match(source, /trend=\{trendByKey\.get\(metric\.key\)\}/, "each metric bar receives its own trend");
    assert.match(source, /vs the previous period/, "chip aria/tooltip names the comparison window");
    assert.match(source, /formatDelta/, "deltas render signed (+8 / -6)");
  });

  it("renders the dock's trust ring from thread confidence with an unmeasured state", () => {
    assert.match(dockSource, /fa-ring--\$\{size\} fa-ring--\$\{tier\}/, "ring tier class tracks the derived tier");
    assert.match(dockSource, /confidence\.hasData \? confidenceTier\(confidence\.label\) : "none"/, "no reports → neutral ring, never a fake Low");
    assert.match(dockSource, /Trust not measured yet — no thread self-reports/, "the unmeasured hero ring says so to AT");
    // In the dock the ring is decoration (its button already names the score);
    // as the trust modal's hero it IS the headline and must be exposed.
    assert.match(
      dockSource,
      /const ringAria = size === "lg"[\s\S]*role: "img" as const[\s\S]*: \{ "aria-hidden": true as const \}/,
      "the hero ring is announced, the decorative one is not",
    );
    assert.match(
      dockSource,
      /const score = confidence\.hasData \? Math\.max\(0, Math\.min\(100, confidence\.score\)\) : null/,
      "one clamped number feeds both the arc and the printed score",
    );
    assert.match(dockSource, /from \$\{confidence\.reportCount\} report/, "the measured ring cites its report count");
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    assert.match(faCss, /\.fa-ring--none\s*\{[^}]*--fa-ring-color:\s*var\(--border-strong\)/, "the unmeasured tier stays neutral (tokens only)");
  });

  it("keeps shared metric-unit styling for 0–100 scores", () => {
    const faCss = readFileSync(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");
    assert.match(source, /className="fa-metric-unit"/, "0–100 scores carry a muted unit suffix");
    assert.match(faCss, /\.fa-metric-unit\s*\{/, "the metric-unit style exists");
    assert.match(faCss, /\.fa-factor-bar \{[\s\S]*?min-width: 44px/, "the metric bar keeps a min-width floor in narrow cells");
    assert.match(faCss, /\.fa-thread-analysis\s*\{/, "the thread-analysis panel has its own layout block");
  });
});
