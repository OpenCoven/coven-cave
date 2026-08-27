import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationRunRecord, AutomationRunStatus } from "../automation-runs.ts";
import type { CodexAutomation } from "../codex-automations-types.ts";
import { cronInsight, cronNextRuns, recordedRunStats } from "./cron-detail-state.ts";

function auto(over: Partial<CodexAutomation> = {}): CodexAutomation {
  return {
    id: "a",
    name: "a",
    kind: "codex",
    status: "ACTIVE",
    rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    model: null,
    reasoningEffort: null,
    executionEnvironment: null,
    cwds: [],
    tags: [],
    familiars: [],
    prompt: "",
    skillPath: null,
    scheduleHuman: "daily 09:00",
    ...over,
  };
}

function run(status: AutomationRunStatus, over: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    id: "r",
    automationId: "a",
    automationName: "a",
    startedAt: "2026-08-25T09:00:00.000Z",
    status,
    ...over,
  };
}

const NOW = new Date("2026-08-25T10:00:00Z").getTime();

describe("cronNextRuns", () => {
  it("answers when an active cron next fires", () => {
    const next = cronNextRuns(auto(), NOW, 3);
    assert.equal(next.length, 3);
    const times = next.map((iso) => new Date(iso).getTime());
    assert.ok(times.every((t) => t > NOW), "every upcoming run is in the future");
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("gives a paused cron no upcoming runs at all", () => {
    // Listing the times it *would have* fired describes a schedule that is off.
    assert.deepEqual(cronNextRuns(auto({ status: "PAUSED" }), NOW, 3), []);
  });

  it("returns nothing for a rule it cannot read, rather than guessing", () => {
    assert.deepEqual(cronNextRuns(auto({ rrule: "RRULE:FREQ=SECONDLY;COUNT=9" }), NOW, 3), []);
    assert.deepEqual(cronNextRuns(auto({ rrule: null }), NOW, 3), []);
  });
});

describe("recordedRunStats", () => {
  it("summarises only runs that actually finished", () => {
    const stats = recordedRunStats([
      run("succeeded", { startedAt: "2026-08-25T09:00:00.000Z", finishedAt: "2026-08-25T09:00:10.000Z" }),
      run("succeeded", { startedAt: "2026-08-25T09:00:00.000Z", finishedAt: "2026-08-25T09:00:30.000Z" }),
      run("running", { startedAt: "2026-08-25T09:00:00.000Z" }), // no finish — excluded
    ]);
    assert.equal(stats.sampled, 2, "an in-flight run has no duration to report");
    assert.equal(stats.medianMs, 20_000);
    assert.equal(stats.maxMs, 30_000);
  });

  it("reports nothing rather than zero when there is nothing to measure", () => {
    const stats = recordedRunStats([run("running")]);
    assert.equal(stats.sampled, 0);
    assert.equal(stats.medianMs, null, "null reads as 'unknown'; 0 would read as 'instant'");
    assert.equal(stats.maxMs, null);
  });
});

describe("cronInsight", () => {
  it("says a paused cron will not run", () => {
    assert.match(cronInsight(auto({ status: "PAUSED" }), undefined, null), /will not run until you resume/);
  });

  it("names the failure reason when one was recorded", () => {
    const insight = cronInsight(auto(), run("failed", { summary: "exit 1: MCP timeout" }), "2026-08-26T09:00:00Z");
    assert.match(insight, /last recorded run failed: exit 1: MCP timeout/);
  });

  it("scopes a failure to what was RECORDED, never to the cron at large", () => {
    // The run store holds app-triggered runs only, so "this cron is failing"
    // would overclaim from a single manual run.
    assert.match(cronInsight(auto(), run("failed"), null), /last recorded run/);
  });

  it("distinguishes 'nothing recorded here' from 'never ran'", () => {
    const insight = cronInsight(auto(), undefined, "2026-08-26T09:00:00Z");
    assert.match(insight, /No runs recorded in Cave yet/);
    assert.match(insight, /daemon/, "and says where the scheduled runs actually happen");
  });

  it("admits when it cannot work out the next run", () => {
    const insight = cronInsight(auto(), run("succeeded"), null);
    assert.match(insight, /can't be read, so the next run is unknown/);
  });
});
