// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "assigned GitHub route should use the shared installation-agnostic token resolver",
);

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token"/,
  "assigned GitHub route should use the shared token resolver",
);
assert.match(
  source,
  /const token = resolveGitHubToken\(\)/,
  "assigned GitHub route should use the same installation-agnostic token as the activity route",
);

assert.doesNotMatch(
  source,
  /NextResponse\.json\(\{[^}]*token/i,
  "assigned GitHub route must not return token material",
);

console.log("github-assigned-route.test.ts OK");
