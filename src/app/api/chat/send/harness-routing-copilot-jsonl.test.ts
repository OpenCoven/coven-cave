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
  }).slice(0, 6),
  ["--no-auto-update", "--allow-all", "--output-format", "json", "--stream", "on"],
  "the direct full-mode routing decision keeps its approval flag before the reviewed JSONL launch contract",
);

for (const capabilityVersion of ["1.0.70.1", "0.9.9", "2.0.0", "2.0.0-rc.1"]) {
  const routing = resolveCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: false,
    capabilityVersion,
  });
  assert.equal(routing.mode, "plain", `${capabilityVersion ?? "unavailable"} must use generic chat`);
  assert.equal(routing.spec, null, "the fallback must never direct-spawn the JSONL parser");
  assert.match(routing.compatibilityDiagnostic ?? "", /not yet compatible/);
}

const capabilityCauseMessages = {
  "version-unavailable":
    "Cave could not read the Copilot CLI version. Run `copilot --version`, then try again.",
  "version-unparseable":
    "Copilot returned an unrecognized version. Update Copilot or the Cave runtime schema, then try again.",
  "probe-timeout":
    "The Copilot version check timed out. Retry after Copilot finishes starting.",
};
for (const [diagnostic, expected] of Object.entries(capabilityCauseMessages)) {
  const routing = resolveCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: false,
    capabilityVersion: null,
    capabilityDiagnostic: diagnostic,
    availability: {
      state: "ready",
      runner: "copilot",
      resolvedPath: "/must-not-reach-wire",
    },
  });
  assert.equal(routing.mode, "plain");
  assert.equal(
    routing.compatibilityDiagnostic,
    expected,
    `${diagnostic} remains distinct from schema incompatibility`,
  );
}

const missingAvailabilityMessage =
  "copilot CLI not found on PATH. Install it with `npm install -g @github/copilot`, then try again.";
const missingRouting = resolveCopilotChatRouting({
  harness: "copilot",
  isSshRuntime: false,
  capabilityVersion: null,
  capabilityDiagnostic: "version-unavailable",
  availability: {
    state: "missing",
    runner: "copilot",
    code: "runtime_missing",
    message: missingAvailabilityMessage,
  },
});
assert.equal(
  missingRouting.compatibilityDiagnostic,
  missingAvailabilityMessage,
  "runtime availability cause wins before generic version diagnostics",
);
assert.doesNotMatch(
  missingRouting.compatibilityDiagnostic ?? "",
  /must-not-reach-wire|resolvedPath|PATH=/,
  "Copilot compatibility diagnostics never expose launch paths or env",
);

assert.deepEqual(
  resolveCopilotChatRouting({
    harness: "copilot",
    isSshRuntime: true,
    capabilityVersion: "1.0.70",
  }),
  { mode: "plain", spec: null, compatibilityDiagnostic: null },
  "remote Copilot routing keeps the remote generic execution path",
);

let resolveProbe!: (value: { version: string; launchCommand: { command: string; fixedArgs: string[] } }) => void;
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
resolveProbe({ version: "1.0.70", launchCommand: { command: "node", fixedArgs: ["copilot-entry.js"] } });
resolveRegistry({ eventProtocols: [] });
const preparedDirectResult = await preparedDirect;
assert.equal(preparedDirectResult.mode, "direct-jsonl", "a supported mocked runtime selects the direct JSONL route");
assert.deepEqual(
  preparedDirectResult.spec?.launchCommand,
  { command: "node", fixedArgs: ["copilot-entry.js"] },
  "the direct route reuses the exact bounded-probe launcher instead of discovering one while streaming",
);

const preparedFallback = await prepareCopilotChatRouting({
  harness: "copilot",
  isSshRuntime: false,
  probe: async () => ({
    version: "2.0.0",
    availability: {
      state: "ready",
      runner: "copilot",
      resolvedPath: "/must-not-reach-wire",
    },
  }),
  resolveCompatibility: async () => ({ eventProtocols: [] }),
});
assert.equal(preparedFallback.mode, "plain", "an unsupported mocked runtime retains generic plain chat");
assert.match(preparedFallback.compatibilityDiagnostic ?? "", /not yet compatible/);
assert.notEqual(
  preparedFallback.compatibilityDiagnostic,
  capabilityCauseMessages["version-unavailable"],
  "a parsed unsupported 2.0.0 keeps the schema incompatibility cause",
);

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
  /const harnessSessionId = grokDirect\s*\?\s*grokSessionId\s*:\s*openCodeDirect[\s\S]*?:\s*hermesDirect && hermesApi\s*\?\s*!result\.is_error && hermesResponseId\s*\?\s*hermesResponseId\s*:\s*existingConversation\?\.harnessSessionId \?\? null\s*:\s*sessionId;/,
  "failed Grok, OpenCode, or Hermes resumes must retain their prior native continuation id",
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
  /else if \(grokDirect\) \{[\s\S]{0,240}?runner: "grok",[\s\S]{0,160}?launch: grokLaunchCommand\(\)/,
  "Grok direct chats must support native executables and Windows npm command shims",
);
assert.match(
  chatRoute,
  /Grok Build chats currently run on this Cave host/,
  "SSH Grok must fail explicitly instead of falling back to coven run",
);
assert.match(
  chatRoute,
  /resolveGrokCompatibility\(await probeGrokRunCapabilities\(grokLaunchCommand\(\), harnessSpawnEnv\(body\.familiarId\)\)\)/,
  "Grok must probe the exact launcher before selecting a structured schema",
);
assert.match(
  chatRoute,
  /outputFormat: grokCompatibility\?\.mode === "structured" \? "streaming-json" : null/,
  "an unverified Grok client must use plain output rather than an assumed JSON protocol",
);
assert.match(
  chatRoute,
  /case "tool_start":[\s\S]*?envelopeToolUse[\s\S]*?consumePendingEnvelopeProgress[\s\S]*?consumePendingEnvelopeResult/,
  "selected Grok schemas must reconcile reordered progress and terminal tool results through the shared tracker",
);
assert.match(
  chatRoute,
  /case "unknown":[\s\S]*?quarantineGrokSchema[\s\S]*?redactedGrokEventFingerprint/,
  "unknown selected-schema events must quarantine future structured launches with a redacted diagnostic",
);

assert.match(
  chatRoute,
  /copilotProtocolDiagnostic\(raw, protocol\)/,
  "unknown tool-event shapes must become a redacted compatibility diagnostic instead of being silently dropped",
);
assert.match(
  chatRoute,
  /recordStdoutErrorTail\("Copilot emitted a malformed protocol frame\.", true\)/,
  "malformed Copilot JSONL records only a fixed redacted diagnostic, never the raw frame",
);
assert.match(
  chatRoute,
  /recordStdoutErrorTail\("Copilot emitted an unrecognized protocol frame\.", true\)/,
  "unframed Copilot stdout is recorded only as a fixed redacted protocol diagnostic",
);
assert.match(
  chatRoute,
  /kind: "assistant_replace", text: assistantText/,
  "an authoritative Copilot full frame replaces divergent streamed text in the live and persisted turn",
);

assert.match(
  chatRoute,
  /let localRuntimePlan: LocalRuntimePlan \| null = null;[\s\S]*?runner: "copilot"[\s\S]*?else if \(openCodeDirect\)[\s\S]*?runner: "opencode"[\s\S]*?else if \(grokDirect\)[\s\S]*?runner: "grok"[\s\S]*?else if \(hermesDirect\)[\s\S]*?runner: "hermes"[\s\S]*?runner: "coven"[\s\S]*?const command = openCodeLaunchCommand[\s\S]*?command: localPlan\.command,[\s\S]*?args: \[\.\.\.localPlan\.fixedArgs, \.\.\.spawnArgs\]/,
  "Copilot, Grok Build, Hermes, and OpenCode direct turns spawn their own CLI; other local harnesses spawn coven",
);
assert.match(
  chatRoute,
  /const copilotManifestStream = copilotDirect \? copilotStreamSpec\(\) : null;[\s\S]*?resolveCopilotRuntimeLaunch\(copilotManifestStream\.executable\)[\s\S]*?probeCopilotCapability\(copilotManifestStream\.executable/,
  "Copilot resolves and probes the manifest-declared executable instead of an independent default",
);
assert.match(
  chatRoute,
  /if \(\s*copilotCompatibilityDiagnostic &&\s*copilotRuntimeLaunch\?\.availability\.state === "ready"\s*\) \{[\s\S]*?copilot-client-compatibility/,
  "a non-ready Copilot plan emits only the structured runtime error, not a duplicate compatibility notice",
);

assert.match(
  chatRoute,
  /if \(copilotStream\) \{[\s\S]*?handleCopilotLine\(line, isJson \|\| line\.trimStart\(\)\.startsWith\("\{"\)\);[\s\S]*?return;/,
  "Complete and truncated Copilot JSONL frames route through the redacted protocol handler, never the AssistantFilter",
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
