import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  route,
  /const codexLaunchPlan = !sshRuntime && binding\.harness === "codex"[\s\S]*?\? covenLaunchCommand\(\)[\s\S]*?const codexSpawnEnv = codexLaunchPlan \? harnessSpawnEnv\(body\.familiarId\) : null/,
  "Codex preflight owns the exact resolved Coven plan and familiar-scoped environment",
);
assert.match(
  route,
  /: codexLaunchPlan \?\? covenLaunchCommand\(\)[\s\S]*?: codexSpawnEnv \?\? harnessSpawnEnv\(body\.familiarId\)/,
  "the Codex child reuses the command and environment preflight inspected",
);
assert.match(
  route,
  /await probeCodexRuntimeAvailability\(\{[\s\S]*?launch: codexLaunchPlan,[\s\S]*?env: codexSpawnEnv,[\s\S]*?\}\)[\s\S]*?if \(availability\.state !== "ready"\)[\s\S]*?push\(\{ kind: "error", code: availability\.code, message: availability\.message \}\)/,
  "an unavailable Codex route emits a structured error before any model attempt",
);
assert.match(
  route,
  /if \(!launchFailure\) \{[\s\S]*?await runAttempt\(/,
  "a failed Codex preflight bypasses the process launch path entirely",
);
assert.match(
  route,
  /codexAdapterFailureAvailability\([\s\S]*?launchFailure = \{ code: adapterFailure\.code, message: adapterFailure\.message \}[\s\S]*?else if \(!assistantText\.trim\(\) && !launchFailure\)/,
  "a post-preflight Codex adapter failure suppresses generic authentication/no-output copy",
);

console.log("harness-routing-codex-preflight.test.ts: ok");
