import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ResponseConfidenceEvent, ThreadSelfReport } from "@/lib/thread-self-report";
import {
  appendResponseConfidenceEvent,
  appendSelfReport,
  findSelfReport,
  listResponseConfidenceEvents,
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

function responseEvent(overrides: Partial<ResponseConfidenceEvent> = {}): ResponseConfidenceEvent {
  return {
    id: overrides.id ?? randomUUID(),
    familiarId: overrides.familiarId ?? "cody",
    sessionId: overrides.sessionId ?? "session-a",
    responseId: overrides.responseId ?? "response-a",
    turnId: overrides.turnId,
    threadTitle: overrides.threadTitle,
    responseAt: overrides.responseAt ?? "2026-06-25T12:00:00.000Z",
    reportedAt: overrides.reportedAt ?? "2026-06-25T12:00:01.000Z",
    overallConfidence: overrides.overallConfidence ?? 80,
    factors: overrides.factors ?? {
      toolUse: { score: 90, weight: 1, reason: "Tools worked.", signals: [] },
      context: { score: 80, weight: 1, reason: "Context enough.", signals: [] },
      skills: { score: 75, weight: 1, reason: "Skill used.", signals: [] },
      permissions: { score: 100, weight: 1, reason: "No block.", signals: [] },
      memory: { score: 60, weight: 1, reason: "Memory partial.", signals: [] },
      instructionFit: { score: 85, weight: 1, reason: "On task.", signals: [] },
      evidence: { score: 70, weight: 1, reason: "Evidence present.", signals: [] },
    },
    diagnosticTags: overrides.diagnosticTags ?? [],
    calibrationNotes: overrides.calibrationNotes,
    rubricVersion: overrides.rubricVersion ?? "2026-06-28.v1",
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

  it("appendResponseConfidenceEvent creates dated JSONL files and appends redacted events", async () => {
    await appendResponseConfidenceEvent("cody", responseEvent({
      id: "event-1",
      responseId: "response-1",
      reportedAt: "2026-06-25T10:00:00.000Z",
    }));
    await appendResponseConfidenceEvent("cody", responseEvent({
      id: "event-2",
      responseId: "response-2",
      reportedAt: "2026-06-25T11:00:00.000Z",
      calibrationNotes: "token=sk-proj-abcdefghijklmnopqrstuvwxyz",
    }));

    const listed = await listResponseConfidenceEvents("cody", {});

    assert.equal(listed.total, 2);
    assert.deepEqual(listed.events.map((item) => item.id), ["event-2", "event-1"]);
    assert.equal(listed.events[0].calibrationNotes, "token=[redacted]");
  });

  it("listResponseConfidenceEvents returns newest-first events with limit and before cursor", async () => {
    await appendResponseConfidenceEvent("cody", responseEvent({
      id: "old",
      responseId: "response-old",
      reportedAt: "2026-06-23T10:00:00.000Z",
    }));
    await appendResponseConfidenceEvent("cody", responseEvent({
      id: "new",
      responseId: "response-new",
      reportedAt: "2026-06-25T10:00:00.000Z",
    }));
    await appendResponseConfidenceEvent("cody", responseEvent({
      id: "mid",
      responseId: "response-mid",
      reportedAt: "2026-06-24T10:00:00.000Z",
    }));

    const limited = await listResponseConfidenceEvents("cody", { limit: 2 });
    const before = await listResponseConfidenceEvents("cody", { before: "2026-06-25T00:00:00.000Z" });
    const fallbackLimit = await listResponseConfidenceEvents("cody", { limit: Number.NaN });

    assert.equal(limited.total, 3);
    assert.deepEqual(limited.events.map((item) => item.id), ["new", "mid"]);
    assert.deepEqual(before.events.map((item) => item.id), ["mid", "old"]);
    assert.deepEqual(fallbackLimit.events.map((item) => item.id), ["new", "mid", "old"]);
  });

  it("listResponseConfidenceEvents returns an empty result for a missing directory", async () => {
    assert.deepEqual(await listResponseConfidenceEvents("cody", {}), { events: [], total: 0 });
  });
});
