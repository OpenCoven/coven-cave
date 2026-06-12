// @ts-nocheck
import assert from "node:assert/strict";
import {
  initiatorFromOpenClawMessages,
  initiatorFromSessionKey,
  labelFromAgentId,
} from "./session-initiator.ts";

assert.equal(labelFromAgentId("kitty"), "Kitty");
assert.equal(labelFromAgentId("coven-code"), "Coven Code");

assert.deepEqual(
  initiatorFromOpenClawMessages(
    [
      {
        role: "user",
        senderName: "Valentina (❖,❖)",
        senderUsername: "BunsDev",
        sourceChannel: "telegram",
      },
    ],
    "kitty",
    "agent:kitty:telegram:direct:823292124",
  ),
  {
    kind: "human",
    label: "Valentina",
    channel: "telegram",
    username: "BunsDev",
  },
  "channel user metadata should win over the familiar whose transcript stored the session",
);

assert.deepEqual(
  initiatorFromOpenClawMessages(
    [{ role: "user", content: "Remember this codeword: avocado." }],
    "kitty",
    "agent:kitty:cave-test-persist-1",
  ),
  {
    kind: "familiar",
    label: "Kitty",
    agentId: "kitty",
  },
  "agent-keyed Cave persistence smoke sessions should show the familiar as initiator",
);

assert.deepEqual(
  initiatorFromSessionKey("agent:sage:cron:daily-brief", "sage"),
  {
    kind: "system",
    label: "cron",
    channel: "cron",
  },
  "cron session keys should be system-originated instead of familiar-originated",
);

assert.deepEqual(
  initiatorFromSessionKey("", "cody"),
  {
    kind: "familiar",
    label: "Cody",
    agentId: "cody",
  },
  "missing session keys should still fall back to the agent folder id",
);

console.log("session-initiator.test.ts: ok");
