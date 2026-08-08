// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FAMILIAR_DASHBOARD_LIMITS,
  FAMILIAR_DASHBOARD_VERSION,
} from "../../../../../lib/familiar-dashboard.ts";
import { handleDashboardRequest } from "./route.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

function successResponseFixture({
  overviewState = "fresh",
  profileState = "fresh",
  analyticsState = "fresh",
}: {
  overviewState?: "fresh" | "partial" | "empty" | "unavailable";
  profileState?: "fresh" | "partial" | "empty" | "unavailable";
  analyticsState?: "fresh" | "partial" | "empty" | "unavailable";
}) {
  const generatedAt = "2026-08-07T20:00:00.000Z";
  return {
    ok: true,
    version: FAMILIAR_DASHBOARD_VERSION,
    familiarId: "sage",
    generatedAt,
    identity: {
      id: "sage",
      displayName: "Sage",
      role: "Researcher",
      pronouns: "they/them",
      avatarUrl: null,
      avatarRevision: null,
      presence: "online",
      lastSeen: generatedAt,
      activeSessionCount: 1,
    },
    sections: {
      overview: {
        state: overviewState,
        generatedAt,
        data: overviewState === "unavailable"
          ? null
          : {
              live: {
                presence: "online",
                harness: "claude",
                model: "claude-sonnet",
                activeSessionCount: 1,
                memoryFreshness: generatedAt,
                generatedAt,
              },
              now: { kind: "idle", label: "No active work" },
              tasks: { items: [], total: 0 },
              sessions: {
                active: [],
                activeTotal: 0,
                recent: [],
                recentTotal: 0,
                totalNonGenerated: 0,
              },
              attention: { items: [], total: 0 },
              reminders: { items: [], total: 0 },
            },
        issues: [],
      },
      profile: {
        state: profileState,
        generatedAt,
        data: profileState === "unavailable"
          ? null
          : {
              description: "Finds evidence.",
              purpose: "Find and verify primary evidence.",
              familiarType: "researcher",
              glyph: { icon: null, emoji: null, color: null },
              runtime: {
                harness: "claude",
                defaultHarness: "claude",
                harnessOverride: null,
                model: "claude-sonnet",
                modelProvenance: "coven_default",
              },
              memoryFreshness: generatedAt,
              voice: { provider: null, model: null, name: null },
              image: {
                provider: null,
                model: null,
                size: null,
                quality: null,
              },
              configuration: {
                note: null,
                autoSelfReport: false,
                omnigent: null,
              },
              contract: {
                specVersion: "0.1.0",
                pass: true,
                propertyPassed: 5,
                propertyTotal: 5,
                violationCount: 0,
                warningCount: 0,
              },
              access: {
                projects: { items: [], total: 0 },
                tools: [
                  {
                    id: "asana",
                    enabled: true,
                    provenance: "inherited",
                    workspaceGid: null,
                  },
                  {
                    id: "x-research",
                    enabled: false,
                    provenance: "explicit",
                    workspaceGid: null,
                  },
                  {
                    id: "x-publish",
                    enabled: false,
                    provenance: "explicit",
                    workspaceGid: null,
                  },
                ],
              },
            },
        issues: [],
      },
      analytics: {
        state: analyticsState,
        generatedAt,
        data: analyticsState === "unavailable"
          ? null
          : {
              activity: {
                definition: "Non-generated Familiar sessions by UTC calendar day.",
                period: "last 14 days",
                sampleCount: 0,
                freshness: null,
                pulse: [],
                activeSessions: 0,
                totalSessions: 0,
                lastActiveAt: null,
                evidenceCount: 0,
              },
              confidence: {
                definition: "Named band derived from the latest thread self-reports.",
                period: "latest 30 reports",
                sampleCount: 0,
                freshness: null,
                band: null,
                latestReportAt: null,
                insufficientData: true,
              },
              trends: {
                definition: "Metric direction across persisted thread snapshots.",
                period: "last 30 days",
                sampleCount: 0,
                freshness: null,
                granularity: "day",
                metrics: [],
                buckets: [],
              },
              memory: {
                definition: "Canonical memory availability and report-backed recall signals.",
                period: "current memory plus latest 30 reports",
                sampleCount: 0,
                freshness: null,
                availability: "ready",
                count: 0,
                latestUpdatedAt: null,
                averageRecall: null,
                averageFileLocatability: null,
              },
              capabilities: {
                definition: "Capabilities observed across the latest thread self-reports.",
                period: "latest 30 reports",
                sampleCount: 0,
                freshness: null,
                used: [],
                lacking: [],
                vital: [],
              },
              healRequests: [],
              feedback: {
                definition: "Final thumbs verdicts for messages attributed to this Familiar.",
                period: "all retained feedback",
                sampleCount: 0,
                freshness: null,
                state: "insufficient",
                up: 0,
                down: 0,
                total: 0,
                models: [],
                runtimes: [],
              },
            },
        issues: [],
      },
    },
  };
}

test("invalid Familiar id returns 403 with a stable code", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/../dashboard?v=1"),
    { params: Promise.resolve({ id: "../sage" }) },
    async () => {
      calls++;
      return { kind: "unavailable" };
    },
  );
  assert.equal(response.status, 403);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "invalid_familiar_id",
  });
  assert.equal(calls, 0);
});

test("unknown Familiar returns 404", async () => {
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/missing/dashboard?v=1"),
    { params: Promise.resolve({ id: "missing" }) },
    async () => ({ kind: "not_found" }),
  );
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "familiar_not_found",
  });
});

for (const status of [401, 403] as const) {
  test(`roster auth ${status} preserves a stable unauthorized response`, async () => {
    const response = await handleDashboardRequest(
      new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
      { params: Promise.resolve({ id: "sage" }) },
      async () => ({ kind: "auth_error", status }),
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "dashboard_unauthorized",
    });
  });
}

test("an explicit unsupported version returns 400 before loading", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=2"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => {
      calls++;
      return { kind: "not_found" };
    },
  );
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
  assert.equal(calls, 0);
});

test("a missing version returns 400 before loading", async () => {
  let calls = 0;
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => {
      calls++;
      return { kind: "not_found" };
    },
  );
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
  assert.equal(calls, 0);
});

test("known Familiar returns 200 even with partial and unavailable sections", async () => {
  const body = successResponseFixture({
    overviewState: "partial",
    profileState: "fresh",
    analyticsState: "unavailable",
  });
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "ok", response: body }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), body);
});

test("no safe dashboard returns 500", async () => {
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "unavailable" }),
  );
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
});

test("loader exceptions are sanitized into the stable 500 response", async () => {
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => {
      throw new Error("/Users/private/sage.json token=secret");
    },
  );
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
});

test("oversized success is replaced by the stable 500 response", async () => {
  const body = successResponseFixture({});
  body.sections.profile.data.description = "x".repeat(
    FAMILIAR_DASHBOARD_LIMITS.responseBytes,
  );
  const response = await handleDashboardRequest(
    new Request("http://cave.local/api/familiars/sage/dashboard?v=1"),
    { params: Promise.resolve({ id: "sage" }) },
    async () => ({ kind: "ok", response: body }),
  );
  assert.equal(response.status, 500);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "dashboard_unavailable",
  });
});

assert.match(source, /export const dynamic = "force-dynamic"/);
assert.match(source, /export const runtime = "nodejs"/);
assert.match(source, /dashboard_unauthorized/);
assert.doesNotMatch(source, /fetch\(/, "dashboard route must not self-fetch Cave APIs");
