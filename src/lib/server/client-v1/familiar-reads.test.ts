import assert from "node:assert/strict";
import test from "node:test";

import type { ContractFiles } from "../../familiar-contract.ts";
import {
  buildFamiliarExecutionAnalytics,
  EXECUTION_ATTEMPT_SCHEMA_VERSION,
  normalizeExecutionAttemptSnapshot,
  type ExecutionAttemptSnapshotV1,
} from "../../familiar-execution-analytics.ts";
import { parseClientV1JsonObject } from "./contract.ts";
import {
  parseClientV1FamiliarAnalyticsQuery,
  projectClientV1FamiliarAnalytics,
  projectClientV1FamiliarContract,
} from "./familiar-reads.ts";

const SOUL = `# SOUL.md - Who I Am

## I am Scribe

My purpose is **keeping the ledger**.

## Core Work

I help my person record what happened.

## What I Am Not

- Not a code assistant.

## My Boundaries

- Don't invent entries. Ever.
`;

const IDENTITY = `# IDENTITY.md - Scribe

- **Name:** Scribe
- **Creature:** Archivist familiar in the Coven
- **Pronouns:** they/them
- **Person:** Val Alexander

## Purpose

I help my person keep an honest record.
`;

const WARD = `[meta]
version = "0.1.0"
familiar = "scribe"
person = "val"

[protected]
files = ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"]
invariants = ["familiar.name == 'Scribe'", "familiar.person == 'val'"]

[editable]
paths = ["TOOLS.md", "notes/"]

[approval_tiers]

[approval_tiers.auto]
blocks = ["read files", "write to notes/"]
gate = "regression_suite"

[approval_tiers.human_review]
blocks = ["publish a finding", "open a pull request"]
gate = "human_approval"
`;

const MEMORY = `# MEMORY.md\n\n- Something durable worth remembering.\n`;

function files(overrides: Partial<ContractFiles> = {}): ContractFiles {
  return { soul: SOUL, identity: IDENTITY, ward: WARD, memory: MEMORY, ...overrides };
}

test("the contract projection carries presence, identity, the ward, and the report — and no path", () => {
  const record = projectClientV1FamiliarContract("scribe", files());
  assert.deepEqual(record, {
    id: "scribe",
    present: { soul: true, identity: true, ward: true, memory: true },
    identity: {
      name: "Scribe",
      creature: "Archivist familiar in the Coven",
      person: "Val Alexander",
    },
    ward: {
      version: "0.1.0",
      familiar: "scribe",
      person: "val",
      protectedFiles: ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"],
      invariants: ["familiar.name == 'Scribe'", "familiar.person == 'val'"],
      editablePaths: ["TOOLS.md", "notes/"],
      approvalTiers: {
        auto: ["read files", "write to notes/"],
        humanReview: ["publish a finding", "open a pull request"],
      },
    },
    report: record.report,
  });
  assert.equal(record.report.pass, true);
  assert.equal(record.report.violations.length, 0);
  // The envelope builder refuses undefined values; the projection must never
  // produce one. And the workspace path the private route serves is withheld.
  assert.doesNotThrow(() => parseClientV1JsonObject(record));
  assert.equal("workspace" in record, false);
});

test("a familiar without ward.toml has no ward, says so, and still gets a report", () => {
  const record = projectClientV1FamiliarContract("scribe", files({ ward: null }));
  assert.equal("ward" in record, false);
  assert.equal(record.present.ward, false);
  assert.equal(record.report.pass, false);
  assert.ok(record.report.violations.some((violation) => violation.file === "ward.toml"));
  assert.doesNotThrow(() => parseClientV1JsonObject(record));
});

test("a familiar without IDENTITY.md has no identity block", () => {
  const record = projectClientV1FamiliarContract("scribe", files({ identity: null }));
  assert.equal("identity" in record, false);
  assert.equal(record.present.identity, false);
});

test("identity and ward fields are omitted, never undefined, when the file names none", () => {
  const record = projectClientV1FamiliarContract("mote", files({
    identity: "# IDENTITY.md\n\nI help my person with things.\n",
    ward: "[meta]\nversion = \"0.1.0\"\n\n[protected]\nfiles = []\n",
  }));
  assert.deepEqual(record.identity, {});
  assert.deepEqual(record.ward, {
    version: "0.1.0",
    protectedFiles: [],
    invariants: [],
    editablePaths: [],
    approvalTiers: { auto: [], humanReview: [] },
  });
  assert.doesNotThrow(() => parseClientV1JsonObject(record));
});

test("the ward projection reads the inline tier spelling too", () => {
  const record = projectClientV1FamiliarContract("astra", files({
    ward: `[meta]
version = "0.3.1"
familiar = "Astra"
person = "Val Alexander"

[approval_tiers]
auto = ["read files", "search the web"]
human_review = ["publish a finding"]
`,
  }));
  assert.deepEqual(record.ward?.approvalTiers, {
    auto: ["read files", "search the web"],
    humanReview: ["publish a finding"],
  });
});

// ── Analytics ─────────────────────────────────────────────────────────────────

function snapshot(overrides: Record<string, unknown> = {}): ExecutionAttemptSnapshotV1 {
  const value = normalizeExecutionAttemptSnapshot({
    schemaVersion: EXECUTION_ATTEMPT_SCHEMA_VERSION,
    attemptId: "ea1_test",
    familiarId: "scribe",
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

const NOW = new Date("2026-08-18T10:00:00.000Z");

function analytics() {
  return buildFamiliarExecutionAnalytics({
    familiarId: "scribe",
    now: NOW,
    attempts: [
      snapshot({
        attemptId: "ea1_live",
        harness: { id: "claude", version: "1.2.3" },
        models: { confirmed: "claude-sonnet" },
        timing: { completedAt: "2026-08-18T09:30:00.000Z", durationMs: 4_000 },
        outcome: { status: "error" },
      }),
      snapshot({
        attemptId: "ea1_old",
        timing: { completedAt: "2026-06-01T09:00:00.000Z" },
        outcome: { status: "cancelled" },
      }),
    ],
  });
}

test("the analytics projection serves every window with its day series and no undefined", () => {
  const record = projectClientV1FamiliarAnalytics(analytics(), null);
  assert.deepEqual(Object.keys(record.windows), ["7d", "14d", "8w", "all"]);
  assert.equal(record.generatedAt, NOW.toISOString());
  assert.equal(record.windows["7d"]?.days?.length, 7);
  assert.equal(record.windows["14d"]?.days?.length, 14);
  assert.equal("days" in (record.windows["8w"] ?? {}), false);
  assert.equal("days" in (record.windows.all ?? {}), false);
  assert.equal(record.windows.all?.cancelled, 1);
  assert.equal(record.windows["7d"]?.successRate, 0);
  assert.equal(record.windows["7d"]?.medianDurationMs, 4_000);
  assert.deepEqual(record.backfill, { state: "not-started", imported: 0 });
  assert.deepEqual(record.recentAttempts[0], {
    id: "ea1_live",
    sessionId: "session-test",
    turnId: "turn-test",
    executionKind: "chat",
    occurredAt: "2026-08-18T09:30:00.000Z",
    harnessId: "claude",
    harnessVersion: "1.2.3",
    confirmedModel: "claude-sonnet",
    status: "failed",
    durationMs: 4_000,
    toolCalls: 0,
    toolFailures: 0,
    provenance: "live",
  });
  assert.doesNotThrow(() => parseClientV1JsonObject(record));
});

test("a named window narrows the response to that window alone", () => {
  const record = projectClientV1FamiliarAnalytics(analytics(), "8w");
  assert.deepEqual(Object.keys(record.windows), ["8w"]);
  assert.equal(record.recentAttempts.length, 2, "the attempt list is not window-scoped");
});

test("the analytics query defaults, narrows, and refuses", () => {
  const url = (query: string) =>
    new URL(`http://127.0.0.1:3020/api/client/v1/familiars/scribe/analytics${query}`);
  assert.deepEqual(parseClientV1FamiliarAnalyticsQuery(url("")), { window: null, recentLimit: 50 });
  assert.deepEqual(
    parseClientV1FamiliarAnalyticsQuery(url("?window=14d&recent=0")),
    { window: "14d", recentLimit: 0 },
  );
  assert.deepEqual(
    parseClientV1FamiliarAnalyticsQuery(url("?recent=100")),
    { window: null, recentLimit: 100 },
  );
  for (const [query, reason] of [
    ["?limit=5", /do not support the "limit" parameter/],
    ["?cursor=abc", /do not support the "cursor" parameter/],
    ["?window=7d&window=14d", /accept "window" at most once/],
    ["?window=3d", /must be one of 7d, 14d, 8w, all/],
    ["?window=", /must be one of 7d, 14d, 8w, all/],
    ["?recent=101", /between 0 and 100/],
    ["?recent=-1", /between 0 and 100/],
    ["?recent=1.5", /between 0 and 100/],
    ["?recent=007", /between 0 and 100/],
    ["?recent=", /between 0 and 100/],
  ] as const) {
    assert.throws(() => parseClientV1FamiliarAnalyticsQuery(url(query)), reason, query);
  }
});
