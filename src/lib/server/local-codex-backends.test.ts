import assert from "node:assert/strict";
import test from "node:test";
import { LOCAL_CODEX_BACKENDS } from "../local-codex.ts";
import {
  clearLocalCodexProbeCache,
  preflightLocalCodex,
  probeLocalCodexBackend,
  resolveLocalCodexEndpoint,
} from "./local-codex-backends.ts";

const ollama = LOCAL_CODEX_BACKENDS["codex-ollama"];
const lmstudio = LOCAL_CODEX_BACKENDS["codex-lmstudio"];

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
  });
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
  const probe = await probeLocalCodexBackend(lmstudio, { env: {}, fetchImpl });
  assert.deepEqual(probe, {
    kind: "available", endpoint: "http://127.0.0.1:1234", version: null,
    models: [
      { name: "plain-llm", tools: false, contextLength: 8192 },
      { name: "qwen/qwen3.8-27b", tools: true, contextLength: 262144 },
      { name: "qwen3-8b", tools: true, contextLength: 40960 },
    ],
  });
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
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, {}), { ok: true, endpoint: "http://127.0.0.1:11434", isDefault: true });
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://localhost:11500/" }), { ok: true, endpoint: "http://localhost:11500", isDefault: false });
  const remote = resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://gpu-box.lan:11434" });
  assert.equal(remote.ok, false);
  assert.match(remote.ok ? "" : remote.reason, /not this machine\. Set CAVE_LOCAL_MODELS_ALLOW_REMOTE=1/);
  assert.deepEqual(resolveLocalCodexEndpoint(ollama, { CAVE_OLLAMA_URL: "http://gpu-box.lan:11434", CAVE_LOCAL_MODELS_ALLOW_REMOTE: "1" }),
    { ok: true, endpoint: "http://gpu-box.lan:11434", isDefault: false });
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
