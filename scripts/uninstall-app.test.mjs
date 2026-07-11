import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL("./uninstall-app.sh", import.meta.url);
const wixCleanupUrl = new URL(
  "../src-tauri/windows/fragments/sidecar-cache-cleanup.wxs",
  import.meta.url,
);
const nativeScriptPath = fileURLToPath(scriptUrl);
function toBashPath(value) {
  return process.platform === "win32"
    ? value.replace(/^([A-Za-z]):[\\/]/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
    : value;
}
const bashScriptPath = process.platform === "win32"
  ? toBashPath(nativeScriptPath)
  : nativeScriptPath;
const windowsGitBash = [
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
].find((candidate) => candidate && existsSync(candidate));
const bashExecutable = process.platform === "win32" && windowsGitBash
  ? windowsGitBash
  : "bash";
const source = await readFile(scriptUrl, "utf8");
const wixCleanup = await readFile(wixCleanupUrl, "utf8");

assert.match(source, /APP_ID="ai\.opencoven\.cave"/, "uninstaller should target the Tauri app identifier");
assert.match(source, /--execute/, "uninstaller should be dry-run by default and require --execute");
assert.match(source, /--with-coven-home/, "daemon/user data removal must require an explicit flag");
assert.match(source, /UNINSTALL_STEP_TIMEOUT_SECONDS/, "destructive uninstall steps should have a bounded timeout");
assert.match(source, /run_bounded\(\)/, "external uninstall commands should go through a bounded runner");
assert.match(source, /DIAGNOSTICS_FILE=/, "uninstaller should emit a diagnostics file");
assert.match(source, /--copy-diagnostics/, "users should be able to copy diagnostics for support");
assert.match(source, /copy_diagnostics\(\)/, "copy diagnostics should have a dedicated helper");
assert.match(source, /COVEN_CAVE_UNINSTALL_APP_PATHS/, "tests and support runs should be able to override app bundle paths");
assert.match(source, /Library\/Application Support\/\$\{APP_ID\}/, "macOS app support should be removed");
assert.match(source, /Library\/Caches\/\$\{APP_ID\}/, "macOS cache should be removed");
assert.match(source, /Library\/WebKit\/\$\{APP_ID\}/, "macOS WebKit storage should be removed");
assert.match(source, /Library\/HTTPStorages\/\$\{APP_ID\}/, "macOS HTTP storage should be removed");
assert.match(source, /Library\/Preferences\/\$\{APP_ID\}\.plist/, "macOS preferences should be removed");
assert.match(source, /Library\/Saved Application State\/\$\{APP_ID\}\.savedState/, "macOS saved state should be removed");
assert.match(source, /Library\/Logs\/\$\{APP_NAME\}/, "custom sidecar logs should be removed");
assert.match(source, /launchctl bootout/, "macOS launch agent should be unloaded before plist removal");
assert.match(source, /XDG_STATE_HOME:-\$\{home\}\/\.local\/state/, "mobile Tailscale state root should be removed");
assert.match(source, /coven-cave-attachments/, "temporary chat attachments should be removed");
assert.match(source, /preserve: \$\{COVEN_HOME:-\$\{home\}\/\.coven\}/, "Coven home should be preserved unless explicitly requested");
assert.match(source, /XDG_DATA_HOME/, "Linux app data should be removed");
assert.match(source, /XDG_CONFIG_HOME/, "Linux config should be removed");
assert.match(source, /XDG_CACHE_HOME/, "Linux cache should be removed");
assert.match(source, /LOCALAPPDATA/, "Windows app install/data paths should be covered");
assert.match(
  source,
  /LOCALAPPDATA[\s\S]*\$\{local_appdata\}\/\$\{APP_ID\}\/sidecar-runtime/,
  "Windows uninstall diagnostics must explicitly cover the extracted sidecar cache",
);
assert.match(source, /skip: LOCALAPPDATA is not set/, "Windows cleanup should not form root-relative paths from missing env vars");
assert.match(wixCleanup, /if defined LOCALAPPDATA/, "MSI cleanup must refuse a missing LOCALAPPDATA root");
assert.match(wixCleanup, /Impersonate="yes"/, "MSI cleanup must target the interactive user's cache");
assert.match(wixCleanup, /Execute="commit"/, "MSI cleanup must wait until uninstall commits");
assert.match(
  wixCleanup,
  /\(REMOVE = "ALL"\) AND NOT UPGRADINGPRODUCTCODE/,
  "MSI cleanup must run only for a full uninstall, not a major upgrade",
);

function run(args, env = {}) {
  const result = spawnSync(bashExecutable, [bashScriptPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      COVEN_HOME: "",
      ...env,
    },
  });
  return result;
}

{
  const home = mkdtempSync(path.join(tmpdir(), "coven-cave-uninstall-home-"));
  const appSupport = path.join(home, "Library", "Application Support", "ai.opencoven.cave");
  const covenHome = path.join(home, ".coven");
  mkdirSync(appSupport, { recursive: true });
  mkdirSync(covenHome, { recursive: true });
  writeFileSync(path.join(appSupport, "state.json"), "{}");
  writeFileSync(path.join(covenHome, "daemon.json"), "{}");

  const result = run([], {
    HOME: home,
    OSTYPE: "darwin22",
    TMPDIR: path.join(home, "tmp"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.match(result.stdout, /DRY-RUN: rm -rf/);
  assert.match(result.stdout, /Library\/Application\\ Support\/ai\.opencoven\.cave/);
  assert.match(result.stdout, /preserve: .*\.coven/);
}

{
  const home = mkdtempSync(path.join(tmpdir(), "coven-cave-uninstall-home-"));
  const stateRoot = path.join(home, ".state");
  const covenHome = path.join(home, ".coven");
  mkdirSync(path.join(stateRoot, "coven-cave"), { recursive: true });
  mkdirSync(covenHome, { recursive: true });

  const result = run(["--with-coven-home"], {
    HOME: home,
    OSTYPE: "linux-gnu",
    XDG_STATE_HOME: stateRoot,
    TMPDIR: path.join(home, "tmp"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.state[\\/]coven-cave/);
  assert.match(result.stdout, /\.coven/);
  assert.doesNotMatch(result.stdout, /preserve: .*\.coven/);
}

{
  const home = mkdtempSync(path.join(tmpdir(), "coven-cave-uninstall-home-"));
  const result = run([], {
    HOME: home,
    OSTYPE: "msys",
    LOCALAPPDATA: "",
    APPDATA: "",
    PROGRAMDATA: "",
    USERPROFILE: "",
    TMPDIR: path.join(home, "tmp"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skip: LOCALAPPDATA is not set/);
  assert.match(result.stdout, /skip: APPDATA is not set/);
  assert.doesNotMatch(result.stdout, /\/Programs\/CovenCave/);
}

{
  const home = mkdtempSync(path.join(tmpdir(), "coven-cave-uninstall-home-"));
  const localAppData = path.join(home, "LocalAppData");
  const sidecarCache = path.join(localAppData, "ai.opencoven.cave", "sidecar-runtime");
  const unrelatedUserData = path.join(localAppData, "coven-user-data");
  mkdirSync(sidecarCache, { recursive: true });
  mkdirSync(unrelatedUserData, { recursive: true });
  writeFileSync(path.join(sidecarCache, ".complete.json"), "{}");
  writeFileSync(path.join(unrelatedUserData, "keep.txt"), "keep");

  const result = run(["--execute"], {
    HOME: home,
    OSTYPE: "msys",
    LOCALAPPDATA: localAppData,
    APPDATA: "",
    PROGRAMDATA: "",
    USERPROFILE: "",
    TMPDIR: path.join(home, "tmp"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ai\.opencoven\.cave\/sidecar-runtime/);
  await assert.rejects(access(sidecarCache), "sidecar cache should be removed on execute");
  await access(path.join(unrelatedUserData, "keep.txt"));
}

if (process.platform === "win32") {
  const localAppData = mkdtempSync(path.join(tmpdir(), "coven-cave-msi-cleanup-"));
  const sidecarCache = path.join(localAppData, "ai.opencoven.cave", "sidecar-runtime");
  const unrelatedUserData = path.join(localAppData, "unrelated-user-data");
  mkdirSync(sidecarCache, { recursive: true });
  mkdirSync(unrelatedUserData, { recursive: true });
  writeFileSync(path.join(sidecarCache, ".complete.json"), "{}");
  writeFileSync(path.join(unrelatedUserData, "keep.txt"), "keep");

  const result = spawnSync(
    "cmd.exe",
    [
      "/D",
      "/C",
      "if defined LOCALAPPDATA if exist \"%LOCALAPPDATA%\\ai.opencoven.cave\\sidecar-runtime\" rmdir /S /Q \"%LOCALAPPDATA%\\ai.opencoven.cave\\sidecar-runtime\"",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, LOCALAPPDATA: localAppData },
      windowsVerbatimArguments: true,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(sidecarCache), "MSI command should remove only the sidecar cache");
  await access(path.join(unrelatedUserData, "keep.txt"));
}

if (process.platform !== "win32") {
  const home = mkdtempSync(path.join(tmpdir(), "coven-cave-uninstall-home-"));
  const bin = path.join(home, "bin");
  const copiedDiagnostics = path.join(home, "copied-diagnostics.txt");
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "launchctl"), "#!/usr/bin/env bash\nsleep 3\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "pbcopy"), "#!/usr/bin/env bash\ncat > \"$COPY_OUT\"\n", { mode: 0o755 });
  const plist = path.join(home, "Library", "LaunchAgents", "ai.opencoven.cave.plist");
  mkdirSync(path.dirname(plist), { recursive: true });
  writeFileSync(plist, "{}");

  const result = run(["--execute", "--copy-diagnostics"], {
    HOME: home,
    OSTYPE: "darwin22",
    PATH: `${bin}:${process.env.PATH}`,
    COVEN_CAVE_UNINSTALL_APP_PATHS: path.join(home, "Applications", "CovenCave.app"),
    UNINSTALL_STEP_TIMEOUT_SECONDS: "1",
    COPY_OUT: copiedDiagnostics,
    TMPDIR: path.join(home, "tmp"),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /timed out after 1s/);
  assert.match(result.stdout, /Diagnostics:/);
  assert.match(result.stdout, /Diagnostics copied to clipboard/);
  assert.match(await readFile(copiedDiagnostics, "utf8"), /timed out after 1s/);
}

console.log("uninstall-app.test.mjs: ok");
