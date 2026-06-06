import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = JSON.parse(readFileSync(new URL("../capabilities/default.json", import.meta.url), "utf8"));
const defaultPermissions = readFileSync(new URL("./default.toml", import.meta.url), "utf8");
const commandPermissions = readFileSync(new URL("./pty.toml", import.meta.url), "utf8");

const requiredPermissionIds = [
  "allow-pty-start",
  "allow-pty-write",
  "allow-pty-resize",
  "allow-pty-stop",
  "allow-pty-list",
  "allow-pty-diagnose",
  "allow-browser-navigate",
  "allow-browser-set-bounds",
  "allow-browser-hide",
  "allow-browser-hide-all-except",
  "allow-browser-close",
  "allow-browser-reload",
  "allow-shell-open",
];

const requiredCommands = [
  "pty_start",
  "pty_write",
  "pty_resize",
  "pty_stop",
  "pty_list",
  "pty_diagnose",
  "browser_navigate",
  "browser_set_bounds",
  "browser_hide",
  "browser_hide_all_except",
  "browser_close",
  "browser_reload",
  "shell_open",
];

test("packaged desktop app can use native browser and terminal commands", () => {
  assert.equal(capability.local, true, "packaged local app origin must receive the default capability");
  assert.ok(capability.permissions.includes("default"), "default capability should include custom app permissions");

  for (const permissionId of requiredPermissionIds) {
    assert.match(defaultPermissions, new RegExp(`"${permissionId}"`), `${permissionId} must be in default permission group`);
  }

  for (const command of requiredCommands) {
    assert.match(commandPermissions, new RegExp(`commands\\.allow = \\["${command}"\\]`), `${command} must have a Tauri allow permission`);
  }
});
