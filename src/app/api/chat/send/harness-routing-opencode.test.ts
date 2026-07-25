// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const capabilities = await readFile(new URL("./chat-send-capabilities.ts", import.meta.url), "utf8");

assert.match(
  route,
  /const openCodeDirect = !sshRuntime && binding\.harness === "opencode";/,
  "OpenCode local turns use the documented direct CLI protocol",
);
assert.match(
  route,
  /const a = \["run"\];[\s\S]*?openCodeCompatibility\?\.mode === "structured"[\s\S]*?const launch = openCodeCompatibility\.schema!\.launch;[\s\S]*?a\.push\(launch\.structuredOutput\.option, launch\.structuredOutput\.value, \.\.\.launch\.requiredFlags\);[\s\S]*?launch\.sessionOption[\s\S]*?options\.includes\("--session"\)[\s\S]*?options\.includes\("--resume"\)[\s\S]*?if \(forwardModel\)/,
  "OpenCode uses selected structured syntax and only a help-confirmed plain-mode resume option rather than a version threshold",
);
assert.match(
  route,
  /handleOpenCodeJsonLine\(line, openCodeCompatibility\?\.schema, \{[\s\S]*?onSession: \(nativeSessionId\) => \{[\s\S]*?announceSession\(nativeSessionId\);/,
  "the first structured OpenCode event persists its minted session id",
);
assert.match(
  route,
  /if \(openCodeDirect\) \{\s*handleOpenCodeLine\(line\);\s*return;/,
  "OpenCode JSON never leaks as raw assistant text",
);
assert.match(
  route,
  /const openCodeLaunchCommand = openCodeDirect \? openCodeLaunch\(spawnArgs\) : null;[\s\S]*?const child = spawn\(command\.command, command\.args, \{[\s\S]*?env: openCodeDirect\s*\? openCodeSpawnEnv\(body\.familiarId\)[\s\S]*?writeOpenCodeLaunchInput\(child, openCodeLaunchCommand\)/,
  "OpenCode uses its Windows-safe launcher, passes its argv over stdin, and keeps the scoped WSL-compatible spawn environment",
);
assert.match(
  capabilities,
  /const launch = openCodeLaunch\(\["run", "--help"\]\);[\s\S]*?launch\.command,[\s\S]*?launch\.args,[\s\S]*?openCodeSpawnEnv\(\),/,
  "OpenCode probes its CLI with the same Windows-safe command and WSL-compatible environment as a chat run",
);
assert.match(
  route,
  /!openCodeDirect\s*&&\s*binding\.harness !== "openclaw"\s*&&\s*binding\.harness !== "grok"\s*&&\s*\(await covenRunSupportsPermission\(\)\)/,
  "OpenCode and Grok do not require the Coven CLI to probe unrelated permission support",
);
assert.match(
  route,
  /!openCodeDirect\s*&&\s*binding\.harness !== "openclaw"\s*&&\s*binding\.harness !== "grok"\s*&&\s*\(await covenRunSupportsAddDir\(\)\)/,
  "OpenCode and Grok do not require the Coven CLI to probe unrelated directory support",
);
assert.match(
  route,
  /if \(openCodeDirect && body\.permissionMode === "read"\)[\s\S]*?status: 501/,
  "OpenCode refuses Cave's Read-only mode rather than running without enforceable sandboxing",
);
assert.match(
  route,
  /Session not found\\b/,
  "OpenCode's missing-session error triggers the existing fresh-session retry",
);
assert.match(
  route,
  /openCodeDirect && forwardModel[\s\S]*?modelApplicationFromRun\([\s\S]*?isError: result\.is_error === true,[\s\S]*?errorText: openCodeModelRejected \? "model unavailable" : \[\.\.\.stderrTail, \.\.\.stdoutErrTail\]\.join\("\\n"\)/,
  "OpenCode marks model-specific failed runs as rejected without retaining raw JSON error messages",
);
assert.match(
  route,
  /onError: \(ev\) => \{[\s\S]*?openCodeModelRejected \|\|= modelRejectionInError\(ev\.message\);[\s\S]*?recordStdoutErrorTail\("OpenCode reported an error event", true\)/,
  "structured OpenCode error payloads are classified but never copied into user-visible diagnostics",
);
assert.match(
  route,
  /onOther: \(ev, rawEvent\) => \{[\s\S]*?unrecognized event; that event was skipped while compatible tool activity continues/,
  "an unknown OpenCode envelope is skipped without suppressing later compatible tool activity",
);
assert.match(
  route,
  /import \{ handleOpenCodeJsonLine \} from "@\/lib\/opencode-stream";[\s\S]*?handleOpenCodeJsonLine\(line, openCodeCompatibility\?\.schema,/,
  "the route uses the behavioral JSONL handler, whose lifecycle-frame behavior is covered by its focused test",
);
assert.match(
  route,
  /child\.on\("close", \(code\) => \{[\s\S]*?if \(openCodeDirect && code !== 0\)[\s\S]*?is_error: true/,
  "a non-zero OpenCode exit cannot be treated as a successful model run when no JSON error arrives",
);
assert.match(
  route,
  /onError: \(ev\) => \{[\s\S]*?openCodeModelRejected \|\|= modelRejectionInError\(ev\.message\);[\s\S]*?recordStdoutErrorTail\("OpenCode reported an error event", true\)/,
  "structured OpenCode errors retain model-rejection state without retaining provider-controlled details",
);
assert.match(
  route,
  /openCodeCompatibility\?\.mode === "plain"[\s\S]*?assistant_chunk/,
  "clients without structured output fall back to plain assistant text instead of dropping a reply",
);
assert.match(
  route,
  /openCodeDirect && openCodeCompatibility\?\.mode === "plain" && !sessionId[\s\S]*?announceSession\(crypto\.randomUUID\(\)\)/,
  "plain OpenCode output receives a Cave-owned stable session id so its first transcript persists",
);
assert.match(
  route,
  /openCodeCompatibility\?\.mode === "plain"[\s\S]*?\? undefined[\s\S]*?: sessionId/,
  "a Cave-owned plain-mode id is never mistaken for a native OpenCode resume token",
);
assert.match(
  route,
  /openCodeDirect && body\.sessionId && existingConversation && \([\s\S]*?!openCodeCompatibility\?\.capabilities\.session[\s\S]*?\|\| !existingConversation\.harnessSessionId[\s\S]*?buildResumeRetryPrompt\(harnessPrompt, existingConversation\)/,
  "OpenCode replays Cave context only when a native resume option or token is unavailable",
);
assert.match(
  route,
  /onToolStart: \(ev\) => \{[\s\S]*?envelopeToolUse[\s\S]*?onToolEnd: \(ev\) => \{[\s\S]*?envelopeToolResult/,
  "split tool lifecycle frames preserve the stable bubble id across progress and result",
);
assert.match(
  route,
  /onTool: \(ev\) => \{[\s\S]*?envelopeToolUse[\s\S]*?consumePendingEnvelopeResult\(ev\.id\)[\s\S]*?return;[\s\S]*?envelopeToolResult/,
  "a reordered split result settles a combined terminal tool frame with the first terminal outcome",
);
assert.match(
  route,
  /opencode-compatibility[\s\S]*?unrecognized event[\s\S]*?redactedOpenCodeEventFingerprint\(rawEvent\)/,
  "unknown future event shapes surface a safe visible diagnostic",
);
assert.match(
  route,
  /persistedOpenCodeDiagnostics[\s\S]*?id === "opencode-compatibility"[\s\S]*?progress: persistedOpenCodeDiagnostics/,
  "safe OpenCode compatibility diagnostics persist with the completed assistant turn",
);
assert.match(
  route,
  /const handleOpenCodeLine[\s\S]*?onMalformedJson: \(\) => \{[\s\S]*?recordStdoutErrorTail\("OpenCode emitted a malformed JSON event", true\)/,
  "malformed structured OpenCode events never copy their raw payload into diagnostics",
);
assert.match(
  capabilities,
  /export function openCodeRunCapabilities\([^)]*\)[\s\S]*?\["--version"\][\s\S]*?json:[\s\S]*?model:[\s\S]*?session:/,
  "OpenCode discovers feature support and records version only for diagnostics",
);

console.log("opencode harness routing tests passed");
