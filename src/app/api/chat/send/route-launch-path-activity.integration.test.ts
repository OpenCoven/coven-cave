// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// #5763 capability matrix, criteria 2, 5 and 7, through the real send route.
// Each launch path must report the honest adapter activity it actually has
// (`runtimeIdentity.activity`), and every path the route refuses must refuse
// before any runtime process starts. The sibling harness-routing-*.test.ts
// files only regex-match route.ts for these boundaries; this file runs them.
// Every runtime here is a deterministic stand-in; no provider turn is made.
const root = path.join(process.cwd(), ".flow-validation-tmp", `launch-path-activity-${process.pid}`);
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
const sessionFrames = (session: string) => [
  { type: "system", subtype: "init", session_id: session },
  { type: "assistant", message: { content: [{ type: "text", text: "Fixture answer" }] }, session_id: session },
  { type: "result", subtype: "success", is_error: false, session_id: session },
];
for (const name of ["coven", "claude", "codex", "hermes", "opencode", "grok", "openclaw", "ssh"]) {
  const fixture = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const name = ${JSON.stringify(name)};
const frames = ${JSON.stringify(sessionFrames("fixture-native-session"))};
if (args.includes("--version")) {
  console.log(name === "claude" ? "2.1.300 (Claude Code)" : name === "codex" ? "codex-cli 0.164.0" : name === "opencode" ? "1.2.3" : "1.0.0");
  process.exit(0);
}
if (name === "claude" && args.includes("--help")) {
  console.log("  --output-format <format>  Output format (choices: \\"text\\", \\"json\\", \\"stream-json\\")\\n  --model <model>  Model for the current session");
  process.exit(0);
}
if (name === "codex" && args.includes("--help")) {
  console.log("--json\\nresume\\n--model\\n--sandbox\\n--add-dir\\n--skip-git-repo-check\\n--color");
  process.exit(0);
}
if (name === "opencode" && args.includes("--help")) {
  console.log("  --format <format>  Output format: text, json\\n  --model <model> Model to use\\n  --session <id> Session to continue");
  process.exit(0);
}
if (args.includes("--help")) { console.log("--model --add-dir --permission"); process.exit(0); }
if (name === "coven" && args[0] === "adapter" && args[1] === "list") {
  console.log(JSON.stringify([{ id: "codex", executable: "codex", available: true }, { id: "claude", executable: "claude", available: true }]));
  process.exit(0);
}
if (name === "coven" && args[0] !== "run") { console.log("[]"); process.exit(0); }
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ name, args }) + "\\n");
if (name === "hermes") {
  console.error("session_id: fixture-native-session");
  console.log("Fixture answer");
} else {
  for (const frame of frames) console.log(JSON.stringify(frame));
}
`;
  if (process.platform === "win32") {
    await writeFile(path.join(bin, `${name}.cjs`), fixture);
    await writeFile(executablePath(name), `"node" "%~dp0\\${name}.cjs" %*\r\n`);
  } else {
    await writeFile(executablePath(name), fixture, { mode: 0o755 });
  }
}
await writeFile(path.join(root, "familiars.toml"), '[[familiar]]\nid = "claw"\nopenclaw_agent = "main"\n');

const { refreshCovenBin, refreshCovenSpawnEnv } = await import("@/lib/coven-bin");
refreshCovenBin();
refreshCovenSpawnEnv();
const { POST } = await import("./route.ts");
const { saveConfig } = await import("@/lib/cave-config");
const { createProject } = await import("@/lib/cave-projects");
const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
const { loadConversation } = await import("@/lib/cave-conversations");

const familiars = {
  sage: { harness: "claude", model: "" },
  cody: { harness: "codex", model: "" },
  herm: { harness: "hermes", model: "" },
  opal: { harness: "opencode", model: "" },
  grokky: { harness: "grok", model: "" },
  claw: { harness: "openclaw", model: "" },
  remote: { harness: "claude", model: "", runtime: { kind: "ssh", host: "fixture-host", cwd: "/remote/project", command: "coven" } },
  remoteGrok: { harness: "grok", model: "", runtime: { kind: "ssh", host: "fixture-host", cwd: "/remote/project", command: "coven" } },
  remoteClaw: { harness: "openclaw", model: "", runtime: { kind: "ssh", host: "fixture-host", cwd: "/remote/project", command: "coven" } },
};
await saveConfig({ familiars });
const project = await createProject({ name: "Launch path activity", root: workspace });
for (const familiarId of Object.keys(familiars)) {
  await grantProjectToFamiliar({ familiarId, projectId: project.id, source: "human", access: "write" });
}

const calls = async () => {
  try {
    return (await readFile(callsPath, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) as Array<{ name: string; args: string[] }>;
  } catch {
    return [];
  }
};
const send = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/chat/send", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ projectRoot: workspace, prompt: "Describe the fixture", ...body }),
}));
const readSse = async (response: Response) => {
  const text = await response.text();
  const events = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  const done = events.findLast((event) => event.kind === "done");
  assert.ok(done, text);
  assert.notEqual(done.isError, true, text);
  return { text, events, done };
};

test.after(async () => {
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  await rm(root, { recursive: true, force: true });
});

test("Claude on the local Coven relay reports tools from its trusted profile and reasoning unknown", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "sage" });
  assert.equal(response.status, 200, await response.clone().text());
  const { events, done } = await readSse(response);
  const identity = done.responseMetadata?.runtimeIdentity;
  assert.deepEqual(identity?.activity, { schemaVersion: 1, path: "coven", tools: "supported", reasoning: "unknown" },
    "a compatible stream-json profile admits tool details, but no descriptor classifies Claude thinking");
  assert.equal(identity?.harness, "claude");
  assert.equal(identity?.version, "2.1.300", "the probed CLI version travels with the launch identity");
  assert.equal(identity?.model, null, "a launch identity never guesses the served model");
  assert.match(done.responseMetadata?.runtime, /^local:/);
  assert.equal(events.filter((event) => event.kind === "reasoning").length, 0, "no reasoning block is manufactured for a text-only turn");
  const launched = (await calls()).slice(before);
  assert.deepEqual(launched.map((call) => call.name), ["coven"]);
  assert.equal(launched[0].args[0], "run");
  assert.equal(launched[0].args[1], "claude");
  assert.ok(launched[0].args.includes("--stream-json"));
  const saved = await loadConversation(done.sessionId);
  assert.deepEqual(saved?.turns.at(-1)?.responseMetadata?.runtimeIdentity, identity, "history keeps the same honest activity state");
});

test("Codex with an unadmitted version stays on the Coven relay and reports unknown activity once", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "cody" });
  assert.equal(response.status, 200, await response.clone().text());
  const { events, done } = await readSse(response);
  const identity = done.responseMetadata?.runtimeIdentity;
  assert.deepEqual(identity?.activity, { schemaVersion: 1, path: "coven", tools: "unknown", reasoning: "unknown" },
    "the generic transport cannot borrow the direct JSONL schema's tool or reasoning contract");
  assert.equal(identity?.version, null, "an unadmitted direct probe is not launch-version evidence on the relay");
  const notices = events.filter((event) => event.kind === "progress" && event.id === "codex-compatibility");
  assert.equal(notices.length, 1, "exactly one compatibility notice");
  assert.equal(notices[0].status, "notice");
  assert.equal(notices[0].detail, "unsupported-version");
  assert.ok(events.some((event) => event.kind === "assistant_chunk" && event.text.includes("Fixture answer")), "plain chat survives the fallback");
  const launched = (await calls()).slice(before);
  assert.deepEqual(launched.map((call) => [call.name, call.args[0], call.args[1]]), [["coven", "run", "codex"]],
    "the 0.164.0 CLI is probed but never launched directly");
});

test("Hermes on the direct CLI without a Responses endpoint reports tools and reasoning unsupported", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "herm" });
  assert.equal(response.status, 200, await response.clone().text());
  const { done } = await readSse(response);
  assert.deepEqual(done.responseMetadata?.runtimeIdentity?.activity, { schemaVersion: 1, path: "direct", tools: "unsupported", reasoning: "unsupported" },
    "the quiet CLI mode hides tool previews, so Cave says so instead of showing nothing");
  const launched = (await calls()).slice(before);
  assert.deepEqual(launched.map((call) => call.name), ["hermes"]);
});

test("the SSH relay reports every activity detail as unverified and never a local version", { skip: process.platform === "win32" }, async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "remote" });
  assert.equal(response.status, 200, await response.clone().text());
  const { done } = await readSse(response);
  const identity = done.responseMetadata?.runtimeIdentity;
  assert.deepEqual(identity?.activity, { schemaVersion: 1, path: "ssh", tools: "unknown", reasoning: "unknown" },
    "an SSH relay cannot borrow a local schema or local hook contract");
  assert.equal(identity?.version, null, "the local Claude probe is not the remote host's version");
  assert.equal(done.responseMetadata?.runtime, "ssh:fixture-host:/remote/project");
  const launched = (await calls()).slice(before);
  assert.deepEqual(launched.map((call) => call.name), ["ssh"], "only the ssh transport runs; no local runtime starts");
});

test("read-only over SSH is refused before launch because the relay cannot forward the flag", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "remote", permissionMode: "read" });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.code, "read_only_unavailable");
  assert.equal((await calls()).length, before, "no ssh or runtime process starts");
});

test("Grok over SSH is refused with 501 before any process starts", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "remoteGrok" });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /SSH Grok is not routed through coven run/);
  assert.equal((await calls()).length, before);
});

test("OpenClaw over SSH is refused with 501 before any process starts", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "remoteClaw" });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /OpenClaw SSH runtime is not supported yet/);
  assert.equal((await calls()).length, before);
});

test("OpenCode read-only is refused with 501 before its capability probe or launch", async () => {
  const before = (await calls()).length;
  const response = await send({ familiarId: "opal", permissionMode: "read" });
  assert.equal(response.status, 501);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /OpenCode does not support Cave's Read-only mode yet/);
  assert.equal((await calls()).length, before, "refusal happens before the opencode shim is ever executed");
});
