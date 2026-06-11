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
