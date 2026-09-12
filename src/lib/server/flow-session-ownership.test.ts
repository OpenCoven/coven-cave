import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), `.flow-ownership-${process.pid}`);
await mkdir(root, { recursive: true });
process.env.COVEN_HOME = root;
process.env.COVEN_FLOW_RUNS_PATH = path.join(root, "flow-runs.json");

try {
  const store = await import("./flow-store.ts");
  const { recordFlowRun, clearFlowRuns } = store;
  const { loadState } = await import("../cave-config.ts");
  const { localConversationSessionRows, mergeSessionRows } = await import("../session-list-merge.ts");
  const { visibleChatSessions } = await import("../chat-list-model.ts");
  const { saveConversation, loadConversation, listConversations } = await import("../cave-conversations.ts");
  const run = await recordFlowRun({
    flowId: "flow-one", flowName: "Daily research", sessionId: "execution-one",
    status: "running", source: "cave", steps: [], startedAt: "2026-09-05T12:00:00.000Z",
  });
  let state = await loadState();
  assert.deepEqual(state.sessionFlow?.["execution-one"], {
    flowId: "flow-one", runId: run.id,
  }, "recording an execution persists exact ownership outside capped history");
  await saveConversation({
    sessionId: "execution-one", familiarId: "cody", harness: "copilot",
    updatedAt: "2026-09-05T12:00:00.000Z",
    turns: [{ id: "answer", role: "assistant", text: "Retained result.", createdAt: "2020-01-01T00:00:00.000Z" }],
  });
  const conversations = await listConversations();
  const rows = localConversationSessionRows(conversations, state, false);
  assert.equal(rows[0].origin, "flow");
  assert.equal(rows[0].attention.state, "none", "an unanswered execution is not a hanging chat");
  assert.equal(visibleChatSessions(rows, null).length, 0);
  assert.equal(visibleChatSessions(rows, null, { showArchived: true }).length, 0);
  const merged = mergeSessionRows({
    daemonSessions: [{
      id: "execution-one", project_root: root, harness: "copilot", title: "Renamed execution",
      status: "completed", exit_code: 0, archived_at: null,
      created_at: run.startedAt, updated_at: run.startedAt,
    }],
    localConversations: conversations, state, includeArchived: false,
  });
  assert.equal(merged[0].origin, "flow", "daemon merge must preserve execution provenance");
  assert.equal(visibleChatSessions(merged, null).length, 0);
  await clearFlowRuns();
  state = await loadState();
  assert.equal(state.sessionFlow?.["execution-one"]?.runId, run.id, "clearing history cannot resurrect a Chat row");
  assert.equal((await loadConversation("execution-one"))?.turns[0].text, "Retained result.");
  assert.equal(visibleChatSessions(localConversationSessionRows(conversations, state, false), null).length, 0);

  const human = { ...conversations[0], sessionId: "human-one", title: "Flow: a human discussion" };
  assert.equal(visibleChatSessions(localConversationSessionRows([human], state, false), null).length, 1,
    "titles are never ownership evidence");
  const statePath = path.join(root, "cave", "state.json");
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.sessionFlow["execution-one"].runId, run.id);

  const queued = await recordFlowRun({
    flowId: "queued-flow", status: "queued", source: "cave", steps: [],
    startedAt: run.startedAt, missionId: "queued-mission", iteration: 4,
  });
  await store.updateFlowRun(queued.id, { sessionId: "queued-session", status: "running" });
  assert.deepEqual((await loadState()).sessionFlow?.["queued-session"], {
    flowId: "queued-flow", runId: queued.id, missionId: "queued-mission", iteration: 4,
  }, "offline replay registers the eventual session under the original run");

  const legacy = { ...run, id: "old-run", sessionId: "old-session", missionId: "research-one", iteration: 3 };
  await writeFile(process.env.COVEN_FLOW_RUNS_PATH, JSON.stringify({ version: 1, runs: [legacy] }));
  assert.equal(typeof store.loadFlowSessionState, "function", "legacy ownership must be projected without requiring a new run");
  const projected = await store.loadFlowSessionState(false);
  assert.equal(projected.sessionFlow?.["old-session"]?.missionId, "research-one");
  assert.equal((await loadState()).sessionFlow?.["old-session"], undefined, "read-only dashboards cannot migrate state");
  const migrated = await store.loadFlowSessionState(true);
  assert.equal(migrated.sessionFlow?.["old-session"]?.iteration, 3);
  await clearFlowRuns();
  assert.equal((await store.loadFlowSessionState(false)).sessionFlow?.["old-session"]?.runId, "old-run");

  const ambiguousRun = await recordFlowRun({ ...legacy, sessionId: "ambiguous" });
  await writeFile(process.env.COVEN_FLOW_RUNS_PATH, JSON.stringify({ version: 1, runs: [
    ambiguousRun, { ...ambiguousRun, id: "conflicting-owner", flowId: "other-flow" },
  ] }));
  assert.equal((await store.loadFlowSessionState(false)).sessionFlow?.ambiguous, undefined,
    "legacy ambiguity overrides an earlier durable owner during read-only projection");
  await store.updateFlowRun(ambiguousRun.id, { status: "succeeded" });
  assert.equal((await loadState()).sessionFlow?.ambiguous, undefined,
    "updating one conflicting run must not retain an owner from that run alone");
  await clearFlowRuns("other-flow");
  assert.equal((await store.loadFlowSessionState(false)).sessionFlow?.ambiguous, undefined,
    "partial clearing cannot resurrect the surviving ambiguous owner");
  await clearFlowRuns();
  assert.equal((await loadState()).sessionFlow?.ambiguous, undefined);
  await writeFile(process.env.COVEN_FLOW_RUNS_PATH, JSON.stringify({ version: 1, runs: [
    { ...legacy, id: "ambiguous-one", sessionId: "ambiguous" },
    { ...legacy, id: "ambiguous-two", sessionId: "ambiguous" },
    ...Array.from({ length: store.FLOW_RUNS_CAP }, (_, index) => ({
      ...run, id: `retained-${index}`, sessionId: `session-${index}`,
    })),
  ] }));
  await recordFlowRun({ flowId: "new-flow", status: "running", source: "cave", steps: [], startedAt: run.startedAt });
  assert.equal((await loadState()).sessionFlow?.ambiguous, undefined, "ambiguous links must not hide any chat");
  assert.equal((await loadState()).sessionFlow?.[`session-${store.FLOW_RUNS_CAP - 1}`]?.runId,
    `retained-${store.FLOW_RUNS_CAP - 1}`, "ownership survives eviction by the history cap");
  delete process.env.COVEN_FLOW_RUNS_PATH;
  assert.equal((await store.listFlowRuns()).length, store.FLOW_RUNS_CAP,
    "default Flow history must respect the same Coven instance root as session state");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("flow-session-ownership.test.ts OK");
