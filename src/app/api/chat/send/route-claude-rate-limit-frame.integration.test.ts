// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Claude Code interleaves an out-of-band `rate_limit_event` usage notice with
// the stream-json message frames once account utilization crosses its warning
// threshold. Cave's compatibility boundary treated that unknown envelope type
// as a protocol break: it latched tool decoding off for the rest of the turn,
// showed "A Claude Code tool frame is not supported by the selected
// compatibility profile", and — because the notice can arrive BETWEEN a
// `tool_use` and its `tool_result` — left the already-open tool bubble
// unsettled. This replays a verbatim capture of that ordering through the real
// route, so the regression is the observable stream, not a parser unit.
//
// Every frame below is recorded from `coven run claude --stream-json` on
// Claude Code 2.1.220 (ids and session shortened, payloads otherwise intact).
const home = await mkdtemp(path.join(homedir(), "cave-claude-rate-limit-"));
const covenBinDir = path.join(home, "coven-bin");
const claudeBinDir = path.join(home, "claude-bin");
const familiarWorkspace = path.join(home, "familiars", "sage");
await mkdir(covenBinDir, { recursive: true });
await mkdir(claudeBinDir, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousOsHome = process.env.HOME;
const previousShell = process.env.SHELL;
const previousCovenBin = process.env.COVEN_BIN;
const previousPath = process.env.PATH;
const previousPathCase = process.env.Path;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.HOME = home;
process.env.SHELL = path.join(home, "missing-shell");
if (process.platform === "win32") delete process.env.Path;

const SESSION = "e0c0b587-3115-4fff-b382-cfe0b64b58a9";
const TOOL_ID = "toolu_01LBKhhNoVnTAeMbP9yHC2sf";
const FRAMES = [
  { type: "system", subtype: "init", cwd: familiarWorkspace, session_id: SESSION, tools: ["Bash"], model: null },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      id: "msg_011CdfufEXnC8VSBHVW5E5pp",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Running it now." }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      id: "msg_011CdfufEXnC8VSBHVW5E5pp",
      type: "message",
      role: "assistant",
      content: [{
        type: "tool_use",
        id: TOOL_ID,
        name: "Bash",
        input: { command: "echo hi", description: "Echo hi" },
        caller: { type: "direct" },
      }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
  },
  // The notice lands mid tool call. This is the frame that used to break the turn.
  {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      resetsAt: 1785902400,
      rateLimitType: "seven_day",
      utilization: 0.86,
      isUsingOverage: false,
      surpassedThreshold: 0.75,
    },
    uuid: "a917cee1-5b74-4b62-bab8-3af62e56d2f5",
    session_id: SESSION,
  },
  {
    type: "user",
    message: { role: "user", content: [{ tool_use_id: TOOL_ID, type: "tool_result", content: "hi", is_error: false }] },
    parent_tool_use_id: null,
    session_id: SESSION,
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5",
      id: "msg_01Second",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "DONE" }],
    },
    parent_tool_use_id: null,
    session_id: SESSION,
  },
  { type: "result", subtype: "success", duration_ms: 7426, is_error: false, num_turns: 1, session_id: SESSION, error: null },
];

const shim = [
  "const frames = " + JSON.stringify(FRAMES) + ";",
  "if (process.argv[2] === 'run' && process.argv[3] === 'claude') {",
  "  for (const frame of frames) process.stdout.write(JSON.stringify(frame) + '\\n');",
  "  process.exit(0);",
  "}",
  "process.exit(0);",
].join("\n");
const shimScript = path.join(covenBinDir, "coven.js");
await writeFile(shimScript, shim, { mode: 0o755 });
let covenShim;
if (process.platform === "win32") {
  covenShim = path.join(covenBinDir, "coven.cmd");
  await writeFile(covenShim, '"%~dp0\\coven.js" %*\r\n');
} else {
  covenShim = path.join(covenBinDir, "coven");
  await writeFile(covenShim, `#!/bin/sh\nexec "${process.execPath}" "${shimScript}" "$@"\n`, { mode: 0o755 });
}

// The compatibility probe reads only documented CLI metadata, so a shim that
// answers --version/--help selects the same signed profile a real 2.x install
// would. Without a stream-json capability line the run would fall back to
// text-only and prove nothing about tool decoding.
const claudeShimScript = path.join(claudeBinDir, "claude.js");
await writeFile(
  claudeShimScript,
  [
    "if (process.argv[2] === '--version') { console.log('2.1.220 (Claude Code)'); process.exit(0); }",
    "if (process.argv[2] === '--help') {",
    "  console.log('Usage: claude [options]');",
    "  console.log('  --output-format <format>  Output format (only works with --print): \"text\", \"json\" or \"stream-json\"');",
    "  console.log('  --permission-mode <mode>  Permission mode to use');",
    "  process.exit(0);",
    "}",
    "process.exit(0);",
  ].join("\n"),
  { mode: 0o755 },
);
const claudeShim = path.join(claudeBinDir, process.platform === "win32" ? "claude.cmd" : "claude");
if (process.platform === "win32") {
  await writeFile(claudeShim, '@echo off\r\nnode "%~dp0\\claude.js" %*\r\n');
} else {
  await writeFile(claudeShim, `#!/bin/sh\nexec "${process.execPath}" "${claudeShimScript}" "$@"\n`, { mode: 0o755 });
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
  const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
  const { resetClaudeCompatibilityCacheForTest, resolveInstalledClaudeCompatibility } =
    await import("@/lib/server/claude-runtime-compatibility");
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");

  process.env.COVEN_BIN = covenShim;
  process.env.PATH = `${claudeBinDir}${path.delimiter}${covenBinDir}`;
  refreshCovenBin();
  refreshCovenSpawnEnv();
  resetClaudeCompatibilityCacheForTest();

  await saveConfig({ familiars: { sage: { harness: "claude" } } });
  const project = await createProject({ name: "Claude rate-limit frame fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });

  // Guard the fixture itself: if the shimmed probe ever stops selecting a
  // profile, the assertions below would pass for the wrong reason (tool
  // decoding disabled from the start rather than surviving the notice).
  const resolution = await resolveInstalledClaudeCompatibility();
  assert.equal(resolution.kind, "compatible", JSON.stringify(resolution));
  assert.equal(resolution.stale, false);

  const { body, events } = await readSse(
    await POST(new Request("http://localhost/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ familiarId: "sage", prompt: "run echo hi", projectRoot: familiarWorkspace }),
    })),
  );

  // Assert the reported symptom FIRST. Ordered after the tool-status check
  // these would never run on the unfixed parser, and a wrong progress id would
  // then pass vacuously on both parsers forever.
  const compatibilityNotice = events.find(
    (event) => event.kind === "progress" && event.id === "claude-runtime-compatibility",
  );
  assert.equal(
    compatibilityNotice,
    undefined,
    `a known usage notice must not report a compatibility failure: ${JSON.stringify(compatibilityNotice)}`,
  );
  assert.doesNotMatch(body, /not supported by the selected compatibility profile/);

  const toolEvents = events.filter((event) => event.kind === "tool_use" && event.name === "Bash");
  assert.ok(toolEvents.length > 0, `the tool call reaches the stream: ${body}`);
  const settled = toolEvents.at(-1);
  assert.equal(
    settled.status,
    "ok",
    `a usage notice between tool_use and tool_result must not leave the bubble running: ${JSON.stringify(toolEvents)}`,
  );
  assert.equal(settled.output, "hi", "the tool result still settles with its real output");

  const assistantText = events
    .filter((event) => event.kind === "assistant_chunk")
    .map((event) => event.text)
    .join("");
  assert.match(assistantText, /DONE/, "assistant text after the notice still streams");
  assert.doesNotMatch(assistantText, /rate_limit|utilization/i, "the notice never leaks into the transcript");

  console.log("route-claude-rate-limit-frame.integration.test.ts OK");
} finally {
  process.env.COVEN_HOME = previousHome;
  process.env.COVEN_CAVE_HOME = previousCaveHome;
  process.env.HOME = previousOsHome;
  process.env.SHELL = previousShell;
  if (previousCovenBin === undefined) delete process.env.COVEN_BIN;
  else process.env.COVEN_BIN = previousCovenBin;
  process.env.PATH = previousPath;
  if (previousPathCase !== undefined) process.env.Path = previousPathCase;
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  await rm(home, { recursive: true, force: true });
}
