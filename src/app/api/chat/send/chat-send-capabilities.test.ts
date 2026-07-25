// @ts-nocheck
import assert from "node:assert/strict";
import { parseOpenCodeRunCapabilitiesHelp } from "./chat-send-capabilities.ts";

const capabilities = parseOpenCodeRunCapabilitiesHelp(`
  --structured-output <format>  Output format: text, json-v3
  --event-stream                Emit structured lifecycle events
  --no-color                    Disable terminal color
  --permission <mode>           Set tool permission policy
`, "3.0.0");

assert.deepEqual(
  capabilities.noValueOptions,
  ["--event-stream", "--no-color"],
  "only declared flags without a value placeholder can satisfy a signed no-value launch requirement",
);
assert.equal(capabilities.structuredOutputs?.[0]?.option, "--structured-output");
assert.deepEqual(capabilities.structuredOutputs?.[0]?.values, ["json-v3"]);

console.log("chat-send-capabilities.test.ts: ok");
