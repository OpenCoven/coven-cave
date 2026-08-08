import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PathLike } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import {
  appendSelfReport,
  listDashboardMetricSnapshots,
  listDashboardSelfReports,
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

function trackedReads() {
  const files: string[] = [];
  const lines: string[] = [];
  return {
    files,
    lines,
    deps: {
      readdir: async (fullPath: PathLike) => readdir(fullPath, "utf8"),
      readFile: async (fullPath: PathLike, encoding: BufferEncoding) => {
        files.push(path.relative(tmpRoot, String(fullPath)));
        return readFile(fullPath, encoding);
      },
      onLineRead: (_fullPath: string, line: string) => {
        lines.push(JSON.parse(line).id);
      },
    },
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

  it("listSelfReports returns every report for the full-evidence mode", async () => {
    await appendSelfReport("cody", report({ id: "old", sessionId: "s1", reportedAt: "2026-06-23T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "new", sessionId: "s2", reportedAt: "2026-06-25T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "mid", sessionId: "s3", reportedAt: "2026-06-24T10:00:00.000Z" }));

    const listed = await listSelfReports("cody", { limit: "all" });

    assert.equal(listed.total, 3);
    assert.deepEqual(listed.reports.map((item) => item.id), ["new", "mid", "old"]);
  });

  it("listSelfReports applies the before cursor after sorting", async () => {
    await appendSelfReport("cody", report({ id: "new", sessionId: "s1", reportedAt: "2026-06-25T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "mid", sessionId: "s2", reportedAt: "2026-06-24T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "old", sessionId: "s3", reportedAt: "2026-06-23T10:00:00.000Z" }));

    const listed = await listSelfReports("cody", { before: "2026-06-25T00:00:00.000Z" });

    assert.deepEqual(listed.reports.map((item) => item.id), ["mid", "old"]);
  });

  it("listDashboardSelfReports stops after the newest relevant file dates once older files cannot outrank the cutoff", async () => {
    const base = Date.parse("2026-06-25T00:00:00.000Z");
    for (let index = 0; index < 35; index++) {
      await appendSelfReport("cody", report({
        id: `recent-${index}`,
        sessionId: `recent-session-${index}`,
        reportedAt: new Date(base + index * 60_000).toISOString(),
      }));
    }
    await appendSelfReport("cody", report({
      id: "older-file",
      sessionId: "older-file-session",
      reportedAt: "2026-06-24T23:59:00.000Z",
    }));

    const tracker = trackedReads();
    const listed = await listDashboardSelfReports("cody", tracker.deps);

    assert.equal(listed.total, 30);
    assert.deepEqual(
      listed.reports.map((item) => item.id),
      Array.from({ length: 30 }, (_, offset) => `recent-${34 - offset}`),
    );
    assert.deepEqual(
      tracker.files,
      ["workspaces/familiars/cody/self-reports/2026-06-25.jsonl"],
    );
    assert.deepEqual(
      tracker.lines,
      Array.from({ length: 35 }, (_, index) => `recent-${index}`),
    );
  });

  it("listDashboardSelfReports keeps same-day appended backfills from displacing newer rows and breaks ties by id", async () => {
    const reportsDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    await mkdir(reportsDir, { recursive: true });

    const raw = [
      ...Array.from({ length: 30 }, (_, offset) => report({
        id: `recent-${offset + 1}`,
        sessionId: `recent-session-${offset + 1}`,
        reportedAt: `2026-06-25T12:${String(offset + 1).padStart(2, "0")}:00.000Z`,
      })),
      report({
        id: "tie-b",
        sessionId: "tie-session-b",
        reportedAt: "2026-06-25T12:31:00.000Z",
      }),
      report({
        id: "tie-a",
        sessionId: "tie-session-a",
        reportedAt: "2026-06-25T12:31:00.000Z",
      }),
      report({
        id: "older-appended-last",
        sessionId: "older-session",
        reportedAt: "2026-06-25T11:00:00.000Z",
      }),
    ].map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(path.join(reportsDir, "2026-06-25.jsonl"), `${raw}\n`, "utf8");

    const listed = await listDashboardSelfReports("cody");

    assert.equal(listed.total, 30);
    assert.equal(
      listed.reports.some((item) => item.id === "older-appended-last"),
      false,
      "an older same-day backfill appended later must not displace a newer report",
    );
    assert.deepEqual(
      listed.reports.slice(0, 4).map((item) => item.id),
      ["tie-a", "tie-b", "recent-30", "recent-29"],
      "same-timestamp reports sort deterministically by id after reportedAt",
    );
    assert.equal(listed.reports.at(-1)?.id, "recent-3");
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

  it("listDashboardMetricSnapshots returns only the trailing 30-day newest 100 snapshots", async () => {
    const now = Date.parse("2026-08-07T20:00:00.000Z");
    for (let index = 0; index < 140; index++) {
      await appendSelfReport("cody", report({
        id: `recent-${index}`,
        sessionId: `session-${index}`,
        reportedAt: new Date(now - index * 6 * 60 * 60_000).toISOString(),
        overallConfidence: 80 - (index % 10),
      }));
    }
    await appendSelfReport("cody", report({
      id: "outside-window",
      sessionId: "old-session",
      reportedAt: "2026-06-01T09:00:00.000Z",
      overallConfidence: 42,
    }));

    const tracker = trackedReads();
    const listed = await listDashboardMetricSnapshots("cody", now, tracker.deps);
    assert.equal(listed.total, 100, "dashboard snapshot reads stop once the bounded window is filled");
    assert.equal(listed.snapshots.length, 100, "dashboard responses cap the visible snapshot ledger");
    assert.equal(listed.snapshots[0].id, "recent-99", "the bounded window keeps the newest 100 items");
    assert.equal(listed.snapshots.at(-1)?.id, "recent-0");
    assert.equal(listed.snapshots.some((snapshot) => snapshot.id === "outside-window"), false);
    assert.equal(
      tracker.files.some((file) => file.includes("metric-snapshots/")),
      true,
      "the bounded union still includes persisted candidates",
    );
    assert.equal(
      tracker.files.some((file) => file.includes("self-reports/") && !file.includes("metric-snapshots/")),
      true,
      "the bounded union must also sample report-derived candidates",
    );
    assert.equal(
      tracker.files.some((file) => file.endsWith("2026-07-08.jsonl")),
      false,
      "older in-window files stay unread once the bounded newest candidates are satisfied",
    );
  });

  it("listDashboardMetricSnapshots unions bounded persisted and report-derived candidates before capping", async () => {
    const now = Date.parse("2026-08-07T20:00:00.000Z");
    const legacyDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    const snapshotDir = path.join(legacyDir, "metric-snapshots");
    await mkdir(legacyDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });

    let reportRaw = "";
    for (let index = 0; index < 110; index++) {
      reportRaw += `${JSON.stringify(report({
        id: `report-${index}`,
        sessionId: `report-session-${index}`,
        reportedAt: new Date(now - (109 - index) * 60_000).toISOString(),
        overallConfidence: 80,
      }))}\n`;
    }
    await writeFile(path.join(legacyDir, "2026-08-07.jsonl"), reportRaw, "utf8");

    let persistedRaw = "";
    for (let index = 0; index < 100; index++) {
      persistedRaw += `${JSON.stringify({
        id: `report-${index}`,
        sessionId: `report-session-${index}`,
        reportedAt: new Date(now - (109 - index) * 60_000).toISOString(),
        confidence: 61,
        toolReliability: 75,
        memoryRecall: 70,
        fileLocatability: 65,
        contextPressure: "adequate",
      })}\n`;
    }
    await writeFile(path.join(snapshotDir, "2026-08-07.jsonl"), persistedRaw, "utf8");

    const tracker = trackedReads();
    const listed = await listDashboardMetricSnapshots("cody", now, tracker.deps);

    assert.equal(listed.total, 100);
    assert.equal(listed.snapshots.length, 100);
    assert.deepEqual(
      listed.snapshots.slice(0, 5).map((snapshot) => snapshot.id),
      ["report-10", "report-11", "report-12", "report-13", "report-14"],
      "the oldest 10 in-window rows should drop when newer report-only rows exist",
    );
    assert.deepEqual(
      listed.snapshots.slice(-10).map((snapshot) => snapshot.id),
      Array.from({ length: 10 }, (_, offset) => `report-${100 + offset}`),
      "the newest report-only rows must survive older persisted saturation",
    );
    assert.equal(
      listed.snapshots.some((snapshot) => snapshot.id === "report-9"),
      false,
      "the oldest 10 in-window rows should be trimmed from the bounded union",
    );
    assert.equal(
      listed.snapshots.find((snapshot) => snapshot.id === "report-99")?.confidence,
      61,
      "persisted rows continue to win representation when both sources carry the same id",
    );
    assert.deepEqual(
      [...tracker.files].sort(),
      [
        "workspaces/familiars/cody/self-reports/2026-08-07.jsonl",
        "workspaces/familiars/cody/self-reports/metric-snapshots/2026-08-07.jsonl",
      ],
      "the bounded union should read only the newest snapshot and report files in-window",
    );
    assert.equal(
      tracker.lines.length,
      210,
      "the reader stays bounded to the newest relevant persisted/report files while fully inspecting same-day candidates",
    );
  });

  it("listDashboardMetricSnapshots ignores same-day appended older backfills, breaks ties by id, and still prefers persisted duplicates", async () => {
    const now = Date.parse("2026-08-07T23:59:59.000Z");
    const reportsDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    const snapshotDir = path.join(reportsDir, "metric-snapshots");
    await mkdir(reportsDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });

    const reportsRaw = [
      ...Array.from({ length: 100 }, (_, offset) => report({
        id: `recent-${offset + 1}`,
        sessionId: `recent-session-${offset + 1}`,
        reportedAt: new Date(Date.parse("2026-08-07T10:00:00.000Z") + offset * 60_000).toISOString(),
        overallConfidence: 50 + (offset % 10),
      })),
      report({
        id: "tie-b",
        sessionId: "tie-session-b",
        reportedAt: "2026-08-07T11:40:00.000Z",
        overallConfidence: 61,
      }),
      report({
        id: "tie-a",
        sessionId: "tie-session-a",
        reportedAt: "2026-08-07T11:40:00.000Z",
        overallConfidence: 62,
      }),
      report({
        id: "older-appended-last",
        sessionId: "older-session",
        reportedAt: "2026-08-07T09:00:00.000Z",
        overallConfidence: 10,
      }),
    ].map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(path.join(reportsDir, "2026-08-07.jsonl"), `${reportsRaw}\n`, "utf8");

    const snapshotsRaw = [
      {
        id: "recent-50",
        sessionId: "recent-session-50",
        reportedAt: "2026-08-07T10:49:00.000Z",
        confidence: 77,
        toolReliability: 75,
        memoryRecall: 70,
        fileLocatability: 65,
        contextPressure: "adequate",
      },
      {
        id: "tie-b",
        sessionId: "tie-session-b",
        reportedAt: "2026-08-07T11:40:00.000Z",
        confidence: 91,
        toolReliability: 75,
        memoryRecall: 70,
        fileLocatability: 65,
        contextPressure: "adequate",
      },
    ].map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(path.join(snapshotDir, "2026-08-07.jsonl"), `${snapshotsRaw}\n`, "utf8");

    const listed = await listDashboardMetricSnapshots("cody", now);

    assert.equal(listed.total, 100);
    assert.equal(listed.snapshots[0].id, "recent-3");
    assert.equal(
      listed.snapshots.some((snapshot) => snapshot.id === "older-appended-last"),
      false,
      "an older same-day backfill appended later must not displace a newer snapshot candidate",
    );
    assert.deepEqual(
      listed.snapshots.slice(-3).map((snapshot) => snapshot.id),
      ["recent-100", "tie-a", "tie-b"],
      "same-timestamp snapshots sort deterministically by id after reportedAt",
    );
    assert.equal(listed.snapshots.find((snapshot) => snapshot.id === "tie-b")?.confidence, 91);
    assert.equal(listed.snapshots.find((snapshot) => snapshot.id === "recent-50")?.confidence, 77);
  });

  it("listDashboardMetricSnapshots keeps report-derived reads bounded even when persisted snapshots run short", async () => {
    const now = Date.parse("2026-08-07T20:00:00.000Z");
    const legacyDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    const snapshotDir = path.join(legacyDir, "metric-snapshots");
    await mkdir(legacyDir, { recursive: true });
    await mkdir(snapshotDir, { recursive: true });
    let persistedRaw = "";
    for (let index = 0; index < 40; index++) {
      persistedRaw += `${JSON.stringify({
        id: `persisted-${index}`,
        sessionId: `persisted-session-${index}`,
        reportedAt: new Date(now - (79 - index) * 60_000).toISOString(),
        confidence: 61,
        toolReliability: 75,
        memoryRecall: 70,
        fileLocatability: 65,
        contextPressure: "adequate",
      })}\n`;
    }
    await writeFile(path.join(snapshotDir, "2026-08-07.jsonl"), persistedRaw, "utf8");

    let reportRaw = "";
    for (let index = 79; index >= 0; index--) {
      reportRaw += `${JSON.stringify(report({
        id: `backfill-${index}`,
        sessionId: `backfill-session-${index}`,
        reportedAt: new Date(now - index * 60_000).toISOString(),
        overallConfidence: 80,
      }))}\n`;
    }
    await writeFile(
      path.join(legacyDir, "2026-08-07.jsonl"),
      reportRaw,
      "utf8",
    );
    await writeFile(
      path.join(legacyDir, "2026-07-10.jsonl"),
      `${JSON.stringify(report({
        id: "older-file",
        sessionId: "older-file-session",
        reportedAt: "2026-07-10T18:00:00.000Z",
        overallConfidence: 17,
      }))}\n`,
      "utf8",
    );

    const tracker = trackedReads();
    const listed = await listDashboardMetricSnapshots("cody", now, tracker.deps);
    assert.equal(listed.total, 100);
    assert.equal(listed.snapshots.length, 100);
    assert.equal(listed.snapshots.at(-1)?.id, "backfill-0");
    assert.deepEqual(
      [...tracker.files].sort(),
      [
        "workspaces/familiars/cody/self-reports/2026-07-10.jsonl",
        "workspaces/familiars/cody/self-reports/2026-08-07.jsonl",
        "workspaces/familiars/cody/self-reports/metric-snapshots/2026-08-07.jsonl",
      ],
      "report-derived candidates stay newest-first and bounded, but may read the next in-window file to fill their own 100-row cap",
    );
    assert.equal(
      tracker.lines.length,
      121,
      "the reader stops after 40 persisted rows plus the 81 newest report-derived candidates available in-window",
    );
    assert.equal(tracker.lines.includes("older-file"), true);
    assert.equal(listed.snapshots.some((snapshot) => snapshot.id === "older-file"), false);
  });
});
