// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// #5938: when a Claude Code plan allowance is spent, the CLI delivers its
// quota notice AS assistant text — an `assistant` envelope whose model is the
// `<synthetic>` marker — followed by a `result` with is_error. Nothing in that
// shape reached a classifier: no `error` event was emitted, the strip showed
// a plain Retry that re-sent the exhausted model, and the notice's tracking
// URL streamed into the transcript. This replays that ordering through the
// real route and pins the recovery contract: a `harness_usage_limit` error
// that names the model the send asked for, no process-failure error for the
// same run, and no provider text in the error message.
//
// Shape checked against Claude Code 2.1.300 (2026-10-15): the CLI builds an
// API-error reply as an assistant message with `model: "<synthetic>"` (its
// constant `Pi`), `stop_reason: "stop_sequence"`, `stop_sequence: ""` and the
// notice as text content, and its stream-json schema adds
// `is_api_error_message` and `api_error_status` beside `message`, never inside
// `message.content`. "You've reached your Fable limit" and the
// `?from=cc_cli_limit_message` settings URL are the CLI's own strings. This is
// read from the shipped bundle, not a captured over-quota stream, so the frame
// carries those fields while the route keys only on the synthetic model and
// the text.
const home = await mkdtemp(path.join(homedir(), "cave-claude-usage-limit-"));
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
const previousTestMode = process.env.CLAUDE_USAGE_LIMIT_TEST_MODE;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.HOME = home;
process.env.SHELL = path.join(home, "missing-shell");
if (process.platform === "win32") delete process.env.Path;

const SESSION = "6f5a3c1e-usage-limit-4b2d-9e8f-claude";
const LIMIT_TEXT =
  "You've reached your Fable limit. Switch to another model, or manage usage credits at " +
  "claude.ai/settings/usage?from=cc_cli_limit_message, to continue.";
const RATE_TEXT = "429 Too Many Requests: rate limit exceeded, retry after 12s";
const FRAMES = [
  { type: "system", subtype: "init", cwd: familiarWorkspace, session_id: SESSION, tools: [], model: "claude-fable-5-1" },
  {
    type: "assistant",
    message: {
      model: "<synthetic>",
      id: "msg_synthetic_limit",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: LIMIT_TEXT }],
      stop_reason: "stop_sequence",
      stop_sequence: "",
    },
    parent_tool_use_id: null,
    is_api_error_message: true,
    api_error_status: 429,
    session_id: SESSION,
  },
  { type: "result", subtype: "success", duration_ms: 1180, is_error: true, num_turns: 1, result: LIMIT_TEXT, session_id: SESSION },
];

const shim = [
  "const frames = " + JSON.stringify(FRAMES) + ";",
  "if (process.argv[2] === 'run' && process.argv[3] === '--help') {",
  "  process.stdout.write('  --model <model>  Forward a provider model id\\n');",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === 'claude') {",
  "  if (process.env.CLAUDE_USAGE_LIMIT_TEST_MODE === 'rate') {",
  "    process.stdout.write(JSON.stringify(frames[0]) + '\\n');",
  "    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 90, is_error: true, num_turns: 1, result: " + JSON.stringify(RATE_TEXT) + ", session_id: frames[0].session_id }) + '\\n');",
  "    process.exit(1);",
  "  }",
  "  for (const frame of frames) process.stdout.write(JSON.stringify(frame) + '\\n');",
  // Claude Code exits non-zero after an error result. This is what used to
  // reach the generic process-failure block.
  "  process.exit(1);",
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

// Same documented-metadata probe answers as the rate-limit-frame fixture, so
// the profile-selected envelope decoder (the path that sees the synthetic
// model) is the one exercised.
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
  const project = await createProject({ name: "Claude usage-limit fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "sage", projectId: project.id, source: "human", access: "write" });

  const resolution = await resolveInstalledClaudeCompatibility();
  assert.equal(resolution.kind, "compatible", JSON.stringify(resolution));
  assert.equal(resolution.stale, false);

  const MODEL = "anthropic/claude-fable-5-1";
  const send = (prompt) => POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "sage",
      prompt,
      modelOverride: MODEL,
      modelOverrideScope: "next-message",
      projectRoot: familiarWorkspace,
    }),
  }));

  delete process.env.CLAUDE_USAGE_LIMIT_TEST_MODE;
  const { body, events } = await readSse(await send("write the summary"));
  const errors = events.filter((event) => event.kind === "error");
  assert.equal(errors.length, 1, `exactly one error event: ${JSON.stringify(errors)}`);
  const [error] = errors;
  assert.equal(error.code, "harness_usage_limit", `the synthetic quota notice is classified: ${body}`);
  assert.equal(error.harness, "claude");
  assert.equal(error.model, MODEL, "the error names the model the send asked for, so Chat can exclude it");
  assert.equal(error.message, `Claude Code usage limit reached for ${MODEL}.`);
  assert.doesNotMatch(error.message, /settings\/usage|cc_cli|Switch to another model|Fable limit/, "the provider notice is not echoed in the error");
  assert.equal(
    events.some((event) => event.kind === "error" && event.code === "runtime_process_failed"),
    false,
    "the non-zero exit does not also produce a process-failure error for the same run",
  );
  const done = events.findLast((event) => event.kind === "done");
  assert.equal(done?.isError, true, "the turn is still an error");
  assert.equal(done?.responseMetadata?.modelApplicationState, "pending", "a quota is not a model rejection");
  assert.equal(done?.responseMetadata?.modelApplicationReason, "Usage limit reached for the selected model.");
  assert.equal(
    done?.responseMetadata?.runtimeIdentity?.model ?? null,
    null,
    "a synthetic envelope is not a model report",
  );
  const limitProgress = events.find((event) => event.kind === "progress" && event.id === "harness-usage-limit");
  assert.equal(limitProgress?.status, "error");
  assert.doesNotMatch(limitProgress?.detail ?? "", /settings\/usage|cc_cli/, "the progress detail carries no provider text either");

  // Throttling is transient: a different code, a plain-retry message, and no
  // model switch.
  process.env.CLAUDE_USAGE_LIMIT_TEST_MODE = "rate";
  const rate = await readSse(await send("try again"));
  const rateError = rate.events.find((event) => event.kind === "error");
  assert.equal(rateError?.code, "harness_rate_limited", rate.body);
  assert.equal(rateError?.harness, "claude");
  assert.equal(rateError?.message, "Claude Code is rate-limiting requests. Wait a moment, then retry.");
  assert.doesNotMatch(rate.body, /retry after 12s/, "the provider's 429 line is withheld");
  assert.equal(rate.events.some((event) => event.kind === "error" && event.code === "runtime_process_failed"), false);
  assert.equal(rate.events.findLast((event) => event.kind === "done")?.isError, true);

  console.log("route-claude-usage-limit.integration.test.ts OK");
} finally {
  if (previousTestMode === undefined) delete process.env.CLAUDE_USAGE_LIMIT_TEST_MODE;
  else process.env.CLAUDE_USAGE_LIMIT_TEST_MODE = previousTestMode;
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
