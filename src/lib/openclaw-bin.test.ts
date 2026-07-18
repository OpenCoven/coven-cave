// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./openclaw-bin.ts", import.meta.url), "utf8");

assert.match(src, /OPENCLAW_BIN/, "OpenClaw binary discovery should allow an explicit override");
assert.match(
  src,
  /process\.env\.APPDATA[\s\S]*"npm"/,
  "Windows npm shim discovery should include %APPDATA%\\npm",
);
assert.match(
  src,
  /process\.env\.npm_config_prefix/,
  "Windows npm shim discovery should include npm_config_prefix",
);
assert.match(
  src,
  /process\.platform === "win32" \? \["openclaw\.cmd", "openclaw\.exe", "openclaw"\]/,
  "Windows should prefer the npm .cmd shim before exe and bare names",
);
assert.match(
  src,
  /export function openClawNeedsShell\(bin = openClawBin\(\)\): boolean[\s\S]*process\.platform === "win32"[\s\S]*endsWith\("\.cmd"\)/,
  "Only Windows OpenClaw .cmd npm shims should require shell mode",
);
assert.match(
  src,
  /export function openClawSpawnArgs\(argv: string\[\], bin = openClawBin\(\)\): string\[\][\s\S]*openClawNeedsShell\(bin\)[\s\S]*quoteWindowsShellArg/,
  "Windows shell-mode OpenClaw spawn args should quote argv entries before Node joins them for cmd.exe",
);
assert.match(
  src,
  /export function openClawSupportsUntrustedArgs\(bin = openClawBin\(\)\): boolean[\s\S]*!openClawNeedsShell\(bin\)/,
  "OpenClaw chat should be able to reject shell-only shims before passing untrusted prompts",
);
assert.match(
  src,
  /quoteWindowsShellArg\(arg: string\)[\s\S]*return `"\$\{escaped\}"`/,
  "OpenClaw Windows shell quoting should preserve a multi-word --message as one CLI argument",
);
assert.match(
  src,
  /delete env\[key\]/,
  "OpenClaw spawn env should strip forbidden secret keys before subprocess launch",
);
assert.match(
  src,
  /FORBIDDEN_SPAWN_ENV_RE/,
  "OpenClaw spawn env should scrub secret-like Cave process variables by pattern, not a single hard-coded key",
);
assert.match(
  src,
  /OPENCLAW_ALLOW_ENV_KEYS/,
  "OpenClaw spawn env should require explicit allowlisting before passing secret-like variables through",
);

console.log("openclaw-bin.test.ts: ok");
