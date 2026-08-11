import assert from "node:assert/strict";
import {
  buildGrokBuildArgs,
  grokIdentityRules,
  grokResumeNeedsNewSandboxSession,
  grokSandboxProfileForPermission,
  grokShouldUseCliDefault,
  parseGrokModels,
  parseGrokStreamEvent,
} from "./grok-build.ts";
import {
  BUILTIN_GROK_SCHEMA_BUNDLE,
  parseGrokCompatibilityEvent,
} from "./grok-compatibility.ts";

const catalog = parseGrokModels(`You are logged in with grok.com.\n\nDefault model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)\n  * grok-code-fast-1`);
assert.equal(catalog.defaultModel, "grok-4.5");
assert.deepEqual(catalog.models, [
  { id: "grok-4.5", label: "grok-4.5 (default)" },
  { id: "grok-code-fast-1", label: "grok-code-fast-1" },
]);

assert.equal(
  grokIdentityRules("nova", "Nova", "Engineer"),
  "You are Nova, a Engineer. Respond as Nova, not as the underlying Grok Build CLI.",
);

assert.deepEqual(
  buildGrokBuildArgs({
    prompt: "inspect this",
    resumeSessionId: "11111111-2222-4333-8444-555555555555",
    model: "xai/grok-4.5",
    permissionMode: "read",
    grantDirs: ["/work/project", ""],
    identityRules: "You are Nova.",
    outputFormat: "streaming-json",
  }),
  [
    "--no-auto-update", "--output-format", "streaming-json",
    "--resume", "11111111-2222-4333-8444-555555555555",
    "--model", "grok-4.5",
    "--disallowed-tools", "run_terminal_cmd,search_replace",
    "--allow", "Read(/work/project/**)",
    "--rules", "You are Nova.",
    "--single", "inspect this",
  ],
  "resumed read runs use native Grok JSONL, grants, system identity, and --resume (not --session-id)",
);

{
  const nestedModelArgs = buildGrokBuildArgs({
    prompt: "inspect this",
    resumeSessionId: null,
    model: "provider/team/model",
    permissionMode: "read",
    grantDirs: [],
    identityRules: "",
  });
  assert.deepEqual(
    nestedModelArgs.slice(nestedModelArgs.indexOf("--model"), nestedModelArgs.indexOf("--model") + 2),
    ["--model", "team/model"],
    "Grok strips only the first provider segment and preserves a nested model id",
  );

  const flagShapedModelArgs = buildGrokBuildArgs({
    prompt: "inspect this",
    resumeSessionId: null,
    model: "provider/--sandbox",
    permissionMode: "read",
    grantDirs: [],
    identityRules: "",
  });
  assert.ok(!flagShapedModelArgs.includes("--model"), "a stripped flag-shaped Grok model never reaches argv");
}

assert.ok(
  !buildGrokBuildArgs({
    prompt: "continue",
    resumeSessionId: "11111111-2222-4333-8444-555555555555",
    model: null,
    permissionMode: "full",
    grantDirs: [],
    identityRules: "",
    outputFormat: "streaming-json",
  }).includes("--sandbox"),
  "resumed chats preserve Grok's session-bound sandbox instead of failing on a changed composer mode",
);

assert.deepEqual(
  buildGrokBuildArgs({
    prompt: "fix it",
    resumeSessionId: null,
    newSessionId: "11111111-2222-4333-8444-555555555555",
    model: null,
    permissionMode: "full",
    grantDirs: [],
    identityRules: "",
    outputFormat: "streaming-json",
  }),
  [
    "--no-auto-update", "--output-format", "streaming-json",
    "--session-id", "11111111-2222-4333-8444-555555555555",
    "--permission-mode", "bypassPermissions", "--sandbox", "off",
    "--single", "fix it",
  ],
);

assert.deepEqual(parseGrokStreamEvent({ type: "text", data: "Hello" }), { kind: "text", text: "Hello" });
assert.deepEqual(
  parseGrokStreamEvent({
    type: "end",
    sessionId: "abc",
    usage: { input_tokens: 1 },
    total_cost_usd: 0.001,
  }),
  {
    kind: "end",
    sessionId: "abc",
    isError: false,
    usage: { input_tokens: 1 },
    totalCostUsd: 0.001,
  },
);
assert.deepEqual(
  parseGrokStreamEvent({ type: "error", message: "not authenticated", total_cost_usd: 0 }),
  { kind: "error", message: "not authenticated", usage: undefined, totalCostUsd: 0 },
);
assert.deepEqual(parseGrokStreamEvent({ type: "thought", data: "hidden" }), { kind: "ignore" });
assert.deepEqual(
  parseGrokCompatibilityEvent({ type: "future_event" }, BUILTIN_GROK_SCHEMA_BUNDLE.schemas[0]),
  { kind: "unknown" },
  "unknown future frames never become activity in the built-in schema",
);

assert.equal(grokSandboxProfileForPermission("read"), "read");
assert.equal(grokSandboxProfileForPermission(undefined), "full");
assert.equal(
  grokShouldUseCliDefault({
    modelSource: "global-default",
    globalDefaultModel: "openai/gpt-5.6-sol",
  }),
  true,
  "a Grok familiar inheriting Cave's provider default must let its CLI choose the authenticated default",
);
assert.equal(
  grokShouldUseCliDefault({
    modelSource: "global-default",
    globalDefaultModel: "xai/grok-code-fast-1",
  }),
  false,
  "an explicitly configured Grok global default must still be forwarded",
);
assert.equal(
  grokResumeNeedsNewSandboxSession({
    resumeSessionId: "session-id",
    savedProfile: "full",
    requestedProfile: "read",
  }),
  true,
  "a resumed Grok chat must start fresh when the requested sandbox changes",
);
assert.equal(
  grokResumeNeedsNewSandboxSession({
    resumeSessionId: "session-id",
    savedProfile: "read",
    requestedProfile: "read",
  }),
  false,
  "a resume can retain the native Grok session when its sandbox matches",
);

console.log("grok-build tests passed");
