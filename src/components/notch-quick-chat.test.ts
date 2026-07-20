// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("./notch-quick-chat.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/quick-chat/page.tsx", import.meta.url), "utf8");
const tray = readFileSync(new URL("./tray-quick-chat.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/notch-quick-chat.css", import.meta.url), "utf8");
const shell = ["tauri_setup.rs", "window_geometry.rs"]
  .map((file) => readFileSync(new URL(`../../src-tauri/src/${file}`, import.meta.url), "utf8"))
  .join("\n");

assert.match(
  page,
  /import \{ NotchQuickChat \} from "@\/components\/notch-quick-chat"/,
  "the shared quick-chat route can render the notch presentation",
);
assert.match(
  page,
  /params\.notch === "1" \? <NotchQuickChat \/> : <TrayQuickChat \/>/,
  "?notch=1 selects the notch presentation server-side — no dedicated route, so the sidecar runtime closure stays flat",
);

// ── The shell owns the notch window ─────────────────────────────────────────
// A dedicated always-on-top frameless window, top-center of the primary
// monitor, loading /quick-chat?notch=1 on the trusted loopback origin only.
assert.match(
  shell,
  /const NOTCH_WINDOW_LABEL: &str = "notch";/,
  "the notch window has its own label",
);
assert.match(
  shell,
  /url\.set_path\("\/quick-chat"\);\s*\n\s*url\.query_pairs_mut\(\)\.append_pair\("notch", "1"\);/,
  "notch_url_from_main routes the trusted loopback origin to /quick-chat?notch=1, keeping the sidecar auth token",
);
assert.match(
  shell,
  /fn notch_url_from_main\(mut url: Url\) -> Option<Url> \{\s*\n\s*let trusted_loopback = url\.scheme\(\) == "http"/,
  "the notch URL is refused unless the main window sits on a loopback sidecar origin",
);
assert.match(
  shell,
  /screen_x \+ \(screen_w - width\) \/ 2\.0, screen_y/,
  "the notch centers horizontally and hugs the top edge of the primary monitor",
);
assert.match(
  shell,
  /\.always_on_top\(true\)\s*\n\s*\.skip_taskbar\(true\)\s*\n\s*\.position\(x, y\)\s*\n\s*\/\/ No native shadow/,
  "the notch window floats frameless above other windows without a taskbar entry",
);

// ── Parked top-center, never chasing the mouse ──────────────────────────────
// The notch stays fixed in the middle of the top bar where a notch belongs.
// The old follow-mouse follower (a thread that glided the pill after the
// cursor) is retired for good — these pins keep it from creeping back.
assert.doesNotMatch(
  shell,
  /spawn_notch_mouse_follower|notch_follow_tick|NOTCH_FOLLOW_TICK/,
  "no follower thread — the notch never chases the mouse",
);
assert.doesNotMatch(
  shell,
  /follow_mouse/,
  "the retired follow-mouse config field stays gone from the shell",
);
assert.match(
  shell,
  /let center_x = monitor_x \+ monitor_w \/ 2\.0;\s*\n\s*let x = notch_centered_x\(center_x, monitor_x, monitor_w, width_px\);/,
  "both notch states center on the exact horizontal middle of the top bar",
);
assert.match(
  shell,
  /fn notch_centered_x\(center_x: f64, monitor_x: f64, monitor_w: f64, width: f64\) -> f64/,
  "the centering clamps inside the monitor span",
);
assert.doesNotMatch(
  component,
  /followMouse/,
  "the page has no follow-mouse state or toggle",
);

// ── Fit inside the top bar ───────────────────────────────────────────────────
// The collapsed pill sizes itself into the menu-bar strip (monitor work-area
// delta) and macOS lifts the window to status level so the bar can't paint
// over it.
assert.match(
  shell,
  /fn menu_bar_strip_height\(monitor: &tauri::Monitor\) -> Option<f64>/,
  "the shell measures the reserved top strip from the monitor work area",
);
assert.match(
  shell,
  /fn notch_collapsed_size\(config: &NotchConfig, strip_height: Option<f64>\)/,
  "the collapsed pill squeezes into the strip when fit-menu-bar is on",
);
assert.match(
  shell,
  /setLevel: 25isize/,
  "macOS lifts the notch to status-window level so it shows inside the menu bar",
);

// ── Customizations ───────────────────────────────────────────────────────────
// Fit (and hand-editable sizes) persist as notch-config.json; the page
// toggle patches the shell through notch:config and the URL seeds the initial
// state (the page has no invoke permissions).
assert.match(
  shell,
  /struct NotchConfig \{[\s\S]{0,400}fit_menu_bar: bool,/,
  "the notch behaviors are a config struct, not hardcoded",
);
assert.match(
  shell,
  /dir\.join\("notch-config\.json"\)/,
  "customizations persist in the app config dir",
);
assert.match(
  shell,
  /app\.listen\("notch:config", move \|event\| \{\s*\n\s*apply_notch_config_patch\(&notch_config_handle, event\.payload\(\)\);/,
  "notch:config patches persist and re-apply geometry",
);
assert.match(
  shell,
  /fn notch_url_with_config\(\s*mut url: Url,\s*config: &NotchConfig,\s*strip_height: Option<f64>,?\s*\)/,
  "the shell seeds the page's presentation state through the URL",
);
assert.match(
  component,
  /void emitNotch\("notch:config", \{ fitMenuBar \}\);/,
  "the fit-menu-bar toggle patches the shell config",
);
assert.match(
  component,
  /readPresentation\(window\.location\.search\)/,
  "the page reads its initial presentation from the shell-seeded URL",
);
assert.match(
  css,
  /width: var\(--notch-pill-w, 190px\);\s*\n\s*height: var\(--notch-pill-h, 38px\);/,
  "the pill sizes from shell-provided variables so it shrinks into the strip",
);

// ── Expand/collapse geometry stays in Rust ──────────────────────────────────
// The page emits intents; the shell resizes between the two fixed states. The
// notch webview is granted nothing but core:event:allow-emit.
assert.match(
  shell,
  /fn set_notch_geometry\(app: &tauri::AppHandle, expanded: bool\)/,
  "one shell function owns both notch geometries",
);
assert.match(
  shell,
  /app\.listen\("notch:expand", move \|_\| \{\s*\n\s*set_notch_geometry\(&notch_expand_handle, true\);/,
  "notch:expand grows the window",
);
assert.match(
  shell,
  /app\.listen\("notch:collapse", move \|_\| \{\s*\n\s*set_notch_geometry\(&notch_collapse_handle, false\);/,
  "notch:collapse shrinks the window back to the pill",
);
const notchCapability = JSON.parse(
  readFileSync(new URL("../../src-tauri/capabilities/loopback-notch.json", import.meta.url), "utf8"),
);
assert.deepEqual(
  notchCapability.webviews,
  ["notch"],
  "the notch capability is scoped to the notch webview only",
);
assert.deepEqual(
  notchCapability.permissions,
  ["core:event:allow-emit"],
  "the notch webview may only emit its intent events — no window permissions",
);
assert.ok(
  Array.isArray(notchCapability.remote?.urls) && notchCapability.remote.urls.length > 0,
  "the notch capability stays restricted to trusted loopback origins",
);

// ── Opting in moves the menu-bar icon ───────────────────────────────────────
// The tray menu item hides the tray icon, opens the notch, and persists the
// choice; startup restores it; the notch's dock button is the way back.
// Only persist the preference and hide the tray after the notch window is
// confirmed to exist (guards against URL failures or window-creation errors).
assert.match(
  shell,
  /"notch_mode" => \{\s*[\s\S]{0,400}show_notch_window\(app, &url\);\s*\n\s*if app\.get_webview_window\(NOTCH_WINDOW_LABEL\)\.is_some\(\) \{\s*\n\s*save_notch_mode\(app, true\);\s*\n\s*set_tray_visible\(app, false\);/,
  "the tray menu item persists the preference and hides the tray icon only after the notch window opens",
);
assert.match(
  shell,
  /if load_notch_mode\(app\.handle\(\)\) \{\s*\n\s*show_notch_from_main\(app\.handle\(\)\);\s*\n\s*if app\s*\.handle\(\)\s*\.get_webview_window\(NOTCH_WINDOW_LABEL\)\s*\.is_some\(\)\s*\{\s*\n\s*set_tray_visible\(app\.handle\(\), false\);/,
  "launch restores the notch presentation and hides the tray only when the window is confirmed open",
);
assert.match(
  shell,
  /app\.listen\("notch:dock-to-tray", move \|_\| \{\s*\n\s*save_notch_mode\(&notch_dock_handle, false\);\s*\n\s*set_tray_visible\(&notch_dock_handle, true\);/,
  "docking restores the tray icon and forgets the preference",
);
assert.match(
  shell,
  /dir\.join\("notch-mode"\)/,
  "the preference persists as a marker file in the app config dir",
);

// ── Detachable ───────────────────────────────────────────────────────────────
// Detach folds the notch up and opens the traditional floating quick-chat
// window (movable, resizable, multi-tab) — the notch never replaces it.
assert.match(
  shell,
  /app\.listen\("notch:detach", move \|_\| \{\s*\n\s*set_notch_geometry\(&notch_detach_handle, false\);\s*\n\s*show_quick_chat_from_main\(&notch_detach_handle\);/,
  "detaching collapses the notch and opens the floating quick-chat window",
);
assert.match(
  component,
  /aria-label="Detach into floating quick chat"/,
  "the toolbar exposes a detach button",
);
assert.match(
  component,
  /void emitNotch\("notch:detach"\);/,
  "detach hands off through the shell event",
);

// ── The page: pill expands into the full quick chat ─────────────────────────
assert.match(
  component,
  /aria-expanded=\{expanded\}[\s\S]{0,200}onClick=\{expanded \? collapse : expand\}/,
  "the pill toggles between expand and collapse",
);
// When the notch is collapsed, the panel must be inert so keyboard users
// cannot tab into toolbar buttons or the composer that are visually hidden.
assert.match(
  component,
  /inert=\{!expanded \|\| undefined\}/,
  "the collapsed panel is inert so keyboard users cannot tab into hidden controls",
);
assert.match(
  component,
  /void emitNotch\("notch:expand"\);\s*\n\s*setExpanded\(true\);/,
  "expanding grows the window before the panel animates in",
);
assert.match(
  component,
  /collapseTimer\.current = window\.setTimeout\(\(\) => \{\s*\n\s*collapseTimer\.current = null;\s*\n\s*void emitNotch\("notch:collapse"\);\s*\n\s*\}, COLLAPSE_ANIMATION_MS\);/,
  "collapsing lets the exit transition play before the shell shrinks the window",
);
// Every traditional quick chat operation: the notch renders the same pane as
// the tray window (controls row, thread, composer, slash commands, queueing,
// open-in-app) — exported, not forked.
assert.match(
  component,
  /<QuickChatTabPane\s*\n\s*tabId=\{1\}\s*\n\s*active=\{expanded\}/,
  "the panel reuses the shared quick chat pane, active while expanded",
);
assert.match(
  tray,
  /export function QuickChatTabPane\(\{/,
  "the tray pane is exported for the notch to reuse",
);
assert.match(tray, /export type TabReport = \{/, "the pane report type is shared");

// ── Closes on send / on close ────────────────────────────────────────────────
assert.match(
  component,
  /if \(sending && !prevSendingRef\.current\) collapse\(\);/,
  "a send starting folds the notch up (the pane keeps streaming behind the pill)",
);
assert.match(
  component,
  /if \(event\.key === "Escape"\) collapse\(\);/,
  "Escape collapses the notch",
);
assert.match(
  component,
  /aria-label="Collapse quick chat"/,
  "the toolbar exposes a close/collapse button",
);
assert.match(
  component,
  /\{sending \? <span className="quick-tab__pulse" role="img" aria-label="Replying…" \/> : null\}/,
  "the pill pulses while a familiar is replying",
);

// ── Smooth animations, with fallbacks ────────────────────────────────────────
assert.match(
  css,
  /transform-origin: top center;/,
  "the panel animates out of the notch seam",
);
assert.match(
  css,
  /transition:\s*\n\s*opacity 180ms ease,\s*\n\s*transform 180ms ease;/,
  "the panel's transition matches COLLAPSE_ANIMATION_MS",
);
assert.match(
  component,
  /const COLLAPSE_ANIMATION_MS = 180;/,
  "the page waits out the same 180ms the CSS animates",
);
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.notch-quick-chat__pill,\s*\n\s*\.notch-quick-chat__panel \{\s*\n\s*transition: none;/,
  "reduced-motion users skip the transitions",
);
assert.match(
  css,
  /@media \(prefers-reduced-transparency: reduce\)/,
  "reduced-transparency users get solid surfaces back",
);
// Glass follows the same shell handshake as the tray quick chat.
assert.match(component, /get\("glass"\) === "1"/, "the page reads the glass handshake from the window URL");
assert.match(
  shell,
  /fn show_notch_window\(app: &tauri::AppHandle, notch_url: &Url\)[\s\S]{0,1800}append_pair\("glass", "1"\)/,
  "only the macOS shell that opened the window transparent sends ?glass=1",
);

console.log("notch-quick-chat.test.ts OK");
