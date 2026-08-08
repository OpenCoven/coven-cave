// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Exercise the real OpenClaw route against a deterministic CLI shim. This
// proves the Gateway-first/local-recovery boundary without a Gateway, a
// provider, or credentials.
const home = await mkdtemp(path.join(homedir(), "cave-openclaw-route-"));
const bin = path.join(home, "bin");
const workspace = path.join(home, "workspace");
const log = path.join(home, "openclaw-calls.jsonl");
const cancelReady = path.join(home, "openclaw-cancel-ready");
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });

const previous = {
  COVEN_HOME: process.env.COVEN_HOME,
  COVEN_CAVE_HOME: process.env.COVEN_CAVE_HOME,
  OPENCLAW_BIN: process.env.OPENCLAW_BIN,
  OPENCLAW_TEST_MODE: process.env.OPENCLAW_TEST_MODE,
  OPENCLAW_TEST_LOG: process.env.OPENCLAW_TEST_LOG,
  OPENCLAW_TEST_CANCEL_READY: process.env.OPENCLAW_TEST_CANCEL_READY,
  OPENCLAW_EMBEDDED_LOCAL: process.env.OPENCLAW_EMBEDDED_LOCAL,
  OPENCLAW_GATEWAY_DISPATCH: process.env.OPENCLAW_GATEWAY_DISPATCH,
};
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.OPENCLAW_TEST_LOG = log;
process.env.OPENCLAW_TEST_CANCEL_READY = cancelReady;
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
  "if (mode === 'attention-reasoning') {",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: 'Visible answer.\\n<thinking>private <coven:attention reason=\"approval\" /></thinking>' }] })); process.exit(0);",
  "}",
  "if (mode === 'attention-both') {",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: 'Visible answer.\\n<coven:attention reason=\"approval\" />\\n<thinking>private plan</thinking>' }] })); process.exit(0);",
  "}",
  "if (mode === 'attention-visible') {",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: '<reasoning>private notes</reasoning>\\nVisible question.\\n<coven:attention reason=\"decision\" />' }] })); process.exit(0);",
  "}",
  "if (mode === 'truncated') { process.stdout.write('{\"payloads\":[{\"text\":\"truncated'); process.exit(1); }",
  "if (mode === 'cancel-empty') {",
  "  record({ cancelReady: true, mode });",
  "  appendFileSync(process.env.OPENCLAW_TEST_CANCEL_READY, 'started');",
  "  setInterval(() => {}, 1000);",
  "  return;",
  "}",
  "if (mode === 'cancel-truncated') {",
  "  process.stdout.write('{\"payloads\":[{\"text\":\"partial');",
  "  record({ cancelReady: true, mode, output: 'truncated' });",
  "  appendFileSync(process.env.OPENCLAW_TEST_CANCEL_READY, 'started');",
  "  setInterval(() => {}, 1000);",
  "  return;",
  "}",
  "if (mode === 'cancel-full-output') {",
  "  process.stdout.write(JSON.stringify({ payloads: [{ text: 'late complete output' }], meta: { agentMeta: { sessionId: 'late-session' } } }));",
  "  record({ cancelReady: true, mode, output: 'full' });",
  "  appendFileSync(process.env.OPENCLAW_TEST_CANCEL_READY, 'started');",
  "  setInterval(() => {}, 1000);",
  "  return;",
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

async function clearCancelReady() {
  await unlink(cancelReady).catch(() => undefined);
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
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { requestChatStop } = await import("@/lib/server/chat-stop-registry");
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

  delete process.env.OPENCLAW_EMBEDDED_LOCAL;
  process.env.OPENCLAW_TEST_MODE = "attention-reasoning";
  const reasoningOnlyEvents = await readSse(await send("do not request attention from hidden reasoning"));
  const reasoningOnlySessionId = reasoningOnlyEvents.findLast((event) => event.kind === "done")?.sessionId;
  const reasoningOnlyConversation = await loadConversation(reasoningOnlySessionId);
  const reasoningOnlyTurn = reasoningOnlyConversation?.turns.at(-1);
  assert.equal(reasoningOnlyTurn?.text, "Visible answer.");
  assert.equal(reasoningOnlyTurn?.reasoning, "private", "reload keeps the reasoning content without its control marker");
  assert.equal(
    reasoningOnlyTurn?.responseMetadata?.attentionRequest,
    undefined,
    "a marker inside hidden reasoning is not persisted as an attention request",
  );
  assert.doesNotMatch(reasoningOnlyTurn?.text ?? "", /<(?:thinking|reasoning)>|<coven:attention/);
  assert.doesNotMatch(reasoningOnlyTurn?.reasoning ?? "", /<coven:attention/);

  process.env.OPENCLAW_TEST_MODE = "attention-both";
  const visibleAndReasoningEvents = await readSse(await send("keep reasoning on reload while honoring visible attention"));
  const visibleAndReasoningSessionId = visibleAndReasoningEvents.findLast((event) => event.kind === "done")?.sessionId;
  const visibleAndReasoningConversation = await loadConversation(visibleAndReasoningSessionId);
  const visibleAndReasoningTurn = visibleAndReasoningConversation?.turns.at(-1);
  assert.equal(visibleAndReasoningTurn?.text, "Visible answer.");
  assert.equal(visibleAndReasoningTurn?.reasoning, "private plan");
  assert.equal(visibleAndReasoningTurn?.responseMetadata?.attentionRequest?.reason, "approval");
  assert.doesNotMatch(visibleAndReasoningTurn?.text ?? "", /<(?:thinking|reasoning)>|<coven:attention/);
  assert.doesNotMatch(visibleAndReasoningTurn?.reasoning ?? "", /<(?:thinking|reasoning)>|<coven:attention/);

  process.env.OPENCLAW_TEST_MODE = "attention-visible";
  const visibleMarkerEvents = await readSse(await send("request a visible decision"));
  const visibleMarkerSessionId = visibleMarkerEvents.findLast((event) => event.kind === "done")?.sessionId;
  const visibleMarkerConversation = await loadConversation(visibleMarkerSessionId);
  const visibleMarkerTurn = visibleMarkerConversation?.turns.at(-1);
  assert.equal(visibleMarkerTurn?.text, "Visible question.");
  assert.equal(visibleMarkerTurn?.reasoning, "private notes", "visible-marker turns still persist reloadable reasoning");
  assert.equal(
    visibleMarkerTurn?.responseMetadata?.attentionRequest?.reason,
    "decision",
    "visible-body attention behavior remains intact after reasoning is removed",
  );
  assert.doesNotMatch(visibleMarkerTurn?.text ?? "", /<(?:thinking|reasoning)>|<coven:attention/);
  assert.doesNotMatch(visibleMarkerTurn?.reasoning ?? "", /<(?:thinking|reasoning)>|<coven:attention/);

  process.env.OPENCLAW_TEST_MODE = "malformed";
  await clearCalls();
  const malformedEvents = await readSse(await send("malformed current envelope"));
  assert.equal(malformedEvents.find((event) => event.kind === "assistant_chunk")?.text, "The OpenClaw bridge emitted an invalid response.");
  assert.ok(malformedEvents.some((event) => event.id === "openclaw-protocol" && event.status === "error"));
  assert.equal(malformedEvents.findLast((event) => event.kind === "done")?.isError, true, "malformed payloads complete as a safe failed turn");

  process.env.OPENCLAW_TEST_MODE = "truncated";
  await clearCalls();
  const truncatedEvents = await readSse(await send("truncated current envelope"));
  assert.equal(truncatedEvents.find((event) => event.kind === "assistant_chunk")?.text, "The OpenClaw bridge emitted an invalid response.");
  assert.ok(truncatedEvents.some((event) => event.id === "openclaw-protocol" && event.status === "error"));
  assert.equal(truncatedEvents.findLast((event) => event.kind === "done")?.isError, true, "truncated stdout remains a real invalid-response failure when not cancelled");

  for (const mode of ["cancel-empty", "cancel-truncated", "cancel-full-output"]) {
    process.env.OPENCLAW_TEST_MODE = mode;
    await clearCalls();
    await clearCancelReady();
    const sessionId = `openclaw-${mode}-session`;
    const runId = `openclaw-${mode}-run`;
    const response = await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "wren", prompt: `stop ${mode}`, projectRoot: workspace, sessionId, runId }),
    }));
    await waitForText(cancelReady);
    assert.equal(requestChatStop(runId), true, `${mode} should register with the shared stop registry`);
    const events = await readSse(response);
    assert.equal(events.find((event) => event.kind === "error"), undefined, `${mode} stop never emits an error event`);
    assert.equal(
      events.find((event) => event.kind === "progress" && event.id === "openclaw-protocol"),
      undefined,
      `${mode} stop must not fabricate an invalid-response diagnostic`,
    );
    assert.equal(events.findLast((event) => event.kind === "done")?.isError, false, `${mode} stop completes as success`);
    const conversation = await loadConversation(sessionId);
    const turn = conversation?.turns.at(-1);
    assert.equal(turn?.text, "(cancelled)", `${mode} stop persists the canonical cancelled text`);
    assert.equal(turn?.cancelled, true, `${mode} stop marks the persisted turn cancelled`);
    assert.equal(turn?.isError, false, `${mode} stop never marks the persisted turn failed`);
  }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}

console.log("route-openclaw-bridge.integration.test.ts: ok");
