// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the Codex gate through the real route. The temporary Coven shim
// reports an unavailable Codex adapter and records every invocation, proving
// that a failed adapter probe cannot fall through to `coven run codex`.
const home = await mkdtemp(path.join(homedir(), "cave-codex-availability-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
const log = path.join(home, "coven-calls.jsonl");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousCovenBin = process.env.COVEN_BIN;
const previousCovenTestLog = process.env.COVEN_TEST_LOG;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_TEST_LOG = log;

const shimScript = path.join(bin, "coven.js");
const shim = [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.COVEN_TEST_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "if (process.argv[2] === 'adapter' && process.argv[3] === 'list' && process.argv[4] === '--json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'codex', executable: 'codex', available: false }]));",
  "  process.exit(0);",
  "}",
  "process.exit(0);",
].join("\n");
await writeFile(shimScript, shim, { mode: 0o755 });

if (process.platform === "win32") {
  const shimBatch = path.join(bin, "coven.cmd");
  // covenLaunchCommand() resolves npm-style batch shims to `node <target>`.
  await writeFile(shimBatch, '"%~dp0\\coven.js" %*\r\n');
  process.env.COVEN_BIN = shimBatch;
} else {
  const shimExecutable = path.join(bin, "coven");
  await writeFile(shimExecutable, `#!/usr/bin/env node\n${shim}`, { mode: 0o755 });
  process.env.COVEN_BIN = shimExecutable;
}

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, events };
}

try {
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "codex" } } });
  const project = await createProject({ name: "Codex availability fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "hello", projectRoot: familiarWorkspace }),
  }));
  const { body, events } = await readSse(response);
  const error = events.find((event) => event.kind === "error");
  assert.ok(error, "the unavailable adapter produces a structured error event");
  assert.equal(error.code, "runtime_missing");
  assert.match(error.message, /Codex CLI is unavailable to Coven/);
  assert.doesNotMatch(body, /installed but not authenticated|produced no output/i);
  assert.ok(!events.some((event) => event.kind === "assistant_chunk"));

  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(calls.some((args) => args.join(" ") === "adapter list --json"));
  assert.ok(
    !calls.some((args) => args[0] === "run" && args[1] === "codex" && args.includes("--stream-json")),
    "an unavailable Codex adapter must never start a model process",
  );

  const done = events.findLast((event) => event.kind === "done");
  assert.ok(done, "the no-spawn path still completes the stream");
  assert.equal(done.isError, true);
  if (done.sessionId) {
    const conversation = await loadConversation(done.sessionId);
    assert.equal((conversation?.turns ?? []).filter((turn) => turn.role === "assistant").length, 0);
  }
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  if (previousCovenTestLog === undefined) delete process.env.COVEN_TEST_LOG;
  else process.env.COVEN_TEST_LOG = previousCovenTestLog;
  await rm(home, { recursive: true, force: true });
}

console.log("route-codex-runtime-availability.integration.test.ts: ok");
