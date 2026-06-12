// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./pty-ws-bridge.ts", import.meta.url), "utf8");

assert.match(src, /export class PtyWsBridge/, "PtyWsBridge class exists");
assert.match(src, /new WebSocket\(url\)/, "bridge opens a WebSocket");
assert.match(src, /binaryType\s*=\s*"arraybuffer"/, "bridge receives binary frames");
assert.match(src, /0x01/, "bridge handles output tag 0x01");
assert.match(src, /0x02/, "bridge handles exit tag 0x02");
assert.match(src, /frame\[0\]\s*=\s*0x03/, "bridge sends input tag 0x03");
assert.match(src, /frame\[0\]\s*=\s*0x04/, "bridge sends resize tag 0x04");
assert.match(src, /setUint16\(1,\s*cols,\s*true\)/, "resize encodes cols little-endian");
assert.match(src, /setUint16\(3,\s*rows,\s*true\)/, "resize encodes rows little-endian");
assert.match(src, /dispose\(\)/, "bridge exposes dispose");

console.log("pty-ws-bridge.test.ts OK");

// ── Disconnect resilience ─────────────────────────────────────────────────────
// A dropped socket used to be silent: write() no-ops when not OPEN and the
// close handler only nulled the field, so the terminal froze and ate
// keystrokes. The bridge now surfaces established-socket closes and can
// re-dial with its remembered parameters.
assert.match(src, /onClose\(cb: CloseHandler\)/, "bridge surfaces post-open closes");
assert.match(src, /reconnect\(\): Promise<void>/, "bridge can re-dial the same session");
assert.match(src, /private lastConnect/, "reconnect reuses the original connect parameters");
assert.match(src, /get isOpen\(\)/, "callers can check liveness before writing");
assert.match(
  src,
  /const wasCurrent = this\.ws === ws;[\s\S]{0,700}if \(wasCurrent\) \{\s*\n\s*for \(const cb of this\.closeHandlers\) cb\(event\.code, event\.reason \?\? ""\);/,
  "close handlers fire only for the bridge's current socket — dispose() nulls ws first so intentional teardown stays silent",
);
console.log("pty-ws-bridge reconnect assertions: ok");
