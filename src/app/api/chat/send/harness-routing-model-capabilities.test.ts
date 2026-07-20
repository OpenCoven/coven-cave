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
  chatRoute,
  /covenRunSupportsModelFlag/,
  "Model forwarding must gate on the coven run --model capability probe",
);

assert.match(
  chatRoute,
  /binding\.harness !== "openclaw" && \(await covenRunSupportsModel\(\)\)/,
  "OpenClaw never forwards --model; every other harness gates on the probe",
);

assert.match(
  chatRoute,
  /const forwardModel =\s*\n?\s*modelForwardingEnabled && cleanModelId\(desiredModel\) \? desiredModel : null;/,
  "forwardModel must require both an enabled probe and a clean model id",
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
  chatRoute,
  /covenRunSupportsAddDirFlag/,
  "--add-dir forwarding must gate on the coven run capability probe",
);
assert.match(
  chatRoute,
  /binding\.harness !== "openclaw" && \(await covenRunSupportsAddDir\(\)\)/,
  "OpenClaw never forwards --add-dir; every other harness gates on the probe",
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
  /modelApplicationForHarness\(\{ supported: true, confirmed: true \}\)/,
  "Confirming an echoed model should promote the application state to applied",
);

console.log("model parity routing tests passed");

