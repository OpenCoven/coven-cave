import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AgentEventSchema, HelloOkSchema } from "@openclaw/gateway-protocol";
import { Value } from "typebox/value";

import {
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  openClawDiscoveryFromHello,
} from "./openclaw-compatibility.ts";

const gatewayBeta4 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta4.json", import.meta.url), "utf8"),
);
const gatewayBeta5 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/gateway-beta5.json", import.meta.url), "utf8"),
);
const toolLifecycleV1 = JSON.parse(
  readFileSync(new URL("./openclaw-fixtures/tool-lifecycle-v1.json", import.meta.url), "utf8"),
);

assert.equal(
  OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
  "ed68832d5ecbc52de7ad5394933cb2a0df7b0f0b6f7a880127f688becbd76bd2",
);

const beta4Discovery = openClawDiscoveryFromHello(gatewayBeta4);
const beta5Discovery = openClawDiscoveryFromHello(gatewayBeta5);

assert.deepStrictEqual(beta4Discovery, {
  serverVersion: "2026.7.2-beta.4",
  protocol: 4,
  methods: ["chat.send", "chat.abort"],
  events: ["chat"],
  serverCapabilities: ["chat-send-routing-contract"],
  agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
});

assert.deepStrictEqual(beta5Discovery, {
  serverVersion: "2026.7.2-beta.5",
  protocol: 4,
  methods: ["chat.send", "chat.abort", "sessions.messages.subscribe"],
  events: ["chat", "agent", "session.tool"],
  serverCapabilities: ["chat-send-routing-contract"],
  agentEventSchemaHash: OPENCLAW_AGENT_EVENT_SCHEMA_HASH,
});

assert.ok(Value.Check(HelloOkSchema, gatewayBeta4));
assert.ok(Value.Check(HelloOkSchema, gatewayBeta5));

assert.deepStrictEqual(
  toolLifecycleV1.frames.map((frame: { event: string }) => frame.event),
  ["agent", "agent", "agent", "session.tool"],
);

for (const frame of toolLifecycleV1.frames) {
  assert.ok(Value.Check(AgentEventSchema, frame.payload), frame.event);
}
