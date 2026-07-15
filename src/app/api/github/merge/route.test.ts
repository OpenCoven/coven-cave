// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "merge route should use the shared vault/env secret resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "merge route should keep the owner/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "merge is a write — it must 401 without a PAT");
assert.match(
  source,
  /typeof data\?\.message === "string" \? data\.message/,
  "merge passes GitHub's own error message through verbatim",
);
assert.doesNotMatch(source, /:\s*token\b/, "merge route must not return token material");

console.log("github-merge-route.test.ts OK");
assert.match(source, /new Set\(\["squash", "merge", "rebase"\]\)/, "merge methods are allow-listed");
assert.match(source, /data\.merged !== true/, "merge success requires GitHub's merged:true");
