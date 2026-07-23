// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "commit route should use the shared installation-agnostic token resolver",
);

assert.match(
  source,
  /const SHA_RE = \/\^\[0-9a-f\]\{7,40\}\$\/i;/,
  "commit sha is validated before path interpolation",
);

assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "commit route should keep the owner/name barrier before path interpolation",
);

assert.match(source, /MAX_FILES/, "file list is capped so giant commits can't flood the card");

assert.doesNotMatch(
  source,
  /:\s*token\b/,
  "commit route must not return token material",
);

console.log("github-commit-route.test.ts OK");
