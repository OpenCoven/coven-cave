// @ts-nocheck
// One-click installs must stay a hard allowlist: the request names a target,
// never a command, package, or URL — so nothing user-controlled reaches a
// shell. Two fixed mechanisms exist: pinned npm packages and pinned official
// install scripts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const INSTALL_TARGETS = \{/,
  "install targets live in a fixed allowlist map",
);

for (const pkg of [
  "@opencoven\\/cli@latest",
  "@openai\\/codex",
  "@anthropic-ai\\/claude-code",
  "@github\\/copilot@latest",
  "openclaw@latest",
]) {
  assert.match(
    source,
    new RegExp(`packageName: "${pkg}"`),
    `allowlist pins the exact npm package (${pkg})`,
  );
}

// Hermes installs via its official script — both platform commands pinned.
assert.match(
  source,
  /posix: "curl -fsSL https:\/\/hermes-agent\.nousresearch\.com\/install\.sh \| bash"/,
  "hermes POSIX installer URL is pinned to the official script",
);
assert.match(
  source,
  /windows: "iex \(irm https:\/\/hermes-agent\.nousresearch\.com\/install\.ps1\)"/,
  "hermes Windows installer URL is pinned to the official script",
);

assert.match(
  source,
  /if \(!isInstallTarget\(body\.target\)\)/,
  "unknown targets are rejected before any spawn",
);

assert.match(
  source,
  /args: \["install", "-g", target\.packageName\]/,
  "npm argv is fully fixed — only the allowlisted package name varies",
);

assert.match(
  source,
  /await prepareForInstall\(targetName, job\)/,
  "installer should run target-specific preparation before npm mutates a global tool",
);

assert.match(
  source,
  /targetName !== "coven-cli"/,
  "daemon stop/kill preparation should be scoped to coven-cli upgrades only",
);

assert.match(
  source,
  /callDaemonTarget<LocalDaemonHealth>\(localDaemonTarget\(\),/,
  "coven-cli upgrades should inspect only the laptop-local daemon rather than a configured remote hub",
);

assert.match(
  source,
  /Resolve it for every probe: Windows daemon[\s\S]*new pipe name to daemon\.json/,
  "daemon recovery re-resolves the local pipe after restart instead of probing a stale Windows socket",
);

assert.match(
  source,
  /prepareDaemonForCliUpdate\(dependencies\)/,
  "coven-cli upgrades should explicitly capture and stop the pre-update daemon lifecycle",
);

assert.match(
  source,
  /recoverDaemonAfterCliUpdate\(job\.daemon, daemonLifecycleDependencies\(job\)\)/,
  "both successful and failed CLI installs should restore a daemon that was running before update",
);

assert.match(
  source,
  /refreshCovenBin\(\)/,
  "daemon recovery should clear cached executable discovery after npm rewrites the CLI",
);

assert.doesNotMatch(
  source,
  /process\.kill\(pid/,
  "the updater must never SIGTERM a reported PID, which could be stale or reused",
);

assert.match(
  source,
  /installFailureHint\(targetName, output\)/,
  "installer should translate common Windows lock failures into actionable guidance",
);

// The request body must never reach the spawn call.
assert.doesNotMatch(
  source,
  /spawn\([^)]*body\./,
  "no request-body value may appear in the spawn call",
);

// Script targets run only pinned constants from the allowlist.
assert.match(
  source,
  /args: \["-lc", target\.posix\]/,
  "POSIX script spawn uses the pinned allowlist command only",
);
assert.match(
  source,
  /args: \["-NoProfile", "-Command", target\.windows\]/,
  "Windows script spawn uses the pinned allowlist command only",
);

assert.match(
  source,
  /npmMissing: true/,
  "missing npm returns a structured marker so the UI can show Node.js setup",
);

assert.match(
  source,
  /nodeInstallHint\(\)/,
  "npm-missing responses carry a platform-specific Node.js install hint",
);

assert.match(
  source,
  /import \{\s*covenBin,\s*covenSpawnEnv,\s*pickWindowsLauncher,\s*refreshCovenBin,\s*refreshCovenSpawnEnv,?\s*\} from "@\/lib\/coven-bin"/,
  "install route can refresh Cave's cached PATH before declaring npm missing",
);

assert.match(
  source,
  /commandPath\("npm", \{ refreshOnMiss: true \}\)/,
  "npm discovery retries with a refreshed PATH so clicking Install again can see newly installed Node.js",
);

assert.match(
  source,
  /code === 1/,
  "command lookup treats only the normal which/where not-found exit as missing npm",
);

assert.match(
  source,
  /commandLookupFailed/,
  "transient command lookup failures are reported separately instead of mislabeling them as missing Node.js",
);

for (const platform of ["darwin", "win32"]) {
  assert.match(
    source,
    new RegExp(`process\\.platform === "${platform}"`),
    `Node.js hint covers ${platform} (linux is the fallback branch)`,
  );
}

assert.match(
  source,
  /shell: process\.platform === "win32"/,
  "Windows spawns npm through a shell because it resolves to npm.cmd",
);

assert.match(
  source,
  /verifyOpenCovenToolInstall\(targetName\)/,
  "OpenCoven installs refresh discovery and perform the authoritative executable/version verification",
);

assert.match(
  source,
  /targetName === "coven-cli" \? \{ refresh: true \}/,
  "CLI success refreshes the executable environment before resolving the installed binary",
);

assert.match(
  source,
  /isVerifiedOpenCovenInstallSuccess\(code, verification\)/,
  "a zero npm exit is necessary but insufficient: OpenCoven success also requires verified post-install state",
);

assert.match(
  source,
  /job\.verification = verification/,
  "the polled job carries sanitized path/version verification evidence to the UI",
);

assert.match(
  source,
  /redactSensitiveInstallOutput\(job\.output \+ stripAnsi\(chunk\)\)/,
  "installer tails re-redact the combined buffer so secrets split across chunks cannot leak",
);

assert.match(
  source,
  /daemon: job\.daemon/,
  "polled jobs expose lifecycle state so the UI can show daemon progress and health",
);

assert.doesNotMatch(
  source,
  /"coven-code":\s*\{/,
  "coven-code is no longer a separate install target — @opencoven/cli self-manages the engine",
);
assert.doesNotMatch(
  source,
  /packageName: "coven-code@/,
  "bare coven-code is a different, deprecated npm package — installs must never target it",
);

// ── Background install jobs ─────────────────────────────────────────────────
// POST starts the installer and returns immediately; GET polls job status.

assert.match(
  source,
  /__covenInstallJobs/,
  "job registry lives on globalThis so dev HMR cannot orphan running jobs",
);

assert.match(
  source,
  /export async function GET/,
  "a GET status endpoint exists for the client to poll",
);

assert.match(
  source,
  /\{ status: 202 \}/,
  "POST registers the job and returns 202 without awaiting the installer",
);

assert.match(
  source,
  /existing\?\.status === "running"/,
  "re-POST while a target is running is idempotent — no duplicate spawn",
);

assert.match(
  source,
  /reserveGlobalNpmInstall\(targetName\)/,
  "npm installs reserve one global npm lease across every allowlisted target",
);

assert.match(
  source,
  /const plan = await spawnPlanFor\(target\);[\s\S]*?reserveGlobalNpmInstall\(targetName\)/,
  "the atomic global reservation happens after asynchronous plan preparation",
);

assert.match(
  source,
  /retryable: true,[\s\S]*?code: "npm_install_in_progress"[\s\S]*?"Retry-After": "2"/,
  "a competing npm request gets a specific, retryable conflict response",
);

assert.match(
  source,
  /npmBusyTarget: InstallTarget \| null/,
  "GET exposes the global npm owner so every client surface can reflect it",
);

assert.match(
  source,
  /export async function DELETE[\s\S]*?job\.cancel\?\.\(\)/,
  "a running install can be cancelled through the route",
);

assert.match(
  source,
  /function finishInstallJobError\([\s\S]*?npmLease\?\.release\(\)/,
  "terminal job error paths release the global npm lease",
);

assert.match(
  source,
  /const safeMessage =\s*"Cave could not safely stop the local daemon before updating the CLI\. The update was not started\.";[\s\S]*?finishInstallJobError\([\s\S]*?safeMessage/,
  "a failed graceful daemon stop keeps actionable copy without exposing raw command output",
);

assert.match(
  source,
  /forceFinishTimer = setTimeout\([\s\S]*?finish\(null, null, new Error\(job\.error \?\? reason\)\)/,
  "the timeout watchdog settles a child that never emits close",
);

assert.match(
  source,
  /@\/lib\/server\/global-npm-install-lane/,
  "the HMR-safe global npm lease is owned by a dedicated server module",
);

assert.match(
  source,
  /\{ status: 409 \}/,
  "a conflicting npm install is rejected with 409, not queued",
);

assert.match(
  source,
  /redactSensitiveInstallOutput\(job\.output \+ stripAnsi\(chunk\)\)/,
  "installer output is ANSI-stripped and redacted before the capped diagnostics tail is stored",
);

assert.match(
  source,
  /slice\(-OUTPUT_CAP\)/,
  "job output is capped, not unbounded",
);

assert.match(
  source,
  /status: "running" as const,[\s\S]*elapsedMs,[\s\S]*tail/,
  "the polled running view exposes status/elapsedMs/tail — the UI contract",
);

console.log("onboarding install route.test.ts: ok");
