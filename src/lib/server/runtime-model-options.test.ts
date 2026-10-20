import assert from "node:assert/strict";
import {
  listRuntimeModelInventory,
  listRuntimeModelOptions,
} from "./runtime-model-options.ts";

const opus5 = { id: "anthropic/claude-opus-5", label: "Claude Opus 5" };
let claudeScope: string | null | undefined;
assert.deepEqual(
  await listRuntimeModelOptions("claude-code", "sage", {
    listClaude: async (familiarId) => {
      claudeScope = familiarId;
      return [opus5];
    },
  }),
  [opus5],
  "Claude aliases consume the shared dynamic inventory",
);
assert.equal(claudeScope, "sage");
assert.deepEqual(
  await listRuntimeModelInventory("claude", "sage", {
    listClaude: async () => [opus5],
  }),
  {
    runtime: "claude",
    models: [opus5],
    provenance: "live",
    freshness: "fresh",
    refreshState: "ready",
    availability: "available",
    defaultOwner: "cave",
    allowCustom: true,
    scope: {
      familiarId: "sage",
      runtime: "claude",
      provider: "anthropic",
      credentialScope: "familiar",
      providerConfiguration: "familiar",
    },
  },
);

const dynamicCopilot = [
  { id: "github/auto", label: "Auto (Copilot picks)" },
  { id: "github/claude-opus-5", label: "Claude Opus 5" },
];
assert.deepEqual(
  await listRuntimeModelOptions("copilot", "sage", {
    listCopilot: async () => dynamicCopilot,
  }),
  dynamicCopilot,
  "Copilot replaces its seed with the authenticated account inventory",
);
assert.deepEqual(
  await listRuntimeModelOptions("copilot", "sage", { listCopilot: async () => [] }),
  [], "failed Copilot discovery never restores a static model list",
);

let openCodeCalls = 0;
assert.deepEqual(
  await listRuntimeModelOptions("opencode", "sage", {
    allowOpenCodeInventory: false,
    listOpenCode: async () => {
      openCodeCalls += 1;
      return [{ id: "anthropic/claude-opus-5", label: "anthropic: Claude Opus 5" }];
    },
  }),
  [],
  "remote aggregate clients do not trigger credential-scoped OpenCode discovery",
);
assert.equal(openCodeCalls, 0);
assert.deepEqual(
  await listRuntimeModelOptions("opencode-ai", "sage", {
    allowOpenCodeInventory: true,
    listOpenCode: async (familiarId) => {
      openCodeCalls += 1;
      assert.equal(familiarId, "sage");
      return [{ id: "anthropic/claude-opus-5", label: "anthropic: Claude Opus 5" }];
    },
  }),
  [{ id: "anthropic/claude-opus-5", label: "anthropic: Claude Opus 5" }],
);
assert.equal(openCodeCalls, 1);

const codexModel = { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" };
assert.deepEqual(
  (await listRuntimeModelInventory("codex", "sage", {
    listCodexInventory: async (id) => {
      assert.equal(id, "sage");
      return { models: [codexModel], provenance: "live" };
    },
  })).models,
  [codexModel], "Codex gets runtime-reported choices, not the static catalog",
);
assert.deepEqual(
  (await listRuntimeModelInventory("codex", "sage", {
    allowCliInventory: false,
    listCodexInventory: async () => { throw new Error("must not discover local models for a remote runtime"); },
  })).models,
  [],
);
for (const runtime of ["codex", "claude", "copilot"]) {
  const inventory = await listRuntimeModelInventory(runtime, "sage", {
    listCodexInventory: async () => ({ models: [], provenance: "unavailable" }),
    listClaude: async () => { throw new Error("transient"); },
    listCopilot: async () => [],
  });
  assert.deepEqual(inventory.models, [], `${runtime} cannot advertise old seeds after failed discovery`);
  assert.equal(inventory.provenance, "unavailable");
}
assert.deepEqual(await listRuntimeModelOptions("not-a-runtime", null), []);
const hermesInventory = await listRuntimeModelInventory("hermes", "sage");
assert.equal(hermesInventory.provenance, "runtime-managed", "Hermes never claims the static OpenAI seed for a scoped familiar");
assert.deepEqual(hermesInventory.models, [], "Hermes scoped inventory omits the OpenAI seed until its provider can be discovered");
assert.equal(
  (await listRuntimeModelInventory("hermes", "sage")).defaultOwner,
  "runtime",
  "Hermes fallback entries never own the unselected default",
);
assert.equal(
  (await listRuntimeModelInventory("opencode", "sage", {
    allowOpenCodeInventory: false,
  })).provenance,
  "runtime-managed",
);

assert.deepEqual(
  await listRuntimeModelInventory("claude", "sage", {
    listClaudeInventory: async () => ({ models: [opus5], provenance: "cached" }),
  }),
  {
    runtime: "claude",
    models: [opus5],
    provenance: "cached",
    freshness: "cached",
    refreshState: "ready",
    availability: "available",
    defaultOwner: "cave",
    allowCustom: true,
    scope: {
      familiarId: "sage",
      runtime: "claude",
      provider: "anthropic",
      credentialScope: "familiar",
      providerConfiguration: "familiar",
    },
  },
  "a resolver cache hit remains truthful at the shared API boundary",
);

const grokModel = { id: "grok-4", label: "Grok 4" };
assert.deepEqual(
  await listRuntimeModelInventory("grok", "sage", {
    listGrok: async (familiarId) => {
      assert.equal(familiarId, "sage", "Grok discovery stays familiar-scoped");
      return [grokModel];
    },
  }),
  {
    runtime: "grok",
    models: [grokModel],
    provenance: "live",
    freshness: "fresh",
    refreshState: "ready",
    availability: "available",
    defaultOwner: "runtime",
    allowCustom: true,
    scope: {
      familiarId: "sage",
      runtime: "grok",
      provider: "xai",
      credentialScope: "familiar",
      providerConfiguration: "familiar",
    },
  },
  "an authenticated Grok probe supplies the shared live inventory",
);
assert.equal(
  (await listRuntimeModelInventory("grok", "sage", { listGrok: async () => [] })).provenance,
  "runtime-managed",
  "a timed-out Grok probe does not fabricate inventory access",
);
assert.equal(
  (await listRuntimeModelInventory("grok", "sage", {
    listGrok: async () => { throw new Error("probe failed"); },
  })).provenance,
  "runtime-managed",
  "a failed Grok probe reports the honest runtime-managed fallback",
);

let hermesCalls = 0;
assert.equal(
  (await listRuntimeModelInventory("hermes", "sage", {
    allowHermesInventory: false,
    listHermes: async () => {
      hermesCalls += 1;
      return [{ id: "openrouter/auto", label: "OpenRouter Auto" }];
    },
  })).provenance,
  "runtime-managed",
  "profile-bound, invalid, and SSH Hermes callers can decline local API discovery",
);
assert.equal(hermesCalls, 0);
assert.deepEqual(
  await listRuntimeModelInventory("hermes", "sage", {
    allowHermesInventory: true,
    listHermes: async (familiarId) => {
      hermesCalls += 1;
      assert.equal(familiarId, "sage");
      return [
        { id: "openrouter/auto", label: " OpenRouter Auto " },
        { id: "hermes-local", label: "Synthetic" },
        { id: "--unsafe", label: "Unsafe" },
      ];
    },
  }),
  {
    runtime: "hermes",
    models: [{ id: "openrouter/auto", label: "OpenRouter Auto" }],
    provenance: "live",
    freshness: "fresh",
    refreshState: "ready",
    availability: "available",
    defaultOwner: "runtime",
    allowCustom: true,
    scope: {
      familiarId: "sage",
      runtime: "hermes",
      provider: "openai",
      credentialScope: "familiar",
      providerConfiguration: "familiar",
    },
  },
  "bare-local Hermes exposes only validated provider inventory",
);
assert.equal(hermesCalls, 1);
assert.equal(
  (await listRuntimeModelInventory("hermes", "sage", {
    allowHermesInventory: true,
    listHermesInventory: async () => ({
      models: [{ id: "openrouter/auto", label: "OpenRouter Auto" }],
      provenance: "cached",
    }),
  })).provenance,
  "cached",
  "Hermes cache provenance remains truthful at the shared inventory boundary",
);

console.log("server/runtime-model-options.test.ts: ok");

for (const runtime of ["codex", "claude", "copilot", "grok", "hermes", "opencode"]) {
  const inventory = await listRuntimeModelInventory(runtime, "sage", {
    allowHermesInventory: true, allowOpenCodeInventory: true,
    listCodexInventory: async () => ({ models: [], provenance: "unavailable" }),
    listClaude: async () => [], listCopilot: async () => [], listGrok: async () => [],
    listHermes: async () => [], listOpenCode: async () => [],
  });
  assert.equal(inventory.discoveryIssue, "discovery-failed", `${runtime} discovery failure must remain distinguishable from managed models`);
}
assert.equal((await listRuntimeModelInventory("openclaw")).discoveryIssue, "runtime-managed");

for (const [runtime, id] of [
  ["codex", "openai/gpt-99-sol"], ["claude", "anthropic/claude-future-99"],
  ["copilot", "github/future-model"], ["grok", "xai/grok-future"],
  ["hermes", "openrouter/provider/future-model"], ["opencode", "provider/future-model"],
]) {
  const models = [{ id, label: "Fresh runtime-reported model" }];
  let probes = 0;
  const report = async () => { probes++; return models; };
  const discovery = async () => ({ models: await report(), provenance: "live" as const });
  const dependencies = { allowHermesInventory: true, allowOpenCodeInventory: true,
    listCodexInventory: discovery, listClaudeInventory: discovery, listCopilot: report,
    listGrok: report, listHermes: report, listOpenCode: report };
  assert.deepEqual((await listRuntimeModelInventory(runtime, "sage", dependencies)).models, models, `${runtime} must not require a seed update to support new models`);
  assert.equal(probes, 1);
  assert.deepEqual((await listRuntimeModelInventory(runtime, "sage", { ...dependencies, inventoryRestriction: "remote-runtime" })).models, []);
  assert.equal(probes, 1, `${runtime} must not probe local credentials for an SSH binding`);
}

// Codex local mode (#6049): the inference server is the inventory.
{
  const { LOCAL_CODEX_BACKENDS } = await import("../local-codex.ts");
  const probes: string[] = [];
  const probe = (answer: Awaited<ReturnType<NonNullable<Parameters<typeof listRuntimeModelInventory>[2]>["probeLocalBackend"] & {}>>) =>
    async (info: { backend: string }) => { probes.push(info.backend); return answer; };
  const ready = await listRuntimeModelInventory("codex-lmstudio", "sage", {
    probeLocalBackend: probe({
      kind: "available", endpoint: "http://127.0.0.1:1234", version: null,
      models: [
        { name: "hermes-3-llama-3.1-8b", tools: true, contextLength: 8192 },
        { name: "hermes-4-llama-3.1-8b", tools: true, contextLength: 8192 },
        { name: "plain-llm", tools: false, contextLength: 8192 },
        { name: "qwen/qwen3.8-27b", tools: true, contextLength: 262144 },
      ],
      deviceCheck: "checked",
    }),
  });
  assert.deepEqual(probes, ["lmstudio"]);
  assert.deepEqual(ready.models, [
    { id: "lmstudio/hermes-3-llama-3.1-8b", label: "hermes-3-llama-3.1-8b" },
    { id: "lmstudio/hermes-4-llama-3.1-8b", label: "hermes-4-llama-3.1-8b" },
    { id: "lmstudio/qwen/qwen3.8-27b", label: "qwen/qwen3.8-27b" },
  ], "every installed tool-capable model is a choice; an older release on a local server is not collapsed away");
  assert.equal(ready.provenance, "live");
  assert.equal(ready.discoveryIssue, undefined);

  const issue = async (runtime: string, answer: Parameters<typeof probe>[0]) =>
    (await listRuntimeModelInventory(runtime, "sage", { probeLocalBackend: probe(answer) })).discoveryIssue;
  assert.equal(await issue("codex-ollama", { kind: "unreachable", endpoint: "http://127.0.0.1:11434" }), "local-server-unavailable");
  assert.equal(await issue("codex-ollama", { kind: "invalid-response", endpoint: "http://127.0.0.1:11434" }), "local-server-unavailable");
  assert.equal(await issue("codex-ollama", { kind: "invalid-endpoint", reason: "not this machine" }), "local-endpoint-invalid");
  assert.equal(await issue("codex-ollama", {
    kind: "available", endpoint: "http://127.0.0.1:11434", version: "0.21.0",
    models: [{ name: "llama2:7b", tools: false, contextLength: 4096 }],
    deviceCheck: "not-needed",
  }), "local-no-tool-models", "a server with only tool-less models says so instead of offering models Codex cannot drive");

  // LM Link (#6094): a model served from another computer needs the remote permission.
  const linkedServer = {
    kind: "available" as const, endpoint: "http://127.0.0.1:1234", version: null, deviceCheck: "checked" as const,
    models: [
      { name: "qwen/qwen3.8-27b", tools: true, contextLength: 262144, lmLink: { deviceName: "studio-mac.local" } },
      { name: "qwen3-8b", tools: true, contextLength: 40960 },
    ],
  };
  let permissionReads = 0;
  const allow = (value: boolean) => async () => { permissionReads++; return value; };
  const offeredWith = async (value: boolean, answer: Parameters<typeof probe>[0] = linkedServer) =>
    (await listRuntimeModelInventory("codex-lmstudio", "sage", { probeLocalBackend: probe(answer), localAllowRemote: allow(value) }));
  assert.deepEqual((await offeredWith(false)).models, [{ id: "lmstudio/qwen3-8b", label: "qwen3-8b" }],
    "a linked model is not offered while servers on other computers are off");
  assert.deepEqual((await offeredWith(true)).models.map((model) => model.id), ["lmstudio/qwen/qwen3.8-27b", "lmstudio/qwen3-8b"],
    "the remote permission offers it");
  const onlyLinked = await offeredWith(false, { ...linkedServer, models: [linkedServer.models[0]] });
  assert.equal(onlyLinked.discoveryIssue, "local-models-on-other-computers");
  assert.deepEqual(onlyLinked.models, []);
  permissionReads = 0;
  await offeredWith(false, { ...linkedServer, models: [linkedServer.models[1]] });
  assert.equal(permissionReads, 0, "the permission is read only when a linked model is present");

  probes.length = 0;
  const remote = await listRuntimeModelInventory("codex-ollama", "sage", {
    allowCliInventory: false,
    probeLocalBackend: probe({ kind: "unreachable", endpoint: "http://127.0.0.1:11434" }),
  });
  assert.equal(remote.discoveryIssue, "remote-runtime");
  assert.deepEqual(probes, [], "an SSH-bound familiar never probes this machine's server");
  assert.equal((await listRuntimeModelInventory("codex-ollama", "sage", {
    probeLocalBackend: async () => { throw new Error("boom"); },
  })).discoveryIssue, "local-server-unavailable");
  assert.ok(LOCAL_CODEX_BACKENDS["codex-ollama"]);
}
