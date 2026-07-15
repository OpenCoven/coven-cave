// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "dispatch route should use the shared vault/env secret resolver",
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
const src2 = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
import assert2 from "node:assert/strict";
assert2.match(src2, /const WORKFLOW_RE = /, "workflow name/id validated before path interpolation");
assert2.match(src2, /const REF_RE = /, "ref validated");
assert2.match(src2, /res\.status !== 204/, "dispatch success is 204 No Content");
