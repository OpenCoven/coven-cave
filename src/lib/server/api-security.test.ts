// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./api-security.ts", import.meta.url), "utf8");

assert.match(source, /MOBILE_ACCESS_HEADER/, "shared local guard should know about mobile proxy marker");
assert.match(
  source,
  /req\.headers\.get\(MOBILE_ACCESS_HEADER\) === "1"[\s\S]*?status:\s*403/,
  "mobile-authenticated requests must be rejected even with loopback-looking Host headers",
);
assert.match(source, /COVEN_CAVE_AUTH_TOKEN/, "packaged sidecar auth token should be enforced when configured");
assert.match(source, /timingSafeEqualString/, "sidecar token comparison should use timing-safe equality");
assert.match(source, /TOKEN_HEADER/, "sidecar token should be read from the first-party token header");
assert.match(source, /const host = req\.headers\.get\("host"\)/, "loopback Host check is still preserved");
assert.match(source, /const origin = req\.headers\.get\("origin"\)/, "loopback Origin check is still preserved");

console.log("api-security.test.ts: ok");
