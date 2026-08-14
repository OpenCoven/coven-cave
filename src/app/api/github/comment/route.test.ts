// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "comment route should use the shared installation-agnostic token resolver",
);
assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "comment route should keep the owner\/name barrier before path interpolation",
);
assert.match(source, /auth_required/, "comment is a write — it must 401 without a PAT");
assert.doesNotMatch(source, /:\s*token\b/, "comment route must not return token material");
assert.match(source, /empty comment/, "comment rejects empty bodies before calling GitHub");

console.log("github-comment-route.test.ts OK");
