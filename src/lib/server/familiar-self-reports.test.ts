import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import {
  appendSelfReport,
  findSelfReport,
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
});
