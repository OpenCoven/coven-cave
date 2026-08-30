import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AutomationRunRecord, AutomationRunStatus } from "../automation-runs.ts";
import { formatElapsed, liveRunView, newestRunFor } from "./live-run.ts";

const START = "2026-08-25T10:00:00.000Z";
const NOW = new Date("2026-08-25T10:00:40.000Z").getTime();

function run(status: AutomationRunStatus, over: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    id: "r1",
    automationId: "a1",
    automationName: "Daily brief",
    startedAt: START,
    status,
    ...over,
  };
}

describe("formatElapsed", () => {
  it("stays narrow and stops jittering once past a minute", () => {
    assert.equal(formatElapsed(8_000), "8s");
    // Zero-padded seconds so the readout does not change width every tick
    // while someone is watching a run.
    assert.equal(formatElapsed(64_000), "1m 04s");
    assert.equal(formatElapsed(4_320_000), "1h 12m");
  });

  it("never renders a negative duration", () => {
    assert.equal(formatElapsed(-5_000), "0s");
  });
});

describe("liveRunView", () => {
  it("shows nothing when there is no run to follow", () => {
    assert.equal(liveRunView(null, NOW), null);
    assert.equal(liveRunView(run("running", { startedAt: "not-a-date" }), NOW), null);
  });

  it("counts up against the wall clock while in flight", () => {
    const view = liveRunView(run("running"), NOW)!;
    assert.equal(view.phase, "running");
    assert.equal(view.settled, false, "an in-flight run keeps the card polling");
    assert.equal(view.elapsedMs, 40_000);
    assert.equal(view.headline, "Running…");
  });

  it("treats a queued run as in flight rather than inventing a fourth state", () => {
    const view = liveRunView(run("queued"), NOW)!;
    assert.equal(view.phase, "running");
    assert.equal(view.settled, false);
  });

  it("freezes the duration once the run finished", () => {
    const view = liveRunView(
      run("succeeded", { finishedAt: "2026-08-25T10:00:25.000Z" }),
      // Later wall clock must NOT keep the number climbing after it settled.
      new Date("2026-08-25T10:05:00.000Z").getTime(),
    )!;
    assert.equal(view.settled, true);
    assert.equal(view.elapsedMs, 25_000);
    assert.equal(view.headline, "Finished in 25s");
  });

  it("names the exit code on failure rather than sending you to the log for it", () => {
    const view = liveRunView(
      run("failed", { finishedAt: "2026-08-25T10:00:10.000Z", exitCode: 1 }),
      NOW,
    )!;
    assert.equal(view.phase, "failed");
    assert.match(view.headline, /Failed \(exit 1\) after 10s/);
  });

  it("settles a cancelled run instead of presenting it as running forever", () => {
    // The daemon reports `cancelled` as a terminal outcome; the card must
    // stop polling and say so, never keep counting up under "Running…".
    const view = liveRunView(
      run("cancelled", { finishedAt: "2026-08-25T10:00:12.000Z" }),
      NOW,
    )!;
    assert.equal(view.phase, "cancelled");
    assert.equal(view.settled, true, "a cancelled run is settled — the card stops ticking");
    assert.equal(view.headline, "Cancelled after 12s");
  });

  it("falls back to wall clock when finishedAt is nonsense, never a negative", () => {
    const view = liveRunView(
      run("succeeded", { finishedAt: "2026-08-25T09:00:00.000Z" }), // before the start
      NOW,
    )!;
    assert.ok(view.elapsedMs >= 0);
    assert.equal(view.elapsedMs, 40_000, "wall clock, rather than a negative duration");
  });

  it("surfaces a summary only when the run left one", () => {
    assert.equal(liveRunView(run("succeeded", { finishedAt: START }), NOW)!.summary, null);
    assert.equal(liveRunView(run("succeeded", { finishedAt: START, summary: "  " }), NOW)!.summary, null);
    assert.equal(
      liveRunView(run("succeeded", { finishedAt: START, summary: " wrote 3 files " }), NOW)!.summary,
      "wrote 3 files",
    );
  });
});

describe("newestRunFor", () => {
  it("follows the newest run for THIS cron, not whatever came first", () => {
    // Re-established rather than assumed: a card following the wrong run would
    // report someone else's outcome.
    const runs = [
      run("succeeded", { id: "old", startedAt: "2026-08-25T09:00:00.000Z" }),
      run("running", { id: "new", startedAt: "2026-08-25T10:00:00.000Z" }),
      run("running", { id: "other", automationId: "a2", startedAt: "2026-08-25T11:00:00.000Z" }),
    ];
    assert.equal(newestRunFor(runs, "a1")?.id, "new");
  });

  it("returns null when this cron has no runs at all", () => {
    assert.equal(newestRunFor([run("running", { automationId: "a2" })], "a1"), null);
  });
});
