import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { LOCAL_CODEX_BACKENDS } from "../local-codex.ts";
import {
  applyLocalCodexSpawnEnv,
  applyLocalModelsSettingsPatch,
  clearLocalCodexProbeCache,
  localModelsAllowRemote,
  preflightLocalCodex,
  probeLocalCodexBackend,
  readLocalModelsStatus,
  resolveLocalCodexEndpoint,
} from "./local-codex-backends.ts";
import { EMPTY_LOCAL_MODEL_SETTINGS, type LocalModelSettings } from "./local-models-settings.ts";
import type { LmsRunner } from "./lmstudio-devices.ts";

// Probes read saved Settings when none are passed; keep that read off the
// real Cave home.
const scratchHome = mkdtempSync(path.join(tmpdir(), "cave-local-models-"));
const savedCaveHome = process.env.COVEN_CAVE_HOME;
process.env.COVEN_CAVE_HOME = scratchHome;
after(() => {
  if (savedCaveHome === undefined) delete process.env.COVEN_CAVE_HOME;
  else process.env.COVEN_CAVE_HOME = savedCaveHome;
  rmSync(scratchHome, { recursive: true, force: true });
});

const ollama = LOCAL_CODEX_BACKENDS["codex-ollama"];
const lmstudio = LOCAL_CODEX_BACKENDS["codex-lmstudio"];

// `lms` as LM Studio 0.4.21 answers with LM Link online (ids and names
// anonymized). Tests never run the real CLI.
const PEER = "7c1972de0a025c8b753be245afd32df2";
function lmsWith(answers: Record<string, unknown>): LmsRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return Object.assign(async (args: string[]) => {
    calls.push(args);
    const answer = answers[args.join(" ")];
    return answer === undefined ? null : JSON.stringify(answer);
  }, { calls });
}
const linkedLms = () => lmsWith({
  "ls --json": [
    { modelKey: "plain-llm", deviceIdentifier: null },
    { modelKey: "qwen3-8b", deviceIdentifier: null },
    { modelKey: "qwen/qwen3.8-27b", deviceIdentifier: PEER, path: `${PEER}:qwen/qwen3.8-27b` },
  ],
  "link status --json": { status: "online", deviceIdentifier: "5acdfe12b91ff9ecbf75fe9da278b652", peers: [{ deviceIdentifier: PEER, deviceName: "studio-mac.local" }] },
});
const noLms: LmsRunner = async () => null;

type Route = (init?: RequestInit) => { status?: number; json: unknown } | Error;
function server(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    const answer = route(init);
    if (answer instanceof Error) throw answer;
    return { ok: (answer.status ?? 200) < 400, status: answer.status ?? 200, json: async () => answer.json } as Response;
  };
  return { calls, fetchImpl };
}

// Shapes recorded from Ollama 0.21.0 with qwen3:8b and nomic-embed-text pulled.
const ollamaRoutes = (extra: Record<string, Route> = {}) => ({
  "http://127.0.0.1:11434/api/version": () => ({ json: { version: "0.21.0" } }),
  "http://127.0.0.1:11434/api/tags": () => ({ json: { models: [{ name: "qwen3:8b" }, { name: "nomic-embed-text:latest" }, { name: "llama2:7b" }] } }),
  "http://127.0.0.1:11434/api/show": (init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model;
    if (model === "qwen3:8b") return { json: { capabilities: ["completion", "tools", "thinking"], model_info: { "qwen3.context_length": 40960 } } };
    if (model === "llama2:7b") return { json: { capabilities: ["completion"], model_info: { "llama.context_length": 4096 } } };
    return { json: { capabilities: ["embedding"], model_info: {} } };
  },
  ...extra,
});

test("Ollama: chat models with their tool support and context; embedding models are not choices", async () => {
  clearLocalCodexProbeCache();
  const { fetchImpl } = server(ollamaRoutes());
  const probe = await probeLocalCodexBackend(ollama, { env: {}, fetchImpl });
  assert.deepEqual(probe, {
    kind: "available", endpoint: "http://127.0.0.1:11434", version: "0.21.0",
    models: [
      { name: "llama2:7b", tools: false, contextLength: 4096 },
      { name: "qwen3:8b", tools: true, contextLength: 40960 },
    ],
    deviceCheck: "not-needed",
  });
});

test("an Ollama cloud model is listed as cloud and never runs locally, whatever the remote permission", async () => {
  // Shapes recorded from Ollama 0.40.6 after `ollama pull gpt-oss:20b-cloud`:
  // /api/tags carries remote_host, /api/show doesn't.
  const routes = ollamaRoutes({
    "http://127.0.0.1:11434/api/tags": () => ({ json: { models: [
      { name: "gpt-oss:20b-cloud", remote_model: "gpt-oss:20b", remote_host: "https://ollama.com" },
      { name: "qwen3:8b" },
    ] } }),
    "http://127.0.0.1:11434/api/show": (init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model;
      if (model === "gpt-oss:20b-cloud") return { json: { capabilities: ["completion", "tools", "thinking"], model_info: { "gptoss.context_length": 131072 } } };
      return { json: { capabilities: ["completion", "tools"], model_info: { "qwen3.context_length": 40960 } } };
    },
  });
  clearLocalCodexProbeCache();
  const { fetchImpl } = server(routes);
  const probe = await probeLocalCodexBackend(ollama, { env: {}, fetchImpl });
  assert.ok(probe.kind === "available");
  assert.deepEqual(probe.models, [
    { name: "gpt-oss:20b-cloud", tools: true, contextLength: 131072, cloud: { host: "ollama.com" } },
    { name: "qwen3:8b", tools: true, contextLength: 40960 },
  ]);
  for (const allowRemote of [false, true]) {
    clearLocalCodexProbeCache();
    const refused = await preflightLocalCodex("codex-ollama", "ollama/gpt-oss:20b-cloud", { env: {}, fetchImpl, settings: { endpoints: {}, allowRemote } });
    assert.deepEqual(refused, {
      ok: false, code: "local_model_cloud",
      message: "gpt-oss:20b-cloud is an Ollama cloud model: it runs on ollama.com, not on this computer. Codex · Ollama runs only models on your computers. Choose a model Ollama runs locally.",
    }, `refused with allowRemote=${allowRemote}`);
  }
  clearLocalCodexProbeCache();
  const local = await preflightLocalCodex("codex-ollama", "ollama/qwen3:8b", { env: {}, fetchImpl, settings: EMPTY_LOCAL_MODEL_SETTINGS });
  assert.equal(local?.ok, true, "a local model on the same server runs as before");
});

test("LM Studio: llm and vlm models with tool_use; embeddings left out", async () => {
  clearLocalCodexProbeCache();
  // Shape recorded from LM Studio 0.4.21's /api/v0/models.
  const { fetchImpl } = server({
    "http://127.0.0.1:1234/api/v0/models": () => ({ json: { data: [
      { id: "qwen/qwen3.8-27b", type: "vlm", state: "loaded", capabilities: ["tool_use"], max_context_length: 262144 },
      { id: "qwen3-8b", type: "llm", state: "not-loaded", capabilities: ["tool_use"], max_context_length: 40960 },
      { id: "text-embedding-nomic-embed-text-v1.5", type: "embeddings", state: "not-loaded", max_context_length: 2048 },
      { id: "plain-llm", type: "llm", state: "not-loaded", max_context_length: 8192 },
    ] } }),
  });
  const lms = linkedLms();
  const probe = await probeLocalCodexBackend(lmstudio, { env: {}, fetchImpl, lms });
  assert.deepEqual(probe, {
    kind: "available", endpoint: "http://127.0.0.1:1234", version: null,
    models: [
      { name: "plain-llm", tools: false, contextLength: 8192 },
      { name: "qwen/qwen3.8-27b", tools: true, contextLength: 262144, lmLink: { deviceName: "studio-mac.local" } },
      { name: "qwen3-8b", tools: true, contextLength: 40960 },
    ],
    deviceCheck: "checked",
  }, "LM Link's model is marked with the computer it runs on");

  clearLocalCodexProbeCache();
  const unchecked = await probeLocalCodexBackend(lmstudio, { env: {}, fetchImpl, lms: noLms });
  assert.equal(unchecked.kind === "available" && unchecked.deviceCheck, "unavailable");
  assert.ok(unchecked.kind === "available" && unchecked.models.every((model) => !model.lmLink), "without lms nothing is guessed");
});

test("LM Studio on another computer is gated by its address, so lms isn't asked", async () => {
  clearLocalCodexProbeCache();
  const lms = linkedLms();
  const { fetchImpl } = server({
    "http://gpu-box.lan:1234/api/v0/models": () => ({ json: { data: [{ id: "qwen3-8b", type: "llm", capabilities: ["tool_use"], max_context_length: 40960 }] } }),
  });
  const probe = await probeLocalCodexBackend(lmstudio, { env: { CAVE_LMSTUDIO_URL: "http://gpu-box.lan:1234", CAVE_LOCAL_MODELS_ALLOW_REMOTE: "1" }, fetchImpl, lms });
  assert.equal(probe.kind === "available" && probe.deviceCheck, "not-needed");
  assert.deepEqual(lms.calls, []);
});

test("a model LM Link serves from another computer needs the remote permission", async () => {
  const { fetchImpl } = server({
    "http://127.0.0.1:1234/api/v0/models": () => ({ json: { data: [
      { id: "qwen/qwen3.8-27b", type: "vlm", capabilities: ["tool_use"], max_context_length: 262144 },
      { id: "qwen3-8b", type: "llm", capabilities: ["tool_use"], max_context_length: 40960 },
    ] } }),
  });
  clearLocalCodexProbeCache();
  const refused = await preflightLocalCodex("codex-lmstudio", "lmstudio/qwen/qwen3.8-27b", { env: {}, fetchImpl, lms: linkedLms(), settings: EMPTY_LOCAL_MODEL_SETTINGS });
  assert.deepEqual(refused, {
    ok: false, code: "local_model_other_computer",
    message: "qwen/qwen3.8-27b runs on studio-mac.local through LM Link, not on this computer. To send prompts there, turn on “Allow servers on other computers” in Settings → Local models. Or choose a model on this computer.",
  });
  const local = await preflightLocalCodex("codex-lmstudio", "lmstudio/qwen3-8b", { env: {}, fetchImpl, lms: linkedLms(), settings: EMPTY_LOCAL_MODEL_SETTINGS });
  assert.equal(local?.ok, true, "a model on this computer runs as before");
  clearLocalCodexProbeCache();
  const allowed = await preflightLocalCodex("codex-lmstudio", "lmstudio/qwen/qwen3.8-27b", { env: {}, fetchImpl, lms: linkedLms(), settings: { endpoints: {}, allowRemote: true } });
  assert.equal(allowed?.ok, true, "the Settings permission allows it");
  clearLocalCodexProbeCache();
  const allowedByEnv = await preflightLocalCodex("codex-lmstudio", "lmstudio/qwen/qwen3.8-27b", { env: { CAVE_LOCAL_MODELS_ALLOW_REMOTE: "1" }, fetchImpl, lms: linkedLms(), settings: EMPTY_LOCAL_MODEL_SETTINGS });
  assert.equal(allowedByEnv?.ok, true, "so does the environment");
});

test("a stopped server is unreachable, a foreign one is an invalid response, and failures are cached only briefly", async () => {
  clearLocalCodexProbeCache();
  let now = 1_000;
  const stopped = server({});
  assert.deepEqual(await probeLocalCodexBackend(ollama, { env: {}, fetchImpl: stopped.fetchImpl, now: () => now }), { kind: "unreachable", endpoint: "http://127.0.0.1:11434" });
  now += 3_500;
  const started = server(ollamaRoutes());
  const probe = await probeLocalCodexBackend(ollama, { env: {}, fetchImpl: started.fetchImpl, now: () => now });
  assert.equal(probe.kind, "available", "a failure is re-checked after 3 s");
  clearLocalCodexProbeCache();
  const foreign = server({ "http://127.0.0.1:11434/api/version": () => ({ status: 404, json: {} }) });
  assert.deepEqual(await probeLocalCodexBackend(ollama, { env: {}, fetchImpl: foreign.fetchImpl }), { kind: "invalid-response", endpoint: "http://127.0.0.1:11434" });
});

test("a success is reused for 15 s, so a menu and a turn share one read", async () => {
  clearLocalCodexProbeCache();
  let now = 0;
  const { calls, fetchImpl } = server(ollamaRoutes());
  await probeLocalCodexBackend(ollama, { env: {}, fetchImpl, now: () => now });
  const first = calls.length;
  now += 10_000;
  await probeLocalCodexBackend(ollama, { env: {}, fetchImpl, now: () => now });
  assert.equal(calls.length, first);
  now += 6_000;
  await probeLocalCodexBackend(ollama, { env: {}, fetchImpl, now: () => now });
  assert.ok(calls.length > first);
});

test("endpoints stay on this machine unless a remote server is explicitly allowed", () => {
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, {}), { ok: true, endpoint: "http://127.0.0.1:11434", isDefault: true, source: "default" });
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://localhost:11500/" }), { ok: true, endpoint: "http://localhost:11500", isDefault: false, source: "environment" });
  const remote = resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://gpu-box.lan:11434" });
  assert.equal(remote.ok, false);
  assert.match(remote.ok ? "" : remote.reason, /^CAVE_OLLAMA_URL points at gpu-box\.lan:11434, which isn't this computer\. .*Settings → Local models, or set CAVE_LOCAL_MODELS_ALLOW_REMOTE=1\.$/);
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://gpu-box.lan:11434", CAVE_LOCAL_MODELS_ALLOW_REMOTE: "1" }),
    { ok: true, endpoint: "http://gpu-box.lan:11434", isDefault: false, source: "environment" });
  for (const bad of ["not a url", "ftp://127.0.0.1", "http://user:pw@127.0.0.1:11434", "http://127.0.0.1:11434/v1", "http://127.0.0.1:11434/?x=1"]) {
    assert.equal(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: bad }).ok, false, bad);
  }
});

test("preflight names what to do for every refusal, and never picks a model itself", async () => {
  clearLocalCodexProbeCache();
  const live = server(ollamaRoutes());
  const cases: [string | null, string][] = [
    [null, "local_model_unselected"],
    ["openai/gpt-5.5", "local_model_unselected"],
    ["ollama/mistral:7b", "local_model_missing"],
    ["ollama/llama2:7b", "local_model_no_tools"],
  ];
  for (const [model, code] of cases) {
    const result = await preflightLocalCodex("codex-ollama", model, { env: {}, fetchImpl: live.fetchImpl });
    assert.equal(result?.ok, false, String(model));
    assert.equal(result && !result.ok && result.code, code, String(model));
  }
  const missing = await preflightLocalCodex("codex-ollama", "ollama/mistral:7b", { env: {}, fetchImpl: live.fetchImpl });
  assert.match(missing && !missing.ok ? missing.message : "", /Ollama doesn't have mistral:7b\. Pull a model with tool support, for example `ollama pull qwen3:8b`/);

  clearLocalCodexProbeCache();
  const stopped = await preflightLocalCodex("codex-lmstudio", "lmstudio/qwen3-8b", { env: {}, fetchImpl: server({}).fetchImpl });
  assert.deepEqual(stopped, {
    ok: false, code: "local_server_unreachable",
    message: "LM Studio isn't reachable at http://127.0.0.1:1234. Start LM Studio's server (Developer tab, or run `lms server start`). Then send again.",
  });
  assert.equal(await preflightLocalCodex("codex", "openai/gpt-5.5", { env: {} }), null, "cloud Codex is not a local harness");
});

test("a ready preflight gives the native model and the Codex overrides for this endpoint", async () => {
  clearLocalCodexProbeCache();
  const live = server(ollamaRoutes());
  const ready = await preflightLocalCodex("codex-ollama", "ollama/qwen3:8b", { env: {}, fetchImpl: live.fetchImpl });
  assert.equal(ready?.ok, true);
  if (!ready?.ok) return;
  assert.equal(ready.nativeModel, "qwen3:8b");
  assert.equal(ready.version, "0.21.0");
  assert.deepEqual(ready.configArgs, ["-c", 'web_search="disabled"', "-c", 'model_provider="ollama"']);

  clearLocalCodexProbeCache();
  const custom = server(Object.fromEntries(Object.entries(ollamaRoutes()).map(([url, route]) => [url.replace("127.0.0.1:11434", "localhost:11500"), route])));
  const moved = await preflightLocalCodex("codex-ollama", "ollama/qwen3:8b", { env: { CAVE_OLLAMA_URL: "http://localhost:11500" }, fetchImpl: custom.fetchImpl });
  assert.equal(moved?.ok, true);
  assert.deepEqual(moved?.ok ? moved.configArgs : [], [
    "-c", 'web_search="disabled"',
    "-c", 'model_providers.cave_local.name="Ollama (Cave)"',
    "-c", 'model_providers.cave_local.base_url="http://localhost:11500/v1"',
    "-c", 'model_providers.cave_local.wire_api="responses"',
    "-c", 'model_provider="cave_local"',
  ]);
});

const saved = (settings: Partial<LocalModelSettings>): LocalModelSettings => ({ ...EMPTY_LOCAL_MODEL_SETTINGS, ...settings });

test("an address comes from the environment, then Settings, then the default", () => {
  const settings = saved({ endpoints: { ollama: "http://127.0.0.1:11500", lmstudio: "http://gpu-box.lan:1234" } });
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, {}, settings), { ok: true, endpoint: "http://127.0.0.1:11500", isDefault: false, source: "settings" });
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://127.0.0.1:11600" }, settings),
    { ok: true, endpoint: "http://127.0.0.1:11600", isDefault: false, source: "environment" }, "the environment overrides a saved address");
  const remote = resolveLocalCodexEndpoint(lmstudio, {}, settings);
  assert.equal(remote.ok, false, "a saved address on another computer still needs the permission");
  assert.match(remote.ok ? "" : remote.reason, /^The saved LM Studio address points at gpu-box\.lan:1234/);
  assert.equal(remote.source, "settings");
  assert.deepEqual(resolveLocalCodexEndpoint(lmstudio, {}, { ...settings, allowRemote: true }),
    { ok: true, endpoint: "http://gpu-box.lan:1234", isDefault: false, source: "settings" });
  assert.deepEqual(localModelsAllowRemote({}, settings), { value: false, source: "default" });
  assert.deepEqual(localModelsAllowRemote({}, { ...settings, allowRemote: true }), { value: true, source: "settings" });
  assert.deepEqual(localModelsAllowRemote({ CAVE_LOCAL_MODELS_ALLOW_REMOTE: "1" }, settings), { value: true, source: "environment" });
});

test("a Settings change is validated against the permission that holds afterwards", () => {
  const empty = EMPTY_LOCAL_MODEL_SETTINGS;
  assert.deepEqual(applyLocalModelsSettingsPatch(empty, { endpoints: { ollama: " http://localhost:11500/ " } }, {}),
    { ok: true, settings: { endpoints: { ollama: "http://localhost:11500" }, allowRemote: false } }, "an address is saved as its origin");
  assert.deepEqual(applyLocalModelsSettingsPatch(saved({ endpoints: { ollama: "http://localhost:11500" } }), { endpoints: { ollama: "" } }, {}),
    { ok: true, settings: { endpoints: {}, allowRemote: false } }, "an empty address restores the default");
  assert.deepEqual(applyLocalModelsSettingsPatch(empty, { endpoints: { lmstudio: "http://127.0.0.1:1234" } }, {}),
    { ok: true, settings: { endpoints: {}, allowRemote: false } }, "saving the default address is the same as the default");
  const remote = applyLocalModelsSettingsPatch(empty, { endpoints: { lmstudio: "http://gpu-box.lan:1234" } }, {});
  assert.equal(remote.ok, false);
  assert.equal(!remote.ok && remote.field, "lmstudio");
  assert.match(!remote.ok ? remote.error : "", /^The LM Studio address points at gpu-box\.lan:1234, which isn't this computer/);
  assert.deepEqual(applyLocalModelsSettingsPatch(empty, { allowRemote: true, endpoints: { lmstudio: "http://gpu-box.lan:1234" } }, {}),
    { ok: true, settings: { endpoints: { lmstudio: "http://gpu-box.lan:1234" }, allowRemote: true } }, "one change can allow a remote server and point at it");
  const offWhileRemote = applyLocalModelsSettingsPatch(saved({ allowRemote: true, endpoints: { lmstudio: "http://gpu-box.lan:1234" } }), { allowRemote: false }, {});
  assert.equal(offWhileRemote.ok, false, "turning the permission off cannot strand a remote address");
  assert.equal(!offWhileRemote.ok && offWhileRemote.field, "lmstudio");
  for (const bad of [null, [], "x", { other: 1 }, { allowRemote: "yes" }, { endpoints: [] }, { endpoints: { vllm: "http://127.0.0.1:8000" } }, { endpoints: { ollama: 5 } }, { endpoints: { ollama: "ftp://127.0.0.1" } }]) {
    assert.equal(applyLocalModelsSettingsPatch(empty, bad, {}).ok, false, JSON.stringify(bad));
  }
});

test("the spawned Codex reaches only this session's server", () => {
  const inherited = () => ({ PATH: "/bin", CODEX_OSS_BASE_URL: "http://elsewhere:9/v1", CODEX_OSS_PORT: "9" });
  const direct = inherited();
  applyLocalCodexSpawnEnv(direct, { endpoint: "http://127.0.0.1:11500", isDefault: false }, "direct");
  assert.deepEqual(direct, { PATH: "/bin" }, "the direct transport names a custom server with -c, so nothing inherited survives");
  const covenDefault = inherited();
  applyLocalCodexSpawnEnv(covenDefault, { endpoint: "http://127.0.0.1:11434", isDefault: true }, "coven");
  assert.deepEqual(covenDefault, { PATH: "/bin" }, "an inherited address cannot redirect a default-endpoint session");
  const covenCustom = inherited();
  applyLocalCodexSpawnEnv(covenCustom, { endpoint: "http://127.0.0.1:11500", isDefault: false }, "coven");
  assert.deepEqual(covenCustom, { PATH: "/bin", CODEX_OSS_BASE_URL: "http://127.0.0.1:11500/v1" });
});

test("Settings status reports both servers, where each address came from, and what each can run", async () => {
  clearLocalCodexProbeCache();
  const { fetchImpl } = server(ollamaRoutes());
  const status = await readLocalModelsStatus({ editable: false, env: {}, settings: EMPTY_LOCAL_MODEL_SETTINGS, fetchImpl });
  assert.equal(status.editable, false);
  assert.deepEqual(status.allowRemote, { value: false, source: "default" });
  const [first, second] = status.backends;
  assert.equal(first.backend, "ollama");
  assert.equal(first.source, "default");
  assert.equal(first.endpoint, "http://127.0.0.1:11434");
  assert.deepEqual(first.server, {
    state: "running", version: "0.21.0",
    models: [{ name: "llama2:7b", tools: false, contextLength: 4096, lmLink: null, cloud: null }, { name: "qwen3:8b", tools: true, contextLength: 40960, lmLink: null, cloud: null }],
    deviceCheck: "not-needed",
  });
  assert.equal(second.backend, "lmstudio");
  assert.deepEqual(second.server, { state: "stopped" });

  clearLocalCodexProbeCache();
  const moved = await readLocalModelsStatus({
    editable: true, env: {}, fetchImpl,
    settings: saved({ endpoints: { ollama: "http://gpu-box.lan:11434" } }),
  });
  assert.equal(moved.backends[0].source, "settings");
  assert.equal(moved.backends[0].endpoint, null);
  assert.equal(moved.backends[0].savedEndpoint, "http://gpu-box.lan:11434");
  assert.equal(moved.backends[0].server.state, "invalid-address");
});

test("a saved custom address reaches the preflight and its Codex overrides", async () => {
  clearLocalCodexProbeCache();
  const custom = server(Object.fromEntries(Object.entries(ollamaRoutes()).map(([url, route]) => [url.replace("127.0.0.1:11434", "127.0.0.1:11500"), route])));
  const ready = await preflightLocalCodex("codex-ollama", "ollama/qwen3:8b", {
    env: {}, fetchImpl: custom.fetchImpl, settings: saved({ endpoints: { ollama: "http://127.0.0.1:11500" } }),
  });
  assert.equal(ready?.ok, true);
  if (!ready?.ok) return;
  assert.equal(ready.endpoint, "http://127.0.0.1:11500");
  assert.equal(ready.isDefault, false);
  assert.equal(ready.source, "settings");
  assert.ok(ready.configArgs.includes('model_providers.cave_local.base_url="http://127.0.0.1:11500/v1"'));
});
