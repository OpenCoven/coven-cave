// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./open-coven-tools-update.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const status = await readFile(new URL("../lib/opencoven-tools-status.ts", import.meta.url), "utf8");
const dashboardCss = await readFile(new URL("../styles/dashboard.css", import.meta.url), "utf8");
const runner = await readFile(new URL("../../scripts/run-tests.mjs", import.meta.url), "utf8");

assert.match(src, /import \{ Button \}/, "OpenCoven tools actions use the shared Button primitive");
assert.doesNotMatch(src, /<button\b/, "OpenCoven tools should not hand-roll button controls");
assert.doesNotMatch(
  src,
  /rounded-md|rounded-lg|rounded(?=\s|")|rounded-\[4px\]/,
  "OpenCoven tools controls should use tokenized radii instead of hard-coded rounded classes",
);
assert.match(src, /\/api\/opencoven-tools\/status/, "component fetches OpenCoven tool version status");
assert.match(src, /\/api\/onboarding\/install/, "component reuses the allowlisted background installer");
assert.match(src, /tool\.outdated/, "update buttons are gated to outdated tools");
assert.match(src, /tool\.compatible/, "tool rows distinguish update availability from Cave compatibility");
assert.match(src, /tool\.minimumVersion/, "tool rows expose the minimum compatible version");
assert.match(src, /tool\.installCommand/, "tool rows expose a copyable install/update command");
assert.match(src, /Copy command/, "tool rows can copy the exact update command");
assert.match(src, /Update \{tool\.label\}/, "outdated tools expose a clear update button");
assert.match(src, /function toolVersionText\(tool: ToolStatus\): string/, "tool version text is centralized");
assert.match(src, /if \(!tool\.current\) return "Installed, version unknown"/, "installed tools with unknown versions should say the version is unknown");
assert.match(src, /function toolStatusText\(tool: ToolStatus\): string/, "tool status text is centralized");
assert.match(src, /function toolNeedsCompatibilityUpdate\(tool: ToolStatus\): boolean/, "tool compatibility failures ignore missing or unknown-version installs");
assert.match(src, /return tool\.installed && Boolean\(tool\.current\) && !tool\.compatible/, "only installed tools with known stale versions trigger compatibility warnings");
assert.match(src, /function toolCompatibilityText\(tool: ToolStatus\): string \| null/, "tool compatibility copy is centralized");
assert.match(src, /if \(!toolNeedsCompatibilityUpdate\(tool\)\) return null/, "missing tools do not render a compatibility floor warning");
assert.match(src, /return `Requires >= \$\{tool\.minimumVersion\}`/, "below-minimum tools show the compatibility floor");
assert.match(src, /if \(!tool\.current\) return "Version unknown"/, "installed tools with unknown versions must not claim to be up to date");
assert.match(src, /tool\.outdated \? `\$\{tool\.current\} -> \$\{tool\.latest\}` : tool\.current/, "version line should show an arrow only for actual upgrades");
assert.doesNotMatch(src, /tool\.latest\s*\?\s*` -> \$\{tool\.latest\}`/, "version line must not advertise latest when npm latest is older than installed");
assert.doesNotMatch(src, /tool\.installed \? "Up to date" : "Not found"/, "installed-but-version-unknown tools must not fall through to Up to date");
assert.match(src, /coven-code/, "coven-code is included in the client install target type");
assert.match(src, /function buildDiagnosticsText/, "tool diagnostics text is centralized");
assert.match(src, /navigator\.clipboard\.writeText/, "component can copy tool diagnostics for debugging");
assert.match(src, /Copy diagnostics/, "About tools exposes a copy diagnostics action");
assert.match(src, /export function OpenCovenToolsBannerTrigger/, "exports a shell banner trigger for stale OpenCoven tools");
assert.match(src, /coven-cave:tool-update:dismissed:/, "tool update banners persist dismissal per released tool version");
assert.match(src, /pushBanner\(/, "tool update trigger publishes through the shared shell banner system");
assert.match(src, /const incompatibleTools = tools\.filter\(toolNeedsCompatibilityUpdate\)/, "global banner only warns for installed tools below the Cave floor");
assert.match(src, /severity: incompatibleTools\.length > 0 \? "warning" : "info"/, "compatibility failures get stronger warning severity than ordinary updates");
assert.match(src, /Review tools/, "tool update banner sends users to the settings tool surface");
assert.match(shell, /OpenCovenToolsBannerTrigger/, "Shell imports and mounts the OpenCoven tools banner trigger");
assert.match(src, /sidecarTokenPresent/, "diagnostics include whether the sidecar auth bridge captured a token");
assert.match(src, /Check tools/, "component offers a manual re-check");
assert.match(
  src,
  /const toolActionBtn =[\s\S]*settings-tool-action/,
  "About tools actions should use the compact Settings tool action class",
);
assert.doesNotMatch(
  src,
  /const (accentBtn|ghostBtn) =[\s\S]*settings-touch-action/,
  "About tools actions should not inherit the tall Settings touch-action target",
);
assert.match(
  dashboardCss,
  /\.settings-tool-action\s*\{[\s\S]*?height:\s*28px[\s\S]*?min-height:\s*28px/,
  "Settings tool actions should match the compact desktop header button height",
);
assert.match(
  src,
  /settings-tool-action--primary/,
  "Update tools action should opt into the more visible primary styling",
);
assert.match(
  dashboardCss,
  /\.settings-tool-action--primary\s*\{[\s\S]*?border:[\s\S]*?box-shadow:/,
  "Primary Settings tool action should have a visible border and elevation",
);
assert.match(status, /minimumVersion: "0\.0\.49"/, "Coven CLI compatibility floor is explicit in the status source");
assert.match(status, /minimumVersion: "0\.0\.22"/, "coven-code compatibility floor is explicit in the status source");
assert.match(status, /installCommand: "npm i -g @opencoven\/cli@latest"/, "Coven CLI exposes the exact update command");
assert.match(status, /installCommand: "npm i -g coven-code@latest"/, "coven-code exposes the exact update command");
assert.match(status, /const compatible =[\s\S]*!!installed\?\.version && compareSemver\(installed\.version, tool\.minimumVersion\) >= 0/, "compatibility compares installed version against the Cave minimum");
assert.match(settings, /import \{ OpenCovenToolsUpdate \}/, "Settings imports the OpenCoven tools update component");
assert.match(settings, /<SettingsGroup label="OpenCoven tools">[\s\S]*<OpenCovenToolsUpdate \/>/, "About settings renders the OpenCoven tools group");
assert.match(runner, /src\/components\/open-coven-tools-update\.test\.ts/, "OpenCoven tools update test is wired into the test:app suite (scripts/run-tests.mjs)");

console.log("open-coven-tools-update.test.ts: ok");
