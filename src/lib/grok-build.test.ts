import assert from "node:assert/strict";
import {
  buildGrokBuildArgs,
  grokIdentityRules,
  parseGrokModels,
  parseGrokStreamEvent,
} from "./grok-build.ts";

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

assert.ok(
  !buildGrokBuildArgs({
    prompt: "continue",
    resumeSessionId: "11111111-2222-4333-8444-555555555555",
    model: null,
    permissionMode: "full",
    grantDirs: [],
    identityRules: "",
  }).includes("--sandbox"),
  "resumed chats preserve Grok's session-bound sandbox instead of failing on a changed composer mode",
);

assert.deepEqual(
  buildGrokBuildArgs({
    prompt: "fix it",
    resumeSessionId: null,
    model: null,
    permissionMode: "full",
    grantDirs: [],
    identityRules: "",
  }),
  [
    "--no-auto-update", "--output-format", "streaming-json",
    "--permission-mode", "bypassPermissions", "--sandbox", "off",
    "--single", "fix it",
  ],
);

assert.deepEqual(parseGrokStreamEvent({ type: "text", data: "Hello" }), { kind: "text", text: "Hello" });
assert.deepEqual(
  parseGrokStreamEvent({ type: "end", sessionId: "abc", usage: { input_tokens: 1 } }),
  { kind: "end", sessionId: "abc", isError: false, usage: { input_tokens: 1 } },
);
assert.deepEqual(
  parseGrokStreamEvent({ type: "error", message: "not authenticated" }),
  { kind: "error", message: "not authenticated", usage: undefined },
);
assert.deepEqual(parseGrokStreamEvent({ type: "thought", data: "hidden" }), { kind: "ignore" });

console.log("grok-build tests passed");
