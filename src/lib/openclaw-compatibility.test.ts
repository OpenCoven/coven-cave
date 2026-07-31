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

assert.equal(beta4Discovery.serverVersion, "2026.7.2-beta.4");
assert.equal(beta5Discovery.serverVersion, "2026.7.2-beta.5");

assert.ok(Value.Check(HelloOkSchema, gatewayBeta4));
assert.ok(Value.Check(HelloOkSchema, gatewayBeta5));

for (const frame of toolLifecycleV1.frames) {
  assert.ok(Value.Check(AgentEventSchema, frame.payload), frame.event);
}
