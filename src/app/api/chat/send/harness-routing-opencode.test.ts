// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

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

console.log("opencode harness routing tests passed");
