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
const previousCovenTestMode = process.env.COVEN_TEST_MODE;
const previousCovenCancelReady = process.env.COVEN_TEST_CANCEL_READY;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_TEST_LOG = log;

const shimScript = path.join(bin, "coven.js");
const shim = [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.COVEN_TEST_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "if (process.argv[2] === 'adapter' && process.argv[3] === 'list' && process.argv[4] === '--json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'codex', executable: 'codex', available: ['post-start', 'silent-exit', 'assistant-envelope', 'assistant-envelope-exit-1', 'cancel'].includes(process.env.COVEN_TEST_MODE) }]));",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === 'codex') {",
  "  if (process.env.COVEN_TEST_MODE === 'silent-exit') process.exit(1);",
  "  if (process.env.COVEN_TEST_MODE === 'cancel') {",
  "    appendFileSync(process.env.COVEN_TEST_CANCEL_READY, 'started');",
  "    setInterval(() => {}, 1000);",
  "    return;",
  "  }",
  "  if (process.env.COVEN_TEST_MODE === 'assistant-envelope' || process.env.COVEN_TEST_MODE === 'assistant-envelope-exit-1') {",
  "    const cleanupExit = process.env.COVEN_TEST_MODE === 'assistant-envelope-exit-1';",
  "    const events = [",
  "      { type: 'system', subtype: 'init', model: 'gpt-5.6-sol', session_id: cleanupExit ? 'coven-envelope-cleanup-session' : 'coven-envelope-session' },",
  "      { type: 'assistant', message: { content: [{ type: 'text', text: cleanupExit ? 'Coven envelope survives cleanup exit' : 'Coven envelope response' }] }, session_id: cleanupExit ? 'coven-envelope-cleanup-session' : 'coven-envelope-session' },",
  "      { type: 'result', subtype: 'success', is_error: false, session_id: cleanupExit ? 'coven-envelope-cleanup-session' : 'coven-envelope-session' },",
  "    ];",
  "    process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
  "    process.exit(cleanupExit ? 1 : 0);",
  "  }",
  "  process.stdout.write('unsupported harness `codex`');",
  "  process.exit(1);",
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

async function waitForText(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(file, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  assert.fail(`timed out waiting for fixture marker ${file}`);
}

try {
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { requestChatStop } = await import("@/lib/server/chat-stop-registry");
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

  // A successful probe cannot promise that Coven will keep its adapter
  // available forever. When the started process emits adapter evidence, the
  // route maps that evidence to the same actionable Codex state instead of
  // calling it an authentication or empty-output failure.
  process.env.COVEN_TEST_MODE = "post-start";
  const postStartResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "hello after probe", projectRoot: familiarWorkspace }),
  }));
  const { body: postStartBody, events: postStartEvents } = await readSse(postStartResponse);
  const postStartError = postStartEvents.find((event) => event.kind === "error");
  assert.ok(postStartError, "a started Coven adapter failure produces a structured error event");
  assert.equal(postStartError.code, "runtime_unlaunchable");
  assert.match(postStartError.message, /Codex adapter is unavailable or misconfigured in Coven/);
  assert.doesNotMatch(postStartBody, /installed but not authenticated|produced no output/i);
  assert.ok(!postStartEvents.some((event) => event.kind === "assistant_chunk"));

  const callsAfterStart = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.ok(
    callsAfterStart.some((args) => args[0] === "run" && args[1] === "codex" && args.includes("--stream-json")),
    "the post-start fixture exercises a real Coven run after the availability probe passed",
  );

  // Coven's current Codex adapter emits its completed reply as a normal
  // stream-json assistant envelope.  The route must emit that text directly;
  // it is already structured assistant data and must not enter Codex's raw
  // transcript filter, which expects an interactive marker line first.
  process.env.COVEN_TEST_MODE = "assistant-envelope";
  const envelopeResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "decode Coven envelope", projectRoot: familiarWorkspace }),
  }));
  const { events: envelopeEvents } = await readSse(envelopeResponse);
  const envelopeChunks = envelopeEvents.filter((event) => event.kind === "assistant_chunk");
  assert.deepEqual(
    envelopeChunks.map((event) => event.text),
    ["Coven envelope response"],
    "a successful Coven Codex assistant envelope reaches the chat stream",
  );
  assert.equal(envelopeEvents.find((event) => event.kind === "error"), undefined);
  assert.equal(envelopeEvents.findLast((event) => event.kind === "done")?.isError, false);

  // Coven is only the outer launch vehicle. A post-response cleanup failure
  // cannot rewrite a completed assistant/result pair into a failed turn.
  process.env.COVEN_TEST_MODE = "assistant-envelope-exit-1";
  const cleanupExitResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "preserve completed envelope", projectRoot: familiarWorkspace }),
  }));
  const { events: cleanupExitEvents } = await readSse(cleanupExitResponse);
  assert.deepEqual(
    cleanupExitEvents.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["Coven envelope survives cleanup exit"],
    "the complete assistant response survives a later non-zero Coven exit",
  );
  assert.equal(cleanupExitEvents.find((event) => event.kind === "error"), undefined);
  assert.equal(cleanupExitEvents.findLast((event) => event.kind === "done")?.isError, false);
  const cleanupExitConversation = await loadConversation("coven-envelope-cleanup-session");
  assert.equal(cleanupExitConversation?.turns.at(-1)?.text, "Coven envelope survives cleanup exit");
  assert.equal(cleanupExitConversation?.turns.at(-1)?.isError, false, "the persisted turn remains successful");

  // A process can start successfully and still exit before Coven emits any
  // JSONL. That is neither an adapter-discovery failure nor evidence that
  // Codex is signed out. It must remain a structured runtime-process error
  // instead of fabricating the completed-but-empty authentication hint.
  process.env.COVEN_TEST_MODE = "silent-exit";
  const silentExitResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "silent child", projectRoot: familiarWorkspace }),
  }));
  const { body: silentExitBody, events: silentExitEvents } = await readSse(silentExitResponse);
  const silentExitError = silentExitEvents.find((event) => event.kind === "error");
  assert.ok(silentExitError, "a silent non-zero Codex exit produces a structured error event");
  assert.equal(silentExitError.code, "runtime_process_failed");
  assert.match(silentExitError.message, /Codex CLI exited with an error/);
  assert.doesNotMatch(silentExitBody, /installed but not authenticated|produced no output/i);
  assert.ok(!silentExitEvents.some((event) => event.kind === "assistant_chunk"));
  const silentDone = silentExitEvents.findLast((event) => event.kind === "done");
  assert.equal(silentDone?.isError, true);

  // Stop is an expected interruption, not evidence that Coven or Codex
  // failed. Its child commonly closes with a null exit code after SIGTERM;
  // the route must preserve the user's cancelled turn without emitting a
  // runtime-process failure or failed progress state.
  const cancelReady = path.join(home, "cancel-ready");
  process.env.COVEN_TEST_MODE = "cancel";
  process.env.COVEN_TEST_CANCEL_READY = cancelReady;
  const cancelledSessionId = "cancelled-codex-session";
  const cancelledRunId = "cancelled-codex-run";
  const cancelResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "stop this silent Codex run",
      projectRoot: familiarWorkspace,
      sessionId: cancelledSessionId,
      runId: cancelledRunId,
    }),
  }));
  await waitForText(cancelReady);
  assert.equal(requestChatStop(cancelledRunId), true, "the explicit Stop registry signal reaches the live run");
  const { events: cancelledEvents } = await readSse(cancelResponse);
  assert.equal(
    cancelledEvents.find((event) => event.kind === "error"),
    undefined,
    "an explicit stop never emits an error event",
  );
  assert.equal(
    cancelledEvents.find((event) => event.kind === "progress" && event.status === "error"),
    undefined,
    `an explicit stop never creates failed progress state: ${JSON.stringify(cancelledEvents)}`,
  );
  assert.equal(cancelledEvents.findLast((event) => event.kind === "done")?.isError, false);
  const cancelledConversation = await loadConversation(cancelledSessionId);
  const cancelledTurn = cancelledConversation?.turns.at(-1);
  assert.equal(cancelledTurn?.role, "assistant");
  assert.equal(cancelledTurn?.text, "(cancelled)");
  assert.equal(cancelledTurn?.cancelled, true);
  assert.equal(cancelledTurn?.isError, false);
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  if (previousCovenTestLog === undefined) delete process.env.COVEN_TEST_LOG;
  else process.env.COVEN_TEST_LOG = previousCovenTestLog;
  if (previousCovenTestMode === undefined) delete process.env.COVEN_TEST_MODE;
  else process.env.COVEN_TEST_MODE = previousCovenTestMode;
  if (previousCovenCancelReady === undefined) delete process.env.COVEN_TEST_CANCEL_READY;
  else process.env.COVEN_TEST_CANCEL_READY = previousCovenCancelReady;
  await rm(home, { recursive: true, force: true });
}

console.log("route-codex-runtime-availability.integration.test.ts: ok");
