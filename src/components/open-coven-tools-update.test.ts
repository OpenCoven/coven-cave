// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./open-coven-tools-update.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/run-tests.mjs", import.meta.url), "utf8");

assert.match(src, /\/api\/opencoven-tools\/status/, "component fetches OpenCoven tool version status");
assert.match(src, /\/api\/onboarding\/install/, "component reuses the allowlisted background installer");
assert.match(src, /tool\.outdated/, "update buttons are gated to outdated tools");
assert.match(src, /Update \{tool\.label\}/, "outdated tools expose a clear update button");
assert.match(src, /function toolVersionText\(tool: ToolStatus\): string/, "tool version text is centralized");
assert.match(src, /if \(!tool\.current\) return "Installed, version unknown"/, "installed tools with unknown versions should say the version is unknown");
assert.match(src, /function toolStatusText\(tool: ToolStatus\): string/, "tool status text is centralized");
assert.match(src, /if \(!tool\.current\) return "Version unknown"/, "installed tools with unknown versions must not claim to be up to date");
assert.match(src, /tool\.outdated \? `\$\{tool\.current\} -> \$\{tool\.latest\}` : tool\.current/, "version line should show an arrow only for actual upgrades");
assert.doesNotMatch(src, /tool\.latest\s*\?\s*` -> \$\{tool\.latest\}`/, "version line must not advertise latest when npm latest is older than installed");
assert.doesNotMatch(src, /tool\.installed \? "Up to date" : "Not found"/, "installed-but-version-unknown tools must not fall through to Up to date");
assert.match(src, /coven-code/, "coven-code is included in the client install target type");
assert.match(src, /function buildDiagnosticsText/, "tool diagnostics text is centralized");
assert.match(src, /navigator\.clipboard\.writeText/, "component can copy tool diagnostics for debugging");
assert.match(src, /Copy diagnostics/, "About tools exposes a copy diagnostics action");
assert.match(src, /sidecarTokenPresent/, "diagnostics include whether the sidecar auth bridge captured a token");
assert.match(src, /Check tools/, "component offers a manual re-check");
assert.match(
  src,
  /const ghostBtn =[\s\S]*settings-touch-action/,
  "About tools footer buttons should use the shared Settings action touch target",
);
assert.match(settings, /import \{ OpenCovenToolsUpdate \}/, "Settings imports the OpenCoven tools update component");
assert.match(settings, /<SettingsGroup label="OpenCoven tools">[\s\S]*<OpenCovenToolsUpdate \/>/, "About settings renders the OpenCoven tools group");
assert.match(runner, /src\/components\/open-coven-tools-update\.test\.ts/, "OpenCoven tools update test is wired into the test:app suite (scripts/run-tests.mjs)");

console.log("open-coven-tools-update.test.ts: ok");
