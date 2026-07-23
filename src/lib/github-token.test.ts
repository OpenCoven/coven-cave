import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./github-token.ts", import.meta.url), "utf8");
const envSource = readFileSync(new URL("./github-token-env.ts", import.meta.url), "utf8");

assert.match(
  envSource,
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
  /resolveVaultManagedSecret\("GITHUB_PAT", map\.GITHUB_PAT\)\?\.trim\(\)/,
  "a Cave-managed PAT takes precedence over a same-named launcher credential",
);
assert.match(
  source,
  /getLocalEncryptedSecret\("GITHUB_PAT"\)\?\.trim\(\)/,
  "legacy encrypted Cave PATs remain authoritative over launcher credentials",
);
assert.match(
  source,
  /readEnvLocalValue\("GITHUB_PAT"\)\?\.trim\(\)/,
  "legacy local-env Cave PATs remain authoritative over launcher credentials",
);
assert.match(
  source,
  /const launcherPat = process\.env\.GITHUB_PAT\?\.trim\(\);[\s\S]*return launcherPat \|\| resolveGitHubTokenFromEnvironment\(\);/,
  "an unconfigured Cave still accepts a direct GITHUB_PAT before standard aliases",
);

console.log("github-token.test.ts: ok");
