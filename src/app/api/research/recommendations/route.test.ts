import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SavedLink } from "@/lib/link-organizer.ts";
import type { ResearchMission } from "@/lib/research-missions.ts";
import type { KnowledgeEntry } from "@/lib/server/knowledge-vault.ts";
import type { SavedXSource } from "@/lib/server/x-sources.ts";
import type { AgenticDiagnosticEvent } from "@/lib/agentic-diagnostics.ts";
import type { SessionRow } from "@/lib/types.ts";
import {
  createResearchRecommendationsRoute,
  type ResearchRecommendationsRouteDeps,
} from "./route.ts";

function mission(id: string): ResearchMission {
  return {
    id,
    familiarId: "researcher",
    title: `Choose retrieval option ${id}`,
    intent: "Make a decision with primary-source evidence.",
    status: "running",
    updatedAt: "2026-08-19T10:00:00.000Z",
    sources: [],
  } as unknown as ResearchMission;
}

function savedLink(id: string): SavedLink {
  return {
    id,
    title: `Retrieval benchmark ${id}`,
    url: `https://example.test/${id}`,
    category: "article",
    addedAt: "2026-08-19T10:00:00.000Z",
    source: "desk",
  };
}

function xSource(id: string): SavedXSource {
  return {
    id,
    familiarId: "researcher",
    postId: "1881",
    canonicalUrl: "https://x.com/opencoven/status/1881",
    originalUrl: "https://x.com/opencoven/status/1881",
    note: "Retrieval benchmark discussion",
    tags: [],
    addedAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
    attachedMissionIds: [],
    availability: "available",
  };
}

function session(id: string): SessionRow {
  return {
    id,
    title: `Session topic ${id}`,
    project_root: "/tmp/coven",
    harness: "copilot",
    status: "completed",
    exit_code: 0,
    archived_at: null,
    created_at: "2026-08-19T09:00:00.000Z",
    updated_at: "2026-08-19T10:00:00.000Z",
    attention: { state: "none", since: null, reason: null },
  };
}

function baseDeps(overrides: Partial<ResearchRecommendationsRouteDeps> = {}): ResearchRecommendationsRouteDeps {
  return {
    listMissions: async () => [],
    listSavedLinks: async () => [],
    listSavedXSources: async () => [],
    listSessions: async () => [],
    hasXResearchCapability: async () => true,
    listVaultEntries: async () => [],
    ...overrides,
  };
}

function request(query = "", signal?: AbortSignal): Request {
  return new Request(`http://127.0.0.1/api/research/recommendations?familiarId=researcher${query}`, {
    headers: { host: "127.0.0.1" },
    signal,
  });
}

test("bounds every context source and returns only an ephemeral read-only projection", async () => {
  const route = createResearchRecommendationsRoute(baseDeps({
    listMissions: async () => Array.from({ length: 40 }, (_, index) => mission(`mission-${index}`)),
    listSavedLinks: async () => Array.from({ length: 40 }, (_, index) => savedLink(`link-${index}`)),
    listSavedXSources: async () => [],
    listSessions: async () => Array.from({ length: 80 }, (_, index) => session(`session-${index}`)),
    listVaultEntries: async () => Array.from({ length: 40 }, (_, index) => ({
      id: `vault-${index}`,
      title: `Retrieval note ${index}`,
      tags: [],
      scope: "global",
      enabled: true,
      body: "retrieval evidence",
    }) satisfies KnowledgeEntry),
  }));

  const response = await route(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.context.missions <= 12);
  assert.ok(body.context.savedLinks <= 12);
  assert.ok(body.context.xSources <= 12);
  assert.ok(body.context.vaultEntries <= 8);
  assert.ok(body.context.sessions <= 24);
  assert.ok(body.recommendations.length <= 12);
});

test("grounds topic recommendations in the familiar-accessible Coven session history", async () => {
  const route = createResearchRecommendationsRoute(baseDeps({
    listSessions: async () => [session("collective-session")],
  }));

  const body = await (await route(request())).json();

  assert.equal(body.context.sessions, 1);
  assert.equal(body.recommendations[0].payload.topic, "Session topic collective-session");
  assert.deepEqual(body.recommendations[0].evidenceRefs.map((ref: { id: string }) => ref.id), [
    "session:collective-session",
  ]);
});

test("keeps the most recently updated mission inside the bounded Desk snapshot", async () => {
  const current = {
    ...mission("mission-current"),
    title: "Current retrieval decision",
    status: "paused",
    updatedAt: "2026-08-19T10:00:00.000Z",
  } as ResearchMission;
  const older = Array.from({ length: 20 }, (_, index) => ({
    ...mission(`mission-old-${index}`),
    updatedAt: "2026-08-01T10:00:00.000Z",
    status: "completed",
  } as ResearchMission));
  const route = createResearchRecommendationsRoute(baseDeps({
    listMissions: async () => [...older, current],
    listSavedLinks: async () => [{
      ...savedLink("current-source"),
      title: "Current retrieval decision",
    }],
  }));

  const response = await route(request());
  const body = await response.json();
  const currentRecommendation = body.recommendations.find((recommendation: { evidenceRefs: Array<{ id: string }> }) =>
    recommendation.evidenceRefs.some((ref) => ref.id === "saved-link:current-source"),
  );

  assert.equal(currentRecommendation.payload.recommendationKind, "refine-mission");
  assert.equal(currentRecommendation.payload.targetMissionId, "mission-current");
});

test("filters archived missions before bounding recent Desk context", async () => {
  const active = {
    ...mission("mission-active"),
    title: "Active retrieval decision",
    status: "paused",
    updatedAt: "2026-08-01T10:00:00.000Z",
  } as ResearchMission;
  const archived = Array.from({ length: 20 }, (_, index) => ({
    ...mission(`mission-archived-${index}`),
    status: "archived",
    updatedAt: "2026-08-19T10:00:00.000Z",
  } as ResearchMission));
  const route = createResearchRecommendationsRoute(baseDeps({
    listMissions: async () => [...archived, active],
    listSavedLinks: async () => [{
      ...savedLink("active-source"),
      title: "Active retrieval decision",
    }],
  }));

  const body = await (await route(request())).json();
  const activeRecommendation = body.recommendations.find((recommendation: { evidenceRefs: Array<{ id: string }> }) =>
    recommendation.evidenceRefs.some((ref) => ref.id === "saved-link:active-source"),
  );

  assert.equal(activeRecommendation.payload.recommendationKind, "refine-mission");
  assert.equal(activeRecommendation.payload.targetMissionId, "mission-active");
});

test("rejects a response request whose supplied fingerprint is stale", async () => {
  const diagnostics: AgenticDiagnosticEvent[] = [];
  const route = createResearchRecommendationsRoute(baseDeps({
    listSavedLinks: async () => [savedLink("link-1")],
    diagnostics: (event) => diagnostics.push(event),
  }));

  const response = await route(request("&contextFingerprint=ctx-v1-00000000000000000000000000000000"));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error, "stale context");
  assert.match(body.contextFingerprint, /^ctx-v1-/);
  assert.deepEqual(
    diagnostics.map((event) => [event.code, event.status]),
    [["stale_discarded", "discarded"]],
  );
});

test("returns a lightweight revision that changes for X and Vault evidence", async () => {
  let xUpdatedAt = "2026-08-19T10:00:00.000Z";
  let vaultModified = "2026-08-19T10:00:00.000Z";
  const route = createResearchRecommendationsRoute(baseDeps({
    listSavedXSources: async () => [{
      id: "x-1",
      postId: "1881",
      note: "Retrieval benchmark discussion",
      tags: [],
      availability: "available",
      canonicalUrl: "https://x.com/example/status/1881",
      originalUrl: "https://x.com/example/status/1881",
      updatedAt: xUpdatedAt,
    }] as unknown as Awaited<ReturnType<ResearchRecommendationsRouteDeps["listSavedXSources"]>>,
    listVaultEntries: async () => [{
      id: "vault-1",
      title: "Retrieval evidence",
      tags: [],
      scope: "global",
      enabled: true,
      body: "Use a retrieval evaluation rubric.",
      modified: vaultModified,
    }],
  }));

  const first = await (await route(request("&revision=1"))).json();
  xUpdatedAt = "2026-08-19T10:01:00.000Z";
  const xChanged = await (await route(request("&revision=1"))).json();
  vaultModified = "2026-08-19T10:02:00.000Z";
  const vaultChanged = await (await route(request("&revision=1"))).json();

  assert.equal(first.ok, true);
  assert.equal(first.recommendations, undefined);
  assert.notEqual(first.contextFingerprint, xChanged.contextFingerprint);
  assert.notEqual(xChanged.contextFingerprint, vaultChanged.contextFingerprint);
});

test("retries one malformed Vault read before using the recovered bounded context", async () => {
  let calls = 0;
  const route = createResearchRecommendationsRoute(baseDeps({
    listVaultEntries: async () => {
      calls += 1;
      if (calls === 1) throw new Error("vault response malformed");
      return [{
        id: "vault-1",
        title: "Retrieval evidence",
        tags: [],
        scope: "global",
        enabled: true,
        body: "Use a retrieval evaluation rubric.",
      }];
    },
  }));

  const response = await route(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(body.reducedContext, false);
  assert.equal(body.context.vaultEntries, 1);
});

test("stops before reading context when the recommendation request is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const diagnostics: AgenticDiagnosticEvent[] = [];
  const route = createResearchRecommendationsRoute(baseDeps({
    listMissions: async () => {
      calls += 1;
      return [mission("mission-1")];
    },
    diagnostics: (event) => diagnostics.push(event),
  }));

  const response = await route(request("", controller.signal));

  assert.equal(response.status, 499);
  assert.equal(calls, 0);
  assert.deepEqual(
    diagnostics.map((event) => [event.code, event.status]),
    [["cancelled", "cancelled"]],
  );
});

test("keeps Desk recommendations and labels reduced context when Vault retrieval fails", async () => {
  const diagnostics: AgenticDiagnosticEvent[] = [];
  const route = createResearchRecommendationsRoute(baseDeps({
    listSavedLinks: async () => [savedLink("link-1")],
    listVaultEntries: async () => {
      throw new Error("vault unavailable");
    },
    diagnostics: (event) => diagnostics.push(event),
  }));

  const response = await route(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.reducedContext, true);
  assert.equal(body.recommendations.length, 1);
  assert.match(body.recommendations[0].rankReasons.join(" "), /reduced context|Vault/i);
  assert.deepEqual(
    diagnostics.map((event) => [event.code, event.status, event.counts?.attempts]),
    [["vault_context_reduced", "reduced", 2]],
  );
});

test("returns no generic fallback topics without grounded evidence", async () => {
  const route = createResearchRecommendationsRoute(baseDeps());
  const response = await route(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.recommendations, []);
});

test("the route exposes no create or refine mission mutation", () => {
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

  assert.doesNotMatch(route, /createAndStart|createResearchMission|action:\s*["']refine["']/);
  assert.match(route, /export const GET/);
  assert.doesNotMatch(route, /export (async )?function POST|export const POST/);
});

test("never reads saved X sources for a familiar without the X research capability", async () => {
  let xReads = 0;
  const route = createResearchRecommendationsRoute(baseDeps({
    hasXResearchCapability: async () => false,
    listSavedXSources: async () => {
      xReads += 1;
      return [xSource("x-1")];
    },
    listSavedLinks: async () => [savedLink("link-1")],
  }));

  const response = await route(request());
  const body = await response.json();

  // Authorize before read: the X store is never touched without the grant.
  assert.equal(xReads, 0);
  assert.equal(response.status, 200);
  assert.equal(body.context.xSources, 0);
  assert.deepEqual(
    body.recommendations.flatMap((recommendation: { evidenceRefs: Array<{ label: string }> }) =>
      recommendation.evidenceRefs.map((ref) => ref.label).filter((label) => label.startsWith("X Article")),
    ),
    [],
  );
  // The non-X context still produces its own recommendation.
  assert.equal(body.recommendations.length, 1);
});

test("still recommends from saved X sources once the X research capability is granted", async () => {
  const route = createResearchRecommendationsRoute(baseDeps({
    hasXResearchCapability: async () => true,
    listSavedXSources: async () => [xSource("x-1")],
  }));

  const body = await (await route(request())).json();

  assert.equal(body.context.xSources, 1);
  assert.deepEqual(
    body.recommendations.flatMap((recommendation: { evidenceRefs: Array<{ id: string }> }) =>
      recommendation.evidenceRefs.map((ref) => ref.id),
    ),
    ["saved-link:x-1"],
  );
});

console.log("research recommendations route.test.ts passed");
