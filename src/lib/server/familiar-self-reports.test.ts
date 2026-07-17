import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import {
  appendSelfReport,
  findSelfReport,
  listMetricSnapshots,
  listSelfReports,
} from "./familiar-self-reports.ts";

let tmpRoot = "";
const originalCovenHome = process.env.COVEN_HOME;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), `coven-self-reports-${randomUUID()}-`));
  process.env.COVEN_HOME = tmpRoot;
});

afterEach(async () => {
  if (originalCovenHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = originalCovenHome;
  await rm(tmpRoot, { recursive: true, force: true });
});

function report(overrides: Partial<ThreadSelfReport> = {}): ThreadSelfReport {
  return {
    id: overrides.id ?? randomUUID(),
    familiarId: overrides.familiarId ?? "cody",
    sessionId: overrides.sessionId ?? "session-a",
    threadTitle: overrides.threadTitle,
    reportedAt: overrides.reportedAt ?? "2026-06-25T12:00:00.000Z",
    overallConfidence: overrides.overallConfidence ?? 80,
    overallConfidenceReason: overrides.overallConfidenceReason ?? "steady",
    toolReliability: overrides.toolReliability ?? {
      score: 75,
      failedTools: [],
      unreliableTools: [],
    },
    contextPressure: overrides.contextPressure ?? "adequate",
    contextNotes: overrides.contextNotes,
    skillsUsed: overrides.skillsUsed ?? [],
    skillsNeedingClarity: overrides.skillsNeedingClarity ?? [],
    skillsNeedingAccess: overrides.skillsNeedingAccess ?? [],
    capabilitiesLacking: overrides.capabilitiesLacking ?? [],
    capabilitiesVital: overrides.capabilitiesVital ?? [],
    memoryRecallScore: overrides.memoryRecallScore ?? 70,
    memoryRecallNotes: overrides.memoryRecallNotes,
    fileLocatabilityScore: overrides.fileLocatabilityScore ?? 65,
    fileLocatabilityNotes: overrides.fileLocatabilityNotes,
    persistentBlockers: overrides.persistentBlockers ?? [],
  };
}

describe("familiar self-report storage", () => {
  it("appendSelfReport creates the dated JSONL file and appends redacted reports", async () => {
    await appendSelfReport("cody", report({ id: "r1", sessionId: "s1", reportedAt: "2026-06-25T10:00:00.000Z" }));
    await appendSelfReport("cody", report({
      id: "r2",
      sessionId: "s2",
      reportedAt: "2026-06-25T11:00:00.000Z",
      memoryRecallNotes: "token=sk-proj-abcdefghijklmnopqrstuvwxyz",
    }));

    const listed = await listSelfReports("cody", {});

    assert.equal(listed.total, 2);
    assert.deepEqual(listed.reports.map((item) => item.id), ["r2", "r1"]);
    assert.equal(listed.reports[0].memoryRecallNotes, "token=[redacted]");
  });

  it("listSelfReports returns newest-first reports with the requested limit", async () => {
    await appendSelfReport("cody", report({ id: "old", sessionId: "s1", reportedAt: "2026-06-23T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "new", sessionId: "s2", reportedAt: "2026-06-25T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "mid", sessionId: "s3", reportedAt: "2026-06-24T10:00:00.000Z" }));

    const listed = await listSelfReports("cody", { limit: 2 });

    assert.equal(listed.total, 3);
    assert.deepEqual(listed.reports.map((item) => item.id), ["new", "mid"]);
  });

  it("listSelfReports applies the before cursor after sorting", async () => {
    await appendSelfReport("cody", report({ id: "new", sessionId: "s1", reportedAt: "2026-06-25T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "mid", sessionId: "s2", reportedAt: "2026-06-24T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "old", sessionId: "s3", reportedAt: "2026-06-23T10:00:00.000Z" }));

    const listed = await listSelfReports("cody", { before: "2026-06-25T00:00:00.000Z" });

    assert.deepEqual(listed.reports.map((item) => item.id), ["mid", "old"]);
  });

  it("findSelfReport returns null for missing sessions and the matching report for existing ones", async () => {
    await appendSelfReport("cody", report({ id: "r1", sessionId: "session-one" }));
    await appendSelfReport("cody", report({ id: "r2", sessionId: "session-two" }));

    assert.equal(await findSelfReport("cody", "missing"), null);
    assert.equal((await findSelfReport("cody", "session-two"))?.id, "r2");
  });

  it("listSelfReports returns an empty result for a missing directory", async () => {
    assert.deepEqual(await listSelfReports("cody", {}), { reports: [], total: 0 });
  });

  it("appendSelfReport persists a compact metric snapshot alongside the report", async () => {
    await appendSelfReport("cody", report({
      id: "r1",
      sessionId: "s1",
      reportedAt: "2026-06-25T10:00:00.000Z",
      overallConfidence: 82,
      memoryRecallNotes: "token=sk-proj-abcdefghijklmnopqrstuvwxyz",
    }));

    const raw = await readFile(
      path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports", "metric-snapshots", "2026-06-25.jsonl"),
      "utf8",
    );
    const line = JSON.parse(raw.trim());
    assert.equal(line.id, "r1");
    assert.equal(line.confidence, 82);
    // Snapshots are score-only — no free-text fields ride along.
    assert.equal("memoryRecallNotes" in line, false);

    const listed = await listMetricSnapshots("cody");
    assert.equal(listed.total, 1);
    assert.equal(listed.snapshots[0].id, "r1");
    assert.equal(listed.snapshots[0].toolReliability, 75);
  });

  it("listMetricSnapshots backfills legacy reports that predate snapshot persistence", async () => {
    // Simulate a pre-snapshot install: a report file exists, no snapshot dir.
    const legacyDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    await mkdir(legacyDir, { recursive: true });
    const legacy = report({ id: "legacy", sessionId: "s0", reportedAt: "2026-06-20T09:00:00.000Z", overallConfidence: 55 });
    await writeFile(path.join(legacyDir, "2026-06-20.jsonl"), `${JSON.stringify(legacy)}\n`, "utf8");

    await appendSelfReport("cody", report({ id: "fresh", sessionId: "s1", reportedAt: "2026-06-25T10:00:00.000Z" }));

    const listed = await listMetricSnapshots("cody");
    assert.equal(listed.total, 2);
    // Oldest → newest: the trend x-axis.
    assert.deepEqual(listed.snapshots.map((snapshot) => snapshot.id), ["legacy", "fresh"]);
    assert.equal(listed.snapshots[0].confidence, 55);
  });

  it("listMetricSnapshots dedupes by report id (newest persisted line wins) and skips malformed lines", async () => {
    await appendSelfReport("cody", report({ id: "r1", sessionId: "s1", reportedAt: "2026-06-25T10:00:00.000Z", overallConfidence: 60 }));
    const snapshotDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports", "metric-snapshots");
    // A replayed/repaired line for the same report id, appended later: it wins.
    await appendFile(
      path.join(snapshotDir, "2026-06-25.jsonl"),
      `not-json\n{"id":"half"}\n${JSON.stringify({
        id: "r1",
        sessionId: "s1",
        reportedAt: "2026-06-25T10:00:00.000Z",
        confidence: 72,
        toolReliability: 75,
        memoryRecall: 70,
        fileLocatability: 65,
        contextPressure: "adequate",
      })}\n`,
      "utf8",
    );

    const listed = await listMetricSnapshots("cody");
    assert.equal(listed.total, 1);
    assert.equal(listed.snapshots[0].id, "r1");
    assert.equal(listed.snapshots[0].confidence, 72, "the newest persisted line replaces the stale one");
  });

  it("listMetricSnapshots returns an empty result for a missing directory", async () => {
    assert.deepEqual(await listMetricSnapshots("cody"), { snapshots: [], total: 0 });
  });
});
