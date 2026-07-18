// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const source = await readFile(
  new URL("../../../../lib/opencoven-tools-status.ts", import.meta.url),
  "utf8",
);
const state = await readFile(
  new URL("../../../../lib/opencoven-tools-state.ts", import.meta.url),
  "utf8",
);

assert.match(
  route,
  /import \{ getOpenCovenToolUpdates \} from "@\/lib\/opencoven-tools-update-cache"/,
  "the compatibility route uses the shared update cache",
);

assert.match(
  route,
  /const update = await getOpenCovenToolUpdates\(\)/,
  "GET preserves the old route without launching a second registry check",
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

assert.doesNotMatch(
  source,
  /id: "coven-code"/,
  "coven-code is no longer a separate install/status target",
);

assert.match(
  source,
  /npmViewLaunchCommandForPath/,
  "the Windows npm launcher is resolved before reading latest versions",
);

assert.match(
  source,
  /\[\.\.\.launch\.fixedArgs, "view", tool\.packageName, "version", "--json"\]/,
  "latest versions are read through fixed argv without a shell command string",
);

assert.match(
  source,
  /latestCheck: NpmLatestCheck/,
  "every response records whether the npm latest check was verified or failed",
);

assert.match(
  source,
  /status: "failed", checkedAt, error:/,
  "failed npm checks preserve explicit error state and freshness time",
);

assert.match(
  source,
  /compareSemver\(latest, probe\.version\) > 0/,
  "outdated status uses the shared semver comparison after identifying the executable package",
);

assert.match(
  source,
  /packageIdentityForExecutable[\s\S]*?manifest\.bin/,
  "status verifies both the package identity and the selected package bin entry point",
);

assert.match(
  source,
  /verifyOpenCovenToolInstall[\s\S]*?refreshCovenSpawnEnv\(\)/,
  "post-install verification rebuilds PATH before probing the tool",
);

assert.match(
  source,
  /if \(launch\.unresolvedWindowsShim\) \{[\s\S]*?error: "launcher-unreadable"/,
  "an unparseable Windows shim fails closed without executing an ambiguous batch file",
);

assert.match(
  source,
  /openCovenToolStatuses[\s\S]*?const env = refreshCovenSpawnEnv\(\);[\s\S]*?toolStatus\(tool, env\)/,
  "ordinary status checks share one freshly rebuilt environment across tool and npm probes",
);

assert.match(
  source,
  /minimumVersion: "0\.1\.1"/,
  "coven CLI compatibility floor unified to v0.1.1 (CLI self-manages the engine)",
);

assert.match(
  source,
  /Promise\.all\(OPEN_COVEN_TOOLS\.map\(\(tool\) => toolStatus\(tool, env\)\)\)/,
  "GET reports all allowlisted OpenCoven tools together",
);

assert.match(
  source,
  /const state = openCovenToolState\(/,
  "GET derives a single truthful tool state from the binary, version, and npm checks",
);

assert.match(
  source,
  /state,\s*\n\s*minimumVersion/,
  "GET includes the computed state in each tool payload",
);

assert.match(
  state,
  /if \(!tool\.installed\) return "missing";[\s\S]*?if \(!tool\.current\) return "version-unreadable";/,
  "missing and unreadable binaries are never allowed to fall through as compatible/current",
);

assert.match(
  state,
  /if \(!tool\.latest\) return "latest-unknown";[\s\S]*?if \(tool\.outdated\) return "outdated";[\s\S]*?return "current";/,
  "latest lookup failures are distinguished from a current tool",
);

console.log("opencoven-tools/status route.test.ts: ok");
