// @ts-nocheck
// Direct copilot spawn for flow sessions (cave-lhc0): the run must launch the
// CLI with a real argv (prompt as ONE argument after -p) and persist the
// finished transcript as a Cave conversation under its session id — where the
// flow transcript endpoint and the research-mission reconcile look first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_HOME = process.env.HOME;
const REAL_CAVE_HOME = process.env.COVEN_CAVE_HOME;
const TMP = mkdtempSync(join(tmpdir(), "flow-copilot-session-"));
process.env.HOME = TMP;
process.env.COVEN_CAVE_HOME = join(TMP, ".coven", "cave");

after(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_CAVE_HOME === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = REAL_CAVE_HOME;
});

// Invoke the current Node executable with a JavaScript fixture rather than a
// POSIX shebang. This exercises the direct spawn path on Windows too.
const FAKE = join(TMP, "fake-copilot.js");
writeFileSync(FAKE, `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
writeFileSync(join(process.cwd(), "argv.json"), JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "@@research-control\\n" } }));
console.log(JSON.stringify({ type: "tool.execution_complete", data: { toolCallId: "call-1", success: true, result: { content: "/workspace" } } }));
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "done.\\n@@research-control\\n{\\"decision\\":\\"complete\\",\\"reason\\":\\"ok\\",\\"confidence\\":1}", toolRequests: [{ toolCallId: "call-1", name: "shell", arguments: { command: "pwd" } }] } }));
console.log(JSON.stringify({ type: "tool.execution_start", data: { toolCallId: "call-1", toolName: "shell", arguments: { command: "pwd" } } }));
`);

const { startCopilotFlowRun } = await import("./flow-copilot-session.ts");
const { copilotStreamSpec } = await import("../copilot-stream.ts");
const protocol = copilotStreamSpec()?.protocol;
assert.ok(protocol, "the registered Copilot flow fixture uses a validated event protocol");

const SPEC = {
  protocol,
  executable: "copilot",
  prefixArgs: ["--output-format", "json", "--stream", "on", "-p"],
  sessionIdFlag: "--session-id",
  resumeFlag: "--resume",
  modelFlag: "--model",
  addDirFlag: "--add-dir",
  sandboxFullArgs: ["--allow-all"],
  sandboxReadOnlyArgs: [],
};
const FAKE_LAUNCH = { command: process.execPath, fixedArgs: [FAKE] };

test("spawns with the prompt as one argv element and persists the transcript", async () => {
  const argvOut = join(TMP, "argv.json");
  const prompt = "Mission: cave-test\nIteration 1 of 3.\nGather sources and print markers.";
  const { sessionId, done } = startCopilotFlowRun({
    spec: SPEC,
    prompt,
    projectRoot: TMP,
    familiarId: "sage",
    familiarName: "Sage",
    familiarRole: "Researcher",
    spawnCommand: FAKE_LAUNCH,
  });
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
  await done;

  // The multi-word prompt traveled as exactly one argv element after -p.
  const argv = JSON.parse(readFileSync(argvOut, "utf8"));
  const promptIndex = argv.indexOf("-p") + 1;
  assert.ok(promptIndex > 0, "prompt flag present");
  assert.match(argv[promptIndex], /Mission: cave-test/);
  assert.match(argv[promptIndex], /Gather sources and print markers\./);
  assert.match(argv[promptIndex], /\[Identity: You are Sage, a Researcher\./);
  assert.equal(argv.length, promptIndex + 1, "nothing trails the prompt argument");
  assert.ok(argv.includes("--session-id"), "fresh session id is pre-assigned");
  assert.ok(!argv.includes("--add-dir"), "no trust flags when addDirs is omitted");
  // One-shot flow runs can't answer approval prompts — without pre-approved
  // tools the CLI auto-denies every write and research iterations end with
  // "completed without artifacts/primary.md". Path verification must stay on.
  assert.ok(argv.includes("--allow-all-tools"), "unattended runs pre-approve tools");
  assert.ok(argv.includes("--allow-all-urls"), "unattended runs pre-approve URL fetches");
  assert.ok(!argv.includes("--allow-all"), "path verification stays on (no blanket --allow-all)");
  assert.ok(!argv.includes("--allow-all-paths"), "writes stay confined to cwd + --add-dir grants");

  // The finished transcript is a Cave conversation under the session id, with
  // the assistant's final content (trailing control markers intact).
  const convPath = join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`);
  const conv = JSON.parse(readFileSync(convPath, "utf8"));
  const roles = conv.turns.map((t) => t.role);
  assert.deepEqual(roles, ["user", "assistant"]);
  assert.match(conv.turns[1].text, /@@research-control/);
  assert.match(conv.turns[1].text, /"decision":"complete"/);
  assert.ok(!conv.turns[1].isError, "successful run is not an error turn");
  assert.equal(conv.turns[1].tools?.length, 1, "flow transcripts persist parsed Copilot tool lifecycle activity");
  assert.deepEqual(
    { ...conv.turns[1].tools[0], durationMs: undefined },
    {
      id: "call-1",
      name: "shell",
      input: '{\n  "command": "pwd"\n}',
      output: "/workspace",
      status: "ok",
      textOffset: conv.turns[1].text.length,
      durationMs: undefined,
    },
    "a completion received before its declaration settles the later tool record",
  );
  assert.ok(typeof conv.turns[1].tools[0].durationMs === "number", "the persisted tool duration is recorded when available");
});

test("addDirs ride as repeatable --add-dir trust flags ahead of the prompt", async () => {
  const runRoot = mkdtempSync(join(TMP, "adddir-run-"));
  const workspace = join(TMP, "familiar-workspace");
  const secondWorkspace = join(TMP, "second-familiar-workspace");
  const { done } = startCopilotFlowRun({
    spec: SPEC,
    prompt: "hello",
    projectRoot: runRoot,
    familiarId: "sage",
    addDirs: [` ${workspace} `, "", runRoot, workspace, secondWorkspace],
    spawnCommand: FAKE_LAUNCH,
  });
  await done;
  const argv = JSON.parse(readFileSync(join(runRoot, "argv.json"), "utf8"));
  const flagIndexes = argv.flatMap((arg, index) => arg === "--add-dir" ? [index] : []);
  const flagIndex = flagIndexes[0];
  assert.ok(flagIndex >= 0, "add-dir trust flag present");
  assert.deepEqual(
    flagIndexes.map((index) => argv[index + 1]),
    [workspace, secondWorkspace],
    "trust grants are trimmed and deduped, with blanks and the spawn cwd excluded",
  );
  assert.ok(flagIndex < argv.indexOf("-p"), "trust flags ride ahead of the prompt flag");
});

test("a failed spawn persists an error turn instead of dropping the run", async () => {
  const badSpec = { ...SPEC, executable: join(TMP, "does-not-exist-bin") };
  const { sessionId, done } = startCopilotFlowRun({
    spec: badSpec,
    prompt: "hello",
    projectRoot: TMP,
    familiarId: null,
  });
  await done;
  const convPath = join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`);
  const conv = JSON.parse(readFileSync(convPath, "utf8"));
  const assistant = conv.turns.find((t) => t.role === "assistant");
  assert.ok(assistant.isError, "failure is an error turn");
  assert.match(assistant.text, /Copilot exited with code \?\./);
});

test("a non-zero exit with partial output keeps the text AND the exit diagnostics", async () => {
  const PARTIAL = join(TMP, "fake-copilot-partial.js");
  writeFileSync(PARTIAL, `
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "partial findings before the crash" } }));
console.error("boom: model backend dropped");
process.exit(3);
`);
  const { sessionId, done } = startCopilotFlowRun({
    spec: SPEC,
    prompt: "hello",
    projectRoot: TMP,
    familiarId: null,
    spawnCommand: { command: process.execPath, fixedArgs: [PARTIAL] },
  });
  await done;
  const convPath = join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`);
  const conv = JSON.parse(readFileSync(convPath, "utf8"));
  const assistant = conv.turns.find((t) => t.role === "assistant");
  assert.ok(assistant.isError, "non-zero exit is an error even with partial output");
  assert.match(assistant.text, /partial findings before the crash/);
  assert.match(assistant.text, /Copilot exited with code 3\./);
  assert.doesNotMatch(assistant.text, /boom: model backend dropped/, "raw CLI stderr is never persisted");
});
