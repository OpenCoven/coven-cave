import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import {
  buildFamiliarExecutionAnalytics,
  EXECUTION_ATTEMPT_LEDGER_VERSION,
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  executionAttemptLedgerRecord,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "../familiar-execution-analytics.ts";
import { backfillFamiliarExecutionAttempts } from "./familiar-execution-analytics-backfill.ts";
import { projectConversationExecutionAttempts } from "./familiar-execution-analytics-projection.ts";
import {
  appendExecutionAttemptSnapshots,
  listExecutionAttemptSnapshots,
} from "./familiar-execution-analytics-store.ts";

const originalCaveHome = process.env.COVEN_CAVE_HOME;
const artifactRoot = path.join(
  process.cwd(),
  ".test-artifacts",
  `familiar-execution-analytics-${process.pid}`,
);

before(async () => {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  process.env.COVEN_CAVE_HOME = artifactRoot;
});

after(async () => {
  if (originalCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = originalCaveHome;
  await rm(artifactRoot, { recursive: true, force: true });
});

function snapshot(overrides: Record<string, unknown> = {}): ExecutionAttemptSnapshotV1 {
  const value = normalizeExecutionAttemptSnapshot({
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId: "ea1_test",
    familiarId: "cody",
    sessionId: "session-test",
    turnId: "turn-test",
    attemptNumber: 1,
    execution: { kind: "assistant-response", origin: "chat" },
    timing: { completedAt: "2026-08-18T09:00:00.000Z" },
    outcome: { status: "succeeded" },
    provenance: {
      source: "live",
      sourceSchema: "execution-attempt-v1",
      capturedAt: "2026-08-18T09:00:00.000Z",
    },
    coverage: { knownFields: [] },
    ...overrides,
  });
  assert.ok(value);
  return value;
}

function historicalConversation(): ConversationFile {
  const privateMarker = "PRIVATE_EXECUTION_CONTENT";
  return {
    sessionId: "conversation-session",
    familiarId: "cody",
    harness: "claude-code",
    runtime: `/private/worktree/${privateMarker}`,
    branch: `feature/${privateMarker}`,
    prUrl: `https://example.invalid/${privateMarker}`,
    origin: "chat",
    createdAt: "2026-08-17T08:00:00.000Z",
    updatedAt: "2026-08-17T08:05:00.000Z",
    turns: [
      {
        id: "user-turn",
        role: "user",
        text: `prompt ${privateMarker}`,
        createdAt: "2026-08-17T08:00:00.000Z",
      },
      {
        id: "assistant-known",
        role: "assistant",
        text: `response ${privateMarker}`,
        reasoning: `reasoning ${privateMarker}`,
        createdAt: "2026-08-17T08:00:05.000Z",
        durationMs: 5_000,
        usage: {
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 25,
        },
        costUsd: 0.03,
        tools: [{
          id: "tool-1",
          name: "shell",
          input: `args ${privateMarker}`,
          output: `output ${privateMarker}`,
          status: "ok",
          durationMs: 750,
        }],
        responseMetadata: {
          familiarId: "cody",
          harness: "claude-code",
          model: "anthropic/claude-sonnet",
          runtime: `/private/runtime/${privateMarker}`,
          requestedModel: "anthropic/claude-sonnet",
          forwardedModel: "claude-sonnet",
          confirmedModel: "claude-sonnet",
        },
      },
      {
        id: "assistant-unknown-metrics",
        role: "assistant",
        text: `second response ${privateMarker}`,
        createdAt: "2026-08-17T08:01:00.000Z",
      },
    ],
  };
}

test("append/read ledger is idempotent and ignores unsupported record versions", async () => {
  const value = snapshot();
  assert.equal(await appendExecutionAttemptSnapshots("cody", [value]), 1);
  assert.equal(
    await appendExecutionAttemptSnapshots("cody", [value]),
    0,
    "re-appending the same normalized snapshot is a no-op",
  );

  const ledger = path.join(
    artifactRoot,
    "familiar-execution-analytics",
    "v1",
    "cody.jsonl",
  );
  const firstRead = await listExecutionAttemptSnapshots("cody");
  assert.deepEqual(firstRead.map((attempt) => attempt.attemptId), ["ea1_test"]);
  assert.equal((await readFile(ledger, "utf8")).trim().split("\n").length, 1);

  await appendFile(
    ledger,
    [
      JSON.stringify({
        ...executionAttemptLedgerRecord(value),
        ledgerVersion: EXECUTION_ATTEMPT_LEDGER_VERSION + 1,
      }),
      JSON.stringify({
        ledgerVersion: EXECUTION_ATTEMPT_LEDGER_VERSION,
        snapshot: {
          ...value,
          schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION + 1,
        },
      }),
      "not-json",
      "",
    ].join("\n"),
    "utf8",
  );

  const afterUnsupportedRows = await listExecutionAttemptSnapshots("cody");
  assert.deepEqual(
    afterUnsupportedRows.map((attempt) => attempt.attemptId),
    ["ea1_test"],
    "unsupported ledger/snapshot versions and malformed lines are ignored",
  );
});

test("conversation projection derives only safe execution metadata", () => {
  const attempts = projectConversationExecutionAttempts(historicalConversation());
  assert.equal(attempts.length, 2);
  const known = attempts[0];
  assert.equal(known.harnessId, "claude");
  assert.equal(known.requestedModel, "anthropic/claude-sonnet");
  assert.equal(known.forwardedModel, "claude-sonnet");
  assert.equal(known.confirmedModel, "claude-sonnet");
  assert.equal(known.durationMs, 5_000);
  assert.deepEqual(known.usage, {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 25,
  });
  assert.equal(known.costUsd, 0.03);
  assert.deepEqual(known.tools, [{ name: "shell", status: "ok", durationMs: 750 }]);

  const serialized = JSON.stringify(attempts);
  assert.doesNotMatch(serialized, /PRIVATE_EXECUTION_CONTENT/);
  assert.doesNotMatch(
    serialized,
    /"text"|"reasoning"|"input"|"output"|"runtime"|"branch"|"prUrl"|tool-1/,
  );
});

test("historical unknown usage, cost, and harness version remain absent", () => {
  const attempts = projectConversationExecutionAttempts(historicalConversation());
  const unknown = attempts[1];
  assert.equal("usage" in unknown, false);
  assert.equal("totalTokens" in unknown, false);
  assert.equal("costUsd" in unknown, false);
  assert.equal("harnessVersion" in unknown, false);
  assert.equal("version" in (unknown.harness ?? {}), false);
  assert.equal(unknown.harnessId, "claude");
});

test("analytics projection builds windows, coverage, slices, and bounded recent rows", () => {
  const historical = projectConversationExecutionAttempts(historicalConversation())[0];
  const live = snapshot({
    attemptId: "ea1_live",
    sessionId: "session-live",
    turnId: "turn-live",
    execution: { kind: "assistant-response", origin: "board" },
    harness: { id: "claude", version: "1.2.3" },
    models: { confirmed: "claude-sonnet" },
    timing: { completedAt: "2026-08-18T09:30:00.000Z" },
    outcome: { status: "error" },
  });
  const old = snapshot({
    attemptId: "ea1_old",
    sessionId: "session-old",
    turnId: "turn-old",
    timing: { completedAt: "2026-06-01T09:00:00.000Z" },
    outcome: { status: "cancelled" },
  });

  const analytics = buildFamiliarExecutionAnalytics({
    familiarId: "cody",
    attempts: [historical, live, old],
    now: new Date("2026-08-18T10:00:00.000Z"),
    recentLimit: 2,
  });

  assert.equal(analytics.windows["7d"].attempts, 2);
  assert.equal(analytics.windows["7d"].completed, 1);
  assert.equal(analytics.windows["7d"].failed, 1);
  assert.equal(analytics.windows["7d"].cancelled, 0);
  assert.equal(analytics.windows["7d"].successRate, 0.5);
  assert.equal(analytics.windows.all.cancelled, 1);
  assert.deepEqual(
    analytics.windows["7d"].coverage.usage,
    { known: 1, total: 2, ratio: 0.5 },
  );
  assert.deepEqual(
    analytics.windows["7d"].coverage.harnessVersion,
    { known: 1, total: 2, ratio: 0.5 },
  );
  assert.ok(
    analytics.windows["7d"].models.some((slice) =>
      slice.key === "claude-sonnet" &&
      slice.attempts === 2 &&
      slice.successRate === 0.5
    ),
  );
  assert.ok(
    analytics.windows["7d"].harnesses.some((slice) =>
      slice.key === "claude@1.2.3" &&
      slice.toolCalls === 0 &&
      slice.toolFailures === 0
    ),
  );
  assert.equal(analytics.recentAttempts.length, 2);
  assert.deepEqual(
    analytics.recentAttempts[0],
    {
      id: "ea1_live",
      sessionId: "session-live",
      turnId: "turn-live",
      executionKind: "board",
      occurredAt: "2026-08-18T09:30:00.000Z",
      harnessId: "claude",
      harnessVersion: "1.2.3",
      confirmedModel: "claude-sonnet",
      status: "failed",
      toolCalls: 0,
      toolFailures: 0,
      provenance: "live",
    },
  );
  assert.equal(analytics.backfill.state, "not-started");
});

test("day-shaped windows carry a runs-per-day series over exactly their calendar days", () => {
  const completedYesterday = snapshot({
    attemptId: "ea1_yesterday",
    timing: { completedAt: "2026-08-17T23:59:59.000Z" },
    outcome: { status: "succeeded" },
  });
  const failedToday = snapshot({
    attemptId: "ea1_today",
    timing: { completedAt: "2026-08-18T09:30:00.000Z" },
    outcome: { status: "error" },
  });
  const cancelledToday = snapshot({
    attemptId: "ea1_cancelled",
    timing: { completedAt: "2026-08-18T09:45:00.000Z" },
    outcome: { status: "cancelled" },
  });
  // Inside the rolling 7 × 24h cutoff (2026-08-11T10:00Z) but on a calendar
  // day the seven-day series does not chart. Counted in the window's totals,
  // absent from `days` — which is the documented shape, not a leak.
  const boundary = snapshot({
    attemptId: "ea1_boundary",
    timing: { completedAt: "2026-08-11T12:00:00.000Z" },
    outcome: { status: "succeeded" },
  });

  const analytics = buildFamiliarExecutionAnalytics({
    familiarId: "cody",
    attempts: [completedYesterday, failedToday, cancelledToday, boundary],
    now: new Date("2026-08-18T10:00:00.000Z"),
  });

  const week = analytics.windows["7d"];
  assert.equal(week.attempts, 4);
  assert.deepEqual(week.days?.map((day) => day.date), [
    "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15",
    "2026-08-16", "2026-08-17", "2026-08-18",
  ]);
  assert.deepEqual(week.days?.at(-2), { date: "2026-08-17", completed: 1, failed: 0, cancelled: 0 });
  assert.deepEqual(week.days?.at(-1), { date: "2026-08-18", completed: 0, failed: 1, cancelled: 1 });
  assert.deepEqual(week.days?.[0], { date: "2026-08-12", completed: 0, failed: 0, cancelled: 0 });
  assert.equal(
    week.days?.reduce((total, day) => total + day.completed + day.failed + day.cancelled, 0),
    3,
    "the boundary run is in the window's totals and outside the charted days",
  );

  const fortnight = analytics.windows["14d"];
  assert.equal(fortnight.days?.length, 14);
  assert.equal(fortnight.days?.[0].date, "2026-08-05");
  assert.deepEqual(fortnight.days?.find((day) => day.date === "2026-08-11"), {
    date: "2026-08-11", completed: 1, failed: 0, cancelled: 0,
  });

  // The week-shaped and unbounded windows are not day-shaped.
  assert.equal("days" in analytics.windows["8w"], false);
  assert.equal("days" in analytics.windows.all, false);
});

test("repeated conversation backfill does not duplicate attempts", async () => {
  const conversation = historicalConversation();
  const dependencies = {
    listConversations: async () => [{
      sessionId: conversation.sessionId,
      familiarId: conversation.familiarId,
      harness: conversation.harness,
      updatedAt: conversation.updatedAt,
    }],
    loadConversation: async () => conversation,
  };
  const initial = await backfillFamiliarExecutionAttempts({
    familiarId: "cody",
    existing: [],
    dependencies,
  });
  const replay = await backfillFamiliarExecutionAttempts({
    familiarId: "cody",
    existing: initial.attempts,
    dependencies,
  });

  assert.equal(initial.attempts.length, 2);
  assert.equal(initial.toAppend.length, 2);
  assert.equal(replay.attempts.length, 2);
  assert.equal(replay.toAppend.length, 0);
  assert.deepEqual(
    replay.attempts.map((attempt) => attempt.attemptId),
    initial.attempts.map((attempt) => attempt.attemptId),
  );
});
