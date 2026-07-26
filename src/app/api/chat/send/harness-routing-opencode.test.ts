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
  /resolveOpenCodeCompatibility\(await openCodeRunCapabilities\(body\.familiarId\)\)/,
  "OpenCode capability discovery uses the same familiar scope as its launched runtime",
);
assert.match(
  route,
  /const a = \["run"\];[\s\S]*?openCodeCompatibility\?\.mode === "structured"[\s\S]*?const launch = openCodeCompatibility\.schema!\.launch;[\s\S]*?a\.push\([\s\S]*?launch\.structuredOutput\.option,[\s\S]*?launch\.requiredFlags[\s\S]*?launch\.sessionOption[\s\S]*?options\.includes\("--session"\)[\s\S]*?options\.includes\("--resume"\)[\s\S]*?if \(forwardModel\)/,
  "OpenCode uses selected structured syntax and only a help-confirmed plain-mode resume option rather than a version threshold",
);
assert.match(
  route,
  /import \{ StringDecoder \} from "node:string_decoder";[\s\S]*?const openCodeStdoutDecoder = openCodeDirect \? new StringDecoder\("utf8"\) : null;[\s\S]*?openCodeStdoutDecoder \? openCodeStdoutDecoder\.write\(data\)[\s\S]*?openCodeStdoutDecoder\?\.end\(\)/,
  "OpenCode stdout uses a streaming UTF-8 decoder and flushes its final bytes before parsing JSONL",
);
assert.match(
  route,
  /const openCodeEndOfOptionsSupported = Boolean\([\s\S]*?capabilities\.endOfOptions[\s\S]*?mode === "plain"[\s\S]*?launch\.endOfOptions === true[\s\S]*?const openCodePromptNeedsDelimiter = openCodeDirect && harnessPrompt\.startsWith\("--"\);[\s\S]*?if \(openCodePromptNeedsDelimiter && !openCodeEndOfOptionsSupported\)[\s\S]*?status: 400[\s\S]*?if \(openCodeEndOfOptionsSupported\) a\.push\("--"\);/,
  "OpenCode emits the end-of-options delimiter only when both the selected schema and help probe confirm it, refusing an unsafe flag-shaped prompt otherwise",
);
assert.match(
  route,
  /const valueOptions = openCodeCompatibility\?\.capabilities\.valueOptions \?\? \[\];[\s\S]*?options\.includes\("--session"\) && valueOptions\.includes\("--session"\)[\s\S]*?options\.includes\("--resume"\) && valueOptions\.includes\("--resume"\)/,
  "plain-mode OpenCode resumes only through an explicitly argument-taking session option",
);
assert.match(
  route,
  /\.\.\.\(launch\.structuredOutput\.value === undefined \? \[\] : \[launch\.structuredOutput\.value\]\)/,
  "a signed valueless structured switch is forwarded without inventing a json argument",
);
assert.match(
  route,
  /let openCodeNativeResumeUsed = false;[\s\S]*?openCodeNativeResumeUsed = false;[\s\S]*?openCodeNativeResumeUsed = true;[\s\S]*?let openCodeSessionId: string \| null = null;[\s\S]*?onSession: \(nativeSessionId\) => \{[\s\S]*?openCodeSessionId = nativeSessionId;[\s\S]*?if \(!sessionId\) announceSession\(nativeSessionId\);[\s\S]*?openCodeSessionId \?\? \(openCodeNativeResumeUsed/,
  "OpenCode preserves a native token only when this attempt actually resumed it, while event tokens remain separate from Cave's stable session id",
);
assert.match(
  route,
  /if \(openCodeDirect\) \{\s*handleOpenCodeLine\(line\);\s*return;/,
  "OpenCode JSON never leaks as raw assistant text",
);
assert.match(
  route,
  /const openCodeLaunchCommand = openCodeDirect \? openCodeLaunch\(spawnArgs\) : null;[\s\S]*?const spawnEnv = openCodeDirect\s*\? openCodeSpawnEnv\(body\.familiarId\)\s*: harnessSpawnEnv\(body\.familiarId\);[\s\S]*?const child = spawn\(command\.command, command\.args, \{[\s\S]*?env: spawnEnv,[\s\S]*?writeOpenCodeLaunchInput\(child, openCodeLaunchCommand\)/,
  "OpenCode uses its Windows-safe launcher, passes its argv over stdin, and keeps the scoped WSL-compatible spawn environment that the availability gate probed",
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
  /if \(resumeFailed && body\.sessionId\) \{[\s\S]*?sessionId = null;[\s\S]*?openCodeSessionId = null;[\s\S]*?await runAttempt\(buildArgs\(null, retry\.prompt\)(?:, retry\.prompt)?\)/,
  "a fresh OpenCode resume retry clears the stale native token before launching without --session",
);
assert.match(
  route,
  /openCodeDirect && forwardModel[\s\S]*?modelApplicationFromRun\([\s\S]*?isError: result\.is_error === true,[\s\S]*?errorText: openCodeModelRejected \? "model unavailable" : \[\.\.\.stderrTail, \.\.\.stdoutErrTail\]\.join\("\\n"\)/,
  "OpenCode marks model-specific failed runs as rejected without retaining raw JSON error messages",
);
assert.match(
  route,
  /onError: \(ev\) => \{[\s\S]*?openCodeModelRejected \|\|= modelRejectionInError\(ev\.message\);[\s\S]*?resumeFailed \|\|= RESUME_ERR_RE\.test\(ev\.message\);[\s\S]*?recordStdoutErrorTail\("OpenCode reported an error event", true\)/,
  "structured OpenCode errors retain only safe classifications while a missing native session triggers the fresh-session recovery",
);
assert.match(
  route,
  /import \{[\s\S]*?quarantineOpenCodeSchema,[\s\S]*?onOther: \(ev, rawEvent\) => \{[\s\S]*?quarantineOpenCodeSchema\(openCodeCompatibility\?\.schema\)/,
  "an unknown OpenCode envelope quarantines its schema for future turns without replaying the current tool-capable request",
);
assert.match(
  route,
  /openCodeCompatibilityHealthNoticeSent[\s\S]*?openCodeProtocolQuarantineNoticeSent/,
  "registry-health and parser-quarantine diagnostics are independently surfaced in the affected turn",
);
assert.match(
  route,
  /compatibility registry is unavailable; continuing in plain chat without tool activity/,
  "an unavailable expired registry accurately reports plain fallback rather than a parser that is not active",
);
assert.doesNotMatch(
  route,
  /openCodeStructuredIncompatibility|structured-stream-quarantined/,
  "an incompatible structured request is never replayed as an unbounded plain retry",
);
assert.doesNotMatch(
  route,
  /const openCodePlainFallback = openCodeDirect && openCodeCompatibility\?\.mode === "plain";[\s\S]*?if \(openCodePlainFallback && RESUME_ERR_RE\.test\(line\)\) \{[\s\S]*?resumeFailed = true;[\s\S]*?return;/,
  "unframed plain OpenCode output never discards assistant text merely because it resembles a resume failure",
);
assert.match(
  route,
  /existingConversation\?\.harnessSessionId \?\? body\.sessionId[\s\S]*?openCodeUnrecordedResume[\s\S]*?announceSession\(crypto\.randomUUID\(\)\)[\s\S]*?not recorded locally and this client cannot resume it; starting a fresh chat/,
  "an unrecorded OpenCode resume token is attempted when supported or visibly restarted when it is not",
);
assert.match(
  route,
  /import \{ handleOpenCodeJsonLine \} from "@\/lib\/opencode-stream";[\s\S]*?handleOpenCodeJsonLine\(line, openCodeCompatibility\?\.schema,/,
  "the route uses the behavioral JSONL handler, whose lifecycle-frame behavior is covered by its focused test",
);
assert.match(
  route,
  /child\.on\("close", \(code\) => \{[\s\S]*?if \(\(openCodeDirect \|\| copilotStream\) && code !== 0\)[\s\S]*?is_error: true/,
  "a non-zero direct OpenCode or Copilot exit cannot be treated as a successful run when no JSON error arrives",
);
assert.match(
  route,
  /onError: \(ev\) => \{[\s\S]*?openCodeModelRejected \|\|= modelRejectionInError\(ev\.message\);[\s\S]*?recordStdoutErrorTail\("OpenCode reported an error event", true\)/,
  "structured OpenCode errors retain model-rejection state without retaining provider-controlled details",
);
assert.match(
  route,
  /const tailBlock = !openCodeDirect && tailSource\.length/,
  "OpenCode stderr never becomes assistant-visible or persisted empty-response diagnostics",
);
assert.match(
  route,
  /openCodeCompatibility\?\.mode === "plain"[\s\S]*?assistant_chunk/,
  "clients without structured output fall back to plain assistant text instead of dropping a reply",
);
assert.match(
  route,
  /const harnessSessionId = grokDirect[\s\S]*?: openCodeDirect[\s\S]*?openCodeSessionId \?\? \(openCodeNativeResumeUsed[\s\S]*?existingConversation\?\.harnessSessionId[\s\S]*?: undefined\)/,
  "a plain OpenCode turn retains a native id only when that token was actually used for the current launch",
);
assert.match(
  route,
  /else if \(openCodeDirect && existingConversation && !openCodeNativeResumeUsed\) \{[\s\S]*?delete conv\.harnessSessionId/,
  "a fresh OpenCode compatibility fallback clears the obsolete native token from the persisted conversation",
);
assert.match(
  route,
  /const openCodeNativeResumeSupported = openCodeCompatibility\?\.mode === "structured"[\s\S]*?schema\?\.launch\.sessionOption[\s\S]*?const openCodeFreshSessionForCompatibility = Boolean\([\s\S]*?!openCodeNativeResumeSupported[\s\S]*?buildResumeRetryPrompt\(harnessPrompt, existingConversation\)/,
  "OpenCode replays Cave context when the selected schema cannot launch a native resume",
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
  /const quarantineOpenCodeProtocol[\s\S]*?recordStdoutErrorTail\("OpenCode emitted a malformed JSON event", true\)[\s\S]*?quarantineOpenCodeSchema\(openCodeCompatibility\?\.schema\)[\s\S]*?const handleOpenCodeLine[\s\S]*?onMalformedJson: \(\) => \{[\s\S]*?quarantineOpenCodeProtocol\(/,
  "malformed structured OpenCode events quarantine future structured launches without copying raw payloads into text or diagnostics",
);
assert.match(
  route,
  /let openCodeStructuredProtocolQuarantined = false;[\s\S]*?openCodeStructuredProtocolQuarantined = true/,
  "a malformed or unknown frame latches the active structured stream into quarantine",
);
assert.match(
  route,
  /if \(openCodeStructuredProtocolQuarantined\) \{[\s\S]*?never allow later frames to create tools, results, or sessions[\s\S]*?handleOpenCodeJsonLine\(line, openCodeCompatibility\?\.schema, \{[\s\S]*?onText: \(ev\)/,
  "the current stream disables structured tool/session callbacks after quarantine while retaining only schema-validated text",
);
assert.match(
  route,
  /const MAX_OPENCODE_JSONL_FRAME_BYTES = 256 \* 1024;[\s\S]*?let discardingOpenCodeFrame = false;[\s\S]*?Buffer\.byteLength\(jsonBuf, "utf8"\) > MAX_OPENCODE_JSONL_FRAME_BYTES[\s\S]*?discardingOpenCodeFrame = true;[\s\S]*?oversized-jsonl-event/,
  "unterminated OpenCode JSONL frames are bounded, discarded through their newline, and quarantined without retaining provider payloads",
);
assert.match(
  route,
  /openCodeCompatibility\?\.mode === "plain"[\s\S]*?Buffer\.byteLength\(jsonBuf, "utf8"\) > MAX_OPENCODE_JSONL_FRAME_BYTES[\s\S]*?const plainChunk = jsonBuf;[\s\S]*?jsonBuf = "";[\s\S]*?handleLine\(plainChunk\)/,
  "plain OpenCode compatibility mode flushes oversized partial stdout instead of buffering it indefinitely",
);
assert.match(
  route,
  /const handleOpenCodeLine = \(line: string\) => \{[\s\S]*?const plainText = resolveBackspaces\(stripAnsi\(line\)\);[\s\S]*?if \(openCodeCompatibility\?\.mode === "plain"\)[\s\S]*?return;[\s\S]*?permission requested[\s\S]*?plainText\.trim\(\)/,
  "plain OpenCode fallback preserves unframed assistant text while structured JSON filters the known control notice",
);
assert.doesNotMatch(
  capabilities,
  /openCodeCapabilitiesProbe/,
  "OpenCode must not retain capability evidence that could be stale after an in-place same-version CLI upgrade; chat-send-capabilities tests this behavior with two probes",
);

console.log("opencode harness routing tests passed");
