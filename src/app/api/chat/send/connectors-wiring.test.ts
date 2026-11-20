// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Pins how chat send wires per-chat connectors (src/lib/connectors.ts).
const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /connectors\?: string\[\];/, "SendBody accepts connector ids");
assert.match(
  route,
  /import \{ hasGitHubTokenInEnv, parseConnectorIds, prepareTurnConnectors \} from "@\/lib\/connectors";/,
);
assert.match(route, /import \{ hasGhStoredLogin \} from "@\/lib\/server\/gh-login-status";/);
assert.match(
  route,
  /const connectorEnv = !sshRuntime && localRuntimePlan \? localRuntimePlan\.env : null;/,
  "only a local launch env can carry connector credentials",
);
assert.match(
  route,
  /const githubStoredLogin =\s*connectorEnv !== null &&\s*requestedConnectors\.includes\("github"\) &&\s*!hasGitHubTokenInEnv\(connectorEnv\)\s*\?\s*await hasGhStoredLogin\(connectorEnv\)\s*:\s*false;/,
  "the stored gh login is probed only for a local GitHub request with no token, against the harness env",
);
assert.match(
  route,
  /const turnConnectors = prepareTurnConnectors\(requestedConnectors, connectorEnv, \{\s*githubStoredLogin,\s*\}\);/,
);
assert.doesNotMatch(route, /gh auth token/, "the send route never reads the keyring token");
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
