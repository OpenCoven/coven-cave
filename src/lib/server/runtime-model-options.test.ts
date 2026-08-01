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
    defaultOwner: "cave",
    allowCustom: true,
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
assert.ok(
  (await listRuntimeModelOptions("copilot", "sage", {
    listCopilot: async () => [],
  })).some((model) => model.id === "github/auto"),
  "a failed Copilot probe falls back to the safe static seed",
);
assert.ok(
  !(await listRuntimeModelOptions("copilot", "sage", {
    listCopilot: async () => [],
  })).some((model) => model.id === "github/claude-opus-5"),
  "failure fallback never fabricates Copilot Opus 5 access",
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

assert.ok(
  (await listRuntimeModelOptions("codex", null)).some(
    (model) => model.id === "openai/gpt-5.6-sol",
  ),
  "static runtimes retain their existing catalog",
);
assert.deepEqual(await listRuntimeModelOptions("not-a-runtime", null), []);
assert.ok(
  (await listRuntimeModelOptions("claude", "sage", {
    listClaude: async () => { throw new Error("transient"); },
  })).some((model) => model.id === "anthropic/claude-opus-4-8"),
  "a failed Claude resolver preserves the seed",
);
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
    defaultOwner: "cave",
    allowCustom: true,
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
    defaultOwner: "runtime",
    allowCustom: true,
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
    defaultOwner: "runtime",
    allowCustom: true,
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
