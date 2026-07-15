// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "issue route should use the shared vault/env secret resolver",
);

assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "issue route should keep the owner/name barrier before path interpolation",
);

// Writes must refuse to run unauthenticated — both verbs.
const authGates = source.match(/auth_required/g) ?? [];
assert.equal(authGates.length >= 2, true, "POST and PATCH must both 401 without a PAT");

assert.match(
  source,
  /body\.state === "closed" \? "closed" : body\.state === "open" \? "open" : null/,
  "PATCH state is allow-listed to open|closed — nothing else reaches GitHub",
);

assert.doesNotMatch(
  source,
  /NextResponse\.json\(\{[^}]*token/i,
  "issue route must not return token material",
);

console.log("github-issue-route.test.ts OK");
