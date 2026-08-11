// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./pty-ws-bridge.ts", import.meta.url), "utf8");

assert.match(src, /export class PtyWsBridge/, "PtyWsBridge class exists");
assert.match(src, /new WebSocket\(url\)/, "bridge opens a WebSocket");
assert.match(src, /binaryType\s*=\s*"arraybuffer"/, "bridge receives binary frames");
assert.match(src, /0x01/, "bridge handles output tag 0x01");
assert.match(src, /0x02/, "bridge handles exit tag 0x02");
assert.match(src, /0x06/, "bridge handles replay-cursor control frames");
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

// ── iOS resume resilience ─────────────────────────────────────────────────────
// iOS/WKWebView resumes from background with either a socket stuck in
// CONNECTING forever (no open/error/close) or a zombie OPEN socket on a dead
// connection. The first wedged the reconnect loop (no connect timeout); the
// second was talked into silently (no teardown before re-dial).
assert.match(src, /const CONNECT_TIMEOUT_MS\b/, "connect has a bounded timeout");
assert.match(
  src,
  /const watchdog = setTimeout\([\s\S]{0,400}reject\(new Error\("terminal websocket connect timed out"\)\)/,
  "a connect that never reaches OPEN rejects so the reconnect loop can advance instead of hanging",
);
assert.match(src, /clearTimeout\(watchdog\)/, "the connect watchdog is cleared once the socket settles");
assert.match(
  src,
  /const prev = this\.ws;[\s\S]{0,300}prev\.close\(1000, "reconnect"\)/,
  "a prior (possibly zombie) socket is torn down before re-dialing",
);
console.log("pty-ws-bridge iOS-resume assertions: ok");

// ── Cursor replay ────────────────────────────────────────────────────────────
assert.match(src, /ptyReplayCursor: String\(this\.replayCursor \?\? -1\)/, "new connections opt into cursor replay");
assert.match(src, /private replayCursor: number \| null = null/, "bridge tracks the last delivered absolute byte cursor");
assert.match(src, /get hasReplayCursor\(\): boolean/, "bridge distinguishes older full-replay servers");
assert.match(src, /this\.replayCursor \+= payload\.byteLength/, "each terminal payload advances the cursor by exact bytes");
assert.match(src, /onReplayReset\(cb: ReplayResetHandler\)/, "bridge exposes bounded-replay fallback reset handling");
assert.match(src, /getFloat64\(0, true\)/, "cursor control frame decodes its safe integer position");
console.log("pty-ws-bridge cursor replay assertions: ok");

// Execute the cursor protocol across real bridge reconnects. This is behavioral
// coverage rather than a source-pattern assertion: the next URL proves exact
// byte advancement, an old socket is allowed to deliver an already-queued
// message after replacement, and an expired cursor resets immediately before
// the bounded full replay.
{
  type Listener = (event: any) => void;
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static readonly instances: FakeWebSocket[] = [];

    readonly listeners = new Map<string, Listener[]>();
    readonly sent: Uint8Array[] = [];
    readonly url: string;
    readyState = FakeWebSocket.CONNECTING;
    binaryType = "";

    constructor(url: string) {
      this.url = url;
      FakeWebSocket.instances.push(this);
    }

    addEventListener(type: string, listener: Listener): void {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type: string, event: any): void {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    }

    message(frame: Uint8Array): void {
      const data = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      this.emit("message", { data });
    }

    send(frame: Uint8Array): void {
      this.sent.push(frame);
    }

    close(code = 1000, reason = ""): void {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close", { code, reason });
    }
  }

  const cursorFrame = (cursor: number, reset = false): Uint8Array => {
    const frame = new Uint8Array(10);
    frame[0] = 0x06;
    new DataView(frame.buffer).setFloat64(1, cursor, true);
    frame[9] = reset ? 1 : 0;
    return frame;
  };
  const dataFrame = (text: string): Uint8Array => {
    const bytes = new TextEncoder().encode(text);
    const frame = new Uint8Array(bytes.length + 1);
    frame[0] = 0x01;
    frame.set(bytes, 1);
    return frame;
  };
  const replayCursor = (socket: FakeWebSocket): string | null =>
    new URL(socket.url).searchParams.get("ptyReplayCursor");

  Object.assign(globalThis, {
    window: { location: { protocol: "http:", host: "cave.test" } },
    WebSocket: FakeWebSocket,
  });
  const { PtyWsBridge } = await import("./pty-ws-bridge.ts");
  const bridge = new PtyWsBridge();
  const events: string[] = [];
  bridge.onData((bytes) => events.push(`data:${new TextDecoder().decode(bytes)}`));
  bridge.onReplayReset(() => events.push("reset"));

  const firstConnect = bridge.connect("cursor-e2e", 80, 24);
  const first = FakeWebSocket.instances.at(-1)!;
  assert.equal(replayCursor(first), "-1", "the first attach negotiates cursor replay");
  first.open();
  await firstConnect;
  first.message(cursorFrame(100));
  first.message(dataFrame("abc"));
  first.close(1006, "network lost");

  const secondConnect = bridge.reconnect();
  const second = FakeWebSocket.instances.at(-1)!;
  assert.equal(replayCursor(second), "103", "reconnect requests exactly the first missed byte");
  second.open();
  await secondConnect;

  // A message already queued by the replaced socket must not mutate terminal
  // state or the shared replay cursor after the new request has been sent.
  first.message(cursorFrame(900));
  first.message(dataFrame("stale"));
  assert.deepEqual(events, ["data:abc"], "a replaced socket cannot deliver stale output");

  second.message(cursorFrame(103));
  second.message(dataFrame("def"));
  second.close(1006, "network lost again");

  const thirdConnect = bridge.reconnect();
  const third = FakeWebSocket.instances.at(-1)!;
  assert.equal(replayCursor(third), "106", "suffix replay advances by exact payload bytes");
  third.open();
  await thirdConnect;
  third.message(cursorFrame(0, true));
  third.message(dataFrame("fresh"));
  assert.deepEqual(
    events,
    ["data:abc", "data:def", "reset", "data:fresh"],
    "an expired cursor resets before bounded full replay",
  );
  bridge.dispose();
}

console.log("pty-ws-bridge behavioral cursor replay: ok");

// ── Explicit tab-close reaps the shell (cave-wujw) ────────────────────────────
// Closing a terminal tab on the WS transport used to just drop the socket, which
// the server treats as a transient DETACH — leaking the shell (and its
// foreground job) for the full detach grace (~5 min). The bridge now sends an
// explicit kill frame (0x05); a threadId→bridge registry lets the out-of-tree
// tab-close handler reach the bridge it doesn't own.
assert.match(src, /const activeBridges = new Map<string, PtyWsBridge>/, "a threadId→bridge registry exists for out-of-tree kills");
assert.match(
  src,
  /export function killPtyBridge\(threadId: string\): void \{\s*\n\s*activeBridges\.get\(threadId\)\?\.kill\(\);/,
  "killPtyBridge reaps by threadId (no-op when no WS bridge is registered — e.g. desktop native IPC)",
);
assert.match(src, /activeBridges\.set\(target\.threadId, this\)/, "open() registers the bridge by threadId");
assert.match(
  src,
  /activeBridges\.get\(threadId\) === this\)\s*\{\s*\n\s*activeBridges\.delete\(threadId\)/,
  "dispose() unregisters only its own entry",
);
assert.match(
  src,
  /kill\(\): void \{[\s\S]{0,220}send\(new Uint8Array\(\[0x05\]\)\)/,
  "kill() sends the 0x05 kill frame over the open socket",
);
assert.match(src, /kill\(\): void \{[\s\S]{0,320}this\.dispose\(\)/, "kill() tears down after sending the frame");
console.log("pty-ws-bridge kill-frame assertions: ok");
