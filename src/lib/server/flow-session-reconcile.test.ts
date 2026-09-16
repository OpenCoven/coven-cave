import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.join(process.cwd(), `.flow-reconcile-${process.pid}`);
await mkdir(root, { recursive: true });
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
const { reconcileFlowSessionOutcomes } = await import("./flow-session-reconcile.ts");
const { recordFlowRun, listFlowRuns, clearFlowRuns, FLOW_RUNS_CAP } = await import("./flow-store.ts");
const { loadState } = await import("../cave-config.ts");
const { saveConversation } = await import("../cave-conversations.ts");
const { loadInbox } = await import("../cave-inbox.ts");

test("daemon outcome polling settles exact runs without cancellation or repeated notification spam", async () => {
  try {
    const ids: string[] = [];
    for (const id of ["failed", "cancelled", "completed", "running"]) {
      const run = await recordFlowRun({
        flowId: "flow", sessionId: id, source: "cave", status: "running", steps: [],
        startedAt: new Date().toISOString(),
      });
      ids.push(run.id);
      await saveConversation({
        sessionId: id, familiarId: "cody", harness: "claude", updatedAt: new Date().toISOString(),
        turns: [{ id: "result", role: "assistant", text: "Recorded output.", createdAt: new Date().toISOString() }],
      });
    }
    const rows = ["failed", "cancelled", "completed", "running"].map((status) => ({
      id: status, status, exit_code: status === "failed" ? 1 : 0,
      updated_at: new Date().toISOString(), familiarId: "cody",
    }));
    await reconcileFlowSessionOutcomes(rows);
    await reconcileFlowSessionOutcomes(rows);
    const runs = await listFlowRuns();
    assert.equal(runs.find((run) => run.id === ids[0])?.status, "failed");
    assert.equal(runs.find((run) => run.id === ids[1])?.status, "failed");
    assert.equal(runs.find((run) => run.id === ids[2])?.status, "succeeded");
    assert.equal(runs.find((run) => run.id === ids[3])?.status, "running");
    const { items } = await loadInbox();
    assert.deepEqual(items.map((item) => item.auto), [`flow-attention:run:${ids[0]}`]);

    for (const status of ["stopped", "exited", "dead"]) {
      const run = await recordFlowRun({
        flowId: "terminal", sessionId: status, source: "cave", status: "running",
        steps: [], startedAt: new Date().toISOString(),
      });
      await saveConversation({ sessionId: status, familiarId: "", harness: "claude", updatedAt: new Date().toISOString(),
        turns: [{ id: "output", role: "assistant", text: "Failed execution", createdAt: new Date().toISOString() }] });
      await reconcileFlowSessionOutcomes([{
        id: status, status, exit_code: 1, updated_at: new Date().toISOString(),
      }]);
      assert.equal((await listFlowRuns()).find((item) => item.id === run.id)?.status, "failed");
      assert.equal((await loadState()).sessionFlowCompleted?.[status], true);
    }

    for (const retention of ["clear", "cap"]) {
      const id = `retained-${retention}`;
      const run = await recordFlowRun({
        flowId: "retained", sessionId: id, source: "cave", status: "running",
        steps: [], startedAt: new Date().toISOString(),
      });
      if (retention === "clear") await clearFlowRuns();
      else for (let i = 0; i < FLOW_RUNS_CAP; i += 1) await recordFlowRun({
        flowId: "preview", source: "cave", status: "preview", steps: [],
        startedAt: new Date().toISOString(),
      });
      assert.equal((await listFlowRuns()).some((item) => item.id === run.id), false);
      assert.equal((await loadState()).sessionFlowCompleted?.[id], false);
      await saveConversation({ sessionId: id, familiarId: "", harness: "claude", updatedAt: new Date().toISOString(),
        turns: [{ id: "output", role: "assistant", text: "Failed execution", createdAt: new Date().toISOString() }] });
      const row = { id, status: "failed", exit_code: 1, updated_at: new Date().toISOString() };
      await reconcileFlowSessionOutcomes([row]);
      await reconcileFlowSessionOutcomes([row]);
      assert.equal((await loadInbox()).items.filter((item) => item.auto === `flow-attention:run:${run.id}`).length, 1,
        "a retained owner still receives its terminal failure after history disappears");
      assert.equal((await loadState()).sessionFlowCompleted?.[id], true);
    }
    const blockedRows = [];
    for (let i = 0; i < 5; i += 1) {
      const id = `fair-retry-${i}`;
      await recordFlowRun({ flowId: "fair", sessionId: id, source: "cave", status: "running",
        steps: [], startedAt: new Date().toISOString() });
      blockedRows.push({ id, status: "completed", exit_code: 0, updated_at: new Date().toISOString() });
    }
    await saveConversation({ sessionId: "fair-retry-4", familiarId: "", harness: "claude",
      updatedAt: new Date().toISOString(), turns: [{ id: "approval", role: "assistant",
        text: '<coven:attention reason="approval" />', createdAt: new Date().toISOString() }] });
    await reconcileFlowSessionOutcomes(blockedRows);
    assert.equal((await loadState()).sessionFlowCompleted?.["fair-retry-4"], false,
      "the first poll is bounded to four hydration attempts");
    await reconcileFlowSessionOutcomes(blockedRows);
    assert.equal((await loadState()).sessionFlowCompleted?.["fair-retry-4"], true,
      "unavailable transcripts must not starve later actionable completions");
    assert.equal((await loadState()).sessionFlowCompleted?.["fair-retry-0"], false);
    const fairRun = (await listFlowRuns()).find((run) => run.sessionId === "fair-retry-4");
    assert.equal((await loadInbox()).items.filter((item) => item.auto === `flow-attention:run:${fairRun?.id}`).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
