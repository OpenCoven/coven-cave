// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "rerun route should use the shared vault/env secret resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "rerun route should keep the owner/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "rerun is a write — it must 401 without a PAT");
assert.match(
  source,
  /typeof data\?\.message === "string" \? data\.message/,
  "rerun passes GitHub's own error message through verbatim",
);
assert.doesNotMatch(source, /:\s*token\b/, "rerun route must not return token material");

console.log("github-rerun-route.test.ts OK");
const src2 = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
import assert2 from "node:assert/strict";
assert2.match(src2, /rerun-failed-jobs/, "failedOnly (default) re-runs failed jobs only");
