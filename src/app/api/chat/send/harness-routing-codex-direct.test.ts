// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Route-level Codex direct integration (cave-53iko.1). A fixture `codex`
// executable (selected hermetically via CODEX_BIN) reports the supported
// 0.145.0 contract and replays the checked-in tool-lifecycle fixture on
// `exec --json`; the route must stream live tool events plus assistant text,
// persist the tool lifecycle, and never render protocol frames as assistant
// text. A second fixture reporting an unknown future version must keep the
// whole turn on the generic `coven run codex` path (fixture coven shim) with
// one codex-compatibility notice.
const home = await mkdtemp(path.join(homedir(), "cave-codex-direct-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const codexLog = path.join(home, "codex-calls.jsonl");
const covenLog = path.join(home, "coven-calls.jsonl");
const fixturePath = fileURLToPath(
  new URL("../../../../lib/fixtures/codex/0.145.0-tool-lifecycle.jsonl", import.meta.url),
);

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousCovenBin = process.env.COVEN_BIN;
const previousCodexBin = process.env.CODEX_BIN;
const previousCovenSocket = process.env.COVEN_SOCKET;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");

const daemonOnlySessionId = "codex-daemon-only-resume";
const daemonSocket = process.platform === "win32"
  ? `\\\\.\\pipe\\cave-codex-direct-${process.pid}-${path.basename(home)}`
  : path.join(home, "coven.sock");
const daemon = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/v1/sessions") {
    res.end(JSON.stringify([{
      id: daemonOnlySessionId,
      title: "Established Codex daemon title",
      project_root: familiarWorkspace,
    }]));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve, reject) => {
  daemon.once("error", reject);
  daemon.listen(daemonSocket, () => {
    daemon.off("error", reject);
    resolve();
  });
});
process.env.COVEN_SOCKET = daemonSocket;

// The fixture Codex CLI: probe-visible version/help contract plus a real
// `exec --json` run that replays the conformance fixture. Every argv is
// logged so the test can assert the exact launch contract. Paths are baked in
// because the capability probe deliberately scrubs custom environment keys.
const codexShimSource = (version) => [
  "const { appendFileSync, readFileSync } = require('node:fs');",
  "const args = process.argv.slice(2);",
  `appendFileSync(${JSON.stringify(codexLog)}, JSON.stringify(args) + "\\n");`,
  "if (args.includes('--version')) {",
  `  console.log('codex-cli ${version}');`,
  "  process.exit(0);",
  "}",
  "if (args.join(' ') === 'exec resume --help') {",
  "  console.log('--json\\n--model\\n--skip-git-repo-check');",
  "  process.exit(0);",
  "}",
  "if (args.join(' ') === 'exec --help') {",
  "  console.log('--json\\nresume\\n--model\\n--sandbox\\n--add-dir\\n--skip-git-repo-check\\n--color');",
  "  process.exit(0);",
  "}",
  "if (args[0] === 'exec') {",
  `  process.stdout.write(readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));`,
  "  process.exit(0);",
  "}",
  "process.exit(9);",
].join("\n");

// The fixture Coven CLI for the fallback case: an available codex adapter and
// a stream-json assistant envelope for `run codex`.
const covenShimSource = [
  "const { appendFileSync } = require('node:fs');",
  `appendFileSync(${JSON.stringify(covenLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
  "if (process.argv[2] === 'adapter' && process.argv[3] === 'list' && process.argv[4] === '--json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'codex', executable: 'codex', available: true }]));",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === 'codex') {",
  "  const events = [",
  "    { type: 'system', subtype: 'init', session_id: 'coven-fallback-session' },",
  "    { type: 'assistant', message: { content: [{ type: 'text', text: 'Coven fallback response' }] }, session_id: 'coven-fallback-session' },",
  "    { type: 'result', subtype: 'success', is_error: false, session_id: 'coven-fallback-session' },",
  "  ];",
  "  process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
  "  process.exit(0);",
  "}",
  "process.exit(0);",
].join("\n");

async function writeExecutableShim(name, source) {
  if (process.platform === "win32") {
    // npm-style .cmd shims are resolved by the shared launcher into a direct
    // `node <script>` spawn, exactly like a real Windows npm install.
    const cjs = path.join(bin, `${name}-shim.cjs`);
    await writeFile(cjs, source);
    const cmd = path.join(bin, `${name}.cmd`);
    await writeFile(cmd, `@"%~dp0\\node.exe" "%~dp0\\${name}-shim.cjs" %*\r\n`);
    return cmd;
  }
  const executable = path.join(bin, name);
  await writeFile(executable, `#!/usr/bin/env node\n${source}`, { mode: 0o755 });
  return executable;
}

const codexCurrent = await writeExecutableShim("codex-current", codexShimSource("0.145.0"));
const codexFuture = await writeExecutableShim("codex-future", codexShimSource("9.9.9"));
const covenShim = await writeExecutableShim("coven", covenShimSource);

async function readSse(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.text();
  const events = body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  return { body, events };
}

async function loggedCalls(file) {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

try {
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  const { clearCodexRuntimeDiscoveryCache } = await import("@/lib/codex-compatibility");
  const { loadState, saveConfig } = await import("@/lib/cave-config");
  const { chatSummaryTitle, defaultChatTitleForSession } = await import("@/lib/cave-chat-titles");
  const { createCard } = await import("@/lib/cave-board");
  const { loadConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");

  process.env.COVEN_BIN = covenShim;
  refreshCovenBin();
  await saveConfig({ familiars: { opal: { harness: "codex" } } });
  const project = await createProject({ name: "Codex direct fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });

  // ── Direct mode: verified 0.145.0 CLI streams native tool activity ────────
  process.env.CODEX_BIN = codexCurrent;
  clearCodexRuntimeDiscoveryCache();
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "codex direct fixture prompt",
      projectRoot: familiarWorkspace,
    }),
  }));
  const { events } = await readSse(response);

  // Diagnose path selection before asserting bubbles: if the capability
  // probe timed out or failed, the route silently serves the turn through
  // the generic coven fallback and every tool assertion below would report
  // an unhelpful empty list.
  const directExecCalls = (await loggedCalls(codexLog)).filter((args) => args[0] === "exec");
  assert.ok(
    directExecCalls.length > 0,
    `the verified CLI must serve this turn directly, not fall back (coven argv: ${JSON.stringify(await loggedCalls(covenLog))})`,
  );

  const toolEvents = events.filter((event) => event.kind === "tool_use");
  assert.ok(
    toolEvents.some((event) => event.name === "Bash" && event.status === "running"),
    `live tool activity starts a Bash bubble: ${JSON.stringify(toolEvents)}`,
  );
  assert.ok(
    toolEvents.some((event) => event.name === "Bash" && event.status === "ok"),
    "the command lifecycle settles as ok",
  );
  assert.ok(
    toolEvents.some((event) => event.name === "example.lookup" && event.status === "error"),
    "the failed MCP call settles as an error bubble with server.tool attribution",
  );

  const assistantTexts = events
    .filter((event) => event.kind === "assistant_chunk" || event.kind === "assistant_replace")
    .map((event) => event.text)
    .join("");
  assert.equal(assistantTexts, "Fixture assistant response.\n", "only the agent message is assistant text");
  assert.doesNotMatch(
    assistantTexts,
    /thread\.started|item\.completed|command_execution|mcp_tool_call/,
    "no protocol payload becomes assistant text",
  );
  assert.ok(
    events.some((event) => event.kind === "session" && event.sessionId === "thread-current"),
    "the native thread id is announced for the fresh chat",
  );
  assert.equal(
    events.find((event) => event.kind === "progress" && event.id === "codex-compatibility"),
    undefined,
    "a fully verified direct turn emits no compatibility notice",
  );
  const done = events.findLast((event) => event.kind === "done");
  assert.ok(done, "the direct stream completes");
  assert.ok(!done.isError, "a completed fixture turn is not an error");

  const conversation = await loadConversation(done.sessionId);
  const assistantTurn = conversation?.turns.at(-1);
  assert.equal(assistantTurn?.role, "assistant");
  assert.equal(assistantTurn?.text, "Fixture assistant response.");
  assert.equal(conversation?.harnessSessionId, "thread-current", "the native thread id persists for resume");
  const persistedTools = assistantTurn?.tools ?? [];
  assert.deepEqual(
    persistedTools.map((tool) => [tool.name, tool.status]).sort(),
    [["Bash", "ok"], ["example.lookup", "error"]],
    `the tool lifecycle persists on the saved turn: ${JSON.stringify(persistedTools)}`,
  );
  assert.doesNotMatch(
    assistantTurn?.text ?? "",
    /thread\.started|command_execution/,
    "no protocol payload persists as assistant text",
  );
  let state = await loadState();
  assert.equal(
    state.sessionTitleAuto[done.sessionId],
    chatSummaryTitle({ userText: "codex direct fixture prompt", assistantText: "Fixture assistant response.\n" }),
    "a true new generic-harness session initializes and auto-names its title",
  );

  const codexCalls = await loggedCalls(codexLog);
  const execRun = codexCalls.find((args) => args[0] === "exec" && !args.includes("--help"));
  assert.ok(execRun, `the direct turn launched codex exec: ${JSON.stringify(codexCalls)}`);
  assert.ok(execRun.includes("--json"), "the direct launch uses the probed JSON contract");
  assert.ok(execRun.includes("--skip-git-repo-check"), "advertised fresh-exec flags are forwarded");
  assert.deepEqual(execRun.slice(execRun.indexOf("--color"), execRun.indexOf("--color") + 2), ["--color", "never"]);
  assert.equal(execRun.includes("--sandbox"), false, "full access never widens or narrows the sandbox implicitly");
  assert.equal(execRun[execRun.length - 2], "--", "the prompt is positional behind the option terminator");
  assert.match(execRun[execRun.length - 1], /codex direct fixture prompt/, "the user prompt reaches the positional");
  assert.ok(
    !(await loggedCalls(covenLog)).some((args) => args[0] === "run" && args[1] === "codex"),
    "a verified direct turn never starts `coven run codex`",
  );

  // A submitted daemon session id is resume provenance even before Cave has a
  // local transcript. Materialize the follow-up, but never claim its title.
  assert.equal(await loadConversation(daemonOnlySessionId), null);
  const daemonResumePrompt = "follow up without replacing the established title";
  const { events: daemonResumeEvents } = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      sessionId: daemonOnlySessionId,
      startNewConversation: true,
      prompt: daemonResumePrompt,
    }),
  })));
  assert.ok(
    !daemonResumeEvents.findLast((event) => event.kind === "done")?.isError,
    `daemon-only resume completes: ${JSON.stringify(daemonResumeEvents)}`,
  );
  const daemonResumeConversation = await loadConversation(daemonOnlySessionId);
  assert.ok(daemonResumeConversation, "daemon-only resume is still materialized locally");
  assert.equal(
    daemonResumeConversation.title,
    defaultChatTitleForSession(daemonOnlySessionId),
    "the follow-up prompt does not become the materialized conversation title",
  );
  state = await loadState();
  assert.equal(
    state.sessionTitles[daemonOnlySessionId],
    undefined,
    "the established daemon title remains authoritative instead of gaining a Cave override",
  );
  assert.equal(
    state.sessionTitleAuto[daemonOnlySessionId],
    undefined,
    "daemon-only resume never claims automatic title ownership",
  );

  // Board reserves a stable Cave id before the transcript exists. That
  // server-owned reservation is intentionally a first exchange.
  const boardSessionId = "codex-board-reserved-new";
  await createCard({
    title: "Reserved Codex task",
    familiarId: "opal",
    sessionId: boardSessionId,
    cwd: familiarWorkspace,
    projectId: project.id,
  });
  const boardPrompt = "implement the reserved board task";
  const { events: boardEvents } = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      sessionId: boardSessionId,
      startNewConversation: true,
      projectRoot: familiarWorkspace,
      prompt: boardPrompt,
    }),
  })));
  assert.ok(
    !boardEvents.findLast((event) => event.kind === "done")?.isError,
    `Board-reserved new session completes: ${JSON.stringify(boardEvents)}`,
  );
  state = await loadState();
  assert.equal(
    state.sessionTitleAuto[boardSessionId],
    chatSummaryTitle({ userText: boardPrompt, assistantText: "Fixture assistant response.\n" }),
    "a server-owned Board reservation retains first-exchange title initialization",
  );

  // ── Fallback: an unknown future version keeps the generic Coven path ──────
  const directExecCountBeforeFallback = (await loggedCalls(codexLog))
    .filter((args) => args[0] === "exec" && !args.includes("--help")).length;
  process.env.CODEX_BIN = codexFuture;
  clearCodexRuntimeDiscoveryCache();
  const fallbackResponse = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "opal",
      prompt: "codex fallback fixture prompt",
      projectRoot: familiarWorkspace,
    }),
  }));
  const { events: fallbackEvents } = await readSse(fallbackResponse);
  const compatibilityNotice = fallbackEvents.filter(
    (event) => event.kind === "progress" && event.id === "codex-compatibility",
  );
  assert.equal(compatibilityNotice.length, 1, "exactly one compatibility diagnostic per request");
  assert.equal(compatibilityNotice[0].status, "notice");
  assert.match(compatibilityNotice[0].label, /no verified event schema.*Coven transport/i);
  assert.equal(compatibilityNotice[0].detail, "unsupported-version");
  assert.equal(
    fallbackEvents
      .filter((event) => event.kind === "assistant_chunk")
      .map((event) => event.text)
      .join(""),
    "Coven fallback response",
    "the fallback turn still completes through the coven path",
  );
  const fallbackDone = fallbackEvents.findLast((event) => event.kind === "done");
  assert.ok(fallbackDone, "the fallback stream completes");
  assert.equal(fallbackDone.isError, false);
  const futureCodexCalls = await loggedCalls(codexLog);
  assert.equal(
    futureCodexCalls.some((args) => args[0] === "exec" && !args.includes("--help") && args.includes("--json") && !args.includes("resume")),
    true,
    "sanity: the earlier fresh direct run remains in the call log",
  );
  assert.equal(
    futureCodexCalls.filter((args) => args[0] === "exec" && !args.includes("--help")).length,
    directExecCountBeforeFallback,
    "the unsupported future CLI is probed but never runs a direct exec turn",
  );
  assert.ok(
    (await loggedCalls(covenLog)).some(
      (args) => args[0] === "run" && args[1] === "codex" && args.includes("--stream-json"),
    ),
    "the fallback turn runs the existing `coven run codex --stream-json` path",
  );
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  if (previousCodexBin === undefined) delete process.env.CODEX_BIN;
  else process.env.CODEX_BIN = previousCodexBin;
  if (previousCovenSocket === undefined) delete process.env.COVEN_SOCKET;
  else process.env.COVEN_SOCKET = previousCovenSocket;
  await new Promise((resolve, reject) => daemon.close((error) => error ? reject(error) : resolve()));
  await rm(home, { recursive: true, force: true });
}

console.log("harness-routing-codex-direct.test.ts: ok");
