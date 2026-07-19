// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./api-security.ts", import.meta.url), "utf8");

// The desktop-only policy (mobile marker, sidecar token, loopback Host) lives
// in the shared isLocalOrigin gate (see local-origin.ts, behaviorally covered
// by local-origin.test.ts). api-security must DELEGATE to that gate rather than
// re-implement the checks, so the security policy can't drift across two files.
assert.match(
  source,
  /import \{ isLocalOrigin \} from "\.\/local-origin"/,
  "rejectNonLocalRequest should delegate the desktop-only policy to the shared isLocalOrigin gate",
);
assert.match(
  source,
  /if \(!isLocalOrigin\(req\)\) \{[\s\S]*?status:\s*403/,
  "a request that fails the shared local-origin gate must be rejected with 403",
);

// The duplicated sidecar-token machinery must NOT be re-implemented here.
assert.doesNotMatch(
  source,
  /timingSafeEqualString/,
  "api-security must not re-implement the timing-safe sidecar-token comparison",
);
assert.doesNotMatch(
  source,
  /COVEN_CAVE_AUTH_TOKEN/,
  "api-security must not read the sidecar token directly (single source of truth in local-origin)",
);
assert.doesNotMatch(
  source,
  /MOBILE_ACCESS_HEADER/,
  "api-security must not re-check the mobile proxy marker (delegated to isLocalOrigin)",
);

// This route family still layers its stricter cross-origin Origin-header check
// on top of the shared gate.
assert.match(
  source,
  /const origin = req\.headers\.get\("origin"\)/,
  "cross-origin Origin check is preserved on top of the shared gate",
);

console.log("api-security.test.ts: ok");
