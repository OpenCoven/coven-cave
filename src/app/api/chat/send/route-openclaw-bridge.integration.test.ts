// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the real OpenClaw route against a deterministic CLI shim. This
// proves the Gateway-first/local-recovery boundary without a Gateway, a
// provider, or credentials.
const home = await mkdtemp(path.join(homedir(), "cave-openclaw-route-"));
const bin = path.join(home, "bin");
const workspace = path.join(home, "workspace");
const log = path.join(home, "openclaw-calls.jsonl");
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });

const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  OPENCLAW_BIN: process.env.OPENCLAW_BIN,
  OPENCLAW_TEST_MODE: process.env.OPENCLAW_TEST_MODE,
  OPENCLAW_TEST_LOG: process.env.OPENCLAW_TEST_LOG,
  OPENCLAW_EMBEDDED_LOCAL: process.env.OPENCLAW_EMBEDDED_LOCAL,
  OPENCLAW_GATEWAY_DISPATCH: process.env.OPENCLAW_GATEWAY_DISPATCH,
};
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.OPENCLAW_TEST_LOG = log;
delete process.env.OPENCLAW_GATEWAY_DISPATCH;
delete process.env.OPENCLAW_EMBEDDED_LOCAL;
await writeFile(
  path.join(home, "familiars.toml"),
  ['[[familiar]]', 'id = "wren"', 'openclaw_agent = "main"'].join("\n"),
  "utf8",
);

const shimScript = path.join(bin, "openclaw.js");
const shim = [
  "const { appendFileSync } = require('node:fs');",
  "const args = process.argv.slice(2);",
  "const record = (row) => appendFileSync(process.env.OPENCLAW_TEST_LOG, JSON.stringify(row) + '\\n');",
  "if (args.join(' ') === 'agents list --json') { process.stdout.write(JSON.stringify([{ id: 'main', isDefault: true }])); process.exit(0); }",
  "if (args[0] !== 'agent') process.exit(1);",
  "const local = args.includes('--local');",
  "record({ args, local, mode: process.env.OPENCLAW_TEST_MODE });",
  "const mode = process.env.OPENCLAW_TEST_MODE;",
  "if (mode === 'gateway-legacy') {",
  "  if (local) { process.stderr.write('unexpected embedded run'); process.exit(1); }",
  "  process.stdout.write(JSON.stringify({ result: { payloads: [{ text: 'legacy Gateway reply' }], sessionId: 'gateway-session' } })); process.exit(0);",
  "}",
  "if (mode === 'gateway-credentials-then-local') {",
  "  if (!local) { process.stderr.write('GatewayCredentialsRequiredError: gateway agent requires credentials before opening a websocket'); process.exit(1); }",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: 'embedded recovery reply' }], meta: { agentMeta: { sessionId: 'embedded-session' } } })); process.exit(0);",
  "}",
  "if (mode === 'explicit-local') {",
  "  if (!local) { process.stderr.write('expected embedded run'); process.exit(1); }",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: 'explicit local reply' }] })); process.exit(0);",
  "}",
  "if (mode === 'malformed') { process.stdout.write(JSON.stringify({ payloads: {} })); process.exit(0); }",
  "process.stderr.write('unknown fixture mode'); process.exit(1);",
].join("\n");
await writeFile(shimScript, shim, { mode: 0o755 });
if (process.platform === "win32") {
  const shimBatch = path.join(bin, "openclaw.cmd");
  await writeFile(shimBatch, '"%~dp0\\openclaw.js" %*\r\n');
  process.env.OPENCLAW_BIN = shimBatch;
} else {
  const shimExecutable = path.join(bin, "openclaw");
  await writeFile(shimExecutable, `#!/usr/bin/env node\n${shim}`, { mode: 0o755 });
  process.env.OPENCLAW_BIN = shimExecutable;
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return events;
}

async function calls() {
  try {
    return (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function clearCalls() {
  await writeFile(log, "", "utf8");
}

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  // OpenClaw owns model selection and cannot accept a Cave model override;
  // keep this bridge fixture on the explicit runtime-default sentinel.
  await saveConfig({ familiars: { wren: { harness: "openclaw", model: "" } } });
  const project = await createProject({ name: "OpenClaw route fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "wren", projectId: project.id, source: "human", access: "write" });
  const send = (prompt) => POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "wren", prompt, projectRoot: workspace }),
  }));

  process.env.OPENCLAW_TEST_MODE = "gateway-legacy";
  await clearCalls();
  const gatewayEvents = await readSse(await send("preserve configured Gateway"));
  assert.deepEqual(gatewayEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text), ["legacy Gateway reply"], JSON.stringify(gatewayEvents));
  assert.equal(gatewayEvents.find((event) => event.kind === "error"), undefined);
  assert.equal(gatewayEvents.findLast((event) => event.kind === "done")?.isError, false);
  const gatewayCalls = await calls();
  assert.equal(gatewayCalls.length, 1, "a working CLI Gateway turn must not fall through to embedded mode");
  assert.equal(gatewayCalls[0].local, false, "the default CLI invocation preserves paired Gateway routing");

  process.env.OPENCLAW_TEST_MODE = "gateway-credentials-then-local";
  await clearCalls();
  const recoveryEvents = await readSse(await send("recover local-only installation"));
  assert.deepEqual(recoveryEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text), ["embedded recovery reply"]);
  assert.equal(recoveryEvents.find((event) => event.kind === "error"), undefined);
  assert.equal(recoveryEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.ok(recoveryEvents.some((event) => event.id === "openclaw-local-retry" && event.status === "done"));
  const recoveryCalls = await calls();
  assert.deepEqual(recoveryCalls.map((call) => call.local), [false, true], "only a positive Gateway credential failure retries locally");

  process.env.OPENCLAW_TEST_MODE = "explicit-local";
  process.env.OPENCLAW_EMBEDDED_LOCAL = "true";
  await clearCalls();
  const explicitEvents = await readSse(await send("explicit embedded mode"));
  assert.deepEqual(explicitEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text), ["explicit local reply"]);
  assert.equal(explicitEvents.findLast((event) => event.kind === "done")?.isError, false);
  assert.deepEqual((await calls()).map((call) => call.local), [true], "an explicit local selection uses one embedded child");

  process.env.OPENCLAW_TEST_MODE = "malformed";
  await clearCalls();
  const malformedEvents = await readSse(await send("malformed current envelope"));
  assert.equal(malformedEvents.find((event) => event.kind === "assistant_chunk")?.text, "The OpenClaw bridge emitted an invalid response.");
  assert.ok(malformedEvents.some((event) => event.id === "openclaw-protocol" && event.status === "error"));
  assert.equal(malformedEvents.findLast((event) => event.kind === "done")?.isError, true, "malformed payloads complete as a safe failed turn");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}

console.log("route-openclaw-bridge.integration.test.ts: ok");
