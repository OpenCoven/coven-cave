// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("./open-coven-tools-update.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");
const status = await readFile(new URL("../lib/opencoven-tools-status.ts", import.meta.url), "utf8");
const statusDisplay = await readFile(new URL("../lib/opencoven-tools-status-display.ts", import.meta.url), "utf8");
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
assert.match(src, /\/api\/onboarding\/install", \{ cache: "no-store" \}/, "About queries the global installer lane without a target");
assert.match(src, /Other npm updates are disabled until it finishes/, "About explains the shared npm lock before a second update can start");
assert.match(src, /disabled=\{blockedByGlobalNpm\}/, "About disables a different tool's update button while npm is busy");
assert.match(src, /createOpenCovenInstallJobObserver/, "About uses the behavior-tested shared lane and job observer");
assert.match(src, /openCovenToolPresentation\(tool\)/, "tool state presentation is centralized");
assert.match(src, /data-tool-state=\{presentation\.state\}/, "tool rows expose the truthful state for UI testing");
assert.match(src, /presentation\.action \? \(/, "missing and unreadable tools expose recovery actions");
assert.match(src, /openCovenToolActionLabel\(presentation\.action!?, tool\.label\)/, "tool action labels distinguish install, repair, and update");
assert.match(src, /tool\.outdated/, "tool state still distinguishes available updates");
assert.match(src, /tool\.compatible/, "tool state still distinguishes Cave compatibility");
assert.match(src, /tool\.minimumVersion/, "tool state includes the minimum compatible version");
assert.match(src, /tool\.installCommand/, "tool rows expose a copyable install/update command");
assert.match(src, /Copy command/, "tool rows can copy the exact update command");
assert.match(src, /import \{[\s\S]*toolStatusText,[\s\S]*\} from "@\/lib\/opencoven-tools-status-display"/, "tool status text is centralized in the shared verification-state helper");
assert.match(src, /latestCheckText\(tool, stale\)/, "each tool renders an explicit npm freshness result");
assert.match(src, /toolFooterStatusText\(\{ tools, checking, error, stale \}\)/, "the footer distinguishes failed or stale latest-version data");
assert.match(src, /const \[stale, setStale\] = useState\(false\)/, "failed refreshes mark retained results as stale");
assert.match(src, /setStale\(true\)/, "a failed refresh cannot leave prior rows looking fresh");
assert.match(src, /function toolNeedsCompatibilityUpdate\(tool: ToolStatus\): boolean/, "tool recovery state is centralized");
assert.match(src, /return tool\.installed && \(!tool\.packageVerified \|\| !tool\.current \|\| !tool\.compatible\)/, "wrong packages and unreadable version probes remain actionable recovery states");
assert.match(src, /function toolCompatibilityText\(tool: ToolStatus\): string \| null/, "tool compatibility copy is centralized");
assert.match(src, /if \(!tool\.installed\) return null/, "missing tools do not render a compatibility floor warning");
assert.match(src, /if \(!tool\.packageVerified\) return `Expected \$\{tool\.packageName\}`/, "wrong-package launchers tell the user which package is expected");
assert.match(src, /return `Requires >= \$\{tool\.minimumVersion\}`/, "below-minimum tools show the compatibility floor");
assert.match(statusDisplay, /if \(tool\.packageVerified === false\) return "Unexpected executable"/, "wrong-package launchers remain explicit recovery states");
assert.match(statusDisplay, /if \(!tool\.current\) return "Version probe failed"/, "installed tools with unknown versions must not claim to be up to date");
assert.match(src, /toolStatusText\(tool, stale\)/, "stale or unverified latest checks are passed through to the row status");
assert.match(src, /state: OpenCovenToolState/, "client status includes the server-derived state");
assert.match(src, /job\.action === "install"/, "progress copy distinguishes installs from updates");
assert.match(src, /json\.hint \?\?\s*json\.error/, "npm prerequisite and permission errors remain actionable");
assert.doesNotMatch(src, /tool\.latest\s*\?\s*` -> \$\{tool\.latest\}`/, "version line must not advertise latest when npm latest is older than installed");
assert.doesNotMatch(src, /tool\.installed \? "Up to date" : "Not found"/, "installed-but-version-unknown tools must not fall through to Up to date");
assert.match(src, /function installResultFromCompletion/, "post-install result reconciliation is centralized");
assert.match(src, /tail: job\.tail/, "completed About-panel failures retain the server-redacted tail");
assert.match(
  src,
  /!busy && !result\?\.ok && result\?\.tail/,
  "the About panel keeps failed installer output visible after completion",
);
assert.match(src, /const refreshed = await load\(\)/, "the UI refreshes status before displaying a completed install result");
assert.match(src, /Post-install recheck now resolves a different executable/, "a stale status recheck replaces optimistic success with a recovery message");
assert.match(
  src,
  /normalizePath\(rechecked\.path\) === normalizePath\(verification\.path\)/,
  "recheck path comparison normalizes Windows casing/slashes so a cosmetic difference does not fail verification",
);
assert.match(src, /Post-install recheck could not verify npm latest/, "a registry recheck failure is not misdiagnosed as a different executable");
assert.match(src, /Verified \$\{verification\.current\}/, "green success includes the verified version");
assert.doesNotMatch(src, /Verified \$\{verification\.current\} at \$\{verification\.path\}/, "green success does not retain a local executable path");
assert.doesNotMatch(src, /coven-code/, "coven-code is no longer a separate install target after unification");
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
assert.match(src, /function daemonLifecycleText/, "tool updates translate daemon lifecycle phases for the About panel");
assert.match(src, /Updating CLI; local daemon will restart afterward/, "About panel shows CLI update and restart progress");
assert.match(src, /Local daemon restarted and healthy/, "About panel surfaces final verified daemon health");
assert.match(src, /local daemon remained stopped/, "an intentionally stopped daemon is not presented as a failed restart");
assert.match(src, /Daemon: \{daemonLifecycleText\(daemon\)\}/, "About panel renders lifecycle health beside the update result");
assert.match(src, /lastSuccessfulCheckedAt/, "tool checks retain a visible successful-check timestamp");
assert.match(src, /Stale data from/, "failed rechecks explicitly mark retained tool rows as stale");
assert.match(src, /Last known/, "each retained tool row identifies last-known data");
assert.match(src, /TOOL_UPDATE_RECHECK_EVENT/, "a completed in-page update requests a banner revalidation");
assert.match(src, /window\.dispatchEvent\(new Event\(TOOL_UPDATE_RECHECK_EVENT\)\)/, "successful in-page updates revalidate the banner");
assert.match(src, /onTerminal:[\s\S]*?const refreshed = await load\(\)/, "all completed recovery actions use the authoritative status recheck");
assert.match(src, /dismissBanner\(TOOL_UPDATE_BANNER_ID\)/, "a clean recheck dismisses an obsolete update banner");
assert.match(src, /Copy diagnostics \(safe\)/, "the copy control discloses that diagnostics are sanitized");
assert.match(src, /paths, raw output, URL queries, and secrets are omitted or redacted/, "the UI discloses copied-diagnostics redaction");
assert.doesNotMatch(src, /updated at \$\{json\.binaryPath\}/, "successful tool updates do not retain local binary paths in UI state");
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
assert.match(status, /minimumVersion: "0\.1\.1"/, "Coven CLI compatibility floor unified to v0.1.1 (CLI self-manages the engine)");
assert.doesNotMatch(status, /minimumVersion: "0\.6\.0"/, "coven-code compatibility floor removed after unification");
assert.match(status, /installCommand: "npm i -g @opencoven\/cli@latest"/, "Coven CLI exposes the exact update command");
assert.doesNotMatch(status, /installCommand: "npm i -g @opencoven\/coven-code@latest"/, "coven-code install command removed after unification");
assert.doesNotMatch(status, /packageName: "@opencoven\/coven-code"/, "coven-code status entry removed after unification");
assert.doesNotMatch(status, /packageName: "coven-code"/, "bare coven-code is a different, deprecated npm package — status must never probe it");
assert.match(status, /const compatible =[\s\S]*packageVerified[\s\S]*!!probe\.version[\s\S]*compareSemver\(probe\.version, tool\.minimumVersion\) >= 0/, "compatibility requires both the expected executable package and the Cave minimum");
assert.match(status, /const state = openCovenToolState/, "server status derives a truthful explicit state");
assert.match(status, /state,/, "server status returns the derived state");
assert.match(status, /verifyOpenCovenToolInstall[\s\S]*refreshCovenSpawnEnv\(\)/, "post-install verification refreshes PATH before probing the selected tool");
assert.match(settings, /import \{ OpenCovenToolsUpdate \}/, "Settings imports the OpenCoven tools update component");
assert.match(settings, /<SettingsGroup label="OpenCoven tools">[\s\S]*<OpenCovenToolsUpdate \/>/, "About settings renders the OpenCoven tools group");
assert.match(runner, /src\/components\/open-coven-tools-update\.test\.ts/, "OpenCoven tools update test is wired into the test:app suite (scripts/run-tests.mjs)");
assert.match(runner, /src\/lib\/opencoven-tools-state\.test\.ts/, "OpenCoven tool state tests are wired into the test suite");
assert.match(runner, /src\/lib\/opencoven-tool-verification\.test\.ts/, "post-install verification scenarios are wired into the app test suite");

console.log("open-coven-tools-update.test.ts: ok");
