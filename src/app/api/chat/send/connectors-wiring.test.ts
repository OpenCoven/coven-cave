// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pins how chat send wires per-chat connectors (src/lib/connectors.ts).
const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /connectors\?: string\[\];/, "SendBody accepts connector ids");
assert.match(
  route,
  /import \{ parseConnectorIds, prepareTurnConnectors \} from "@\/lib\/connectors";/,
);
assert.match(
  route,
  /const turnConnectors = prepareTurnConnectors\(\s*parseConnectorIds\(body\.connectors\),\s*!sshRuntime && localRuntimePlan \? localRuntimePlan\.env : null,\s*\);/,
  "only a local launch env can carry connector credentials",
);
const prepared = route.indexOf("const turnConnectors =");
assert.ok(
  prepared > route.lastIndexOf("localRuntimePlan = createLocalRuntimePlan("),
  "connectors are prepared after the final runtime plan exists",
);
assert.ok(
  prepared < route.indexOf("const scopedPrompt ="),
  "connectors are prepared before the prompt is assembled",
);
assert.match(
  route,
  /\{ modelControls: promptModelControls, connectors: turnConnectors \}/,
  "the prompt receives the turn's real connector availability",
);

console.log("connectors-wiring.test.ts: ok");
