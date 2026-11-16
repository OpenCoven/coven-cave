// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "dispatch route should use the shared installation-agnostic token resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "dispatch route should keep the owner/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "dispatch is a write — it must 401 without a PAT");
assert.match(
  source,
  /typeof data\?\.message === "string" \? data\.message/,
  "dispatch passes GitHub's own error message through verbatim",
);
assert.doesNotMatch(source, /:\s*token\b/, "dispatch route must not return token material");

console.log("github-dispatch-route.test.ts OK");
assert.match(source, /const WORKFLOW_RE = /, "workflow name/id validated before path interpolation");
assert.match(source, /const REF_RE = /, "ref validated");
// Any 2xx accepts the dispatch (204, or 200 with run details); a torn 2xx
// body must not become a failure that invites a second dispatch (#6369).
assert.match(source, /if \(!res\.ok\) \{/, "dispatch success is any 2xx");
assert.match(source, /isAmbiguousWriteStatus\(res\.status\)\) return ambiguousWrite\("GitHub", "workflow dispatch"\)/, "a 5xx dispatch is outcome-unknown");
