// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// A conversation's persisted harness is the resume contract. This exercises
// the real route after the familiar has subsequently been rebound to Claude:
// it must continue through OpenClaw rather than silently changing runtime.
const home = await mkdtemp(path.join(homedir(), "cave-openclaw-resume-"));
const bin = path.join(home, "bin");
const workspace = path.join(home, "workspace");
const calls = path.join(home, "openclaw-calls.jsonl");
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(home, "familiars.toml"), "[[familiar]]\nid = \"wren\"\nopenclaw_agent = \"wren\"\n");

const previousHome = process.env.COVEN_HOME;
const previousCaveHome = process.env.COVEN_CAVE_HOME;
const previousOpenClawBin = process.env.OPENCLAW_BIN;
const previousCallLog = process.env.OPENCLAW_TEST_CALLS;
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.OPENCLAW_TEST_CALLS = calls;

const shimScript = path.join(bin, "openclaw.js");
await writeFile(shimScript, [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.OPENCLAW_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');",
  "if (process.argv[2] === 'agent') {",
  "  process.stdout.write(JSON.stringify({ result: { payloads: [{ text: 'resumed through OpenClaw' }] } }) + '\\n');",
  "  process.exit(0);",
  "}",
  "process.exit(1);",
].join("\n"), { mode: 0o755 });

if (process.platform === "win32") {
  const shimBatch = path.join(bin, "openclaw.cmd");
  await writeFile(shimBatch, '"%~dp0\\openclaw.js" %*\r\n');
  process.env.OPENCLAW_BIN = shimBatch;
} else {
  const shimExecutable = path.join(bin, "openclaw");
  await writeFile(shimExecutable, `#!/usr/bin/env node\n${await readFile(shimScript, "utf8")}`, { mode: 0o755 });
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

try {
  const { saveConfig } = await import("@/lib/cave-config");
  const { loadConversation, saveConversation } = await import("@/lib/cave-conversations");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { POST } = await import("./route.ts");

  const sessionId = "openclaw-resume-contract";
  const now = new Date().toISOString();
  await saveConversation({
    sessionId,
    familiarId: "wren",
    harness: "openclaw",
    // OpenClaw owns model selection; an older conversation must therefore
    // retain the runtime-default sentinel rather than a Cave override.
    model: "",
    runtime: `local:${workspace}`,
    createdAt: now,
    updatedAt: now,
    turns: [{ id: "first-user", role: "user", text: "first", createdAt: now }],
    activeLeafId: "first-user",
  });
  // Simulate the familiar being edited after this conversation began.
  await saveConfig({ familiars: { wren: { harness: "claude", model: "" } } });
  const project = await createProject({ name: "OpenClaw resume fixture", root: workspace });
  await grantProjectToFamiliar({ familiarId: "wren", projectId: project.id, source: "human", access: "write" });

  const events = await readSse(await POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: "wren",
      sessionId,
      projectRoot: workspace,
      prompt: "continue this conversation",
    }),
  })));

  assert.deepEqual(
    events.filter((event) => event.kind === "assistant_chunk").map((event) => event.text),
    ["resumed through OpenClaw"],
  );
  assert.equal(events.find((event) => event.kind === "error"), undefined);
  const done = events.findLast((event) => event.kind === "done");
  assert.equal(done?.isError, false);
  assert.equal(done?.responseMetadata?.harness, "openclaw");
  assert.equal(done?.responseMetadata?.openclawAgentId, "wren");

  const invocations = (await readFile(calls, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(invocations.length, 1, "the resumed turn starts exactly one OpenClaw child");
  assert.deepEqual(invocations[0].slice(0, 3), ["agent", "--agent", "wren"]);
  assert.ok(invocations[0].includes(`cave-${sessionId}`), "the existing Cave session key is retained");

  const conversation = await loadConversation(sessionId);
  assert.equal(conversation?.harness, "openclaw", "resume never rewrites the stored harness");
  assert.equal(conversation?.turns.at(-1)?.responseMetadata?.harness, "openclaw");
} finally {
  if (previousHome === undefined) delete process.env.COVEN_HOME;
  else process.env.COVEN_HOME = previousHome;
  if (previousCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = previousCaveHome;
  if (previousOpenClawBin === undefined) delete process.env.OPENCLAW_BIN;
  else process.env.OPENCLAW_BIN = previousOpenClawBin;
  if (previousCallLog === undefined) delete process.env.OPENCLAW_TEST_CALLS;
  else process.env.OPENCLAW_TEST_CALLS = previousCallLog;
  await rm(home, { recursive: true, force: true });
}
