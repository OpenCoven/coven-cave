// @ts-nocheck
// Direct copilot spawn for flow sessions (cave-lhc0): the run must launch the
// CLI with a real argv (prompt as ONE argument after -p) and persist the
// finished transcript as a Cave conversation under its session id — where the
// flow transcript endpoint and the research-mission reconcile look first.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAL_HOME = process.env.HOME;
const TMP = mkdtempSync(join(tmpdir(), "flow-copilot-session-"));
process.env.HOME = TMP;

after(() => { process.env.HOME = REAL_HOME; });

// A fake copilot binary (node shebang) that records its full argv (to
// cwd/argv.json) and emits two JSONL frames like the real CLI's stream mode.
const FAKE = join(TMP, "fake-copilot");
writeFileSync(FAKE, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
writeFileSync(join(process.cwd(), "argv.json"), JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "assistant.message_delta", data: { messageId: "m1", deltaContent: "@@research-control\\n" } }));
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "done.\\n@@research-control\\n{\\"decision\\":\\"complete\\",\\"reason\\":\\"ok\\",\\"confidence\\":1}" } }));
`);
chmodSync(FAKE, 0o755);

const { startCopilotFlowRun } = await import("./flow-copilot-session.ts");

const SPEC = {
  executable: FAKE,
  prefixArgs: ["--output-format", "json", "--stream", "on", "-p"],
  sessionIdFlag: "--session-id",
  resumeFlag: "--resume",
  modelFlag: "--model",
  sandboxFullArgs: ["--allow-all"],
  sandboxReadOnlyArgs: [],
};

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

  // The finished transcript is a Cave conversation under the session id, with
  // the assistant's final content (trailing control markers intact).
  const convPath = join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`);
  const conv = JSON.parse(readFileSync(convPath, "utf8"));
  const roles = conv.turns.map((t) => t.role);
  assert.deepEqual(roles, ["user", "assistant"]);
  assert.match(conv.turns[1].text, /@@research-control/);
  assert.match(conv.turns[1].text, /"decision":"complete"/);
  assert.ok(!conv.turns[1].isError, "successful run is not an error turn");
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
  assert.match(assistant.text, /copilot exited|ENOENT/);
});

test("a non-zero exit with partial output keeps the text AND the exit diagnostics", async () => {
  const PARTIAL = join(TMP, "fake-copilot-partial");
  writeFileSync(PARTIAL, `#!/usr/bin/env node
console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "m1", content: "partial findings before the crash" } }));
console.error("boom: model backend dropped");
process.exit(3);
`);
  chmodSync(PARTIAL, 0o755);
  const { sessionId, done } = startCopilotFlowRun({
    spec: { ...SPEC, executable: PARTIAL },
    prompt: "hello",
    projectRoot: TMP,
    familiarId: null,
  });
  await done;
  const convPath = join(TMP, ".coven", "cave", "conversations", `${sessionId}.json`);
  const conv = JSON.parse(readFileSync(convPath, "utf8"));
  const assistant = conv.turns.find((t) => t.role === "assistant");
  assert.ok(assistant.isError, "non-zero exit is an error even with partial output");
  assert.match(assistant.text, /partial findings before the crash/);
  assert.match(assistant.text, /copilot exited with code 3/);
  assert.match(assistant.text, /boom: model backend dropped/);
});
