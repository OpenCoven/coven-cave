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
  /const a = \["run", "--format", "json"\];[\s\S]*?a\.push\("--session", resumeSessionId\);[\s\S]*?a\.push\("--model", forwardModel\);/,
  "OpenCode forwards resume session and selected model to its non-interactive JSON command",
);
assert.match(
  route,
  /const ev = parseOpenCodeRunEvent\(JSON\.parse\(line\)\);[\s\S]*?announceSession\(ev\.sessionId\);/,
  "the first structured OpenCode event persists its minted session id",
);
assert.match(
  route,
  /if \(openCodeDirect\) \{\s*handleOpenCodeLine\(line\);\s*return;/,
  "OpenCode JSON never leaks as raw assistant text",
);
assert.match(
  route,
  /command: openCodeCommand\(\), fixedArgs: \[\] as string\[\][\s\S]*?env: openCodeDirect\s*\? openCodeSpawnEnv\(body\.familiarId\)/,
  "OpenCode uses its scoped spawn environment, including the WSL runtime-dir fallback",
);
assert.match(
  capabilities,
  /openCodeSpawnEnv\(\),\s*\n\s*\)\);/,
  "OpenCode probes its CLI with the same WSL-compatible environment as a chat run",
);
assert.match(
  route,
  /!openCodeDirect && binding\.harness !== "openclaw" && \(await covenRunSupportsPermission\(\)\)/,
  "OpenCode does not require the Coven CLI to probe unrelated permission support",
);
assert.match(
  route,
  /!openCodeDirect && binding\.harness !== "openclaw" && \(await covenRunSupportsAddDir\(\)\)/,
  "OpenCode does not require the Coven CLI to probe unrelated directory support",
);
assert.match(
  route,
  /Session not found\\b/,
  "OpenCode's missing-session error triggers the existing fresh-session retry",
);
assert.match(
  route,
  /openCodeDirect && forwardModel[\s\S]*?modelApplicationFromRun\([\s\S]*?isError: result\.is_error === true,[\s\S]*?errorText: \[\.\.\.stderrTail, \.\.\.stdoutErrTail\]\.join\("\\n"\)/,
  "OpenCode marks model-specific failed runs as rejected instead of confirming the forwarded model",
);
assert.match(
  route,
  /child\.on\("close", \(code\) => \{[\s\S]*?if \(openCodeDirect && code !== 0\)[\s\S]*?is_error: true/,
  "a non-zero OpenCode exit cannot be treated as a successful model run when no JSON error arrives",
);

console.log("opencode harness routing tests passed");
