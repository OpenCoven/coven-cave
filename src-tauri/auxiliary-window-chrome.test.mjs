import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source pin for the native window chrome of the two auxiliary chat windows.
// Neither trait below is expressible as a checked type, so they are only
// verifiable here until someone runs the desktop shell by hand.
//
// Quick chat is a small always_on_top panel summoned from the tray.
// always_on_top orders it only against windows on the space it is already on:
// with a default collection behavior it stays pinned to the space it opened on
// and is hidden outright while another app is fullscreen. Its collection
// behavior therefore has to be widened in the objc2 block.
//
// The detached Chat window is the opposite kind of window: an ordinary
// application window that holds full conversations. It must stay a normal,
// decorated, resizable window and must never inherit the floating panel's
// traits.

const src = await readFile(new URL("./src/window_geometry.rs", import.meta.url), "utf8");

// Scope assertions to the relevant function bodies so a matching call elsewhere
// in window_geometry.rs can't satisfy these by accident.
const FN_MARKER = "pub(super) fn ";
function sliceFn(name) {
  const start = src.indexOf(`${FN_MARKER}${name}`);
  assert.ok(start >= 0, `${name} not found in window_geometry.rs`);
  const next = src.indexOf(FN_MARKER, start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

const quickChat = sliceFn("show_quick_chat_window");
const chatWindow = sliceFn("show_chat_window_from_main");

test("quick chat joins all spaces and survives another app going fullscreen", () => {
  assert.match(
    quickChat,
    /CAN_JOIN_ALL_SPACES:\s*usize\s*=\s*1\s*<<\s*0/,
    "canJoinAllSpaces is bit 0 of NSWindowCollectionBehavior",
  );
  assert.match(
    quickChat,
    /FULL_SCREEN_AUXILIARY:\s*usize\s*=\s*1\s*<<\s*8/,
    "fullScreenAuxiliary is bit 8 of NSWindowCollectionBehavior",
  );
  assert.match(
    quickChat,
    /let\s+current:\s*usize\s*=\s*msg_send!\[[^\]]*collectionBehavior\]/,
    "read the current mask before modifying it",
  );
  assert.match(
    quickChat,
    /current\s*\|\s*CAN_JOIN_ALL_SPACES\s*\|\s*FULL_SCREEN_AUXILIARY/,
    "OR the traits into the current mask rather than overwriting what tao set",
  );
});

test("quick chat is NOT raised to status level — it is a panel, not a menu-bar resident", () => {
  // always_on_top(true) already gives it NSFloatingWindowLevel, which is the
  // correct level; status level would put a full chat panel above the menu bar.
  assert.doesNotMatch(
    quickChat,
    /setLevel:/,
    "quick chat must keep the floating level always_on_top gives it",
  );
});

test("the detached Chat window is an ordinary application window", () => {
  for (const trait of [/\.always_on_top\(/, /\.skip_taskbar\(/, /\.decorations\(false\)/, /\.transparent\(/, /setLevel:/]) {
    assert.doesNotMatch(
      chatWindow,
      trait,
      `the Chat window must not take the floating panel trait ${trait}`,
    );
  }
  assert.match(chatWindow, /\.resizable\(true\)/, "the Chat window is resizable");
  assert.match(
    chatWindow,
    /\.min_inner_size\(/,
    "the Chat window keeps a minimum size its rail, list and composer still fit",
  );
  assert.match(
    chatWindow,
    /\.disable_drag_drop_handler\(\)/,
    "the composer's HTML5 file drop needs the OS drop handler disabled, as in the main window",
  );
  assert.match(
    chatWindow,
    /title_bar_style\(tauri::TitleBarStyle::Overlay\)[\s\S]*\.hidden_title\(true\)/,
    "macOS uses the same seamless overlay title bar as the main window",
  );
});

test("popping out again reuses the running Chat window instead of reloading it", () => {
  const reuse = chatWindow.slice(0, chatWindow.indexOf("main_url_for_child_windows"));
  assert.match(
    reuse,
    /get_webview_window\(CHAT_WINDOW_LABEL\)[\s\S]*set_focus\(\)[\s\S]*return Ok\(\(\)\);/,
    "an open Chat window is focused, never rebuilt",
  );
  assert.doesNotMatch(
    reuse,
    /navigate\(|location/,
    "an open Chat window must not be navigated: that would drop its live conversations",
  );
  assert.match(
    reuse,
    /serde_json::to_string\(target\)[\s\S]*cave:chat-window-target/,
    "the new target reaches the page as serialized JSON on a DOM event",
  );
});

// Review of #6480: a pop-out the shell could not show must say so. The page
// closes the docked panel only on success, so an Ok(()) with no window would
// make the conversation vanish.
test("a Chat window that could not be shown is reported to the page", async () => {
  assert.match(
    chatWindow,
    /-> Result<\(\), String>/,
    "show_chat_window_from_main reports whether a window is showing the chat",
  );
  assert.match(
    chatWindow,
    /else \{[\s\S]{0,160}return Err\(/,
    "no known app address is an error, not a silent focus of the main window",
  );
  assert.match(
    chatWindow,
    /Err\(e\) => \{[\s\S]{0,160}Err\(format!\(/,
    "a window build failure reaches the page",
  );
  const setup = await readFile(new URL("./src/tauri_setup.rs", import.meta.url), "utf8");
  // Building a window in a synchronous command deadlocks on Windows (WebView2).
  assert.match(setup, /async fn open_chat_window\(/, "the command that builds the Chat window is async");
  assert.match(
    setup,
    /show_chat_window_from_main\(app, &ChatWindowTarget::new\(familiar_id, session_id\)\)\n\}/,
    "the command returns the window's result instead of a blanket Ok",
  );
});
