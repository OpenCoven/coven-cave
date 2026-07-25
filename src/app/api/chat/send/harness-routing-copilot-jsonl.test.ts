// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildPromptWithAttachments,
  IMAGE_ATTACHMENTS_UNSUPPORTED_NOTE,
  MAX_ATTACHMENT_IMAGE_BYTES,
  normalizeChatAttachments,
} from "../../../../lib/chat-attachments.ts";
import {
  flattenToolResultContent,
  formatToolInputValue,
  formatToolPayload,
  ToolCallTracker,
  toPersistedTools,
} from "../../../../lib/chat-tool-events.ts";
import { buildCopilotStreamArgs } from "../../../../lib/copilot-stream.ts";
import { prepareCopilotChatRouting, resolveCopilotChatRouting } from "./copilot-routing.ts";

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const streamEvents = await readFile(
  new URL("../../../../lib/stream-events.ts", import.meta.url),
  "utf8",
);
const openclawBridge = await readFile(
  new URL("../../../../lib/openclaw-bridge.ts", import.meta.url),
  "utf8",
);
const boardRoute = await readFile(
  new URL("../../board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);
const chatView = await readFile(
  new URL("../../../../components/chat-view.tsx", import.meta.url),
  "utf8",
);
// ── Copilot JSONL stream wiring (cave-yesg) ──────────────────────────────────
// `coven run copilot --stream-json` launches the CLI one-shot and pipes raw
// prose, so tool calls never reach the chat. Copilot chats must spawn the CLI
// directly with its manifest-declared stream args and parse its JSONL events;
// every other adapter (and SSH runtimes) keeps the coven run path.

const directCopilot = resolveCopilotChatRouting({
  harness: "copilot",
  isSshRuntime: false,
  capabilityVersion: "1.0.70",
});
assert.equal(directCopilot.mode, "direct-jsonl");
assert.ok(directCopilot.spec, "a supported local Copilot runtime selects the direct JSONL launch");
assert.equal(directCopilot.spec.executable, "copilot");
assert.deepEqual(
  buildCopilotStreamArgs({
    spec: directCopilot.spec,
    prompt: "route behavior",
    resumeSessionId: null,
    newSessionId: null,
    model: null,
    permissionMode: "full",
    addDirs: [],
  }).slice(0, 4),
  ["--output-format", "json", "--stream", "on"],
  "the direct routing decision carries the reviewed JSONL launch contract",
);

for (const capabilityVersion of [null, "1.0.70.1", "0.9.9", "2.0.0", "2.0.0-rc.1"]) {
  const routing = resolveCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: false,
    capabilityVersion,
  });
  assert.equal(routing.mode, "plain", `${capabilityVersion ?? "unavailable"} must use generic chat`);
  assert.equal(routing.spec, null, "the fallback must never direct-spawn the JSONL parser");
  assert.match(routing.compatibilityDiagnostic ?? "", /not yet compatible/);
}

assert.deepEqual(
  resolveCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: true,
    capabilityVersion: "1.0.70",
  }),
  { mode: "plain", spec: null, compatibilityDiagnostic: null },
  "remote Copilot routing keeps the remote generic execution path",
);

let resolveProbe!: (value: { version: string }) => void;
let resolveRegistry!: (value: { eventProtocols: unknown[] }) => void;
let probeStarted = false;
let registryStarted = false;
const preparedDirect = prepareCopilotChatRouting({
  harness: "copilot",
  isSshRuntime: false,
  probe: () => new Promise((resolve) => {
    probeStarted = true;
    resolveProbe = resolve;
  }),
  resolveCompatibility: () => new Promise((resolve) => {
    registryStarted = true;
    resolveRegistry = resolve;
  }),
});
assert.equal(probeStarted, true, "the route preparation starts the version probe");
assert.equal(registryStarted, true, "the route preparation starts registry resolution without awaiting the probe");
resolveProbe({ version: "1.0.70" });
resolveRegistry({ eventProtocols: [] });
assert.equal((await preparedDirect).mode, "direct-jsonl", "a supported mocked runtime selects the direct JSONL route");

const preparedFallback = await prepareCopilotChatRouting({
  harness: "copilot",
  isSshRuntime: false,
  probe: async () => ({ version: "2.0.0" }),
  resolveCompatibility: async () => ({ eventProtocols: [] }),
});
assert.equal(preparedFallback.mode, "plain", "an unsupported mocked runtime retains generic plain chat");
assert.match(preparedFallback.compatibilityDiagnostic ?? "", /not yet compatible/);

// ── Grok Build JSONL stream wiring ─────────────────────────────────────────

assert.match(
  chatRoute,
  /const grokDirect = !sshRuntime && binding\.harness === "grok";/,
  "Grok Build must use its native local JSONL path, not coven run",
);
assert.match(
  chatRoute,
  /buildGrokBuildArgs\(\{[\s\S]*?resumeSessionId,[\s\S]*?identityRules: grokIdentityRules\(/,
  "Grok argv must carry native resume semantics and system identity",
);
assert.match(
  chatRoute,
  /const grokForwardModel = grokShouldUseCliDefault\([\s\S]*?\? null\s*:\s*cleanModelId\(desiredModel\);[\s\S]*?buildGrokBuildArgs\(\{[\s\S]*?model: grokForwardModel,/,
  "an inherited non-Grok global model must omit --model so the installed Grok CLI chooses its authenticated default",
);
assert.match(
  chatRoute,
  /if \(!confirmedModel && grokForwardModel\) confirmedModel = desiredModel;/,
  "Cave must not claim an inherited fallback model was applied when it deliberately used Grok's CLI default",
);
assert.match(
  chatRoute,
  /if \(grokDirect\) \{\s*handleGrokLine\(line, isJson\);\s*return;/,
  "Grok stdout routes through the native JSONL parser, never generic stream-json parsing",
);
assert.match(
  chatRoute,
  /case "end":[\s\S]*?usage: parseStreamJsonUsage\(event\.usage\),[\s\S]*?costUsd: parseCostUsd\(event\.totalCostUsd\),/,
  "Grok end events must preserve their usage and cost metadata for the transcript and done event",
);
assert.match(
  chatRoute,
  /case "end":\s*if \(event\.sessionId\) grokSessionId = event\.sessionId;/,
  "Grok end events must retain the native session id even when Cave is resuming a stable conversation id",
);
assert.match(
  chatRoute,
  /const harnessSessionId = grokDirect \? grokSessionId : sessionId;/,
  "a failed Grok resume must not overwrite the native resume id with Cave's stable conversation id",
);
assert.match(
  chatRoute,
  /if \(grokDirect && grokSessionId\) conv\.grokSandboxProfile = grokSandboxProfile;/,
  "a failed sandbox-switch attempt must retain the profile of the native session it will resume next",
);
assert.match(
  chatRoute,
  /grokSessionHint = resumeSessionId \? null : crypto\.randomUUID\(\);/,
  "new Grok chats must preassign their native UUID so a stopped first turn remains resumable",
);
assert.match(
  chatRoute,
  /import \{ grokLaunchCommand \} from "@\/lib\/grok-bin"/,
  "Grok direct chats must use the shared cross-platform launcher resolver",
);
assert.match(
  chatRoute,
  /grokDirect\s*\? grokLaunchCommand\(\)/,
  "Grok direct chats must support native executables and Windows npm command shims",
);
assert.match(
  chatRoute,
  /Grok Build chats currently run on this Cave host/,
  "SSH Grok must fail explicitly instead of falling back to coven run",
);

assert.match(
  chatRoute,
  /copilotProtocolDiagnostic\(raw, protocol\)/,
  "unknown tool-event shapes must become a redacted compatibility diagnostic instead of being silently dropped",
);

assert.match(
  chatRoute,
  /const launch = copilotStream[\s\S]*?: grokDirect\s*\? grokLaunchCommand\(\)[\s\S]*?: hermesDirect[\s\S]*?command: process\.platform === "win32" \? "hermes\.exe" : "hermes",[\s\S]*?: covenLaunchCommand\(\);[\s\S]*?const openCodeLaunchCommand = openCodeDirect \? openCodeLaunch\(spawnArgs\) : null;/,
  "Copilot, Grok Build, Hermes, and OpenCode direct turns spawn their own CLI; other local harnesses spawn coven",
);

assert.match(
  chatRoute,
  /if \(copilotStream\) \{\s*\n\s*handleCopilotLine\(line, isJson\);\s*\n\s*return;/,
  "Copilot stdout routes through the copilot JSONL handler, never the AssistantFilter (raw JSON frames must not leak into the bubble)",
);

assert.match(
  chatRoute,
  /const isJson = !hermesDirect && line\.startsWith\("\{"\) && line\.endsWith\("\}"\);/,
  "Hermes direct stdout must stay plain text even when an assistant reply looks like a JSON object",
);

assert.match(
  chatRoute,
  /copilotIdentityPreamble\(\s*\n?\s*body\.familiarId,/,
  "The direct copilot spawn bypasses `coven run --familiar`, so the route must mirror coven's identity preamble itself",
);

assert.match(
  chatRoute,
  /No session, task, or name matched/,
  "Copilot --resume misses (e.g. pre-stream conversations whose harnessSessionId lives in coven's store) must trigger the transparent fresh-session retry",
);

assert.match(
  chatRoute,
  /copilotText\.reset\(\);/,
  "The resume retry must clear per-attempt copilot text-dedup state alongside the tracker",
);
assert.match(
  chatRoute,
  /\(openCodeDirect \|\| copilotStream\) && code !== 0[\s\S]*?is_error: true/,
  "a nonzero direct Copilot process exit persists the turn as an error even without a final result frame",
);
assert.match(
  chatRoute,
  /const a = \["run", binding\.harness, "--stream-json"\];/,
  "Adapters without a Cave-known stream protocol keep the coven run passthrough fallback",
);

console.log("copilot stream routing tests passed");

console.log("harness-routing tests passed");
