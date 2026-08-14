// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [mobile, harnesses, launch, hosts, install, installService] = await Promise.all([
  readFile(new URL("../app/api/mobile-handoff/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/harnesses/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/launch/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/hosts/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/install/install-process.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/onboarding/install/install-service.ts", import.meta.url), "utf8"),
]);

for (const [name, source] of [
  ["mobile handoff", mobile],
  ["harness probes", harnesses],
  ["Terminal launch", launch],
  ["SSH host probe", hosts],
  ["installer stop", install],
]) {
  assert.match(source, /terminateProcessTree/, `${name} should terminate the owned tree`);
  assert.match(
    source,
    /detached: (?:process\.platform !== "win32"|true)/,
    `${name} should own a POSIX process group`,
  );
}

for (const [name, source] of [
  ["mobile handoff", mobile],
  ["harness probes", harnesses],
  ["Terminal launch", launch],
  ["installer stop", install],
]) {
  assert.match(source, /BoundedProcessOutput/, `${name} should cap retained process output`);
}

for (const [name, source] of [
  ["mobile handoff", mobile],
  ["harness probes", harnesses],
  ["Terminal launch", launch],
  ["SSH host probe", hosts],
  ["installer stop", install],
]) {
  assert.match(source, /timedOut/, `${name} should preserve timeout semantics through close`);
}

assert.match(install, /shell: false/, "installer stop should never execute through a shell");
assert.match(
  installService,
  /if \(unresolvedWindowsShim\)/,
  "installer daemon stop should reject an unresolved Windows batch shim",
);
assert.match(
  harnesses,
  /function whichWith[\s\S]*?redactOutput: false/,
  "executable discovery should preserve valid Nix store hashes",
);
assert.doesNotMatch(mobile, /stderr: error\.message/, "mobile diagnostics should not expose raw spawn errors");
assert.doesNotMatch(launch, /error: err\.message/, "Terminal diagnostics should not expose raw spawn errors");

console.log("process-boundary-contracts.test.ts: ok");
