import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.join(process.cwd(), `.flow-discussion-${process.pid}`);
await mkdir(root, { recursive: true });
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
const { POST } = await import("./route.ts");
const { PUT } = await import("../../chat/conversation/[id]/route.ts");
const { saveConfig, loadState } = await import("../../../../lib/cave-config.ts");
const { saveConversation, loadConversation, listConversations } = await import("../../../../lib/cave-conversations.ts");
const { recordFlowRun, clearFlowRuns } = await import("../../../../lib/server/flow-store.ts");
const { localConversationSessionRows } = await import("../../../../lib/session-list-merge.ts");
const { visibleChatSessions } = await import("../../../../lib/chat-list-model.ts");

function request(body: unknown) {
  return new Request("http://localhost/api/flows/discussion", {
    method: "POST", headers: { "content-type": "application/json", host: "localhost" }, body: JSON.stringify(body),
  });
}

test("discussion persists as Chat, keeps exact lineage after history clearing and transcript writes", async () => {
  try {
    await saveConfig({ familiars: { cody: { harness: "copilot" } } });
    await saveConversation({
      sessionId: "execution", familiarId: "cody", harness: "copilot",
      harnessSessionId: "native-run", runtime: "local:/execution-only",
      title: "Flow: research", origin: "flow", updatedAt: new Date().toISOString(),
      turns: [{ id: "result", role: "assistant", text: "Recorded finding", createdAt: new Date().toISOString() }],
    });
    const run = await recordFlowRun({
      flowId: "flow", sessionId: "execution", source: "cave", status: "succeeded",
      missionId: "mission", iteration: 1, steps: [], startedAt: new Date().toISOString(),
    });
    await clearFlowRuns();
    const before = await loadConversation("execution");
    const deniedHeaders: Record<string, string>[] = [
      { host: "remote.ts.net" }, { host: "localhost", "x-coven-cave-mobile-access": "1" },
    ];
    for (const headers of deniedHeaders) {
      const rejected = await POST(new Request("http://localhost/api/flows/discussion", {
        method: "POST", headers, body: JSON.stringify({ sessionId: "execution" }),
      }));
      assert.equal(rejected.status, 403);
      assert.equal((await listConversations()).length, 1, "rejection must precede durable writes");
    }
    const response = await POST(request({ sessionId: "execution" }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.session.origin, "chat");
    assert.equal(result.familiarId, "cody");
    assert.notEqual(result.sessionId, "execution");
    const discussion = await loadConversation(result.sessionId);
    assert.equal(discussion?.flowDiscussion?.runId, run.id);
    assert.equal(discussion?.parentSessionId, "execution");
    assert.equal(discussion?.harnessSessionId, undefined);
    assert.equal(discussion?.runtime, undefined);
    assert.deepEqual(await loadConversation("execution"), before, "opening a discussion never mutates its source");
    const rows = localConversationSessionRows(await listConversations(), await loadState(), false);
    assert.deepEqual(visibleChatSessions(rows, null).map((row) => row.id), [result.sessionId]);
    const rewritten = await PUT(new Request("http://localhost/api/chat/conversation", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ turns: discussion?.turns }),
    }), { params: Promise.resolve({ id: result.sessionId }) });
    assert.equal(rewritten.status, 200);
    assert.deepEqual((await loadConversation(result.sessionId))?.flowDiscussion, discussion?.flowDiscussion);
    assert.equal((await loadConversation(result.sessionId))?.parentSessionId, "execution");
    assert.equal((await POST(request({ sessionId: result.sessionId }))).status, 404,
      "a discussion cannot itself be treated as a Flow execution");
    for (const body of [null, [], { sessionId: "../escape" }, { sessionId: 1 }]) {
      assert.equal((await POST(request(body))).status, 400);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
