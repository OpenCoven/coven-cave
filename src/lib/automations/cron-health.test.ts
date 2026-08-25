import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationRunStatus } from "../automation-runs.ts";
import type { CodexAutomation } from "../codex-automations-types.ts";
import { cronHealth, cronHealthLabel, cronRunVerb, failingCronIds } from "./cron-health.ts";

function auto(id: string, status: CodexAutomation["status"] = "ACTIVE"): CodexAutomation {
  return {
    id,
    name: id,
    kind: "codex",
    status,
    rrule: null,
    model: null,
    reasoningEffort: null,
    executionEnvironment: null,
    cwds: [],
    tags: [],
    familiars: [],
    prompt: "",
    skillPath: null,
    scheduleHuman: "daily 09:00",
  };
}

const run = (status: AutomationRunStatus) => ({ status });

describe("cronHealth", () => {
  it("reports paused before any run signal", () => {
    assert.equal(cronHealth(auto("a", "PAUSED"), run("failed")), "paused");
    assert.equal(cronHealth(auto("a", "PAUSED"), run("running")), "paused");
  });

  it("treats an in-flight run as running", () => {
    assert.equal(cronHealth(auto("a"), run("running")), "running");
    assert.equal(cronHealth(auto("a"), run("queued")), "running");
  });

  it("reports a failed newest run as failed", () => {
    assert.equal(cronHealth(auto("a"), run("failed")), "failed");
  });

  it("defaults to healthy — including with no recorded run at all", () => {
    // A cron the daemon runs on schedule has NO local run record: the store
    // only sees app-triggered "run now" executions. Absence must therefore read
    // as healthy, never as stale.
    assert.equal(cronHealth(auto("a"), undefined), "healthy");
    assert.equal(cronHealth(auto("a"), run("succeeded")), "healthy");
  });
});

describe("cronHealthLabel", () => {
  it("scopes the failed label to the recorded run", () => {
    assert.equal(cronHealthLabel("failed"), "Last run failed");
    assert.equal(cronHealthLabel("running"), "Running now");
    assert.equal(cronHealthLabel("paused"), "Paused");
    assert.equal(cronHealthLabel("healthy"), "Healthy");
  });
});

describe("failingCronIds", () => {
  it("counts active crons whose newest run failed", () => {
    const autos = [auto("a"), auto("b"), auto("c")];
    const runs = new Map([["a", run("failed")], ["b", run("succeeded")]]);
    assert.deepEqual([...failingCronIds(autos, runs)], ["a"]);
  });

  it("never counts a paused cron — paused is off, not failing", () => {
    const autos = [auto("a", "PAUSED")];
    const runs = new Map([["a", run("failed")]]);
    assert.equal(failingCronIds(autos, runs).size, 0);
  });

  it("is empty when nothing has run", () => {
    assert.equal(failingCronIds([auto("a"), auto("b")], new Map()).size, 0);
  });
});

describe("cronRunVerb", () => {
  it("names the state instead of leaving a bare timestamp", () => {
    // The handoff spec files "Run Jul 9" as a P1: ambiguous between last and
    // next run, and red without saying why. Every verb here answers both.
    assert.equal(cronRunVerb("failed"), "failed");
    assert.equal(cronRunVerb("running"), "running");
    assert.equal(cronRunVerb("healthy"), "ran");
  });

  it("uses the past tense for a paused cron's last recorded run", () => {
    // A paused cron still has run history; the cell describes that run, not
    // the pause.
    assert.equal(cronRunVerb("paused"), "ran");
  });
});
