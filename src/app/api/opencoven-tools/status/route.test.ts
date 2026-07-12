// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const source = await readFile(
  new URL("../../../../lib/opencoven-tools-status.ts", import.meta.url),
  "utf8",
);

assert.match(
  route,
  /import \{ openCovenToolStatuses \} from "@\/lib\/opencoven-tools-status"/,
  "the route uses the shared OpenCoven tool detector",
);

assert.match(
  route,
  /const tools = await openCovenToolStatuses\(\)/,
  "GET reports shared OpenCoven tool statuses",
);

assert.match(
  source,
  /export const OPEN_COVEN_TOOLS = \[/,
  "tool status lives in a fixed server-side allowlist",
);

assert.match(
  source,
  /id: "coven-cli"[\s\S]*packageName: "@opencoven\/cli"[\s\S]*binary: "coven"/,
  "the Coven CLI status checks the npm-published @opencoven/cli package and coven binary",
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
  /Promise\.all\(OPEN_COVEN_TOOLS\.map\(toolStatus\)\)/,
  "GET reports all allowlisted OpenCoven tools together",
);

console.log("opencoven-tools/status route.test.ts: ok");
