// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /doctor:\s*\[[^\]]*"--non-interactive"/,
  "coven doctor must not be invoked with --non-interactive; the CLI rejects that flag",
);

assert.match(
  source,
  /daemon:\s*\["status"\]/,
  "coven daemon slash exec should still run the status subcommand",
);

assert.match(
  source,
  /isMissingExecutableError\(e\)[\s\S]*covenCliMissingError\(\)/,
  "missing Coven CLI spawn errors should return the stable install/setup payload",
);
assert.match(source, /BoundedProcessOutput/, "slash-command CLI output should be explicitly bounded");
assert.match(source, /terminateProcessTree\(child\)/, "timeouts should terminate the owned process tree");
assert.match(source, /detached: process\.platform !== "win32"/, "POSIX slash-command launches should own a process group");
assert.doesNotMatch(source, /error: e\.message/, "spawn diagnostics must not expose raw executable paths");

assert.match(
  source,
  /COVEN_CAVE_CORRELATION_ID:\s*diagnostics\.correlationId/,
  "allowlisted CLI children inherit the request correlation",
);
assert.match(
  source,
  /recordDaemonDiagnosticEvent\(diagnostics/,
  "CLI execution emits structured local lifecycle events",
);
assert.match(
  source,
  /DAEMON_DIAGNOSTIC_CORRELATION_HEADER/,
  "CLI responses expose the correlation without exposing command output in diagnostics",
);

console.log("coven exec route.test.ts: ok");
