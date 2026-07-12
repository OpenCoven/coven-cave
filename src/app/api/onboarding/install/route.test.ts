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
  "@opencoven\\/coven-code@latest",
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
  /await prepareForInstall\(targetName, target, job\)/,
  "installer should run target-specific preparation before npm mutates a global tool",
);

assert.match(
  source,
  /targetName !== "coven-cli"/,
  "daemon stop/kill preparation should be scoped to coven-cli upgrades only",
);

assert.match(
  source,
  /callDaemon<\{ ok\?: boolean; daemon\?: \{ pid\?: number \} \}>/,
  "coven-cli upgrades should query the live daemon pid instead of trusting stale pid files",
);

assert.match(
  source,
  /process\.kill\(pid, "SIGTERM"\)/,
  "coven-cli upgrades should clear a still-running daemon that keeps coven.exe locked",
);

assert.match(
  source,
  /installFailureHint\(targetName, job\.output\)/,
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
  /import \{\s*covenBin,\s*covenSpawnEnv,\s*pickWindowsLauncher,\s*refreshCovenSpawnEnv,?\s*\} from "@\/lib\/coven-bin"/,
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
  /commandPath\(target\.binary\)/,
  "success is verified by resolving the installed binary, not just exit code 0",
);

assert.match(
  source,
  /"coven-code":\s*\{[\s\S]*packageName: "@opencoven\/coven-code@latest"[\s\S]*binary: "coven-code"/,
  "coven-code updates use the SCOPED @opencoven package and verify the coven-code binary",
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
  /other\.kind === "npm"/,
  "npm-kind installs are mutually exclusive (global npm tree races)",
);

assert.match(
  source,
  /\{ status: 409 \}/,
  "a conflicting npm install is rejected with 409, not queued",
);

assert.match(
  source,
  /appendOutput\(job, stripAnsi\(/,
  "installer output is ANSI-stripped at append time, so the cap counts visible bytes",
);

assert.match(
  source,
  /slice\(-OUTPUT_CAP\)/,
  "job output is capped, not unbounded",
);

assert.match(
  source,
  /status: "running" as const, elapsedMs, tail/,
  "the polled running view exposes status/elapsedMs/tail — the UI contract",
);

console.log("onboarding install route.test.ts: ok");
