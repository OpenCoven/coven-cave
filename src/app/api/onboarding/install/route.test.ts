// @ts-nocheck
// One-click installs must stay a hard allowlist: the request names a target,
// never a command or package, so nothing user-controlled reaches a shell.
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
]) {
  assert.match(
    source,
    new RegExp(`packageName: "${pkg}"`),
    `allowlist pins the exact npm package (${pkg})`,
  );
}

assert.match(
  source,
  /if \(!isInstallTarget\(body\.target\)\)/,
  "unknown targets are rejected before any spawn",
);

assert.match(
  source,
  /const args = \["install", "-g", target\.packageName\]/,
  "npm argv is fully fixed — only the allowlisted package name varies",
);

// The request body must never reach the spawn argv.
assert.doesNotMatch(
  source,
  /spawn\([^)]*body\./,
  "no request-body value may appear in the spawn call",
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
  "Windows spawns through a shell because npm resolves to npm.cmd",
);

assert.match(
  source,
  /commandPath\(target\.binary\)/,
  "success is verified by resolving the installed binary, not just exit code 0",
);

console.log("onboarding install route.test.ts: ok");
