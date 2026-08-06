// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
const previousCodexBin = process.env.CODEX_BIN;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_TEST_LOG = log;

// Every scenario in this file exercises the GENERIC `coven run codex`
// transport through the shim above. On a machine with a real Codex CLI on
// the discovered spawn PATH, direct codex routing can engage instead —
// bypassing the adapter gate entirely and spawning the real CLI on the test
// prompt (cave-evrsr: order/timing-dependent, since the capability probes
// race their timeout). Pin CODEX_BIN to an existing but unlaunchable fixture
// (mode-0644 file on POSIX, unconvertible .cmd on Windows — the same shape
// as cave-g3qar's fix in the sibling route-runtime-availability test) so the
// passive availability gate keeps the direct path off deterministically. A
// nonexistent override would not do: codexBin() falls back to PATH search.
const pinnedCodex = path.join(
  bin,
  process.platform === "win32" ? "codex-no-exec.cmd" : "codex-no-exec",
);
await writeFile(
  pinnedCodex,
  process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
  { mode: 0o644 },
);
process.env.CODEX_BIN = pinnedCodex;

const shimScript = path.join(bin, "coven.js");
const shim = [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.COVEN_TEST_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "if (process.argv[2] === 'adapter' && process.argv[3] === 'list' && process.argv[4] === '--json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'codex', executable: 'codex', available: ['post-start', 'silent-exit', 'silent-stderr', 'assistant-envelope', 'assistant-envelope-exit-1', 'assistant-envelope-reasoning', 'cancel', 'cancel-partial-attention'].includes(process.env.COVEN_TEST_MODE) }]));",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === '--help') {",
  "  process.stdout.write('  --model <model>  Forward a provider model id\\n');",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === 'codex') {",
  "  if (process.env.COVEN_TEST_MODE === 'silent-exit') process.exit(1);",
  "  if (process.env.COVEN_TEST_MODE === 'silent-stderr') { console.error('model gpt-5.6-sol is unsupported at /private/fixture/secret ghp_1234567890abcdefghijklmnopqrstuv'); process.exit(1); }",
  "  if (process.env.COVEN_TEST_MODE === 'cancel') {",
  "    appendFileSync(process.env.COVEN_TEST_CANCEL_READY, 'started');",
  "    setInterval(() => {}, 1000);",
  "    return;",
  "  }",
  "  if (process.env.COVEN_TEST_MODE === 'cancel-partial-attention') {",
  "    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'gpt-5.6-sol', session_id: 'cancelled-partial-attention-session' }) + '\\n');",
  "    process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Visible answer.\\n<coven:attent' }] }, session_id: 'cancelled-partial-attention-session' }) + '\\n');",
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
  "  if (process.env.COVEN_TEST_MODE === 'assistant-envelope-reasoning') {",
  "    const events = [",
  "      { type: 'system', subtype: 'init', model: 'gpt-5.6-sol', session_id: 'coven-envelope-reasoning-session' },",
  "      { type: 'assistant', message: { content: [{ type: 'text', text: '<reasoning>private notes <coven:attention reason=\"decision\" /></reasoning>\\nVisible answer.\\n<coven:attention reason=\"approval\" />' }] }, session_id: 'coven-envelope-reasoning-session' },",
  "      { type: 'result', subtype: 'success', is_error: false, session_id: 'coven-envelope-reasoning-session' },",
  "    ];",
  "    process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
  "    process.exit(0);",
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

async function clearFile(file) {
  await unlink(file).catch(() => undefined);
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
  process.env.COVEN_TEST_MODE = "assistant-envelope-reasoning";
  {
    const { events } = await readSse(await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        familiarId: "opal",
        prompt: "preserve reasoning on reload",
        projectRoot: familiarWorkspace,
        sessionId: "coven-envelope-reasoning-session",
        runId: "coven-envelope-reasoning-run",
      }),
    })));
    assert.equal(events.findLast((event) => event.kind === "done")?.isError, false);
    const reasoningConversation = await loadConversation("coven-envelope-reasoning-session");
    const reasoningTurn = reasoningConversation?.turns.at(-1);
    assert.equal(reasoningTurn?.text.trim(), "Visible answer.");
    assert.equal(reasoningTurn?.reasoning, "private notes", "reasoning survives reload without control markers");
    assert.equal(
      reasoningTurn?.responseMetadata?.attentionRequest?.reason,
      "approval",
      "only the visible attention marker should create a human attention request",
    );
    assert.doesNotMatch(reasoningTurn?.text ?? "", /<(?:thinking|reasoning)>|<coven:attention/);
    assert.doesNotMatch(reasoningTurn?.reasoning ?? "", /<(?:thinking|reasoning)>|<coven:attention/);
  }

  process.env.COVEN_TEST_MODE = "silent-exit";
  const silentExitSessionId = "silent-codex-session";
  const silentExitResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "silent child",
      modelOverride: "openai/gpt-5.6-sol",
      modelOverrideScope: "next-message",
      projectRoot: familiarWorkspace,
      sessionId: silentExitSessionId,
    }),
  }));
  const { body: silentExitBody, events: silentExitEvents } = await readSse(silentExitResponse);
  const silentExitError = silentExitEvents.find((event) => event.kind === "error");
  assert.ok(silentExitError, "a silent non-zero Codex exit produces a structured error event");
  assert.equal(silentExitError.code, "runtime_process_failed");
  assert.match(silentExitError.message, /Codex CLI exited with an error \(exit code 1\)/);
  assert.match(silentExitError.message, /did not emit an error message/);
  assert.doesNotMatch(silentExitBody, /installed but not authenticated|produced no output/i);
  assert.ok(!silentExitEvents.some((event) => event.kind === "assistant_chunk"));
  assert.deepEqual(
    silentExitEvents.find((event) => event.kind === "progress" && event.id === "runtime-process"),
    {
      kind: "progress",
      id: "runtime-process",
      label: "codex process failure",
      status: "error",
      detail: "Exit code 1; the runtime did not emit an error message.",
    },
    "silent exits retain a safe, concrete diagnostic without guessing at authentication",
  );
  const silentDone = silentExitEvents.findLast((event) => event.kind === "done");
  assert.equal(silentDone?.isError, true);
  assert.equal(silentDone?.responseMetadata?.confirmedModel, undefined);
  assert.equal(silentDone?.responseMetadata?.modelApplicationState, "pending");
  const silentConversation = await loadConversation(silentExitSessionId);
  const silentTurn = silentConversation?.turns.at(-1);
  assert.equal(silentTurn?.isError, true, "an existing conversation retains the failed run");
  assert.match(silentTurn?.text ?? "", /exit code 1/);
  assert.deepEqual(silentTurn?.progress?.find((step) => step.id === "runtime-process"), {
    id: "runtime-process",
    label: "codex process failure",
    status: "error",
    detail: "Exit code 1; the runtime did not emit an error message.",
    createdAt: silentTurn?.progress?.find((step) => step.id === "runtime-process")?.createdAt,
  });

  // Stderr may name a rejected model or contain local credentials and paths.
  // Cave persists only the fixed diagnostic shape rather than copying the
  // provider payload into chat, and treats the forwarded model as unverified.
  process.env.COVEN_TEST_MODE = "silent-stderr";
  const stderrExitResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "silent stderr",
      modelOverride: "openai/gpt-5.6-sol",
      modelOverrideScope: "next-message",
      projectRoot: familiarWorkspace,
    }),
  }));
  const { body: stderrExitBody, events: stderrExitEvents } = await readSse(stderrExitResponse);
  const stderrExitError = stderrExitEvents.find((event) => event.kind === "error");
  assert.match(stderrExitError?.message ?? "", /exit code 1/);
  assert.match(stderrExitError?.message ?? "", /diagnostic output, which Cave withheld/);
  assert.doesNotMatch(stderrExitBody, /ghp_|\/private\/fixture|unsupported at/i);
  assert.equal(stderrExitEvents.findLast((event) => event.kind === "done")?.responseMetadata?.confirmedModel, undefined);
  assert.equal(stderrExitEvents.findLast((event) => event.kind === "done")?.responseMetadata?.modelApplicationState, "pending");

  // Stop is an expected interruption, not evidence that Coven or Codex
  // failed. Its child commonly closes with a null exit code after SIGTERM;
  // the route must preserve the user's cancelled turn without emitting a
  // runtime-process failure or failed progress state.
  const cancelReady = path.join(home, "cancel-ready");
  process.env.COVEN_TEST_MODE = "cancel";
  process.env.COVEN_TEST_CANCEL_READY = cancelReady;
  await clearFile(cancelReady);
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
  assert.deepEqual(
    requestChatStop(cancelledRunId),
    { state: "accepted", terminalOutcome: null },
    "the explicit Stop registry signal reaches the live run",
  );
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
  const cancelledDone = cancelledEvents.findLast((event) => event.kind === "done");
  assert.equal(cancelledDone?.isError, false);
  assert.equal(cancelledDone?.cancelled, true);
  const cancelledConversation = await loadConversation(cancelledSessionId);
  const cancelledTurn = cancelledConversation?.turns.at(-1);
  assert.equal(cancelledTurn?.role, "assistant");
  assert.equal(cancelledTurn?.text, "(cancelled)");
  assert.equal(cancelledTurn?.cancelled, true);
  assert.equal(cancelledTurn?.isError, false);

  // A cancelled streamed reply keeps the visible text that already reached the
  // user, but must hide any incomplete `<coven:attention` tail before it is
  // persisted and reloaded.
  process.env.COVEN_TEST_MODE = "cancel-partial-attention";
  await clearFile(cancelReady);
  const cancelledPartialRunId = "cancelled-partial-attention-run";
  const cancelPartialResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "stop after partial attention prefix",
      projectRoot: familiarWorkspace,
      sessionId: "cancelled-partial-attention-session",
      runId: cancelledPartialRunId,
    }),
  }));
  await waitForText(cancelReady);
  assert.deepEqual(requestChatStop(cancelledPartialRunId), { state: "accepted", terminalOutcome: null });
  const { events: cancelledPartialEvents } = await readSse(cancelPartialResponse);
  const cancelledPartialDone = cancelledPartialEvents.findLast((event) => event.kind === "done");
  assert.equal(cancelledPartialDone?.isError, false);
  assert.equal(cancelledPartialDone?.cancelled, true);
  const cancelledPartialConversation = await loadConversation("cancelled-partial-attention-session");
  const cancelledPartialTurn = cancelledPartialConversation?.turns.at(-1);
  assert.equal(cancelledPartialTurn?.text, "Visible answer.\n");
  assert.equal(cancelledPartialTurn?.cancelled, true);
  assert.equal(cancelledPartialTurn?.isError, false);
  assert.doesNotMatch(cancelledPartialTurn?.text ?? "", /<coven:attention/);
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
  if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
  else process.env.CODEX_BIN = previousCodexBin;
  await rm(home, { recursive: true, force: true });
}

console.log("route-codex-runtime-availability.integration.test.ts: ok");
