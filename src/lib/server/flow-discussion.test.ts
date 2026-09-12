import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationFile } from "../cave-conversations.ts";
import { createFlowDiscussion, type FlowDiscussionDeps } from "./flow-discussion.ts";

function setup(overrides: Partial<FlowDiscussionDeps> = {}) {
  const saved: ConversationFile[] = [];
  const registered: string[] = [];
  const deps: FlowDiscussionDeps = {
    loadSource: async () => ({
      familiarId: "cody", harness: "copilot", title: "Research",
      reference: { flowId: "flow", runId: "run", missionId: "mission", iteration: 2 },
      transcript: "The recorded result.",
    }),
    saveConversation: async (conv) => { saved.push(conv); },
    registerConversation: async (conv) => { registered.push(conv.sessionId); },
    mintSessionId: () => "new-discussion",
    ...overrides,
  };
  return { deps, saved, registered };
}

test("explicit discussion creates a linked Chat without execution resume authority", async () => {
  const { deps, saved, registered } = setup();
  const result = await createFlowDiscussion(deps, "execution");
  assert.equal(result?.sessionId, "new-discussion");
  assert.equal(saved[0].origin, "chat");
  assert.equal(saved[0].parentSessionId, "execution");
  assert.deepEqual(saved[0].flowDiscussion, {
    sessionId: "execution", flowId: "flow", runId: "run", missionId: "mission", iteration: 2,
  });
  assert.equal(saved[0].runtime, undefined);
  assert.equal(saved[0].harnessSessionId, undefined);
  assert.equal(saved[0].runtimeAccessFingerprint, undefined);
  assert.equal(saved[0].activeLeafId, saved[0].turns[0].id);
  assert.match(saved[0].turns[0].text, /The recorded result/);
  assert.match(saved[0].turns[0].text, /execution/);
  assert.deepEqual(registered, ["new-discussion"]);
});

test("unowned source cannot be promoted by its title", async () => {
  const { deps, saved } = setup({ loadSource: async () => null });
  assert.equal(await createFlowDiscussion(deps, "ordinary-chat"), null);
  assert.equal(saved.length, 0);
});

test("empty and lengthy execution results retain honest bounded context", async () => {
  const { deps, saved } = setup({
    loadSource: async () => ({
      familiarId: "cody", harness: "copilot", title: "Flow", transcript: "",
      reference: { flowId: "flow", runId: "run" },
    }),
  });
  await createFlowDiscussion(deps, "execution");
  assert.match(saved[0].turns[0].text, /No execution output is available yet/);
  deps.loadSource = async () => ({
    familiarId: "cody", harness: "copilot", title: "Flow",
    transcript: "a".repeat(40_000), reference: { flowId: "flow", runId: "run" },
  });
  await createFlowDiscussion(deps, "execution");
  assert.ok(saved[1].turns[0].text.length < 18_000);
  assert.match(saved[1].turns[0].text, /excerpt/);
});

test("storage failures propagate rather than reporting a created discussion", async () => {
  const { deps, registered } = setup({
    saveConversation: async () => { throw new Error("disk full"); },
  });
  await assert.rejects(createFlowDiscussion(deps, "execution"), /disk full/);
  assert.deepEqual(registered, []);
});
