import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = JSON.parse(readFileSync(new URL("../capabilities/default.json", import.meta.url), "utf8"));
const defaultPermissions = readFileSync(new URL("./default.toml", import.meta.url), "utf8");
const commandPermissions = readFileSync(new URL("./pty.toml", import.meta.url), "utf8");
const browserRust = readFileSync(new URL("../src/browser.rs", import.meta.url), "utf8");
const ptyRust = readFileSync(new URL("../src/pty.rs", import.meta.url), "utf8");
const libRust = readFileSync(new URL("../src/lib.rs", import.meta.url), "utf8");
const browserPane = readFileSync(new URL("../../src/components/browser-pane.tsx", import.meta.url), "utf8");
const bottomTerminal = readFileSync(new URL("../../src/components/bottom-terminal.tsx", import.meta.url), "utf8");

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

function capabilityAllowsOrigin(origin) {
  const patterns = capability.remote?.urls ?? [];
  return patterns.some((pattern) => new URLPattern(pattern).test(origin));
}

test("local app origins do not receive terminal permissions", () => {
  assert.equal(capability.local, false, "packaged local app origins must not receive PTY command permissions");
  assert.ok(capability.permissions.includes("default"), "default capability should include custom app permissions");

  for (const permissionId of requiredPermissionIds) {
    const escapedPermissionId = permissionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      defaultPermissions,
      new RegExp(String.raw`"${escapedPermissionId}"`),
      `${permissionId} must be in default permission group`,
    );
  }

  for (const command of requiredCommands) {
    const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      commandPermissions,
      new RegExp(String.raw`commands\.allow\s*=\s*\[[^\]]*"${escapedCommand}"[^\]]*\]`),
      `${command} must have a Tauri allow permission`,
    );
  }
});

test("packaged sidecar loopback origins can use native browser commands", () => {
  assert.ok(capabilityAllowsOrigin("http://127.0.0.1:3000/"), "dev 127.0.0.1 origin should be allowed");
  assert.ok(capabilityAllowsOrigin("http://localhost:3000/"), "dev localhost origin should be allowed");
  assert.ok(capabilityAllowsOrigin("http://127.0.0.1:64203/"), "packaged random 127.0.0.1 sidecar port should be allowed");
  assert.ok(capabilityAllowsOrigin("http://localhost:64203/"), "packaged random localhost sidecar port should be allowed");
  assert.equal(capabilityAllowsOrigin("http://example.com:64203/"), false, "remote non-loopback origins should stay denied");
});

test("privileged PTY commands require the trusted main webview at runtime", () => {
  assert.match(ptyRust, /static TRUSTED_MAIN_ORIGINS:/);
  assert.match(ptyRust, /pub fn trust_main_origin\(url: &Url\)/);
  assert.match(libRust, /pty::trust_main_origin\(&main_url\);/);
  assert.match(ptyRust, /if webview\.label\(\) != "main"/);
  assert.match(ptyRust, /trusted\.clear\(\);/);
  assert.match(ptyRust, /TRUSTED_MAIN_ORIGINS\.lock\(\)\.contains\(&origin\)/);

  for (const command of ["pty_start", "pty_write", "pty_resize", "pty_stop", "pty_list", "pty_diagnose"]) {
    const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      ptyRust,
      new RegExp(String.raw`pub fn ${escapedCommand}\([^)]*webview: Webview[\s\S]*?ensure_trusted_pty_caller\(&webview\)\?;`),
      `${command} must reject untrusted child webviews and localhost origins before handling PTY state`,
    );
  }
});

test("browser event labels use the same native prefix in Rust and React", () => {
  assert.match(browserRust, /const BROWSER_LABEL_PREFIX: &str = "cave-browser-";/);
  assert.match(browserPane, /const NATIVE_BROWSER_LABEL_PREFIX = "cave-browser-";/);
  assert.match(browserPane, /return `\$\{NATIVE_BROWSER_LABEL_PREFIX\}\$\{label\}-tab-`;/);
  assert.equal(browserPane.match(/startsWith\(eventPrefix\)/g)?.length, 2);
  assert.equal(browserPane.match(/slice\(eventPrefix\.length\)/g)?.length, 2);
});

test("pty_start only accepts terminal session metadata", () => {
  assert.match(
    ptyRust,
    /#\[serde\(deny_unknown_fields\)\]\s*pub struct StartOptions \{[\s\S]*?pub thread_id: String,[\s\S]*?pub project_root: Option<String>,[\s\S]*?pub cols: Option<u16>,[\s\S]*?pub rows: Option<u16>,[\s\S]*?\}/,
    "StartOptions should reject unknown caller-supplied fields",
  );
  assert.doesNotMatch(ptyRust, /pub command:/, "pty_start must not accept caller-supplied executables");
  assert.doesNotMatch(ptyRust, /pub args:/, "pty_start must not accept caller-supplied arguments");
  assert.doesNotMatch(ptyRust, /pub env:/, "pty_start must not accept caller-supplied environment overrides");
  assert.match(ptyRust, /let command = default_shell\(\);/, "pty_start should always use the platform default shell");
  assert.match(ptyRust, /let args = default_shell_args\(\);/, "pty_start should always use platform default shell args");
});

test("terminal commands use Tauri camelCase command arguments", () => {
  assert.match(
    bottomTerminal,
    /invoke\("pty_write", \{[\s\S]*threadId: threadId,[\s\S]*bytes:/,
    "pty_write must pass threadId so desktop keystrokes reach Rust",
  );
  assert.match(
    bottomTerminal,
    /invoke\("pty_resize", \{[\s\S]*threadId: threadId,[\s\S]*cols:[\s\S]*rows:/,
    "pty_resize must pass threadId so desktop resize reaches Rust",
  );
  assert.match(
    bottomTerminal,
    /invoke\("pty_stop", \{ threadId: threadId \}/,
    "pty_stop must pass threadId so desktop cleanup reaches Rust",
  );
  assert.doesNotMatch(
    bottomTerminal,
    /invoke\("pty_(?:write|resize|stop)", \{[\s\S]{0,120}thread_id:/,
    "direct Tauri command args should not use snake_case without rename_all",
  );
});
