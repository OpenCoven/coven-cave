// @ts-nocheck
//
// File-read smoke for the board task-chat route. Locks in the
// unsupported-harness branch added alongside this test: when the
// daemon rejects a session with "not a supported harness", trusted
// Chat runtimes reserve a native Chat task and untrusted runtimes get
// an actionable 409 instead of a 502 that reads as "the daemon is broken".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import\s*\{[^}]*\bauthorizeChatProjectLaunch\b[^}]*\}\s*from\s*"@\/lib\/server\/chat-project-launch"/,
  "Board task chat should use the shared project launch gate",
);
assert.match(
  source,
  /taskModelOverride \? \{ initialModelOverride: taskModelOverride \} : \{\}/,
  "native OpenClaw and local Copilot task handoffs retain the validated card model for their first Chat send",
);
assert.match(
  source,
  /const pendingFirstPromptFields = async \(reserved: Card\) => \{[\s\S]*?reservedFirstPromptPending\(reserved\)[\s\S]*?initialPrompt: buildInitialTaskChatPrompt\(card\)[\s\S]*?bridge: "native-chat"[\s\S]*?if \(card\.sessionId\) \{[\s\S]*?recheckProjectRoot\(\)[\s\S]*?\.\.\.\(await pendingFirstPromptFields\(card\)\)/,
  "a reused native reservation whose first prompt never landed hands the prompt back, after the same root recheck (#6562)",
);
assert.match(
  source,
  /const reserveNativeChatTask = async \(\) => \{[\s\S]*?sessionId,\s*nativeSessionId: sessionId,[\s\S]*?claimFirstPromptHandoff\(sessionId\);[\s\S]*?initialPrompt: buildInitialTaskChatPrompt\(card\)/,
  "only a native reservation marks its session as Cave's own, and its start claims the first prompt (#6562)",
);
assert.match(
  source,
  /return serializeTaskStart\(id, async \(\) => \{[\s\S]*?const locked = await withTaskStartLock\(id, \(\) => startTaskChat\(id, parsed\.body\)\);[\s\S]*?if \(locked\.ok\) return locked\.value;[\s\S]*?code: "task_start_busy"[\s\S]*?status: 409/,
  "every start holds the task's cross-process lock, and a busy lock refuses instead of starting unlocked (#6562)",
);
assert.match(source, /binding\.harness === "openclaw"[\s\S]*?return reserveNativeChatTask\(\)/, "OpenClaw uses the override-preserving native handoff");
assert.match(source, /binding\.harness === "copilot" && !sshBound && !hubAuthority[\s\S]*?return reserveNativeChatTask\(\)/, "local Copilot uses the override-preserving native handoff");
assert.match(
  source,
  /if \(isLocalCodexHarness\(binding\.harness\)\) \{\s*return reserveNativeChatTask\(\);[\s\S]*?path: "\/api\/v1\/sessions"/,
  "Codex local mode takes the native Chat handoff, with its local preflight, before any daemon session (#6049)",
);
assert.match(
  source,
  /validateProjectRoot:\s*validateCaveProjectRoot/,
  "Board task chat should reject a project root that no longer resolves to a directory",
);
const authorizationIndex = source.indexOf("await authorizeChatProjectLaunch");
const reuseIndex = source.indexOf("if (card.sessionId)");
const nativeReserveIndex = source.indexOf("const reserveNativeChatTask");
const daemonLaunchIndex = source.indexOf("const res = await callDaemon");
assert.ok(authorizationIndex >= 0, "Board task chat should await project authorization");
assert.ok(
  authorizationIndex < reuseIndex,
  "Board task chat must authorize before reusing a persisted session link",
);
assert.ok(
  authorizationIndex < nativeReserveIndex,
  "Board task chat must authorize before reserving a native Chat session",
);
assert.ok(
  authorizationIndex < daemonLaunchIndex,
  "Board task chat must authorize before asking the daemon to launch",
);
assert.match(
  source,
  /import\s*\{\s*assertCurrentPinnedLaunchRoot\s*\}\s*from\s*"@\/lib\/server\/project-root-pin"/,
  "Board task chat must reload and check the current project pin at launch boundaries",
);
assert.match(
  source,
  /if \(card\.sessionId\) \{\s*const rootChanged = await recheckProjectRoot\(\);/,
  "Board task chat must recheck the project pin before reusing a persisted session",
);
assert.match(
  source,
  /const rootChanged = await recheckProjectRoot\(\);\s*if \(rootChanged\) return rootChanged;\s*try \{\s*const root = await resolveRepoRoot\(projectRoot\);\s*if \(root\.ok\) \{\s*const beforeProvision = await recheckProjectRoot\(\);/,
  "Board task chat must recheck the registered root immediately before worktree provisioning",
);
assert.match(
  source,
  /const rootChanged = await recheckProjectRoot\(sessionRoot\);\s*if \(rootChanged\) return rootChanged;\s*const res = await callDaemon/,
  "Board task chat must recheck the registered root immediately before daemon dispatch",
);

// The route uses extractDaemonError so the nested
// { error: { code, message } } daemon body actually surfaces.
assert.match(
  source,
  /import\s*\{[^}]*\bextractDaemonError\b[^}]*\}\s*from\s*"@\/lib\/coven-daemon"/,
  "route imports extractDaemonError from @/lib/coven-daemon",
);

// The detection regex must remain case-insensitive so we don't miss a
// daemon-side capitalization change.
assert.match(
  source,
  /\/not a supported harness\/i/,
  "route declares an /i regex for 'not a supported harness' detection",
);

// Trusted runtimes use the native Chat handoff instead of losing Board task
// support merely because the daemon lacks their session adapter.
assert.match(
  source,
  /UNSUPPORTED_HARNESS_RE\.test\(daemonMsg\)[\s\S]{0,400}isTrustedChatHarness\(binding\.harness\)[\s\S]{0,100}reserveNativeChatTask\(\)/,
  "route falls back to native Chat when the daemon rejects a trusted runtime",
);

// Untrusted harnesses still return 409, not a generic 502.
assert.match(
  source,
  /isTrustedChatHarness\(binding\.harness\)[\s\S]{0,700}status:\s*409/,
  "route returns 409 when the daemon rejects an unsupported untrusted harness",
);

// The friendly message must name the harness from the binding so the
// user knows which familiar to reassign without reading server logs.
assert.match(
  source,
  /'\$\{binding\.harness\}'/,
  "route names the binding's harness in the friendly message",
);

// The generic-failure path now prefers `daemonMsg` over the bare
// "daemon http <status>" so other 4xx/5xx responses still surface a
// useful message.
assert.match(
  source,
  /error:\s*daemonMsg\s*\?\?\s*res\.error\s*\?\?\s*`daemon http \$\{res\.status\}`/,
  "route falls back to daemonMsg before 'daemon http <status>' on the 502 path",
);

assert.match(
  source,
  /cardModelHarness = card\.modelOverrideHarness[\s\S]{0,160}card\.modelOverride && cardModelHarness === binding\.harness[\s\S]{0,180}cleanModelId\(card\.modelOverride\)/,
  "task sessions canonicalize the card harness and only use a safe override from the familiar's current runtime",
);
assert.match(
  source,
  /cardModelHarness === binding\.harness && !taskModelOverride[\s\S]{0,240}code: "invalid_model_override"/,
  "task launches reject an unsafe current-runtime override instead of silently falling back",
);
assert.match(
  source,
  /isModelAllowedByRuntime\(binding\.harness, taskModelOverride\)[\s\S]{0,220}code: "unsupported_model_override"/,
  "task launches reject a safe-looking override that the selected runtime cannot accept",
);
assert.match(
  source,
  /const configuredModel = binding\.model \? cleanModelId\(binding\.model\) : null[\s\S]{0,420}code: "invalid_configured_model"[\s\S]{0,420}isModelAllowedByRuntime\(binding\.harness, configuredModel\)/,
  "task launches validate the familiar default at the daemon boundary",
);

assert.match(
  source,
  /updateCard\(card\.id, \{ modelOverride: null, modelOverrideHarness: null \}\)/,
  "a stale model override is cleared when a familiar's harness changes",
);

assert.match(
  source,
  /\.\.\.\(\(taskModelOverride \?\? configuredModel\)[\s\S]{0,100}\? \{ model: taskModelOverride \?\? configuredModel \}[\s\S]{0,30}: \{\}\)/,
  "task sessions forward explicit models and omit an absent runtime-owned default",
);

assert.match(
  source,
  /binding\.harness\s*=\s*canonicalHarnessId\(binding\.harness\)/,
  "task launch canonicalizes package and binary harness aliases before daemon validation",
);

// Windows Hermes configurations created before prompt_flag support point to a
// POSIX-only launcher. The route must repair that known manifest before the
// daemon creates its PTY, or retrying a task will fail before Hermes starts.
assert.match(
  source,
  /import\s*\{[^}]*\bensureAdapterManifestScaffold\b[^}]*\}\s*from\s*"@\/lib\/server\/adapter-manifest-scaffold"/,
  "route imports the adapter-manifest migration helper",
);
assert.ok(
  source.indexOf("await ensureAdapterManifestScaffold(binding.harness)") < source.indexOf("const res = await callDaemon"),
  "route repairs the trusted harness manifest before daemon session creation",
);
assert.match(
  source,
  /if \(binding\.hermesProfile\) \{[\s\S]*?return reserveNativeChatTask\(\);/,
  "profile-bound Hermes tasks reserve native chat so their first turn receives the explicit profile argv",
);
assert.match(
  source,
  /if \(binding\.hasInvalidHermesProfileBinding\)[\s\S]*?Hermes profile binding is invalid/,
  "a malformed persisted Hermes profile binding blocks task launch instead of degrading to sticky Hermes",
);

// #6562: a folder refusal a person must clear (unconfirmed, or moved) is
// recorded on the task once, keyed by the project the refusal names, on both
// the admission and the pre-launch recheck paths. The refusal carries the
// updated card, and recording never changes its status or code.
const recordBlock = source.slice(source.indexOf("const recordFolderBlocker = async"), source.indexOf("const refusal = ("));
assert.match(recordBlock, /if \(error\.code !== "project_root_unconfirmed" && error\.code !== "project_root_moved"\) return null;/, "only folder refusals a person clears are recorded");
assert.match(recordBlock, /const refusedProjectId = error\.projectId \?\? knownProjectId \?\? card\.projectId;/, "the blocker names the refused project");
assert.match(recordBlock, /recordLaunchBlocker\(card\.id, \{\s*ref: projectFolderBlockerRef\(refusedProjectId\),\s*kind: "human",\s*label: projectFolderBlockerLabel\(name, error\.code === "project_root_moved"\),/);
assert.match(recordBlock, /console\.warn\(/, "a failed write is logged, not silently dropped");
assert.match(source, /const refusal = \(error: ChatProjectLaunchError, recorded: Card \| null\) =>\s*NextResponse\.json\(\s*\{ \.\.\.chatProjectLaunchRefusalBody\(error\), \.\.\.\(recorded \? \{ card: recorded \} : \{\}\) \},\s*\{ status: error\.status \},/, "the refusal keeps its body and status and adds the updated card");
assert.match(source, /return refusal\(error, await recordFolderBlocker\(error\)\);/, "admission records the refusal");
assert.match(source, /return refusal\(error, await recordFolderBlocker\(error, authorizedProjectId\)\);/, "the pre-launch recheck records the refusal");

// #6562: a launch that passes the pin check resolves the task's wait on that
// folder however it was confirmed. It runs only after authorization.
const resolveIndex = source.indexOf("await resolveLaunchBlockers(folderRef");
assert.ok(resolveIndex > source.indexOf("authorizedProjectId = authorized.projectId;"), "resolution follows a passing launch check");
assert.ok(resolveIndex < source.indexOf("const recheckProjectRoot"), "resolution happens before any launch work");

// #6562: only a started daemon session dispatches here, and only a ready,
// triaged task, decided inside the board lock. A native Chat reservation has
// not sent the prompt; the Board dispatches it once the first send lands.
const markStart = source.slice(source.indexOf("const markTaskStarted = async"), source.indexOf("const reserveNativeChatTask"));
assert.match(markStart, /transitionCard\(started\.id, \{\s*to: "dispatched",\s*reason: `Task chat started \(session \$\{sessionId\}\)`,\s*onlyIf: readyToDispatch,/, "dispatch goes through the guarded state machine");
assert.doesNotMatch(markStart, /loadBoard\(\)/, "no readiness check outside the lock");
assert.match(markStart, /\} catch \(error\) \{[\s\S]*?return started;/, "a lifecycle refusal never undoes a started chat");
assert.equal((source.match(/const started = await markTaskStarted\(updated, sessionId\);/g) ?? []).length, 1, "only the daemon path dispatches at start");
const reserve = source.slice(source.indexOf("const reserveNativeChatTask"), source.indexOf("// OpenClaw has no daemon adapter"));
assert.doesNotMatch(reserve, /markTaskStarted/, "a native reservation never dispatches before its prompt is sent");

// #6562: daemon offline is the only daemon failure that falls back, and only
// on this computer for a trusted runtime. A timeout may have created the
// session, so it is never resent.
assert.match(
  source,
  /res\.status === 0 &&\s*res\.error === "daemon offline" &&\s*!sshBound &&\s*!hubAuthority &&\s*isTrustedChatHarness\(binding\.harness\)\s*\) \{\s*return reserveNativeChatTask\(\);/,
  "a provably unsent daemon request falls back to native Chat on this computer",
);
assert.doesNotMatch(source, /"daemon timeout"/, "a daemon timeout never triggers a fallback");
assert.ok(
  source.indexOf('res.error === "daemon offline"') < source.indexOf("{ status: 502 }"),
  "the fallback is tried before the 502",
);

console.log("board chat route.test.ts: ok");
