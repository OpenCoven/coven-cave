import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  summarizeFeedback,
  validateFeedback,
} from "./onboarding-feedback-report.mjs";

test("summarizeFeedback emits de-identified onboarding counts", () => {
  const report = summarizeFeedback([
    {
      source: "office_hours",
      observedAt: "2026-08-01",
      stage: "runtime_connection",
      classification: "runtime_integration",
      severity: "major",
      platform: "windows",
      issueKey: "codex-sign-in-not-detected",
      workaround: "User opened a terminal and signed in",
      proposedFix: "Add an in-app connection test",
      owner: "Desktop runtime team",
      successMetric: "Connection succeeds without support",
    },
    {
      source: "discord",
      observedAt: "2026-08-02",
      stage: "runtime_connection",
      classification: "missing_feedback",
      severity: "blocker",
      platform: "macos",
      issueKey: "codex-sign-in-not-detected",
    },
  ]);

  assert.deepEqual(report.byIssue["codex-sign-in-not-detected"], {
    count: 2,
    severity: "blocker",
    platforms: ["macos", "windows"],
    stages: ["runtime_connection"],
    classifications: ["missing_feedback", "runtime_integration"],
    sources: ["discord", "office_hours"],
  });
  assert.deepEqual(report.byPlatform, { macos: 1, windows: 1 });
  assert.deepEqual(report.bySeverity, { blocker: 1, major: 1 });
  assert.deepEqual(report.bySource, { discord: 1, office_hours: 1 });
  assert.doesNotMatch(JSON.stringify(report), /opened a terminal/i);
  assert.doesNotMatch(JSON.stringify(report), /Desktop runtime team/i);
  assert.doesNotMatch(JSON.stringify(report), /in-app connection test/i);
});

test("validateFeedback rejects identifying or unstructured extra fields", () => {
  assert.throws(
    () => validateFeedback([{
      source: "discord",
      observedAt: "2026-08-02",
      stage: "recovery",
      classification: "missing_feedback",
      severity: "major",
      platform: "linux",
      issueKey: "blank-error-state",
      participantName: "Private Person",
    }]),
    /unknown field "participantName"/,
  );
});

test("CLI emits only the aggregate report", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cave-onboarding-feedback-"));
  const inputPath = path.join(directory, "feedback.json");
  writeFileSync(inputPath, JSON.stringify([{
    source: "usability_test",
    observedAt: "2026-08-03",
    stage: "project",
    classification: "platform_bug",
    severity: "blocker",
    platform: "windows",
    issueKey: "folder-picker-failed",
    workaround: "Private workaround text",
  }]));

  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./onboarding-feedback-report.mjs", import.meta.url)), inputPath],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.byIssue["folder-picker-failed"].count, 1);
    assert.doesNotMatch(result.stdout, /Private workaround text/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validateFeedback rejects invalid categories and dates", () => {
  assert.throws(
    () => validateFeedback([{
      source: "private_chat",
      observedAt: "2026-02-30",
      stage: "recovery",
      classification: "missing_feedback",
      severity: "major",
      platform: "linux",
      issueKey: "blank-error-state",
    }]),
    /"source" must be one of/,
  );

  assert.throws(
    () => validateFeedback([{
      source: "github",
      observedAt: "2026-02-30",
      stage: "recovery",
      classification: "missing_feedback",
      severity: "major",
      platform: "linux",
      issueKey: "blank-error-state",
    }]),
    /real YYYY-MM-DD date/,
  );
});
