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
assert.match(src, /tool\.outdated\s*\?\s*`\$\{tool\.current \?\? "unknown"\} -> \$\{tool\.latest\}`/, "version line should show an arrow only for actual upgrades");
assert.doesNotMatch(src, /tool\.latest\s*\?\s*` -> \$\{tool\.latest\}`/, "version line must not advertise latest when npm latest is older than installed");
assert.match(src, /coven-code/, "coven-code is included in the client install target type");
assert.match(src, /Check tools/, "component offers a manual re-check");
assert.match(settings, /import \{ OpenCovenToolsUpdate \}/, "Settings imports the OpenCoven tools update component");
assert.match(settings, /<SettingsGroup label="OpenCoven tools">[\s\S]*<OpenCovenToolsUpdate \/>/, "About settings renders the OpenCoven tools group");
assert.match(runner, /src\/components\/open-coven-tools-update\.test\.ts/, "OpenCoven tools update test is wired into the test:app suite (scripts/run-tests.mjs)");

console.log("open-coven-tools-update.test.ts: ok");
