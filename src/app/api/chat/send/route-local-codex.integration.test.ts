// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Codex local mode through the real send route (#6049). The local preflight
// refuses before anything spawns, and a ready turn runs `coven run
// codex-ollama` with Cave's scaffolded manifest: never `coven run codex`,
// which would reach a cloud model.
const home = await mkdtemp(path.join(homedir(), "cave-local-codex-"));
const bin = path.join(home, "bin");
const familiarWorkspace = path.join(home, "familiars", "opal");
const log = path.join(home, "coven-calls.jsonl");
await mkdir(bin, { recursive: true });
await mkdir(familiarWorkspace, { recursive: true });

const saved = Object.fromEntries(["COVEN_HOME", "COVEN_CAVE_HOME", "COVEN_BIN", "COVEN_TEST_LOG", "CODEX_BIN", "CAVE_OLLAMA_URL", "CODEX_OSS_BASE_URL", "CODEX_OSS_PORT"].map((key) => [key, process.env[key]]));
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
process.env.COVEN_TEST_LOG = log;
delete process.env.CAVE_OLLAMA_URL;

// Keep Cave's direct Codex transport off deterministically (as the sibling
// Codex availability test does), so the turn takes the Coven path.
const pinnedCodex = path.join(bin, process.platform === "win32" ? "codex-no-exec.cmd" : "codex-no-exec");
await writeFile(pinnedCodex, process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n", { mode: 0o644 });
process.env.CODEX_BIN = pinnedCodex;

const shim = [
  "const { appendFileSync } = require('node:fs');",
  "appendFileSync(process.env.COVEN_TEST_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);",
  "if (process.argv[2] === 'adapter' && process.argv[3] === 'list' && process.argv[4] === '--json') {",
  "  process.stdout.write(JSON.stringify([{ id: 'codex-ollama', executable: 'codex', available: true }]));",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === '--help') {",
  "  process.stdout.write('  --model <model>  Forward a provider model id\\n  --permission <permission>  Sandbox\\n');",
  "  process.exit(0);",
  "}",
  "if (process.argv[2] === 'run' && process.argv[3] === 'codex-ollama') {",
  "  appendFileSync(process.env.COVEN_TEST_LOG + '.env', `${JSON.stringify({ base: process.env.CODEX_OSS_BASE_URL ?? null, port: process.env.CODEX_OSS_PORT ?? null })}\\n`);",
  "  const session = 'local-session';",
  "  const events = [",
  "    { type: 'system', subtype: 'init', model: 'ollama/qwen3:8b', session_id: session },",
  "    { type: 'assistant', message: { content: [{ type: 'text', text: 'Local answer.' }] }, session_id: session },",
  "    { type: 'result', subtype: 'success', is_error: false, session_id: session },",
  "  ];",
  "  process.stdout.write(events.map((event) => JSON.stringify(event)).join('\\n') + '\\n');",
  "  process.exit(0);",
  "}",
  "process.stdout.write('unsupported harness');",
  "process.exit(1);",
].join("\n");
const shimScript = path.join(bin, "coven.js");
await writeFile(shimScript, shim, { mode: 0o755 });
if (process.platform === "win32") {
  const shimBatch = path.join(bin, "coven.cmd");
  await writeFile(shimBatch, '"%~dp0\\coven.js" %*\r\n');
  process.env.COVEN_BIN = shimBatch;
} else {
  const shimExecutable = path.join(bin, "coven");
  await writeFile(shimExecutable, `#!/usr/bin/env node\n${shim}`, { mode: 0o755 });
  process.env.COVEN_BIN = shimExecutable;
}

// A fake Ollama on the default endpoint and on 11500. `server` switches what it answers.
let server = "down";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("http://127.0.0.1:11434/") && !url.startsWith("http://127.0.0.1:11500/")) return realFetch(input, init);
  if (server === "down") throw new TypeError("fetch failed");
  const json = (value) => ({ ok: true, status: 200, json: async () => value });
  if (url.endsWith("/api/version")) return json({ version: "0.21.0" });
  if (url.endsWith("/api/tags")) return json({ models: server === "ready" ? [{ name: "qwen3:8b" }] : [{ name: "llama2:7b" }] });
  if (url.endsWith("/api/show")) {
    const model = JSON.parse(String(init?.body)).model;
    return json(model === "qwen3:8b"
      ? { capabilities: ["completion", "tools"], model_info: { "qwen3.context_length": 40960 } }
      : { capabilities: ["completion"], model_info: {} });
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const runCalls = async () => (await readFile(log, "utf8").catch(() => ""))
  .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  .filter((args) => args[0] === "run" && args[1] !== "--help");

try {
  const { refreshCovenBin } = await import("@/lib/coven-bin");
  refreshCovenBin();
  const { saveConfig } = await import("@/lib/cave-config");
  const { createProject } = await import("@/lib/cave-projects");
  const { grantProjectToFamiliar } = await import("@/lib/project-permissions");
  const { clearLocalCodexProbeCache } = await import("@/lib/server/local-codex-backends");
  const { POST } = await import("./route.ts");
  await saveConfig({ familiars: { opal: { harness: "codex-ollama" } } });
  const project = await createProject({ name: "Local Codex fixture", root: familiarWorkspace });
  await grantProjectToFamiliar({ familiarId: "opal", projectId: project.id, source: "human", access: "write" });
  const send = (body) => POST(new Request("http://localhost/api/chat/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ familiarId: "opal", prompt: "hello", projectRoot: familiarWorkspace, ...body }),
  }));

  // No model chosen: a local session never picks one, and never a cloud one.
  clearLocalCodexProbeCache();
  let response = await send({});
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "local_model_unselected");

  // The server is down: say how to start it.
  clearLocalCodexProbeCache();
  response = await send({ modelOverride: "ollama/qwen3:8b", modelOverrideScope: "next-message" });
  assert.equal(response.status, 409);
  const down = await response.json();
  assert.equal(down.code, "local_server_unreachable");
  assert.match(down.error, /Ollama isn't reachable at http:\/\/127\.0\.0\.1:11434\. Start Ollama/);

  // The server is up without the model: say how to add it.
  server = "no-model";
  clearLocalCodexProbeCache();
  response = await send({ modelOverride: "ollama/qwen3:8b", modelOverrideScope: "next-message" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "local_model_missing");
  assert.deepEqual(await runCalls(), [], "no refusal ever starts a model process");

  // Ready: the turn runs the local adapter through Coven, with the manifest Cave scaffolded.
  // An address inherited from Cave's own environment must not redirect it.
  server = "ready";
  process.env.CODEX_OSS_BASE_URL = "http://elsewhere.example:9/v1";
  process.env.CODEX_OSS_PORT = "9";
  clearLocalCodexProbeCache();
  response = await send({ modelOverride: "ollama/qwen3:8b", modelOverrideScope: "next-message" });
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  assert.ok(!events.some((event) => event.kind === "error"), JSON.stringify(events.filter((event) => event.kind === "error")));
  const runs = await runCalls();
  assert.equal(runs.length, 1);
  assert.equal(runs[0][1], "codex-ollama", "the local adapter runs, never the cloud `codex` harness");
  assert.ok(runs[0].includes("--model") && runs[0][runs[0].indexOf("--model") + 1] === "ollama/qwen3:8b");
  const manifest = JSON.parse(await readFile(path.join(home, "adapters", "codex-ollama.json"), "utf8"));
  assert.deepEqual(manifest.adapters[0].non_interactive_prompt_prefix_args, [
    "exec", "--skip-git-repo-check", "--color", "never", "--config", 'web_search="disabled"', "--config", 'model_provider="ollama"',
  ]);
  const spawnEnvs = async () => (await readFile(`${log}.env`, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(await spawnEnvs(), [{ base: null, port: null }], "a default-endpoint turn clears an inherited server address");

  // A custom address saved in Settings reaches Codex through `coven run`.
  const { writeLocalModelSettings } = await import("@/lib/server/local-models-settings");
  await writeLocalModelSettings({ endpoints: { ollama: "http://127.0.0.1:11500" }, allowRemote: false });
  clearLocalCodexProbeCache();
  response = await send({ modelOverride: "ollama/qwen3:8b", modelOverrideScope: "next-message" });
  assert.equal(response.status, 200, await response.clone().text());
  await response.text();
  assert.equal((await runCalls()).at(-1)[1], "codex-ollama");
  assert.deepEqual((await spawnEnvs()).at(-1), { base: "http://127.0.0.1:11500/v1", port: null });
} finally {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(home, { recursive: true, force: true });
}
