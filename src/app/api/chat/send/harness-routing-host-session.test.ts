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
const modelHelpers = await readFile(
  new URL("./chat-send-models.ts", import.meta.url),
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
assert.match(
  chatRoute,
  /isTrustedChatHarness\(binding\.harness\)/,
  "Native chat should enforce the trusted Coven harness gate before spawning coven run",
);

assert.match(
  chatRoute,
  /binding\.harness = canonicalHarnessId\(binding\.harness\)/,
  "Native chat must canonicalize the bound harness id (e.g. hermes-agent → hermes) before the trust gate, so an aliased familiar isn't 403'd",
);

assert.match(
  chatRoute,
  /const adapter = COMPATIBILITY_ADAPTERS\.find\(\(h\) => h\.id === binding\.harness\);/,
  "Native chat should consult bundled adapter metadata before spawning a harness",
);

assert.match(
  chatRoute,
  /if \(adapter && !adapter\.chatSupported\)/,
  "Native chat should reject bundled adapters that opt out of native chat",
);

assert.match(
  chatRoute,
  /const hermesDirect = !sshRuntime && binding\.harness === "hermes"/,
  "local Hermes chats should use its documented direct one-shot command instead of a POSIX-only Coven shim",
);

assert.match(
  chatRoute,
  /const a = \["chat", "--source", "coven", "-Q"\];[\s\S]*a\.push\("--query", prompt\)/,
  "Hermes direct chat must use quiet query mode so stdout contains the actual reply",
);

assert.match(
  chatRoute,
  /const modelForwardingEnabled = hermesDirect[\s\S]*?await hermesChatSupportsModel\(\)/,
  "Hermes model forwarding must probe its direct CLI instead of assuming the coven-run capability applies",
);

assert.match(
  chatRoute,
  /if \(hermesDirect\) \{[\s\S]*?if \(forwardModel\) a\.push\("--model", forwardModel\);[\s\S]*?a\.push\("--query", prompt\)/,
  "An advertised Hermes --model flag must receive the selected model before the query",
);

assert.match(
  chatRoute,
  /captureHermesSessionFromStderr[\s\S]*session_id:\\s\*\(\\S\+\)/,
  "Hermes quiet mode must capture its resumable session id from stderr",
);

assert.match(
  chatRoute,
  /command: process\.platform === "win32" \? "hermes\.exe" : "hermes"/,
  "Hermes direct chat must use the Windows executable name on Windows",
);

assert.doesNotMatch(
  chatRoute,
  /const a = \["run", binding\.harness, "--stream-json"\];[\s\S]*binding\.harness === "openclaw"/,
  "OpenClaw should not be special-cased inside the generic coven run argv builder",
);

// Permission enforcement: Read-only forwards `coven run --permission read-only`
// (mapped to the harness's native sandbox flag), gated on the CLI advertising
// the flag; "full" stays implicit so the harness keeps its default sandbox.
assert.match(
  chatRoute,
  /covenRunSupportsPermission\(\)/,
  "route capability-probes coven run --permission before forwarding",
);
assert.match(
  chatRoute,
  /body\.permissionMode === "read" \? "read-only" : null/,
  "only Read-only is forwarded; Full access stays implicit (harness default sandbox)",
);
assert.match(
  chatRoute,
  /a\.push\("--permission", forwardPermission\)/,
  "coven run argv forwards --permission when enabled",
);

assert.match(
  chatRoute,
  /if \(binding\.harness === "openclaw" && !sshRuntime\)/,
  "OpenClaw native chat should use its agent CLI bridge instead of coven run",
);

assert.match(
  chatRoute,
  /if \(sshRuntime && binding\.harness === "openclaw"\)[\s\S]*OpenClaw SSH runtime is not supported yet/,
  "OpenClaw over SSH should fail clearly until Cave has a dedicated remote OpenClaw bridge",
);

assert.match(
  chatRoute,
  /const sshRuntime = isSshRuntime\(effectiveRuntime\) \? effectiveRuntime : null;[\s\S]*buildSshSpawnArgs/,
  "SSH runtime chats should build SSH argv before local process spawning",
);

// ── Host picker (composer Host chip) ─────────────────────────────────────────
// An explicit allowed host wins; with no request, a conversation recorded on
// an allowed ssh host stays pinned there; only then does the familiar's own
// runtime binding decide. Unregistered hosts are rejected fail-closed and the
// remote command comes from the registry, never the body.
assert.match(
  chatRoute,
  /const runtimeSelection = resolveRequestedRuntime\(\{\s*requestedHost: body\.runtimeHost,\s*conversationRuntime: existingConversation\?\.runtime,/,
  "the requested host resolves against the server-side registry with the conversation runtime as fallback",
);
assert.match(
  chatRoute,
  /if \(!runtimeSelection\.ok\) \{[\s\S]{0,220}status: 400/,
  "an unregistered host is rejected with a 400, never improvised",
);
assert.match(
  chatRoute,
  /const effectiveRuntime = runtimeSelection\.runtime \?\? binding\.runtime;/,
  "the familiar's own runtime binding stays the final fallback",
);
assert.match(
  chatRoute,
  /remoteHosts: config\.remoteHosts,/,
  "registered remote hosts feed the registry",
);
assert.match(
  chatRoute,
  /familiarRuntimes: \[config\.defaults\?\.runtime, binding\.runtime\]/,
  "inherited familiar SSH runtimes are scoped to the current familiar instead of every familiar",
);
assert.match(
  chatRoute,
  /currentRuntime: binding\.runtime,/,
  "requested local execution is authorized against the current familiar runtime",
);
assert.doesNotMatch(
  chatRoute,
  /Object\.values\(config\.familiars \?\? \{\}\)\.map\(\(entry\) => entry\?\.runtime\)/,
  "send must not expose every familiar's SSH runtime as a selectable chat host",
);

assert.match(
  chatRoute,
  /spawn\("ssh", sshArgs/,
  "SSH runtime chat should spawn the local ssh binary with prebuilt argv instead of shell-concatenating locally",
);

assert.match(
  chatRoute,
  /resolveOpenClawAgentBinding\(args\.body\.familiarId\)/,
  "OpenClaw native chat should resolve Cave familiar ids to typed OpenClaw agent bindings",
);

assert.match(
  chatRoute,
  /import \{ openClawBin, openClawNeedsShell, openClawSpawnArgs, openClawSpawnEnv, openClawSupportsUntrustedArgs \} from "@\/lib\/openclaw-bin";/,
  "OpenClaw native chat should use the Windows-aware binary resolver instead of spawning a bare command",
);
assert.match(
  chatRoute,
  /if \(!openClawSupportsUntrustedArgs\(openclawCommand\)\)[\s\S]*openclaw_unsafe_shell/,
  "OpenClaw chat should fail closed before passing untrusted prompts to shell-only Windows shims",
);

assert.match(
  openclawBridge,
  /export interface RuntimeBridge[\s\S]*id: "openclaw";[\s\S]*resolveAgent\(familiarId: string\): Promise<OpenClawAgentBinding>;/,
  "OpenClaw native chat should expose a typed runtime bridge contract separate from adapter manifests",
);

assert.match(
  openclawBridge,
  /type OpenClawBridgeRequest = \{[\s\S]*familiarId: string;[\s\S]*conversationId\?: string;[\s\S]*controls\?:/,
  "OpenClaw bridge requests should capture Cave conversation ids, attachments, and response controls",
);

assert.match(
  openclawBridge,
  /export type OpenClawBridgeCapabilities = \{[\s\S]*stableSessionKey: boolean;[\s\S]*localFileAttachments: false;[\s\S]*nativeMemory: true;/,
  "OpenClaw bridge should expose first-class capability flags for UI/runtime code",
);

assert.match(
  openclawBridge,
  /"agent"[\s\S]*"--agent"[\s\S]*agentId[\s\S]*"--message"[\s\S]*harnessPrompt[\s\S]*"--json"/,
  "OpenClaw native chat should call openclaw agent with the resolved agent id and JSON output",
);

assert.match(
  openclawBridge,
  /spawn\(openClawBin\(\), openClawSpawnArgs\(\["agents", "list", "--json"\]\)[\s\S]*env: openClawSpawnEnv\(\),[\s\S]*shell: openClawNeedsShell\(\)/,
  "OpenClaw agent listing should launch Windows npm .cmd shims correctly",
);

assert.match(
  chatRoute,
  /const openclawCommand = openClawBin\(\);[\s\S]*const spawnArgv = openClawSpawnArgs\(argv, openclawCommand\);[\s\S]*spawn\(openclawCommand, spawnArgv,[\s\S]*env: openClawSpawnEnv\(\),[\s\S]*shell: openClawNeedsShell\(openclawCommand\)/,
  "OpenClaw chat should only spawn an OpenClaw command that can receive untrusted prompt argv safely",
);

// Session persistence contract (regression: chats forked into new sessions
// every time OpenClaw rotated its internal session id):
// 1. every turn pins the conversation to a cave-owned explicit session id/key — values are
//    OpenClaw's durable identity; internally generated session ids rotate on reset/compaction;
// 2. the gateway's session id is never adopted as the conversation key.
assert.match(
  openclawBridge,
  /"--session-id",\s*\n?\s*openClawSessionKey\(conversationId\)/,
  "OpenClaw native chat must pin a per-conversation explicit session id/key",
);
assert.match(
  chatRoute,
  /const conversationId = args\.body\.sessionId \?\? crypto\.randomUUID\(\)/,
  "Continuing chats reuse the cave conversation id; new chats mint one",
);
assert.match(
  chatRoute,
  /const sessionId: string = conversationId/,
  "Conversation identity stays cave-owned across turns",
);
assert.match(
  chatRoute,
  /openclawAgentId: agentBinding\.openclawAgentId,[\s\S]*caveSessionId: conversationId,[\s\S]*gatewaySessionId: undefined,[\s\S]*sessionKey: openClawSessionKey\(conversationId\)/,
  "OpenClaw transcript metadata should persist Cave id, session key, agent id, and diagnostic gateway id separately",
);
assert.match(
  chatRoute,
  /responseMetadata\.gatewaySessionId = gatewaySessionId;/,
  "OpenClaw gateway session ids should be surfaced only as response diagnostics",
);
assert.doesNotMatch(
  chatRoute,
  /sessionId = extractOpenClawSessionId/,
  "The gateway's rotating session id must never become the conversation key",
);
assert.match(
  chatRoute,
  /error instanceof OpenClawAgentResolutionError[\s\S]*pushProgress\("openclaw-resolve", "OpenClaw agent resolution failed", "error", error\.message\)/,
  "Missing OpenClaw agents should stream a clear bridge error before spawning",
);
assert.doesNotMatch(
  chatRoute,
  /"--session-key"/,
  "OpenClaw chat route must not emit the removed --session-key flag",
);
// Model parity superseded the old "never emit --model" guard: --model is now
// forwarded, but ONLY behind the coven run capability probe (see the gated
// forwarding assertions at the end of this file). Guard against an UNGATED
// emission sneaking back in.
assert.doesNotMatch(
  chatRoute,
  /a\.push\("--model"\)(?!.*forwardModel)/,
  "Cave chat must never emit --model except behind the forwardModel gate",
);
assert.match(
  chatRoute,
  /modelApplicationState: modelState\.applicationState/,
  "Response metadata should expose unsupported/saved state instead of claiming application",
);
assert.match(
  modelHelpers,
  /const sessionModel =[\s\S]*modelOverrideScope === "session"[\s\S]*\? requestedModel[\s\S]*: args\.existingConversation\?\.modelIntent\?\.model \?\? null/,
  "Session-scoped model overrides should feed the response model state, not only desiredModel",
);
assert.match(
  chatRoute,
  /if \(existingConversation && existingConversation\.familiarId !== body\.familiarId\)/,
  "Send must reject session ids owned by a different familiar before reading model intent",
);
assert.match(
  chatRoute,
  /persistSendModelIntent\(conv, args\.body, args\.modelState\)/,
  "OpenClaw transcript persistence should save direct session-scoped model intent",
);
assert.match(
  chatRoute,
  /persistSendModelIntent\(conv, body, modelState\)/,
  "Native transcript persistence should save direct session-scoped model intent",
);
assert.match(
  chatRoute,
  /const push = \(e: StreamEvent\) => \{[\s\S]*?if \(closed \|\| req\.signal\.aborted\) return;[\s\S]*?controller\.enqueue\(chatSse\(e, seq\)\);[\s\S]*?catch/,
  "Native stream pushes should be ignored after close/abort so late child output cannot enqueue into a closed stream",
);
assert.match(
  chatRoute,
  /catch \(error\) \{[\s\S]*?closed = true;[\s\S]*?if \(!req\.signal\.aborted\) console\.warn/,
  "Native stream enqueue failures should mark the stream closed and avoid noisy abort-path errors",
);
assert.match(
  chatRoute,
  /const push = \(event: StreamEvent\) => \{[\s\S]*?if \(closed \|\| args\.req\.signal\.aborted\) return;[\s\S]*?controller\.enqueue\(chatSse\(event, seq\)\);[\s\S]*?catch/,
  "OpenClaw stream pushes should be ignored after close/abort so late child close/error output cannot enqueue into a cancelled stream",
);
assert.doesNotMatch(
  chatRoute,
  /saveConfig\([\s\S]*modelOverride/,
  "A chat send must not persist one-off model overrides into Cave config",
);

assert.match(
  chatRoute,
  /reasoningEffort\?: string;/,
  "Send body should accept the composer thinking control value",
);
assert.match(
  chatRoute,
  /responseSpeed\?: string;/,
  "Send body should accept the composer speed control value",
);
assert.match(
  chatView,
  /fetch\("\/api\/chat\/send"[\s\S]*body: JSON\.stringify\(\{[\s\S]*reasoningEffort: controlsOverride\?\.thinkingEffort \?\? thinkingEffort,[\s\S]*responseSpeed: controlsOverride\?\.responseSpeed \?\? responseSpeed/,
  "ChatView should send selected Thinking and Speed controls through the existing chat send body",
);
assert.match(
  chatRoute,
  /type OfflineChatQueuePayload = Pick<[\s\S]*\|\s*"reasoningEffort"[\s\S]*\|\s*"responseSpeed"/,
  "Offline queued sends should preserve response controls from any composer surface",
);
assert.match(
  chatRoute,
  /const payload: OfflineChatQueuePayload = \{[\s\S]*reasoningEffort: args\.body\.reasoningEffort,[\s\S]*responseSpeed: args\.body\.responseSpeed/,
  "The send route should carry composer responseSpeed through offline queue payloads",
);
assert.match(
  modelHelpers,
  /function buildPromptWithResponseControls/,
  "Chat send model helpers should turn composer controls into harness-visible instructions",
);
assert.match(
  modelHelpers,
  /const speed = normalizeResponseSpeed\(body\.responseSpeed\)/,
  "Chat send model helpers should continue accepting responseSpeed from all composer send bodies",
);
assert.match(
  chatRoute,
  /buildPromptWithResponseControls\([\s\S]*buildPromptWithAttachments\(promptText/,
  "Response controls should wrap the user prompt before the normal harness prompt pipeline",
);

// Native (coven) path: same stable-identity contract.
assert.match(
  chatRoute,
  /const resumeTarget = body\.sessionId\s*\n?\s*\? existingConversation\?\.harnessSessionId \?\? body\.sessionId/,
  "Resume targets the harness's latest session id, not the stable conversation id",
);
assert.match(
  chatRoute,
  /const finalSessionId = body\.sessionId \?\? sessionId/,
  "Transcripts persist under the stable conversation id across resumed turns",
);
assert.match(
  chatRoute,
  /const announcedId = body\.sessionId \?\? sessionId/,
  "The client is always told the stable conversation id, never the rotated harness id",
);
assert.match(
  chatRoute,
  /conv\.harnessSessionId = harnessSessionId/,
  "The harness's rotating id is tracked on the conversation for the next resume",
);
assert.match(
  chatRoute,
  /existingConversation\?\.runtime\?\.startsWith\("local:"\)/,
  "Resumed turns reuse the conversation's recorded cwd — harness stores are cwd-scoped",
);

assert.match(
  chatRoute,
  /await resolveLocalRuntimeCwd\(body\.projectRoot \?\? resumeCwd \?\? resolvedFamiliarWorkspace\)/,
  "Local Cave chat must fail closed on invalid project roots instead of downgrading to homedir",
);

assert.match(
  chatRoute,
  /error instanceof RuntimeScopeError[\s\S]*code: error\.code/,
  "Runtime scope errors should return structured JSON before spawning a harness",
);

assert.match(
  chatRoute,
  /const runtimeScope: RuntimeScope = sshRuntime[\s\S]*kind: "ssh"[\s\S]*kind: "local"/,
  "The prompt boundary should describe the actual local or SSH runtime root",
);

assert.match(
  chatRoute,
  /filterProjectsForFamiliar\(projects, body\.familiarId\)/,
  "Local Cave chat should derive grant-aware project roots for the familiar before building the runtime prompt",
);

assert.match(
  chatRoute,
  /allowedProjectRoots: grantedProjectRoots/,
  "The runtime prompt should include every project root the familiar is granted, not only the spawn cwd",
);

assert.match(
  chatRoute,
  /import \{[\s\S]*ProjectAccessDeniedError,[\s\S]*assertProjectAccess,[\s\S]*\} from "@\/lib\/project-permissions";/,
  "Chat send should import the shared project-permission chokepoint",
);

assert.match(
  chatRoute,
  /import \{ chatProjectAccessId \} from "@\/lib\/chat-project-access";/,
  "Chat send should resolve project access ids through the shared chat-project-access helper (explicit and resumed roots resolve to a project id; unknown explicit roots fail closed; the familiar's own workspace is exempt — see chat-project-access.test.ts)",
);

assert.match(
  chatRoute,
  /const chatProjectId = sshRuntime[\s\S]*chatProjectAccessId\(\{[\s\S]*requestedProjectRoot: body\.projectRoot,[\s\S]*resumeCwd,[\s\S]*resolvedCwd: cwd,[\s\S]*familiarWorkspace: resolvedFamiliarWorkspace,[\s\S]*\}\);[\s\S]*await assertProjectAccess\(\{ familiarId: body\.familiarId \}, chatProjectId, "chat"\);/,
  "Local project-scoped chat must assert project access — with the familiar's own workspace exempt — before building the harness prompt",
);

assert.doesNotMatch(
  chatRoute,
  /bootstrapConfiguredFamiliarProjectGrants/,
  "Chat send must not grant configured familiars project access before enforcing the chokepoint",
);

assert.match(
  chatRoute,
  /error instanceof ProjectAccessDeniedError[\s\S]*status: error\.status/,
  "Project access denials should return structured JSON 403 responses before spawning a harness",
);

assert.match(
  chatRoute,
  /const scopedPrompt = buildPromptWithRuntimeScope\(/,
  "Every chat harness prompt should carry the runtime filesystem boundary",
);

assert.match(
  chatRoute,
  /const harnessPrompt = buildPromptWithBoundaryReminder\(scopedPrompt, body\.sessionId\)/,
  "The harness prompt should carry the corrective boundary reminder when the previous turn went out of bounds",
);

assert.match(
  chatRoute,
  /boundarySentinel\?\.observe\(block\.name, block\.input\)/,
  "Envelope tool_use blocks should feed the boundary sentinel",
);

assert.match(
  chatRoute,
  /if \(!isPost\) boundarySentinel\?\.observe\(name, rest\)/,
  "pre_tool_use hook lines should feed the boundary sentinel",
);

assert.match(
  chatRoute,
  /recordBoundaryViolations\(boundarySessionId, boundaryViolations\)/,
  "Boundary violations should be recorded to steer the conversation's next turn",
);

assert.match(
  streamEvents,
  /\|\s*\{\s*kind: "progress";\s*id\?: string;\s*label: string;\s*detail\?: string;\s*status\?: "running" \| "done" \| "error";\s*durationMs\?: number;\s*\}/,
  "Native chat streams should expose progress SSE events for quiet phases",
);

assert.match(
  chatRoute,
  /pushProgress\("openclaw-resolve", "Resolving OpenClaw agent", "running"[\s\S]*pushProgress\("openclaw-resolve", "OpenClaw agent resolved", "done"/,
  "OpenClaw bridge should show agent resolution progress before the JSON response returns",
);

assert.match(
  chatRoute,
  /pushProgress\(\s*"harness-start",\s*`Starting \$\{binding\.harness\}`,\s*"running"[\s\S]*pushProgress\(\s*"harness-start",\s*`\$\{binding\.harness\} exited`,\s*"done"/,
  "Coven harness streams should show process start and exit progress",
);

assert.match(
  chatRoute,
  /pushProgress\(\s*"resume-retry",[\s\S]*?"Resume failed; starting a fresh chat",\s*"running",?\s*\)[\s\S]*?pushProgress\(\s*"resume-retry",[\s\S]*?"Fresh chat started",\s*"done",?\s*\)[\s\S]*?await runAttempt\(buildArgs\(null, retry\.prompt\)\)/,
  "Transparent resume fallback should be visible in the progress timeline and settle BEFORE the fresh attempt runs — left running until the attempt ended, 'Resume failed…' headlined the activity strip for the whole reply",
);

assert.match(
  chatRoute,
  /const retry = buildResumeRetryPrompt\(harnessPrompt, existingConversation\)[\s\S]*?retry\.replayedHistory[\s\S]*?await runAttempt\(buildArgs\(null, retry\.prompt\)\)/,
  "Fresh-session retry should replay recent conversation history so the familiar keeps context",
);

assert.match(
  chatRoute,
  /session\\s\+\\S\+\\s\+not found in local store/,
  "Transparent resume fallback should also handle Coven local-store misses from stale session ids",
);

assert.match(
  chatRoute,
  /No conversation found with session ID/,
  "Transparent resume fallback should also handle Claude conversation-store misses from stale session ids",
);

assert.match(
  chatRoute,
  /Session not found:/,
  "Transparent resume fallback should also handle Hermes session-store misses",
);

assert.match(
  chatRoute,
  /stderrTail\.length = 0;[\s\S]*stdoutErrTail\.length = 0;[\s\S]*await runAttempt\(buildArgs\(null, retry\.prompt\)\)/,
  "Fresh-chat retry should clear stale diagnostic tails before the retry attempt",
);

assert.match(
  chatRoute,
  /pushProgress\("save-transcript", "Saving transcript", "running"[\s\S]*await saveConversation\(conv\)[\s\S]*pushProgress\("save-transcript", "Transcript saved", "done"/,
  "Conversation persistence should be visible before the final done event",
);

assert.match(
  chatRoute,
  /defaultChatTitleForSession\(finalSessionId\)/,
  "Fresh persisted chats should use a neutral New Session title instead of the first user prompt",
);

assert.match(
  chatRoute,
  /await setDefaultSessionTitleIfMissing\(finalSessionId, chatTitle\)/,
  "Fresh chats should store a Cave-side title override so daemon prompt-derived titles do not win in the session list",
);

assert.match(
  chatRoute,
  /async function setDefaultSessionTitleIfMissing[\s\S]*await setSessionTitle\(sessionId, title\)/,
  "The default title override helper should preserve existing titles and write only through the Cave title override path",
);

assert.match(
  boardRoute,
  /isTrustedChatHarness\(binding\.harness\)/,
  "Board step enrichment should enforce the same trusted Coven harness gate",
);
