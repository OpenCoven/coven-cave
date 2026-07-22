import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-token.ts", import.meta.url), "utf8");

assert.match(
  source,
  /GITHUB_TOKEN_ENV_KEYS = \[[\s\S]*"GITHUB_TOKEN",[\s\S]*"COVEN_GITHUB_TOKEN",[\s\S]*"GH_TOKEN",[\s\S]*"GITHUB_PERSONAL_ACCESS_TOKEN"/,
  "GitHub routes recognize standard token environments used by shell and harness installations",
);
assert.match(
  source,
  /const value = env\[key\]\?\.trim\(\);[\s\S]*if \(value\) return value;/,
  "blank higher-priority environment variables do not mask a configured token",
);
assert.match(
  source,
  /return resolveSecret\("GITHUB_PAT"\) \?\? resolveGitHubTokenFromEnvironment\(\);/,
  "Cave's configured PAT remains authoritative over external launcher credentials",
);

console.log("github-token.test.ts: ok");
