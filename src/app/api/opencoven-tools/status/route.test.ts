// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /const TOOLS = \[/,
  "tool status lives in a fixed server-side allowlist",
);

assert.match(
  source,
  /id: "coven-cli"[\s\S]*packageName: "@opencoven\/cli"[\s\S]*binary: "coven"/,
  "the coven CLI status checks the npm-published @opencoven/cli package and coven binary",
);

assert.match(
  source,
  /id: "coven-code"[\s\S]*packageName: "coven-code"[\s\S]*binary: "coven-code"/,
  "the coven-code status checks the public coven-code package and coven-code binary",
);

assert.match(
  source,
  /execFileAsync\("npm", \["view", tool\.packageName, "version", "--json"\]/,
  "latest versions are read from npm without involving a shell",
);

assert.match(
  source,
  /compareSemver\(latest, installed\.version\) > 0/,
  "outdated status uses the shared semver comparison",
);

assert.match(
  source,
  /Promise\.all\(TOOLS\.map\(toolStatus\)\)/,
  "GET reports all allowlisted OpenCoven tools together",
);

console.log("opencoven-tools/status route.test.ts: ok");
