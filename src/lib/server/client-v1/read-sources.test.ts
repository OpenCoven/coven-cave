import assert from "node:assert/strict";
import test from "node:test";

import type { ConversationSummary } from "../../cave-conversations.ts";
import { listClientV1Conversations } from "./read-sources.ts";
import {
  clientV1ConversationPageKey,
  projectClientV1Conversation,
  sortClientV1Conversations,
} from "./reads.ts";

const summary = (sessionId: string, title = "Flow: release"): ConversationSummary => ({
  sessionId,
  familiarId: "nova",
  title,
  origin: "chat",
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T11:00:00.000Z",
});

test("canonical inventory annotates exact Flow ownership without removing rows or changing page keys", async () => {
  const raw = [summary("execution"), summary("discussion"), summary("lookalike")];
  const flow = { flowId: "release", runId: "run-1", missionId: "mission-1", iteration: 2 };
  const reads: boolean[] = [];
  const rows = await listClientV1Conversations({
    listConversations: async () => raw,
    loadFlowSessionState: async (persist) => {
      reads.push(persist);
      return { sessionFlow: { execution: flow } };
    },
  });

  assert.deepEqual(reads, [false], "canonical reads must never persist legacy links");
  assert.equal(rows.length, raw.length, "Flow executions remain canonical resources");
  assert.deepEqual(rows.map(clientV1ConversationPageKey), raw.map(clientV1ConversationPageKey));
  assert.deepEqual(
    sortClientV1Conversations(rows).map((row) => row.sessionId),
    sortClientV1Conversations(raw).map((row) => row.sessionId),
  );
  const execution = projectClientV1Conversation(rows[0]);
  assert.equal(execution.origin, "flow");
  assert.deepEqual(execution.flow, flow);
  assert.equal(projectClientV1Conversation(rows[1]).origin, "chat");
  assert.equal(projectClientV1Conversation(rows[2]).origin, "chat");
  assert.equal("flow" in projectClientV1Conversation(rows[1]), false);
  assert.equal(raw[0].origin, "chat", "the cached transcript summary is not mutated");
});

test("canonical provenance does not infer Flow ownership from a title or identifier prefix", async () => {
  const rows = await listClientV1Conversations({
    listConversations: async () => [
      summary("flow-release"),
      summary("toString"),
      summary("constructor"),
      summary("__proto__"),
    ],
    loadFlowSessionState: async () => ({ sessionFlow: {} }),
  });
  for (const row of rows) {
    assert.equal(row.origin, "chat");
    assert.equal("flow" in projectClientV1Conversation(row), false);
  }
});
