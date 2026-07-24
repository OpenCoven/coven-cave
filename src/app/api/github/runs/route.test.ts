// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ resolveGitHubToken \} from "@\/lib\/github-token";/,
  "runs route should use the shared installation-agnostic token resolver",
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

assert.match(
  source,
  /\/\^\\d\{1,16\}\$\/\.test\(idParam\)/,
  "run id is validated as a positive integer before path interpolation",
);

assert.match(
  source,
  /actions\/runs\/\$\{runId\}/,
  "an id fetches that exact run instead of scanning the list page",
);

assert.match(
  source,
  /runId\s*\?\s*\[data as Record<string, unknown>\]/,
  "by-id responses normalize through the same runs[] shape as the list",
);

console.log("github-runs-route.test.ts OK");
