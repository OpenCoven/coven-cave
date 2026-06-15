// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");

assert.match(src, /import \{ PtyWsBridge \} from "@\/lib\/pty-ws-bridge";/, "BottomTerminal imports browser WS bridge");
assert.doesNotMatch(src, /platform === "browser"[\s\S]{0,120}setUnavailable\(true\)/, "browser mode must not render unavailable placeholder");
assert.doesNotMatch(src, /platform === "ios" \|\| platform === "android"[\s\S]{0,120}setUnavailable\(true\)/, "mobile native must not hard-render the unavailable placeholder — it rides the WS bridge");
assert.match(src, /if \(platform !== "desktop"\) return;/, "Tauri IPC path remains desktop-only");
assert.match(src, /if \(platform !== "browser" && platform !== "ios" && platform !== "android"\) return;/, "WS bridge path covers browser and Tauri-mobile");
assert.match(src, /bridge\.connect\(threadId,\s*term\.cols,\s*term\.rows,\s*projectRootRef\.current\)/, "WS bridge connects with terminal dimensions and cwd");
assert.match(src, /bridge\.write\(new TextEncoder\(\)\.encode\(data\)\)/, "terminal input flows to WS bridge");
assert.match(src, /bridge\.resize\(term\.cols,\s*term\.rows\)/, "terminal resize flows to WS bridge");
assert.match(src, /bridge\.dispose\(\)/, "WS bridge is disposed on cleanup");

console.log("bottom-terminal-ws-bridge.test.ts OK");

// ── Disconnect recovery (the "terminal stopped accepting input" class) ───────
assert.match(src, /bridge\.onClose\(/, "terminal reacts to a dropped socket instead of freezing");
assert.match(src, /terminal disconnected — reconnecting/, "drop is announced in the pane");
assert.match(src, /const RECONNECT_DELAYS_MS = \[0, 1000, 3000\]/, "reconnect retries with capped backoff");
assert.match(
  src,
  /if \(!bridge\.isOpen\) \{[\s\S]{0,260}attemptReconnect\(\);[\s\S]{0,80}return;[\s\S]{0,120}bridge\.write\(new TextEncoder\(\)\.encode\(data\)\)/,
  "typing on a dead socket revives the terminal instead of vanishing into a no-op write",
);
assert.match(src, /term\.reset\(\);[\s\S]{0,120}await bridge\.reconnect\(\)/, "screen resets before reattach so the server replay paints clean");
assert.match(src, /reason === "replaced"/, "a take-over by another window is announced, not fought with reconnects");

// ── PTY lifetime is decoupled from view lifetime ──────────────────────────────
// Unmount is usually a keepalive tab-switch remount; killing the PTY there
// raced the next mount's pty_list and left a dead pane that ate keystrokes.
assert.doesNotMatch(
  src,
  /invoke\("pty_stop"/,
  "desktop cleanup must NOT stop the PTY — only closing the tab (ComuxView.removeSession) kills the shell",
);
assert.match(
  src,
  /pty_snapshot/,
  "attaching to a running PTY replays the Rust scrollback ring",
);
assert.match(
  src,
  /const attachToRunning = running\.includes\(threadId\);[\s\S]{0,900}unlistenData/,
  "snapshot replay happens before the live data listener registers",
);
console.log("bottom-terminal disconnect-recovery assertions: ok");

// ── iOS background/resume recovery ────────────────────────────────────────────
// iOS/WKWebView resumes with a zombie OPEN socket that never fires close, so
// the onClose-driven reconnect never runs and the pane hangs. Re-dial on
// foreground: force it on iOS (zombie sockets lie about being open), and on
// other platforms redial only when the socket is actually down.
assert.match(src, /addEventListener\("visibilitychange", onForeground\)/, "terminal re-validates its socket when the app returns to the foreground");
assert.match(src, /addEventListener\("pageshow", onForeground\)/, "pageshow (iOS bfcache resume) also re-validates the socket");
assert.match(
  src,
  /if \(platform === "ios" \|\| !bridge\.isOpen\) \{\s*\n\s*void attemptReconnect\(\);/,
  "iOS always re-dials on foreground (zombie OPEN sockets); other platforms only when the socket is down",
);
assert.match(src, /removeEventListener\("visibilitychange", onForeground\)/, "foreground listeners are torn down on cleanup");
console.log("bottom-terminal iOS-resume assertions: ok");
