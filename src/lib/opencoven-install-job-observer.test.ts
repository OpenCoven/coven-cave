// @ts-nocheck
import assert from "node:assert/strict";
import { createOpenCovenInstallJobObserver } from "./opencoven-install-job-observer.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  let lane = { npmBusy: false, npmBusyTarget: null, npmBusyLabel: null };
  const jobs = new Map();
  const seen = [];
  const terminals = [];
  let laneClears = 0;
  let scheduled;
  let unscheduled = 0;
  const observer = createOpenCovenInstallJobObserver({
    fetchLane: async () => lane,
    fetchJob: async (target) => jobs.get(target) ?? { status: "idle" },
    onLane: (next) => seen.push(["lane", next?.target ?? null]),
    onJob: (target, job) => seen.push(["job", target, job?.status ?? "idle"]),
    onTerminal: async (target, job) => terminals.push([target, job.ok]),
    onLaneCleared: async () => { laneClears += 1; },
    schedule: (callback) => { scheduled = callback; return 17; },
    unschedule: (id) => { assert.equal(id, 17); unscheduled += 1; },
  });
  return {
    observer, jobs, seen, terminals,
    setLane: (next) => { lane = next; },
    tick: async () => { scheduled(); await flush(); },
    laneClears: () => laneClears,
    unscheduled: () => unscheduled,
  };
}

{
  const h = harness();
  h.setLane({ npmBusy: true, npmBusyTarget: "coven-cli", npmBusyLabel: "Coven CLI" });
  h.jobs.set("coven-cli", { status: "running", elapsedMs: 10, tail: "installing" });
  h.observer.start();
  await flush();
  assert.deepEqual(h.seen.slice(-2), [["lane", "coven-cli"], ["job", "coven-cli", "running"]], "reload attaches to the running lane owner");
  h.jobs.set("coven-cli", { status: "done", elapsedMs: 20, tail: "", ok: true });
  await h.tick();
  await h.tick();
  assert.deepEqual(h.terminals, [["coven-cli", true]], "completion is reconciled exactly once");
}

{
  const h = harness();
  h.setLane({ npmBusy: true, npmBusyTarget: "coven-cli", npmBusyLabel: "Coven CLI" });
  h.jobs.set("coven-cli", { status: "done", elapsedMs: 20, tail: "", ok: true });
  h.observer.start();
  await flush();
  assert.deepEqual(h.terminals, [["coven-cli", true]], "a job completing before the attachment fetch is still processed");
}

{
  const h = harness();
  h.setLane({ npmBusy: true, npmBusyTarget: "coven-cli", npmBusyLabel: "Coven CLI" });
  h.jobs.set("coven-cli", { status: "done", elapsedMs: 20, tail: "", ok: false, error: "npm failed" });
  h.observer.start();
  await flush();
  assert.deepEqual(h.terminals, [["coven-cli", false]], "failed attached jobs use the terminal reconciliation path");
}

{
  const h = harness();
  h.setLane({ npmBusy: true, npmBusyTarget: "coven-cli", npmBusyLabel: "Coven CLI" });
  h.jobs.set("coven-cli", { status: "running", elapsedMs: 10, tail: "" });
  h.observer.start();
  await flush();
  // coven-cli completes; the lane stays busy (another npm target takes over).
  h.jobs.set("coven-cli", { status: "done", elapsedMs: 20, tail: "", ok: true });
  h.setLane({ npmBusy: true, npmBusyTarget: "codex", npmBusyLabel: "Codex" });
  await h.tick();
  assert.deepEqual(h.terminals, [["coven-cli", true]], "the prior owner completes while the new owner is attached");
  assert.ok(h.seen.some((event) => event.join(":") === "job:coven-cli:running"));
  h.setLane({ npmBusy: false, npmBusyTarget: null, npmBusyLabel: null });
  await h.tick();
  await h.tick();
  assert.equal(h.laneClears(), 1, "lane clearing refreshes retained rows once per transition");
}

{
  const h = harness();
  h.setLane({ npmBusy: true, npmBusyTarget: "../../arbitrary", npmBusyLabel: "attacker" });
  h.observer.start();
  await flush();
  assert.deepEqual(h.seen, [["lane", null]], "untrusted targets are never attached or displayed");
  h.observer.stop();
  await h.tick();
  assert.equal(h.unscheduled(), 1, "unmount clears the sole timer");
  assert.deepEqual(h.terminals, [], "unmount prevents later completion processing");
}

console.log("opencoven-install-job-observer.test.ts: ok");
