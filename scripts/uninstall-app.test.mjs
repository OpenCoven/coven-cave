import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const scriptUrl = new URL("./uninstall-app.sh", import.meta.url);
const source = await readFile(scriptUrl, "utf8");

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
assert.match(source, /skip: LOCALAPPDATA is not set/, "Windows cleanup should not form root-relative paths from missing env vars");

function run(args, env = {}) {
  const result = spawnSync("bash", [scriptUrl.pathname, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
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
  assert.match(result.stdout, new RegExp(`${stateRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/coven-cave`));
  assert.match(result.stdout, new RegExp(`${covenHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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
