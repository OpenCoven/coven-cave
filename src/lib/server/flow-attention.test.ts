import assert from "node:assert/strict";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import type { ResearchMission } from "../research-missions.ts";

const home = path.resolve(`.flow-attention-test-${process.pid}`);
mkdirSync(home, { recursive: true });
process.env.COVEN_HOME = path.join(home, ".coven");
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_RESEARCH_MISSIONS_DIR = path.join(home, "research-missions");
delete process.env.COVEN_FLOW_RUNS_PATH;
const attention = await import("./flow-attention.ts");
const { listFlowRuns, recordFlowRun } = await import("./flow-store.ts");
const { dismissItem, loadInbox } = await import("../cave-inbox.ts");
const { saveConversation } = await import("../cave-conversations.ts");
after(() => rmSync(home, { recursive: true, force: true }));

async function flow(sessionId: string, missionId?: string) {
  if (missionId) {
    const { recordSessionFamiliar } = await import("../cave-config.ts");
    await recordSessionFamiliar(sessionId, "sage");
  }
  return recordFlowRun({
    flowId: "flow-one",
    flowName: "Source review",
    sessionId,
    missionId,
    status: "running",
    startedAt: "2026-09-05T12:00:00.000Z",
    source: "cave",
    steps: [],
  });
}

function mission(id: string, patch: Partial<ResearchMission> = {}): ResearchMission {
  return {
    version: 1,
    id,
    familiarId: "sage",
    title: "Research sources",
    intent: "Review sources",
    mode: "autoresearch",
    modeSource: "user",
    deliverable: "findings",
    constraints: [],
    bounds: {
      wallClockMinutes: 60,
      maxIterations: 6,
      checkpointEvery: 2,
      sourceTarget: 12,
      stopWhenCostUnavailable: false,
    },
    status: "running",
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:00:00.000Z",
    iterations: [],
    artifacts: [],
    sources: [],
    ...patch,
  };
}

test("successful Flow completion is quiet and does not consume the actionable dedup key", async () => {
  const run = await flow("success-then-failure");
  assert.equal(await attention.emitFlowSessionAttention({ sessionId: run.sessionId!, text: "Done" }), null);
  const item = await attention.emitFlowSessionAttention({ sessionId: run.sessionId!, isError: true });
  assert.ok(item);
  assert.equal(item.auto, `flow-attention:run:${run.id}`);
  assert.equal(item.status, "fired");
  assert.equal(item.sessionId, null, "background execution must not route to Chat");
  assert.equal(item.link?.kind, "url");
  assert.match(item.body!, /review|retry/i);
});

test("sessionless engine errors use the same parent-run notification policy", async () => {
  const run = {
    id: "engine-run",
    flowId: "engine-flow",
    flowName: "Engine source review",
    status: "succeeded" as const,
  };
  assert.equal(await attention.emitFlowRunAttention(run), null);
  const failed = { ...run, status: "failed" as const };
  const item = await attention.emitFlowRunAttention(failed);
  assert.ok(item);
  assert.equal(item.auto, "flow-attention:run:engine-run");
  assert.equal(await attention.emitFlowRunAttention(failed), null);
});

test("notifications select their exact run or mission in supported parent surfaces", async () => {
  const flowItem = await attention.emitFlowRunAttention({
    id: "navigation-flow-run",
    flowId: "navigation-flow",
    status: "failed",
  });
  assert.equal(flowItem?.link?.ref, "/?mode=chat&flowRun=navigation-flow-run");
  const missionItem = await attention.emitResearchMissionAttention(mission("navigation-mission", { status: "failed" }));
  assert.equal(missionItem?.link?.ref, "/?mode=surface%3Aresearcher-desk&researchMission=navigation-mission&flowFamiliar=sage");
  const approvalItem = await attention.emitFlowRunAttention({
    id: "navigation-approval-run",
    flowId: "navigation-flow",
    missionId: "navigation-approval-mission",
    familiarId: "sage",
    status: "succeeded",
    text: '<coven:attention reason="approval" />',
  });
  assert.equal(approvalItem?.link?.ref, "/?mode=surface%3Aresearcher-desk&researchMission=navigation-approval-mission&flowFamiliar=sage");
});

test("one parent item follows changed blockers and re-arms only for a new event", async () => {
  const first = mission("changing-blocker", { status: "failed", lastError: "first failure" });
  const item = await attention.emitResearchMissionAttention(first);
  assert.ok(item);
  await attention.emitResearchMissionAttention({ ...first, status: "checkpoint", lastError: undefined });
  let stored = (await loadInbox()).items.find((entry) => entry.id === item.id)!;
  assert.match(stored.body!, /checkpoint/);
  await dismissItem(item.id);
  assert.equal(await attention.emitResearchMissionAttention({ ...first, status: "checkpoint", lastError: undefined }), null);
  const again = await attention.emitResearchMissionAttention({ ...first, lastError: "new failure" });
  assert.equal(again?.id, item.id, "a new blocker updates the parent item rather than adding iteration items");
  await attention.emitResearchMissionAttention({ ...first, status: "completed", lastError: undefined });
  stored = (await loadInbox()).items.find((entry) => entry.id === item.id)!;
  assert.equal(stored.status, "done", "resolved work must not leave an actionable notification behind");
  assert.equal((await loadInbox()).items.filter((entry) => entry.auto === item.auto).length, 1);
});

test("concurrent actionable completions insert exactly one durable item per run", async () => {
  const run = await flow("concurrent-failure");
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    attention.emitFlowSessionAttention({ sessionId: run.sessionId!, isError: true })));
  assert.equal(results.filter(Boolean).length, 1);
  const { items } = await loadInbox();
  const matches = items.filter((item) => item.auto === `flow-attention:run:${run.id}`);
  assert.equal(matches.length, 1);
  await dismissItem(matches[0].id);
  assert.equal(await attention.emitFlowSessionAttention({ sessionId: run.sessionId!, isError: true }), null);
});

test("only structured, non-code attention markers request intervention", async () => {
  const run = await flow("explicit-approval");
  for (const text of [
    "Please approve this work",
    '`<coven:attention reason="approval" />`',
    '<coven:attention reason="approval" extra="no" />',
  ]) {
    assert.equal(await attention.emitFlowSessionAttention({ sessionId: run.sessionId!, text }), null);
  }
  const item = await attention.emitFlowSessionAttention({
    sessionId: run.sessionId!,
    text: '<coven:attention reason="approval" />',
  });
  assert.ok(item);
  assert.match(item.body!, /approval/i);
});

test("Research iteration failures wait for authoritative mission state, which dedups across iterations", async () => {
  const first = await flow("research-first", "research-parent");
  const second = await flow("research-second", "research-parent");
  for (const run of [first, second]) {
    assert.equal(await attention.emitFlowSessionAttention({ sessionId: run.sessionId!, isError: true }), null);
  }
  const results = await Promise.all([
    attention.emitResearchMissionAttention(mission("research-parent", { status: "failed", lastError: "Run failed" })),
    attention.emitResearchMissionAttention(mission("research-parent", { status: "failed", lastError: "Run failed again" })),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean)!.auto, "flow-attention:mission:research-parent");
});

test("Research stays quiet during automatic checkpoints, normal success and deliberate pauses", async () => {
  for (const status of ["running", "queued", "planning", "completed", "cancelled", "archived", "paused"] as const) {
    assert.equal(await attention.emitResearchMissionAttention(mission(`quiet-${status}`, { status })), null);
  }
  assert.equal(await attention.emitResearchMissionAttention(mission("auto-checkpoint", {
    status: "checkpoint",
    automation: { id: "schedule", rrule: "FREQ=DAILY", status: "ACTIVE", checkpointFingerprint: "one" },
  })), null);
});

test("Research notifies once when human review, cost approval or error repair is required", async () => {
  for (const patch of [
    { status: "checkpoint" as const },
    { status: "paused" as const, lastError: "Cost unavailable; review before another iteration" },
    { status: "completed" as const, lastError: "Publication failed" },
    { status: "checkpoint" as const, lastError: "Source ledger needs repair" },
  ]) {
    const id = `action-${patch.status}-${patch.lastError ?? "review"}`;
    const item = await attention.emitResearchMissionAttention(mission(id, patch));
    assert.ok(item);
    assert.equal(item.auto, `flow-attention:mission:${id}`);
    assert.equal(item.sessionId, null);
    assert.match(item.body!, /review|retry|approve/i);
    assert.equal(await attention.emitResearchMissionAttention(mission(id, patch)), null);
  }
});

test("explicit Research approval and mission failure share the owning mission key", async () => {
  await flow("research-approval", "research-approval-parent");
  const item = await attention.emitFlowSessionAttention({
    sessionId: "research-approval",
    text: '<coven:attention reason="approval" />',
  });
  assert.ok(item);
  assert.equal(item.auto, "flow-attention:mission:research-approval-parent");
  assert.equal(await attention.emitResearchMissionAttention(mission("research-approval-parent", { status: "failed" })), null);
});

test("quiet same-iteration saves cannot acknowledge an explicit request or rearm its dismissal", async () => {
  const run = await flow("same-iteration-request", "quiet-request-parent");
  const marker = { sessionId: run.sessionId!, text: '<coven:attention reason="input" />' };
  const item = await attention.emitFlowSessionAttention(marker);
  assert.ok(item);
  const iterations = [{ number: 2, status: "completed" as const, flowRunId: run.id }];
  for (const status of ["running", "checkpoint", "completed"] as const) {
    await attention.emitResearchMissionAttention(mission("quiet-request-parent", {
      status, iterations,
      automation: { id: "schedule", rrule: "FREQ=DAILY", status: "ACTIVE", checkpointFingerprint: "same" },
    }));
    assert.equal((await loadInbox()).items.find((entry) => entry.id === item.id)?.status, "fired");
  }
  await dismissItem(item.id);
  await attention.emitResearchMissionAttention(mission("quiet-request-parent", { status: "completed", iterations }));
  assert.equal(await attention.emitFlowSessionAttention(marker), null);
  assert.equal((await loadInbox()).items.find((entry) => entry.id === item.id)?.status, "dismissed");
  await attention.emitResearchMissionAttention(mission("quiet-request-parent", {
    status: "running", iterations: [...iterations, { number: 3, status: "running" }],
  }));
  assert.equal((await loadInbox()).items.find((entry) => entry.id === item.id)?.status, "done");
  assert.equal(await attention.emitFlowSessionAttention(marker), null, "late old delivery cannot rearm a handled request");
});

test("production Research persistence emits the checkpoint's parent notification", async () => {
  const { createResearchMissionWorkspace } = await import("./research-mission-store.ts");
  const { makeProductionResearchMissionRunner } = await import("./research-mission-runner.ts");
  await createResearchMissionWorkspace(mission("production-research", { status: "paused" }));
  const updated = await makeProductionResearchMissionRunner().act("production-research", { action: "resume" });
  assert.equal(updated.status, "checkpoint");
  const { items } = await loadInbox();
  assert.equal(items.filter((item) => item.auto === "flow-attention:mission:production-research").length, 1);
});

test("the production direct Copilot finalizer emits one parent error without Chat completion", async () => {
  const { startCopilotFlowRun } = await import("./flow-copilot-session.ts");
  const { copilotStreamSpec } = await import("../copilot-stream.ts");
  const { CovenProcessSupervisorUnavailableError } = await import("./coven-process-supervisor.ts");
  const fixture = path.join(home, "failed-copilot.cjs");
  writeFileSync(fixture, 'process.exit(1);\n');
  const spec = copilotStreamSpec();
  assert.ok(spec);
  const started = await startCopilotFlowRun({
    spec,
    prompt: "Test failure ownership",
    projectRoot: home,
    familiarId: "sage",
    spawnCommand: { command: process.execPath, fixedArgs: [fixture] },
  }, {
    resolveSupervisorCommand: async () => { throw new CovenProcessSupervisorUnavailableError(); },
  });
  const run = await flow(started.sessionId);
  started.confirmBookkeeping();
  await started.done;
  const { items } = await loadInbox();
  assert.equal(items.filter((item) => item.auto === `flow-attention:run:${run.id}`).length, 1);
  assert.equal(items.some((item) => item.auto === "session-finished" && item.sessionId === started.sessionId), false);
  const settled = (await listFlowRuns()).find((candidate) => candidate.id === run.id);
  assert.equal(settled?.status, "failed");
  assert.ok(settled.finishedAt);
  assert.equal(settled.summary, undefined, "transcript output must not leak into run history");
});

test("the direct finalizer keeps success quiet and routes structured approval to its parent", async () => {
  const { startCopilotFlowRun } = await import("./flow-copilot-session.ts");
  const { copilotStreamSpec } = await import("../copilot-stream.ts");
  const { CovenProcessSupervisorUnavailableError } = await import("./coven-process-supervisor.ts");
  const spec = copilotStreamSpec();
  assert.ok(spec);
  for (const [label, content, expected] of [
    ["success", "Research is complete", 0],
    ["approval", '<coven:attention reason="approval" />', 1],
  ] as const) {
    const fixture = path.join(home, `copilot-${label}.cjs`);
    const frame = JSON.stringify({
      type: "assistant.message",
      data: { messageId: "answer", content, toolRequests: [] },
    });
    writeFileSync(fixture, `console.log(${JSON.stringify(frame)});\n`);
    const started = await startCopilotFlowRun({
      spec,
      prompt: `Test ${label} ownership`,
      projectRoot: home,
      familiarId: "sage",
      spawnCommand: { command: process.execPath, fixedArgs: [fixture] },
    }, {
      resolveSupervisorCommand: async () => { throw new CovenProcessSupervisorUnavailableError(); },
    });
    const run = await flow(started.sessionId);
    started.confirmBookkeeping();
    await started.done;
    const { items } = await loadInbox();
    assert.equal(items.filter((item) => item.auto === `flow-attention:run:${run.id}`).length, expected);
    const settled = (await listFlowRuns()).find((candidate) => candidate.id === run.id);
    assert.equal(settled?.status, "succeeded");
    assert.ok(settled.finishedAt);
    assert.equal(settled.summary, undefined);
  }
});

test("Research iteration completion settles history without an iteration notification", async () => {
  for (const isError of [false, true]) {
    const run = await flow(`settle-research-${isError}`, "settle-research-parent");
    const finishedAt = "2026-09-05T13:00:00.000Z";
    assert.equal(await attention.finalizeFlowSession({
      sessionId: run.sessionId!,
      isError,
      text: "Private research output must remain in the transcript",
      finishedAt,
    }), null);
    const settled = (await listFlowRuns()).find((candidate) => candidate.id === run.id);
    assert.equal(settled?.status, isError ? "failed" : "succeeded");
    assert.equal(settled.finishedAt, finishedAt);
    assert.equal(settled.summary, undefined);
  }
});

test("user cancellation with a zero exit settles failed history without notifying", async () => {
  const { cancelCopilotFlowRun, startCopilotFlowRun } = await import("./flow-copilot-session.ts");
  const { copilotStreamSpec } = await import("../copilot-stream.ts");
  const { CovenProcessSupervisorUnavailableError } = await import("./coven-process-supervisor.ts");
  const spec = copilotStreamSpec();
  assert.ok(spec);
  const fixture = path.join(home, "cancel-copilot.cjs");
  const ready = path.join(home, "cancel-ready");
  writeFileSync(fixture, [
    'process.on("SIGTERM", () => process.exit(0));',
    `require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready");`,
    "setInterval(() => {}, 100);",
  ].join("\n"));
  const started = await startCopilotFlowRun({
    spec,
    prompt: "Test deliberate cancellation",
    projectRoot: home,
    familiarId: "sage",
    spawnCommand: { command: process.execPath, fixedArgs: [fixture] },
  }, {
    resolveSupervisorCommand: async () => { throw new CovenProcessSupervisorUnavailableError(); },
  });
  const run = await flow(started.sessionId);
  started.confirmBookkeeping();
  try {
    const deadline = Date.now() + 5_000;
    while (!existsSync(ready) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(existsSync(ready), "the fixture installed its zero-exit termination handler");
    await cancelCopilotFlowRun(started.sessionId);
    await started.done;
    const settled = (await listFlowRuns()).find((candidate) => candidate.id === run.id);
    assert.equal(settled?.status, "failed", "cancelled work must never appear succeeded");
    assert.ok(settled.finishedAt);
    const { items } = await loadInbox();
    assert.equal(items.some((item) => item.auto === `flow-attention:run:${run.id}`), false);
  } finally {
    await cancelCopilotFlowRun(started.sessionId);
  }
});

test("notification persistence failure is logged and never rejects the owner operation", async () => {
  const run = await flow("notification-write-failure");
  const { loadState } = await import("../cave-config.ts");
  const inbox = path.join(home, "cave", "inbox.json");
  const backup = path.join(home, "cave", "inbox.backup.json");
  const hadInbox = existsSync(inbox);
  if (hadInbox) renameSync(inbox, backup);
  mkdirSync(inbox);
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    assert.equal(await attention.emitFlowSessionAttention({ sessionId: "notification-write-failure", isError: true }), null);
    assert.equal(await attention.finalizeFlowSession({
      sessionId: run.sessionId!, isError: true, finishedAt: new Date().toISOString(),
    }), null);
    assert.equal((await loadState()).sessionFlowCompleted?.[run.sessionId!], false,
      "failed publication must leave daemon outcome reconciliation eligible to retry");
    assert.ok(warnings.some((args) => String(args[0]).includes("[flow-attention]")));
  } finally {
    console.warn = original;
    rmSync(inbox, { recursive: true });
    if (hadInbox) renameSync(backup, inbox);
  }
  // Reconciliation needs hydrated output in addition to the terminal row;
  // unavailable output is deliberately not acknowledged as an empty result.
  await saveConversation({
    sessionId: run.sessionId!, familiarId: "", harness: "claude",
    updatedAt: new Date().toISOString(),
    turns: [{ id: "failed-output", role: "assistant", text: "Execution failed.",
      isError: true, createdAt: new Date().toISOString() }],
  });
  const { reconcileFlowSessionOutcomes } = await import("./flow-session-reconcile.ts");
  await reconcileFlowSessionOutcomes([{
    id: run.sessionId!, status: "failed", exit_code: 1, updated_at: new Date().toISOString(),
  }]);
  assert.equal((await loadState()).sessionFlowCompleted?.[run.sessionId!], true);
  assert.equal((await loadInbox()).items.filter((item) => item.auto === `flow-attention:run:${run.id}`).length, 1);
});

test("failed history writes retain reconciliation eligibility even after notification succeeds", async () => {
  const run = await flow("history-write-failure");
  const { loadState } = await import("../cave-config.ts");
  const history = path.join(home, ".coven", "flow-runs.json");
  const backup = path.join(home, ".coven", "flow-runs.backup.json");
  renameSync(history, backup);
  mkdirSync(history);
  const original = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    await attention.finalizeFlowSession({
      sessionId: run.sessionId!, isError: true, finishedAt: new Date().toISOString(),
    });
    assert.ok(warnings.length > 0);
  } finally {
    console.warn = original;
    rmSync(history, { recursive: true });
    renameSync(backup, history);
  }
  assert.equal((await loadState()).sessionFlowCompleted?.[run.sessionId!], false);
  assert.equal((await listFlowRuns()).find((item) => item.id === run.id)?.status, "running");
  // Reconciliation needs hydrated output in addition to the terminal row;
  // unavailable output is deliberately not acknowledged as an empty result.
  await saveConversation({
    sessionId: run.sessionId!, familiarId: "", harness: "claude",
    updatedAt: new Date().toISOString(),
    turns: [{ id: "failed-output", role: "assistant", text: "Execution failed.",
      isError: true, createdAt: new Date().toISOString() }],
  });
  const { reconcileFlowSessionOutcomes } = await import("./flow-session-reconcile.ts");
  await reconcileFlowSessionOutcomes([{
    id: run.sessionId!, status: "failed", exit_code: 1, updated_at: new Date().toISOString(),
  }]);
  assert.equal((await listFlowRuns()).find((item) => item.id === run.id)?.status, "failed");
  assert.equal((await loadState()).sessionFlowCompleted?.[run.sessionId!], true);
  assert.equal((await loadInbox()).items.filter((item) => item.auto === `flow-attention:run:${run.id}`).length, 1);
});


test("successful ordinary run resolves a previous structured request", async () => {
  const run = await flow("ordinary-request");
  await attention.emitFlowRunAttention({ ...run, text: '<coven:attention reason="approval" />' });
  await attention.emitFlowRunAttention({ ...run, status: "succeeded" });
  assert.equal((await loadInbox()).items.find((item) => item.auto === `flow-attention:run:${run.id}`)?.status, "done");
});

test("mission requests resolve the durable familiar or fail closed", async () => {
  const { saveResearchMission } = await import("./research-mission-store.ts");
  mkdirSync(path.join(home, "research-missions", "durable-owner"), { recursive: true });
  await saveResearchMission(mission("durable-owner"));
  const run = { id: "owner-run", flowId: "owner-flow", status: "running" as const,
    text: '<coven:attention reason="input" />' };
  const item = await attention.emitFlowRunAttention({ ...run, missionId: "durable-owner" });
  assert.ok(item);
  assert.equal(new URL(item.link!.ref, "http://localhost").searchParams.get("flowFamiliar"), "sage");
  assert.equal(await attention.emitFlowRunAttention({ ...run, missionId: "missing-owner" }), null);
});
