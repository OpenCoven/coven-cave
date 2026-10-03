import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// One live turn per conversation. A client that lost its stream can still
// send while the server runs the earlier turn; a second launch would put two
// harnesses on one native session and hide the earlier run from Stop.

const root = path.join(process.cwd(), ".flow-validation-tmp", `concurrent-turn-${process.pid}`);
const bin = path.join(root, "Library", "pnpm");
const workspace = path.join(root, "workspace");
const executablePath = (name: string) => path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
await mkdir(bin, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(path.join(root, "package.json"), '{"type":"commonjs"}');
const previousEnv = { ...process.env };
process.env.COVEN_HOME = root;
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.HOME = root;
if (process.platform === "win32") {
  process.env.USERPROFILE = root;
  delete process.env.Path;
}
process.env.SHELL = path.join(root, "missing-shell");
process.env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}`;
process.env.COVEN_BIN = executablePath("coven");
delete process.env.COVEN_SOCKET;
const callsPath = path.join(root, "calls.jsonl");
for (const name of ["coven", "claude"]) {
  const fixture = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.0.0"); process.exit(0); }
if (args.includes("--help")) { console.log("--model --add-dir --permission"); process.exit(0); }
if (${JSON.stringify(name)} === "coven" && args[0] !== "run") { console.log("[]"); process.exit(0); }
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ name: ${JSON.stringify(name)}, args }) + "\\n");
console.log(JSON.stringify({ type: "system", session_id: "native-1" }));
console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Follow-up answer" }] } }));
console.log(JSON.stringify({ type: "result", is_error: false, duration_ms: 1 }));
`;
  if (process.platform === "win32") {
    await writeFile(path.join(bin, `${name}.cjs`), fixture);
    await writeFile(executablePath(name), `"node" "%~dp0\\${name}.cjs" %*\r\n`);
  } else {
    await writeFile(executablePath(name), fixture, { mode: 0o755 });
  }
}
await writeFile(callsPath, "");
const { POST } = await import("./route.ts");
const {
  registerChatRun,
  requestChatStop,
  unregisterChatRun,
  hasActiveChatRun,
  resetChatStopRegistryForTests,
} = await import("@/lib/server/chat-stop-registry");
const { saveConversation, loadConversation } = await import("../../../../lib/cave-conversations.ts");
const { saveConfig } = await import("../../../../lib/cave-config.ts");
const { createProject } = await import("../../../../lib/cave-projects.ts");
const { grantProjectToFamiliar } = await import("../../../../lib/project-permissions.ts");
await saveConfig({ familiars: { cody: { harness: "claude", model: "" } } });
const project = await createProject({ name: "Concurrent turn", root: workspace });
await grantProjectToFamiliar({ familiarId: "cody", projectId: project.id, source: "human", access: "write" });

test.after(async () => {
  resetChatStopRegistryForTests();
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(root, { recursive: true, force: true });
});

const sessionId = "busy-chat";
const send = (prompt: string, overrides: Record<string, unknown> = {}) => POST(new Request("http://localhost/api/chat/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ familiarId: "cody", sessionId, projectRoot: workspace, prompt, ...overrides }),
}));

test("a send for a chat with a live run is refused before anything launches", async () => {
  resetChatStopRegistryForTests();
  const now = new Date().toISOString();
  await saveConversation({
    sessionId, familiarId: "cody", harness: "claude", harnessSessionId: "native-1", origin: "chat",
    createdAt: now, updatedAt: now,
    turns: [{ id: "seed", role: "assistant", text: "Earlier answer", createdAt: now }],
    activeLeafId: "seed",
  });
  let kills = 0;
  const earlier = registerChatRun(["earlier-run", sessionId], () => {
    kills += 1;
  }, { runId: "earlier-run" });
  try {
    const callsBefore = await readFile(callsPath, "utf8");
    const refused = await send("Second message while the first still runs");
    assert.equal(refused.status, 409, await refused.clone().text());
    const body = await refused.json();
    assert.equal(body.code, "chat_run_active");
    assert.equal(body.ok, false);
    assert.equal(await readFile(callsPath, "utf8"), callsBefore, "no harness was launched");
    assert.equal((await loadConversation(sessionId))?.turns.length, 1, "the transcript is unchanged");
    assert.equal(hasActiveChatRun(sessionId), true, "the earlier run is still listed as running");

    // The earlier run is still reachable by conversation id, and a stopping
    // run no longer blocks: Stop-then-send launches the new turn.
    assert.equal(requestChatStop(sessionId), true);
    assert.equal(kills, 1);
    unregisterChatRun(earlier);
    const accepted = await send("Send after stopping the earlier turn");
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.match(await accepted.text(), /Follow-up answer/);
    const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(calls.length, 1, "exactly one harness launch, after the earlier run was stopped");
    assert.deepEqual(calls[0].args.slice(0, 2), ["run", "claude"]);
  } finally {
    unregisterChatRun(earlier);
  }
});

test("a stop-requested run that is still exiting does not block the next turn", async () => {
  resetChatStopRegistryForTests();
  const ending = registerChatRun(["ending-run", sessionId], () => {}, { runId: "ending-run" });
  try {
    assert.equal(requestChatStop(sessionId), true);
    const callsBefore = (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).length;
    const accepted = await send("Send right after Stop");
    assert.equal(accepted.status, 200, await accepted.clone().text());
    await accepted.text();
    const callsAfter = (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).length;
    assert.equal(callsAfter, callsBefore + 1);
  } finally {
    unregisterChatRun(ending);
  }
});

test("simultaneous sends admit only one turn during asynchronous setup", async () => {
  resetChatStopRegistryForTests();
  const callsBefore = (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).length;
  const turnsBefore = (await loadConversation(sessionId))!.turns.length;
  const responses = await Promise.all([send("First concurrent send"), send("Second concurrent send")]);
  // Drain even the unexpected second stream so a failed assertion cannot
  // leave a harness writing into the next test's fixture.
  await Promise.all(responses.map((response) => response.text()));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const callsAfter = (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).length;
  assert.equal(callsAfter, callsBefore + 1, "only the admitted turn launches a harness");
  assert.equal((await loadConversation(sessionId))!.turns.length, turnsBefore + 2);
  assert.equal(hasActiveChatRun(sessionId), false, "completion releases admission");
});

test("a project authorization failure releases admission for a corrected send", async () => {
  resetChatStopRegistryForTests();
  const unregistered = path.join(root, "unregistered-project");
  await mkdir(unregistered, { recursive: true });
  const refused = await send("Wrong project", { projectRoot: unregistered });
  assert.equal(refused.status, 400, await refused.clone().text());
  assert.equal((await refused.json()).code, "project_not_registered");
  assert.equal(hasActiveChatRun(sessionId), false, "setup failure cannot leave a phantom run");
  const accepted = await send("Corrected project");
  assert.equal(accepted.status, 200, await accepted.clone().text());
  await accepted.text();
});
