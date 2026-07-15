// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveSecret \} from "@\/lib\/vault";/,
  "runs route should use the shared vault/env secret resolver",
);

assert.match(
  source,
  /const BRANCH_RE = /,
  "branch names are validated before entering the query string",
);

assert.match(
  source,
  /encodeURIComponent\(branch\)/,
  "branch is URL-encoded so it cannot smuggle extra query parameters",
);

assert.match(
  source,
  /const REPO_RE = \/\^\[A-Za-z0-9\]/,
  "runs route should keep the owner/name barrier before path interpolation",
);

assert.doesNotMatch(
  source,
  /:\s*token\b/,
  "runs route must not return token material",
);

console.log("github-runs-route.test.ts OK");
