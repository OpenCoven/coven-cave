// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildConnectorsDirective,
  parseConnectorIds,
  prepareTurnConnectors,
} from "./connectors.ts";

// parseConnectorIds: allowlist only, trimmed, case-folded, de-duplicated.
assert.deepEqual(
  parseConnectorIds([" GitHub ", "asana", "github", "slack", 7, null]),
  ["github", "asana"],
);
assert.deepEqual(parseConnectorIds("github"), [], "a non-array is ignored");
assert.deepEqual(parseConnectorIds(undefined), []);

// GitHub: the Vault PAT arrives as GITHUB_PAT; gh reads GH_TOKEN.
{
  const env = { GITHUB_PAT: "ghp_test_value" };
  assert.deepEqual(prepareTurnConnectors(["github"], env), [{ id: "github", available: true }]);
  assert.equal(env.GH_TOKEN, "ghp_test_value", "bridges the granted PAT to gh");
}
{
  const env = { GH_TOKEN: "existing", GITHUB_PAT: "other" };
  prepareTurnConnectors(["github"], env);
  assert.equal(env.GH_TOKEN, "existing", "never overrides an explicit GH_TOKEN");
}

{
  const env = { GH_TOKEN: "   ", GITHUB_PAT: "ghp_real" };
  prepareTurnConnectors(["github"], env);
  assert.equal(env.GH_TOKEN, "ghp_real", "a blank GH_TOKEN is replaced");
}
{
  const env = { GITHUB_PAT: "  ghp_x  " };
  prepareTurnConnectors(["github"], env);
  assert.equal(env.GH_TOKEN, "ghp_x", "a padded token is trimmed");
}
{
  const env = { GITHUB_TOKEN: "tok" };
  assert.deepEqual(prepareTurnConnectors(["github"], env), [{ id: "github", available: true }]);
  assert.equal(env.GH_TOKEN, "tok");
}
{
  const env = {};
  prepareTurnConnectors(["github", "asana"], env);
  assert.deepEqual(env, {}, "an unavailable connector leaves the env untouched");
}

// Asana: a launcher ASANA_ACCESS_TOKEN is exposed under the one name the prompt uses.
{
  const env = { ASANA_ACCESS_TOKEN: "asana_test_value" };
  assert.deepEqual(prepareTurnConnectors(["asana"], env), [{ id: "asana", available: true }]);
  assert.equal(env.ASANA_PAT, "asana_test_value");
}

// Missing credentials and non-local runtimes are reported, never faked.
assert.deepEqual(prepareTurnConnectors(["github", "asana"], {}), [
  { id: "github", available: false },
  { id: "asana", available: false },
]);
assert.deepEqual(prepareTurnConnectors(["github"], null), [{ id: "github", available: false }]);

// Nothing requested: the env is untouched.
{
  const env = { GITHUB_PAT: "x" };
  assert.deepEqual(prepareTurnConnectors([], env), []);
  assert.equal(env.GH_TOKEN, undefined);
}

// Prompt block.
assert.equal(buildConnectorsDirective([]), "", "no block when no connector is on");
const block = buildConnectorsDirective([
  { id: "github", available: true },
  { id: "asana", available: false },
]);
assert.match(block, /^<connectors>\n/);
assert.match(block, /GitHub — on\. The gh CLI is signed in for this turn through GH_TOKEN\./);
assert.match(block, /Asana — requested, but no Asana credential reached you on this turn\./);
assert.match(block, /Never ask the user to paste a token\./);
assert.match(block, /Never print, echo, or write a token value anywhere/);
assert.match(block, /<\/connectors>$/);
assert.doesNotMatch(block, /ghp_|asana_test/, "the block never contains a credential");

console.log("connectors.test.ts: ok");
