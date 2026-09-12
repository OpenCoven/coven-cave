import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";

const root = path.join(process.cwd(), ".flow-validation-tmp", `flow-readonly-${process.pid}`);
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
process.env.CODEX_BIN = executablePath("codex");
process.env.HERMES_BIN = executablePath("hermes");
process.env.OPENCLAW_BIN = executablePath("openclaw");
delete process.env.HERMES_API_URL;
delete process.env.HERMES_API_KEY;
delete process.env.OPENCLAW_GATEWAY_DISPATCH;
delete process.env.COVEN_SOCKET;
const callsPath = path.join(root, "calls.jsonl");
for (const name of ["coven", "hermes", "copilot", "openclaw", "claude", "opencode", "codex", "ssh"]) {
  const fixture = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const name = ${JSON.stringify(name)};
if (args.includes("--version")) { console.log(name === "copilot" ? "1.0.70" : name === "opencode" ? "1.2.3" : name === "codex" ? "codex-cli 0.145.0" : "1.0.0"); process.exit(0); }
if (name === "codex" && args.includes("--help")) {
  console.log("--json\\nresume\\n--model\\n--sandbox\\n--add-dir\\n--skip-git-repo-check\\n--color");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log(name === "opencode" ? "  --format <format>  Output format: text, json\\n  --model <model> Model to use\\n  --session <id> Session to continue" : "--model --add-dir --permission");
  process.exit(0);
}
if (name === "coven" && args[0] !== "run") { console.log("[]"); process.exit(0); }
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ name, args }) + "\\n");
const id = args[args.indexOf("--session-id") + 1] || "fresh-native-N";
if (name === "opencode") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => {
    appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ name, args, input }) + "\\n");
    console.log(JSON.stringify({ type: "text", sessionID: "fresh-native-N", part: { type: "text", text: "Discussion answer" } }));
  });
} else if (name === "codex") {
  console.log(JSON.stringify({ type: "thread.started", thread_id: "fresh-native-N" }));
  console.log(JSON.stringify({ type: "item.completed", item: { id: "answer", type: "agent_message", text: "Discussion answer" } }));
} else if (name === "hermes") {
  console.error("session_id: fresh-native-N");
  console.log("Discussion answer");
} else if (name === "openclaw") {
  console.log(JSON.stringify({ result: { payloads: [{ text: "Discussion answer" }] } }));
} else if (name === "copilot") {
  console.log(JSON.stringify({ type: "assistant.message", data: { messageId: "a", content: "Discussion answer" } }));
  console.log(JSON.stringify({ type: "result", sessionId: id, exitCode: 0, usage: { sessionDurationMs: 1 } }));
} else {
  console.log(JSON.stringify({ type: "system", session_id: "fresh-native-N" }));
  console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Discussion answer" }] } }));
  console.log(JSON.stringify({ type: "result", is_error: false, duration_ms: 1 }));
}
`;
  if (process.platform === "win32") {
    await writeFile(path.join(bin, `${name}.cjs`), fixture);
    await writeFile(executablePath(name), `"node" "%~dp0\\${name}.cjs" %*\r\n`);
  } else {
    await writeFile(executablePath(name), fixture, { mode: 0o755 });
  }
}
await writeFile(path.join(root, "familiars.toml"), '[[familiar]]\nid = "cody"\nopenclaw_agent = "main"\n');
const { POST } = await import("./route.ts");
const { saveConversation, loadConversation } = await import("../../../../lib/cave-conversations.ts");
const { recordFlowRun } = await import("../../../../lib/server/flow-store.ts");
const { saveConfig } = await import("../../../../lib/cave-config.ts");
const { createProject } = await import("../../../../lib/cave-projects.ts");
const { grantProjectToFamiliar } = await import("../../../../lib/project-permissions.ts");
await saveConfig({ familiars: { cody: { harness: "hermes", model: "" } } });
const project = await createProject({ name: "Discussion transport", root: workspace });
await grantProjectToFamiliar({ familiarId: "cody", projectId: project.id, source: "human", access: "write" });

test.after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(root, { recursive: true, force: true });
});

for (const harness of ["hermes", "claude", "copilot", "openclaw", "opencode", "codex"]) {
  test(`${harness} discussion sends context once and resumes the new native identity`, async () => {
    const sessionId = `discussion-${harness}`;
    const now = new Date().toISOString();
    await saveConversation({
      sessionId, familiarId: "cody", harness, origin: "chat",
      flowDiscussion: { sessionId: "source-execution", flowId: "flow", runId: "run" },
      createdAt: now, updatedAt: now,
      turns: [{ id: "seed", role: "assistant", text: "Seeded Flow evidence: teal comet", createdAt: now }],
      activeLeafId: "seed",
    });
    const send = async (prompt: string) => {
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "cody", sessionId, projectRoot: workspace, prompt }),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      const events = (await response.text()).split("\n")
        .filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
      assert.notEqual(events.findLast((event) => event.kind === "done")?.isError, true, JSON.stringify(events));
      assert.equal(events.findLast((event) => event.kind === "done")?.sessionId, sessionId);
      assert.ok(events.filter((event) => event.kind === "session").every((event) => event.sessionId === sessionId));
      return (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).at(-1) as { args: string[]; input?: string };
    };
    const first = await send("Explain the teal evidence");
    const promptFlag = harness === "hermes" ? "--query" : harness === "openclaw" ? "--message" : harness === "copilot" ? "-p" : "--";
    const firstPrompt = first.input ?? first.args[first.args.indexOf(promptFlag) + 1];
    assert.match(firstPrompt, /Seeded Flow evidence: teal comet/);
    assert.equal(firstPrompt.split("Explain the teal evidence").length - 1, 1);
    assert.ok(!first.args.includes("--resume") && !first.args.includes("resume") && !first.args.includes("--continue") && !first.args.includes("--session"));
    const saved = await loadConversation(sessionId);
    assert.equal(saved?.turns.length, 3);
    assert.equal(saved?.turns[1].text, "Explain the teal evidence");
    assert.equal(saved?.origin, "chat");
    assert.ok(saved?.harnessSessionId);
    assert.notEqual(saved.harnessSessionId, sessionId, "Cave ID must not masquerade as native ID");
    if (harness === "hermes" || harness === "claude") assert.equal(saved.harnessSessionId, "fresh-native-N");
    const second = await send("Now continue the discussion");
    assert.doesNotMatch(second.input ?? second.args[second.args.indexOf(promptFlag) + 1], /Seeded Flow evidence/);
    if (harness !== "openclaw") {
      const resumeFlag = harness === "claude" ? "--continue" : harness === "opencode" ? "--session" : harness === "codex" ? "resume" : "--resume";
      assert.equal(second.args[second.args.indexOf(resumeFlag) + 1], saved.harnessSessionId);
    }
    assert.equal((await loadConversation(sessionId))?.turns.length, 5);
    assert.equal(await loadConversation("fresh-native-N"), null, "native identity never creates another Cave chat");
  });
}

test("Hermes API discussion replays once and retains the Responses identity", async () => {
  const requests: Array<{ input: string; previous_response_id?: string }> = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end([
      'event: response.output_text.delta\ndata: {"delta":"API discussion answer"}\n\n',
      `event: response.completed\ndata: {"response":{"id":"resp-${requests.length}"}}\n\n`,
    ].join(""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.HERMES_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.HERMES_API_KEY = "local-fixture-key";
  const { refreshCovenSpawnEnv } = await import("../../../../lib/coven-bin.ts");
  refreshCovenSpawnEnv();
  try {
    const sessionId = "discussion-api";
    const now = new Date().toISOString();
    await saveConversation({
      sessionId, familiarId: "cody", harness: "hermes", origin: "chat",
      flowDiscussion: { sessionId: "source-execution", flowId: "flow", runId: "run" },
      createdAt: now, updatedAt: now,
      turns: [{ id: "seed", role: "assistant", text: "API seed context", createdAt: now }],
      activeLeafId: "seed",
    });
    for (const prompt of ["First API question", "Second API question"]) {
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "cody", sessionId, projectRoot: workspace, prompt }),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(await response.text(), /API discussion answer/);
    }
    assert.equal(requests.length, 2);
    assert.match(requests[0].input, /API seed context/);
    assert.equal(requests[0].input.split("First API question").length - 1, 1);
    assert.equal(requests[0].previous_response_id, undefined);
    assert.doesNotMatch(requests[1].input, /API seed context|First API question/);
    assert.equal(requests[1].previous_response_id, "resp-1");
    assert.equal((await loadConversation(sessionId))?.harnessSessionId, "resp-2");
    assert.equal((await loadConversation(sessionId))?.turns.length, 5);
  } finally {
    delete process.env.HERMES_API_URL;
    delete process.env.HERMES_API_KEY;
    refreshCovenSpawnEnv();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("SSH discussion uses a fresh remote execution and keeps its Cave identity", { skip: process.platform === "win32" }, async () => {
  await saveConfig({ familiars: { cody: {
    harness: "claude", model: "",
    runtime: { kind: "ssh", host: "discussion-host", cwd: "/remote/project", command: "coven" },
  } } });
  const sessionId = "discussion-ssh";
  const now = new Date().toISOString();
  await saveConversation({
    sessionId, familiarId: "cody", harness: "claude", origin: "chat",
    flowDiscussion: { sessionId: "source-execution", flowId: "flow", runId: "run" },
    updatedAt: now,
    turns: [{ id: "seed", role: "assistant", text: "SSH seed context", createdAt: now }],
    activeLeafId: "seed",
  });
  try {
    for (const prompt of ["First remote question", "Second remote question"]) {
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "cody", sessionId, projectRoot: workspace, prompt }),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(await response.text(), /Discussion answer/);
    }
    const calls = (await readFile(callsPath, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line)).filter((call) => call.name === "ssh");
    assert.equal(calls.length, 2);
    assert.match(calls[0].args.at(-1), /SSH seed context/);
    assert.doesNotMatch(calls[0].args.at(-1), /--continue/);
    assert.equal(calls[0].args.at(-1).split("First remote question").length - 1, 1);
    assert.doesNotMatch(calls[1].args.at(-1), /SSH seed context/);
    assert.match(calls[1].args.at(-1), /'--continue' 'fresh-native-N'/);
    assert.equal((await loadConversation(sessionId))?.harnessSessionId, "fresh-native-N");
  } finally {
    await saveConfig({ familiars: { cody: { harness: "hermes", model: "", runtime: { kind: "local" } } } });
  }
});

test("a discussion still requires ordinary project grants before launching", async () => {
  const deniedRoot = path.join(root, "ungranted");
  await mkdir(deniedRoot);
  await createProject({ name: "Not granted", root: deniedRoot });
  const now = new Date().toISOString();
  await saveConversation({
    sessionId: "discussion-denied", familiarId: "cody", harness: "hermes", origin: "chat",
    flowDiscussion: { sessionId: "source-execution", flowId: "flow", runId: "run" },
    updatedAt: now, turns: [{ id: "seed", role: "assistant", text: "seed", createdAt: now }],
  });
  const callsBefore = await readFile(callsPath, "utf8");
  const response = await POST(new Request("http://localhost/api/chat/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "cody", sessionId: "discussion-denied", projectRoot: deniedRoot, prompt: "Do not run" }),
  }));
  assert.equal(response.status, 403);
  assert.equal(await readFile(callsPath, "utf8"), callsBefore);
  assert.equal((await loadConversation("discussion-denied"))?.harnessSessionId, undefined);
});

test("Chat cannot append to a Flow execution, including exact legacy links", async () => {
    for (const [sessionId, origin] of [["execution", "flow"], ["legacy", undefined]] as const) {
      await saveConversation({
        sessionId, familiarId: "cody", harness: "copilot", origin,
        updatedAt: new Date().toISOString(), turns: [],
      });
      if (!origin) await recordFlowRun({
        flowId: "flow", sessionId, source: "cave", status: "running",
        steps: [], startedAt: new Date().toISOString(),
      });
      const response = await POST(new Request("http://localhost/api/chat/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: "cody", sessionId, prompt: "Continue here" }),
      }));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "flow_session_read_only");
      assert.equal((await loadConversation(sessionId))?.turns.length, 0);
    }
});
