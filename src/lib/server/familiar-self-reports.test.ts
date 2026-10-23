import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deriveThreadConfidence } from "@/lib/thread-confidence";
import type { ThreadSelfReport } from "@/lib/thread-self-report";
import {
  appendSelfReport,
  findSelfReport,
  listMetricSnapshots,
  listSelfReports,
  redactSelfReport,
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
  it("independent processes admit only one automatic report", { timeout: 15_000 }, async () => {
    const moduleUrl = new URL("./familiar-self-reports.ts", import.meta.url).href;
    const children = Array.from({ length: 4 }, (_, index) => {
      const child = spawn(process.execPath, [
        "--experimental-strip-types", "--import", "./scripts/test-alias-register.mjs",
        "--input-type=module", "--eval", `
          import { appendSelfReport } from ${JSON.stringify(moduleUrl)};
          process.send("ready");
          process.once("message", async () => {
            try {
              const accepted = await appendSelfReport("cody", JSON.parse(process.env.COVEN_TEST_REPORT), { onlyIfAbsent: true });
              process.stdout.write(JSON.stringify(accepted));
            } catch (error) { console.error(error); process.exitCode = 1; }
            finally { process.disconnect(); }
          });
        `,
      ], {
        env: { ...process.env, COVEN_TEST_REPORT: JSON.stringify(report({ id: `process-${index}` })) },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let output = "";
      let errors = "";
      assert.ok(child.stdout);
      assert.ok(child.stderr);
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { errors += data; });
      const ready = new Promise<void>((resolve, reject) => {
        child.once("message", () => resolve());
        child.once("error", reject);
        child.once("exit", () => reject(new Error(`worker exited before readiness: ${errors}`)));
      });
      const done = new Promise<boolean>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => {
          if (code !== 0) reject(new Error(`worker failed: ${errors}`));
          else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } }
        });
      });
      // Attach rejection handlers immediately while the readiness barrier waits.
      void done.catch(() => {});
      return { child, ready, done };
    });
    try {
      await Promise.all(children.map(({ ready }) => ready));
      for (const { child } of children) child.send("go");
      const results = await Promise.all(children.map(({ done }) => done));
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal((await listSelfReports("cody", {})).total, 1);
      assert.equal((await listMetricSnapshots("cody")).total, 1);
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill();
      await Promise.allSettled(children.map(({ done }) => done));
    }
  });

  it("a manual write racing automatic admission is always retained", async () => {
    const [manualAccepted, autoAccepted] = await Promise.all([
      appendSelfReport("cody", report({ id: "manual-race" })),
      appendSelfReport("cody", report({ id: "auto-race" }), { onlyIfAbsent: true }),
    ]);
    assert.equal(manualAccepted, true);
    const stored = await listSelfReports("cody", {});
    assert.ok(stored.reports.some((item) => item.id === "manual-race"));
    assert.equal(stored.total, autoAccepted ? 2 : 1);
    assert.equal((await listMetricSnapshots("cody")).total, stored.total);
  });

  it("automatic admission refuses an unreadable ledger and releases its lock", async () => {
    await appendSelfReport("cody", report({ sessionId: "other" }));
    const { familiarWorkspace } = await import("@/lib/coven-paths");
    const broken = path.join(await familiarWorkspace("cody"), "self-reports", "broken.jsonl");
    await mkdir(broken);
    await assert.rejects(appendSelfReport("cody", report(), { onlyIfAbsent: true }));
    await rm(broken, { recursive: true });
    assert.equal(await appendSelfReport("cody", report(), { onlyIfAbsent: true }), true);
  });

  it("automatic admission rejects an existing manual report without writing a snapshot", async () => {
    await appendSelfReport("cody", report({ id: "manual" }));
    const accepted = await appendSelfReport("cody", report({ id: "auto" }), { onlyIfAbsent: true });
    assert.equal(accepted, false);
    assert.deepEqual((await listSelfReports("cody", {})).reports.map((item) => item.id), ["manual"]);
    assert.deepEqual((await listMetricSnapshots("cody")).snapshots.map((item) => item.id), ["manual"]);
  });

  it("simultaneous automatic writes admit exactly one report while manual repeats remain allowed", async () => {
    const accepted = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      appendSelfReport("cody", report({ id: `auto-${i}` }), { onlyIfAbsent: true }),
    ));
    assert.equal(accepted.filter(Boolean).length, 1);
    assert.equal((await listSelfReports("cody", {})).total, 1);
    assert.equal((await listMetricSnapshots("cody")).total, 1);
    await Promise.all([
      appendSelfReport("cody", report({ id: "manual-1" })),
      appendSelfReport("cody", report({ id: "manual-2" })),
    ]);
    assert.equal((await listSelfReports("cody", {})).total, 3);
    assert.equal((await listMetricSnapshots("cody")).total, 3);
  });

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

  it("drops a stored report missing its required id before analytics aggregation", async () => {
    const reportsDir = path.join(tmpRoot, "workspaces", "familiars", "cody", "self-reports");
    await mkdir(reportsDir, { recursive: true });
    const valid = report({
      id: "valid",
      sessionId: "valid-session",
      reportedAt: "2026-06-25T10:00:00.000Z",
    });
    const { id: _missingId, ...missingId } = report({
      id: "discarded",
      sessionId: "malformed-session",
      reportedAt: valid.reportedAt,
    });
    await writeFile(
      path.join(reportsDir, "2026-06-25.jsonl"),
      `${JSON.stringify(missingId)}\n${JSON.stringify(valid)}\n`,
      "utf8",
    );

    const listed = await listSelfReports("cody", { limit: "all" });
    const confidence = deriveThreadConfidence(listed.reports);

    assert.deepEqual(listed.reports.map((item) => item.id), ["valid"]);
    assert.equal(confidence.reportCount, 1);
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

  it("listMetricSnapshots returns only the requested trailing evidence window", async () => {
    await appendSelfReport("cody", report({ id: "old", sessionId: "s1", reportedAt: "2026-06-23T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "mid", sessionId: "s2", reportedAt: "2026-06-24T10:00:00.000Z" }));
    await appendSelfReport("cody", report({ id: "new", sessionId: "s3", reportedAt: "2026-06-25T10:00:00.000Z" }));

    const listed = await listMetricSnapshots("cody", { limit: 2 });

    assert.equal(listed.total, 3);
    assert.deepEqual(listed.snapshots.map((snapshot) => snapshot.id), ["mid", "new"]);
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

describe("redactSelfReport", () => {
  it("redacts secrets in the report but keeps the thread id routes hand back", () => {
    // Assembled at runtime so the fixture never reads as a real key in the diff.
    const token = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
    const input = report({ sessionId: "session-keep", threadTitle: `Deploy with token ${token}` });
    const out = redactSelfReport(input);
    assert.equal(out.sessionId, "session-keep");
    assert.ok(!JSON.stringify(out).includes(token), "the token is still redacted");
  });
});
