// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "assigned GitHub route should use the shared vault/env secret resolver",
);

assert.match(
  source,
  /resolveSecret\("GITHUB_PAT"\)\s*\?\?\s*process\.env\.GITHUB_TOKEN\?\.trim\(\)\s*\?\?\s*process\.env\.COVEN_GITHUB_TOKEN\?\.trim\(\)/,
  "assigned GitHub route should reuse the saved GitHub PAT before legacy token env vars",
);

assert.doesNotMatch(
  source,
  /NextResponse\.json\(\{[^}]*token/i,
  "assigned GitHub route must not return token material",
);

console.log("github-assigned-route.test.ts OK");
