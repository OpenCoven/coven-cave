import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const defaultCapability = JSON.parse(readFileSync(new URL("../capabilities/default.json", import.meta.url), "utf8"));
const loopbackBrowserCapability = JSON.parse(
  readFileSync(new URL("../capabilities/loopback-browser.json", import.meta.url), "utf8"),
);
const loopbackMainEventsCapability = JSON.parse(
  readFileSync(new URL("../capabilities/loopback-main-events.json", import.meta.url), "utf8"),
);
const loopbackWindowDragCapability = JSON.parse(
  readFileSync(new URL("../capabilities/loopback-window-drag.json", import.meta.url), "utf8"),
);
const loopbackUpdaterCapability = JSON.parse(
  readFileSync(new URL("../capabilities/loopback-updater.json", import.meta.url), "utf8"),
);
const defaultPermissions = readFileSync(new URL("./default.toml", import.meta.url), "utf8");
const commandPermissions = readFileSync(new URL("./pty.toml", import.meta.url), "utf8");
const browserRust = readFileSync(new URL("../src/browser.rs", import.meta.url), "utf8");
const ptyRust = readFileSync(new URL("../src/pty.rs", import.meta.url), "utf8");
const libRust = readFileSync(new URL("../src/lib.rs", import.meta.url), "utf8");
const browserPane = readFileSync(new URL("../../src/components/browser-pane.tsx", import.meta.url), "utf8");
const bottomTerminal = readFileSync(new URL("../../src/components/bottom-terminal.tsx", import.meta.url), "utf8");
const shellTsx = readFileSync(new URL("../../src/components/shell.tsx", import.meta.url), "utf8");
const trayQuickChat = readFileSync(new URL("../../src/components/tray-quick-chat.tsx", import.meta.url), "utf8");
const updateAvailable = readFileSync(new URL("../../src/components/update-available.tsx", import.meta.url), "utf8");

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
  "allow-browser-close-all",
  "allow-browser-reload",
  "allow-shell-open",
  "allow-sidecar-startup-status",
  "allow-retry-sidecar-startup",
  "allow-cancel-sidecar-startup",
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
  "browser_close_all",
  "browser_reload",
  "shell_open",
  "sidecar_startup_status",
  "retry_sidecar_startup",
  "cancel_sidecar_startup",
];

// Node 22 (CI's runtime) has no global URLPattern, so match capability
// remote URL patterns component-wise the way Tauri's urlpattern crate does
// for the simple `scheme://host:port/path` + `*` shapes this repo uses.
// Backslash escapes in patterns (e.g. the IPv6 colons in
// "http://[\:\:1]:*/*") are URLPattern literal escapes — strip them first.
function originMatchesPattern(pattern, origin) {
  const literal = pattern.replace(/\\(.)/g, "$1");
  const parts = /^([a-z][a-z0-9+.-]*|\*):\/\/(\[[^\]]*\]|[^:/]*)(?::([^/]*))?(\/.*)?$/i.exec(literal);
  assert.ok(parts, `unsupported capability URL pattern shape: ${pattern}`);
  const [, scheme, host, port, path] = parts;
  const url = new URL(origin);
  const schemeOk = scheme === "*" || url.protocol === `${scheme.toLowerCase()}:`;
  const hostOk = host === "*" || url.hostname.toLowerCase() === host.toLowerCase();
  const portOk = port === "*" || (port ?? "") === url.port;
  const pathOk = path === undefined || path === "/*" || url.pathname === path;
  return schemeOk && hostOk && portOk && pathOk;
}

function capabilityAllowsOrigin(capability, origin) {
  const patterns = capability.remote?.urls ?? [];
  return patterns.some((pattern) => originMatchesPattern(pattern, origin));
}

function assertCapabilityDoesNotGrant(capability, deniedPermissions) {
  for (const permission of deniedPermissions) {
    assert.equal(
      capability.permissions.includes(permission),
      false,
      `${capability.identifier} must not grant ${permission}`,
    );
  }
}

test("packaged desktop app can use native browser and terminal commands", () => {
  assert.equal(defaultCapability.local, true, "packaged local app origin must receive the default capability");
  assert.deepEqual(
    defaultCapability.platforms,
    ["linux", "macOS", "windows"],
    "desktop-only permissions must not leak into mobile Tauri builds",
  );
  assert.ok(defaultCapability.permissions.includes("default"), "default capability should include custom app permissions");

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

test("packaged sidecar loopback origins can use browser commands and main-webview PTY", () => {
  for (const origin of [
    "http://127.0.0.1:3000/",
    "http://localhost:3000/",
    "http://[::1]:3000/",
    "http://127.0.0.1:64203/",
    "http://localhost:64203/",
    "http://[::1]:64203/",
  ]) {
    assert.equal(
      capabilityAllowsOrigin(defaultCapability, origin),
      false,
      `default capability must not trust loopback origin ${origin}`,
    );
  }

  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://127.0.0.1:3000/"),
    "dev 127.0.0.1 origin should be allowed restricted browser IPC",
  );
  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://localhost:3000/"),
    "dev localhost origin should be allowed restricted browser IPC",
  );
  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://[::1]:3000/"),
    "dev IPv6 loopback origin should be allowed restricted browser IPC",
  );
  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://127.0.0.1:64203/"),
    "packaged random 127.0.0.1 sidecar port should be allowed restricted browser IPC",
  );
  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://localhost:64203/"),
    "packaged random localhost sidecar port should be allowed restricted browser IPC",
  );
  assert.ok(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://[::1]:64203/"),
    "packaged random IPv6 loopback sidecar port should be allowed restricted browser IPC",
  );
  assertCapabilityDoesNotGrant(loopbackBrowserCapability, [
    "core:event:allow-listen",
    "core:event:allow-unlisten",
  ]);

  assert.deepEqual(
    loopbackMainEventsCapability.webviews,
    ["main"],
    "loopback event permissions must be restricted to the trusted main webview",
  );
  for (const permission of ["core:event:allow-listen", "core:event:allow-unlisten"]) {
    assert.ok(
      loopbackMainEventsCapability.permissions.includes(permission),
      `trusted main loopback webview must be allowed to use Tauri event ${permission}`,
    );
  }
  for (const permission of [
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
    "allow-browser-close-all",
    "allow-browser-reload",
    "allow-browser-report-title",
  ]) {
    assert.ok(
      loopbackBrowserCapability.permissions.includes(permission),
      `loopback-browser should grant packaged sidecar permission ${permission}`,
    );
  }
  assert.equal(
    capabilityAllowsOrigin(loopbackBrowserCapability, "http://example.com:64203/"),
    false,
    "remote non-loopback origins should stay denied",
  );

  assertCapabilityDoesNotGrant(loopbackBrowserCapability, [
    "default",
    "allow-shell-open",
    "allow-sidecar-startup-status",
    "allow-retry-sidecar-startup",
    "allow-cancel-sidecar-startup",
  ]);
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

test("privileged PTY commands require the trusted main webview at runtime", () => {
  assert.match(ptyRust, /static TRUSTED_MAIN_ORIGINS:/);
  assert.match(ptyRust, /pub fn trust_main_origin\(url: &Url\)/);
  assert.match(libRust, /pty::trust_main_origin\(&main_url\);/);
  assert.match(ptyRust, /if webview\.label\(\) != "main"/);
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

// The main webview loads from an external http://127.0.0.1 URL, which the
// capability ACL treats as a REMOTE execution context — capabilities without a
// matching remote.urls block (like default.json) do not apply there at all.
// Titlebar drag / drag-region double-click therefore need this explicit
// remote-scoped grant; without it Tauri's drag.js and any startDragging()
// call are silently denied and the window can never be dragged (the CSS
// app-region hint is equally inert on external URLs).
test("loopback app webviews can drive native window drag for the seamless titlebar", () => {
  assert.deepEqual(
    loopbackWindowDragCapability.windows,
    ["main", "quick-chat"],
    "drag permissions cover the main shell and the decoration-less quick-chat tray window (which is otherwise unmovable)",
  );
  assert.deepEqual(
    loopbackWindowDragCapability.platforms,
    ["linux", "macOS", "windows"],
    "window-drag permissions are desktop-only and must not leak into mobile Tauri builds",
  );
  for (const origin of [
    "http://127.0.0.1:3000/",
    "http://localhost:3000/",
    "http://[::1]:3000/",
    "http://127.0.0.1:64203/",
    "http://localhost:64203/",
    "http://[::1]:64203/",
  ]) {
    assert.ok(
      capabilityAllowsOrigin(loopbackWindowDragCapability, origin),
      `loopback origin ${origin} must be allowed to start a native window drag`,
    );
  }
  assert.equal(
    capabilityAllowsOrigin(loopbackWindowDragCapability, "http://example.com:64203/"),
    false,
    "remote non-loopback origins should stay denied",
  );
  assert.deepEqual(
    loopbackWindowDragCapability.permissions,
    ["core:window:allow-start-dragging", "core:window:allow-internal-toggle-maximize"],
    "the drag capability grants exactly the drag + drag-region double-click commands and nothing else",
  );

  // The web side must actually mark the drag handles: `deep` covers empty
  // chrome anywhere inside the titlebar subtree while drag.js's clickable
  // check keeps controls working. Bare (valueless) regions only drag on
  // direct presses on the attributed element, which is why the shell uses
  // `deep` everywhere.
  assert.ok(
    shellTsx.includes('<div className="shell-top" data-tauri-drag-region="deep">'),
    "the shell titlebar must be a deep Tauri drag region",
  );
  assert.ok(
    trayQuickChat.includes(
      '<header className="quick-chat-overlay__header tray-quick-chat__header" data-tauri-drag-region="deep">',
    ),
    "the quick-chat tray header must be a deep Tauri drag region so the decoration-less window can be moved",
  );
});

// Like window drag above, the in-app updater runs from the loopback main
// webview — a REMOTE execution context where the local-only default.json
// grants (updater:default / process:default) never apply. Without this
// remote-scoped capability every plugin-updater check() throws an ACL denial
// and update-available.tsx falls back to "Open installer in Browser", which
// defeats the whole in-app update experience. Scoped to webviews:["main"]
// (not windows) so in-app browser child webviews that a user navigates to a
// localhost page can never invoke install/relaunch IPC.
test("the trusted main loopback webview can run the native in-app updater", () => {
  assert.deepEqual(
    loopbackUpdaterCapability.webviews,
    ["main"],
    "updater/relaunch IPC must be limited to the trusted main webview — never in-app browser child webviews on loopback origins",
  );
  assert.equal(
    loopbackUpdaterCapability.windows,
    undefined,
    "scope by webview label, not window label — browser child webviews live inside the main window",
  );
  assert.deepEqual(
    loopbackUpdaterCapability.platforms,
    ["linux", "macOS", "windows"],
    "updater permissions are desktop-only and must not leak into mobile Tauri builds",
  );
  for (const origin of [
    "http://127.0.0.1:3000/",
    "http://localhost:3000/",
    "http://[::1]:3000/",
    "http://127.0.0.1:64203/",
    "http://localhost:64203/",
    "http://[::1]:64203/",
  ]) {
    assert.ok(
      capabilityAllowsOrigin(loopbackUpdaterCapability, origin),
      `loopback origin ${origin} must be allowed to run the native updater`,
    );
  }
  assert.equal(
    capabilityAllowsOrigin(loopbackUpdaterCapability, "http://example.com:64203/"),
    false,
    "remote non-loopback origins should stay denied",
  );
  assert.deepEqual(
    loopbackUpdaterCapability.permissions,
    ["updater:default", "process:allow-restart", "os:allow-platform", "os:allow-arch"],
    "grant exactly check/download/install (updater:default), relaunch, and the platform/arch reads used to pick installer fallbacks — nothing else (no process:allow-exit)",
  );

  // The web side must actually drive the native path: check(), prepare the
  // signed download while the old app remains usable, explicitly install,
  // and relaunch. If a refactor drops these the capability grant is dead.
  assert.ok(
    updateAvailable.includes('await import("@tauri-apps/plugin-updater")'),
    "update-available.tsx must check for updates through the native plugin-updater",
  );
  assert.ok(
    updateAvailable.includes("prepareNativeUpdate") && updateAvailable.includes("installPreparedUpdate"),
    "update-available.tsx must separate signed download preparation from explicit install",
  );
  assert.equal(
    updateAvailable.includes("downloadAndInstall"),
    false,
    "update preparation must not exit the old app as soon as download finishes",
  );
  assert.ok(
    updateAvailable.includes('await import("@tauri-apps/plugin-process")'),
    "update-available.tsx must relaunch through plugin-process after installing",
  );
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
    // cols/rows may be longhand (`cols: cols`) or shorthand (`cols,`) — #2651
    // moved to shorthand and this pin (then unwired from CI) silently drifted.
    /invoke\("pty_resize", \{[\s\S]*threadId: threadId,[\s\S]*cols[,:][\s\S]*rows[,:]/,
    "pty_resize must pass threadId so desktop resize reaches Rust",
  );
  assert.match(
    bottomTerminal,
    /Deliberately NO pty_stop here/,
    "terminal unmount must not race the next pane mount by stopping the PTY",
  );
  assert.doesNotMatch(
    bottomTerminal,
    /invoke\("pty_(?:write|resize|stop)", \{[\s\S]{0,120}thread_id:/,
    "direct Tauri command args should not use snake_case without rename_all",
  );
});

test("pty_start keeps process authority native-side", () => {
  const startOptions =
    ptyRust.match(/#\[serde\(deny_unknown_fields\)\][\s\S]*?pub struct StartOptions \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(startOptions, /#\[serde\(deny_unknown_fields\)\]/);
  assert.doesNotMatch(startOptions, /command:/, "renderer must not choose the executable");
  assert.doesNotMatch(startOptions, /args:/, "renderer must not choose process arguments");
  assert.doesNotMatch(startOptions, /env:/, "renderer must not choose process environment");
  assert.match(ptyRust, /let command = default_shell\(\);/);
  assert.match(ptyRust, /let args = default_shell_args\(\);/);
  assert.doesNotMatch(ptyRust, /options\.command|options\.args|options\.env/);
});
