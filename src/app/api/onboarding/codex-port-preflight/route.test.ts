// @ts-nocheck
//
// Guard: the codex-port-preflight route must keep the contract the
// onboarding overlay depends on:
//   1. POST handler (no GET — destructive action)
//   2. Calls preflightCodexOAuthPort()
//   3. Returns the four outcome variants the UI handles:
//      "port-free", "cleared-stale-codex", "held-by-other", "held-unknown"
//   4. Held-by-other / held-unknown return 409 so the UI can branch on
//      response.ok without parsing the body
//
// Source-string pattern matches src/app/api/onboarding/install/route.test.ts
// and src/app/api/onboarding/setup/route.test.ts — for @-aliased route
// handlers the convention is source-string assertions; functional tests
// belong in the helper module's own test (codex-oauth-port.test.ts).
//
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

// (1) POST handler exists
assert.match(
  source,
  /export\s+async\s+function\s+POST\s*\(/,
  "codex-port-preflight must export an async POST handler",
);

// (1b) NO GET handler — the action is destructive (may kill a process).
//      A drive-by GET request from a browser bar should not trigger it.
assert.doesNotMatch(
  source,
  /export\s+async\s+function\s+GET\s*\(/,
  "codex-port-preflight must NOT export a GET handler (the action is destructive)",
);

// (2) Calls the preflight helper
assert.match(
  source,
  /preflightCodexOAuthPort\(\)/,
  "route must call preflightCodexOAuthPort() exactly as named",
);

// (3) All four outcome variants are handled
for (const variant of [
  "port-free",
  "cleared-stale-codex",
  "held-by-other",
  "held-unknown",
]) {
  assert.match(
    source,
    new RegExp(`["'\`]${variant}["'\`]`),
    `route must handle outcome variant "${variant}"`,
  );
}

// (4) Held-by-other and held-unknown return HTTP 409 (Conflict)
assert.match(
  source,
  /status:\s*409/,
  "route must use HTTP 409 for held-by-other and held-unknown outcomes so the UI can branch on response.ok",
);

// (5) Defensive: the route must NOT shell out to anything itself —
//     all process-touching logic stays in the helper module so it's
//     unit-testable and reusable.
assert.doesNotMatch(
  source,
  /\b(execFile|execFileAsync|spawn|exec)\s*\(/,
  "codex-port-preflight route must not shell out directly; process logic stays in codex-oauth-port.ts",
);

console.log("codex-port-preflight route.test.ts: ok");
