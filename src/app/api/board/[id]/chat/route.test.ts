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
assert.match(source, /binding\.harness === "openclaw"[\s\S]*?return reserveNativeChatTask\(\)/, "OpenClaw uses the override-preserving native handoff");
assert.match(source, /binding\.harness === "copilot" && !sshBound && !hubAuthority[\s\S]*?return reserveNativeChatTask\(\)/, "local Copilot uses the override-preserving native handoff");
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

console.log("board chat route.test.ts: ok");
