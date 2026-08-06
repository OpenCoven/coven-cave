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

const chatRoute = await readFile(
  new URL("./route.ts", import.meta.url),
  "utf8",
);
const copilotStream = await readFile(
  new URL("../../../../lib/copilot-stream.ts", import.meta.url),
  "utf8",
);
const grokBuild = await readFile(
  new URL("../../../../lib/grok-build.ts", import.meta.url),
  "utf8",
);
const capabilityProbes = await readFile(
  new URL("./chat-send-capabilities.ts", import.meta.url),
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
// ── Model parity (gated --model passthrough) ───────────────────────────────
assert.match(
  capabilityProbes,
  /covenRunSupportsModelFlag/,
  "Model forwarding must gate on the coven run --model capability probe",
);
assert.match(
  capabilityProbes,
  /export type HelpProbeOutcome =[\s\S]*?\{ ok: true; matched: boolean \}[\s\S]*?\{ ok: false; reason: string \}/,
  "Help probes report an incomplete probe separately from an unmatched flag",
);
for (const failure of [
  /did not respond within \$\{timeoutMs\}ms/,
  /child\.on\("error", \(error: Error\) => \{[\s\S]*?ok: false, reason: `\\`\$\{command\}\\` could not be started: \$\{error\.message\}`/,
]) {
  assert.match(
    capabilityProbes,
    failure,
    "Timeouts and spawn errors carry the underlying reason instead of resolving false",
  );
}
assert.match(
  capabilityProbes,
  /const probe = start\(\)\.then\(\(outcome\) => \{[\s\S]*?if \(!outcome\.ok\) write\(null\);/,
  "Only answered capability probes are cached; a failed probe must not pin itself for the process lifetime",
);
assert.match(
  capabilityProbes,
  /export function covenRunModelFlagOutcome\(\): Promise<HelpProbeOutcome>[\s\S]*?export function covenRunSupportsModel\(\): Promise<boolean> \{[\s\S]*?outcome\.ok && outcome\.matched/,
  "The boolean model capability is derived from the outcome rather than replacing it",
);
assert.match(
  capabilityProbes,
  /export function hermesChatSupportsModel\(launch:[\s\S]*?\["chat", "--help"\][\s\S]*?launch\.env[\s\S]*?launch\.cwd/,
  "Direct Hermes model forwarding must probe hermes chat --help with its resolved command, scoped environment, and spawn cwd",
);

assert.match(
  chatRoute,
  /const covenModelProbeDecides =[\s\S]*?binding\.harness !== "openclaw";[\s\S]*?const covenModelForwarding = covenModelProbeDecides[\s\S]*?probeCovenCapabilityOutcome\(covenRunModelFlagOutcome\)/,
  "OpenClaw never forwards --model; generic Coven forwarding uses the ready-plan-gated probe",
);
assert.match(
  chatRoute,
  /const modelForwardingProbeFailure[\s\S]*?covenModelForwarding\.ran === false[\s\S]*?covenModelForwarding\.value\.ok === false/,
  "A Coven model probe that never ran and one that failed to complete are both kept distinct from an answered probe",
);
assert.match(
  chatRoute,
  /const covenModelForwardingSupported =[\s\S]*?covenModelForwarding\.ran === true &&[\s\S]*?value\.ok === true &&[\s\S]*?value\.matched === true/,
  "Model forwarding turns on only for a probe that ran, completed, and matched",
);
for (const rejection of [
  /if \(explicitModelSelection && !modelForwardingEnabled\) \{[\s\S]*?if \(modelForwardingProbeFailure\) \{[\s\S]*?code: "model_forwarding_probe_failed"[\s\S]*?modelApplicationReason: modelForwardingProbeFailure\.reason/,
  /if \(savedModelRejection === "forwarding"\) \{[\s\S]*?if \(modelForwardingProbeFailure\) \{[\s\S]*?code: "model_forwarding_probe_failed"[\s\S]*?modelApplicationReason: modelForwardingProbeFailure\.reason/,
]) {
  assert.match(
    chatRoute,
    rejection,
    "A failed capability probe is reported as a probe failure with its underlying reason, never as an unsupported model",
  );
}

assert.match(
  chatRoute,
  /const selectedModel = cleanModelId\(desiredModel\);[\s\S]*?const forwardModel =[\s\S]*?modelForwardingEnabled && selectedModel[\s\S]*?\? modelForRuntimeLaunch\(binding\.harness, selectedModel\)[\s\S]*?: null;/,
  "forwardModel must gate a clean id and translate only at the native runtime boundary",
);
assert.match(
  chatRoute,
  /forwardModel && forwardModel !== desiredModel[\s\S]*?\? desiredModel[\s\S]*?: forwardModel/,
  "retry metadata preserves the canonical Cave id when launch argv uses a runtime alias",
);
assert.match(
  chatRoute,
  /modelForCaveFromRuntimeEcho\(\s*binding\.harness,\s*selectedModel,\s*echoed,\s*\)/,
  "runtime echoes must be converted back to Cave's canonical model id",
);

assert.match(
  chatRoute,
  /if \(forwardModel\) a\.push\("--model", forwardModel\);/,
  "Local argv should push --model before the -- prompt separator when forwarding",
);

assert.match(
  chatRoute,
  /buildSshSpawnArgs\(\{[\s\S]*?model: forwardModel,[\s\S]*?\}\)/,
  "SSH spawn args should forward the same gated model",
);

// Direct native launches consume registry-owned model-id transforms. Copilot
// and Grok apply them in their focused argv builders; Hermes and OpenCode do
// so at the route's direct transport boundary. Generic Coven/SSH delegation
// retains the provider-qualified id because Coven applies the transform.
assert.match(
  copilotStream,
  /runtimeModelIdForLaunch\("copilot", launch\.model\)/,
  "Copilot direct argv must consume its registry model-id transform",
);
assert.match(
  grokBuild,
  /runtimeModelIdForLaunch\("grok", input\.model\)/,
  "Grok direct argv must consume its registry model-id transform",
);
assert.match(
  chatRoute,
  /const hermesLaunchModel = hermesDirect\s*\?\s*runtimeModelIdForLaunch\("hermes", forwardModel\)\s*:\s*null;/,
  "Hermes direct transports must derive their launch-only model from registry metadata",
);
assert.match(
  chatRoute,
  /const openCodeLaunchModel = openCodeDirect\s*\?\s*runtimeModelIdForLaunch\("opencode", forwardModel\)\s*:\s*null;/,
  "OpenCode direct argv must derive its launch-only model from registry metadata",
);
assert.match(
  chatRoute,
  /const grokLaunchModel = grokDirect\s*\?\s*runtimeModelIdForLaunch\("grok", grokForwardModel\)\s*:\s*null;/,
  "Grok confirmation metadata must share the post-transform launch guard",
);
assert.match(
  chatRoute,
  /if \(hermesLaunchModel\) a\.push\("--model", hermesLaunchModel\);/,
  "Hermes native CLI argv uses the transformed launch value",
);
assert.match(
  chatRoute,
  /body: JSON\.stringify\(\{[\s\S]*?\.\.\.\(hermesLaunchModel \? \{ model: hermesLaunchModel \} : \{\}\)/,
  "Hermes native API payload omits model field when hermesLaunchModel is null",
);
assert.match(
  chatRoute,
  /if \(openCodeLaunchModel\) a\.push\("--model", openCodeLaunchModel\);/,
  "OpenCode native argv uses the transformed launch value",
);
const genericCovenArgvBlock = chatRoute.match(
  /const a = \["run", binding\.harness, "--stream-json"\];[\s\S]*?return a;/,
);
assert.ok(genericCovenArgvBlock, "generic Coven argv builder block should be present");
assert.match(
  genericCovenArgvBlock[0],
  /if \(forwardModel\) a\.push\("--model", forwardModel\);/,
  "Codex/Claude Coven delegation must retain the provider-qualified model id",
);
assert.match(
  chatRoute,
  /if \(openCodeDirect && openCodeLaunchModel && forwardModel\)[\s\S]*?confirmedModel: forwardModel,[\s\S]*?responseMetadata\.confirmedModel = forwardModel;/,
  "OpenCode confirms the original provider-qualified id only when its launch guard forwarded a model",
);

// --model is emitted before the `--` separator, never after (the prompt is a
// variadic positional that would otherwise swallow it).
const localArgvBlock = chatRoute.match(/const a = \["run", binding\.harness, "--stream-json"\];[\s\S]*?a\.push\("--", prompt\);/);
assert.ok(localArgvBlock, "local argv builder block should be present");
assert.ok(
  localArgvBlock[0].indexOf('a.push("--model"') < localArgvBlock[0].indexOf('a.push("--", prompt)'),
  "--model must be pushed before the -- prompt separator",
);

// ── Directory grants (gated --add-dir passthrough) ─────────────────────────
// Granted project roots must be forwarded to the harness or they stay
// prompt-text-only: the runtime-scope preamble describes the grants, but a
// harness that only trusts its cwd denies every access to them.
assert.match(
  capabilityProbes,
  /covenRunSupportsAddDirFlag/,
  "--add-dir forwarding must gate on the coven run capability probe",
);
assert.match(
  chatRoute,
  /binding\.harness !== "grok" &&\s*binding\.harness !== "hermes" &&\s*\(\(await probeCovenCapability\(covenRunSupportsAddDir\)\) \?\? false\)/,
  "Direct Grok and Hermes paths must not wait for an unrelated ready-plan-gated coven run --add-dir probe",
);
assert.match(
  chatRoute,
  /addDirForwardingEnabled && !sshRuntime/,
  "--add-dir forwarding is local-only; SSH runtimes own their remote filesystem",
);
assert.match(
  chatRoute,
  /for \(const dir of forwardAddDirs\) a\.push\("--add-dir", dir\);/,
  "Local argv should push each granted root via the repeatable --add-dir flag",
);
assert.ok(
  localArgvBlock[0].indexOf('a.push("--add-dir"') < localArgvBlock[0].indexOf('a.push("--", prompt)'),
  "--add-dir must be pushed before the -- prompt separator",
);
assert.match(
  chatRoute,
  /\.filter\(\(root\) => root && root !== spawnRoot\)/,
  "The spawn cwd is already trusted and must not be re-forwarded",
);
// The grant LIST is computed ungated (local runtimes only); the coven-run
// probe only gates the `coven run --add-dir` forwarding, never the list
// itself — the copilot direct spawn consumes it without the coven probe.
assert.match(
  chatRoute,
  /const grantDirs = !sshRuntime\s*\n?\s*\? Array\.from\(/,
  "Granted-root list must be computed independently of the coven run probe",
);
assert.match(
  chatRoute,
  /const forwardAddDirs = addDirForwardingEnabled && !sshRuntime \? grantDirs : \[\];/,
  "coven run forwarding stays gated on the --add-dir capability probe",
);
// Copilot direct-stream grant forwarding (cave-n1yc): the direct spawn never
// goes through `coven run`, so it must receive the UNGATED grant list and
// emit copilot's native repeatable --add-dir pairs itself. Without this,
// read-only copilot sessions get no granted-root access at all and full
// sessions ride --allow-all instead of the declared grant boundary.
assert.match(
  chatRoute,
  /return buildCopilotStreamArgs\(\{[\s\S]*?addDirs: grantDirs,[\s\S]*?\}\);/,
  "The copilot direct spawn must forward the ungated grant list as addDirs",
);

assert.match(
  chatRoute,
  /responseMetadata\.confirmedModel = confirmedModel;/,
  "A harness-echoed model should be recorded as the confirmed model",
);

assert.match(
  chatRoute,
  /else if \(confirmedModel\) \{[\s\S]*?modelApplicationFromRun\(\{[\s\S]*?confirmedModel,/,
  "a direct runtime echo is evaluated as confirmation only in the native-runtime branch",
);

const covenModelMetadataStart = chatRoute.indexOf('else if (localRuntimePlan?.runner === "coven" && forwardModel) {');
const nativeModelMetadataStart = chatRoute.indexOf("else if (confirmedModel) {", covenModelMetadataStart);
assert.ok(
  covenModelMetadataStart >= 0 && nativeModelMetadataStart > covenModelMetadataStart,
  "Coven-forwarded model metadata must be handled before generic harness echoes",
);
const covenModelMetadataBlock = chatRoute.slice(covenModelMetadataStart, nativeModelMetadataStart);
assert.match(
  covenModelMetadataBlock,
  /Coven forwarded the selected model; downstream acceptance was not confirmed\./,
  "forwarding a model through Coven must not be described as downstream acceptance",
);
assert.doesNotMatch(
  covenModelMetadataBlock,
  /responseMetadata\.confirmedModel = confirmedModel/,
  "a Coven system-init model echo must not be persisted as a confirmed model",
);

console.log("model parity routing tests passed");
