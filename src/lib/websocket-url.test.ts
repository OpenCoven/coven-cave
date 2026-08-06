import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requiresSecureWebsocket,
  websocketProtocolFor,
  websocketUrl,
} from "./websocket-url.ts";

// One decision point for ws: vs wss:. Getting it wrong is not cosmetic — an
// insecure socket from an HTTPS page is blocked as mixed content by the browser
// and refused by ATS on iOS, so the terminal never connects and the failure
// surfaces nowhere near its cause.

// --- scheme follows the page -------------------------------------------------
assert.equal(websocketProtocolFor({ protocol: "https:", host: "a.ts.net" }), "wss:");
assert.equal(websocketProtocolFor({ protocol: "http:", host: "127.0.0.1:3000" }), "ws:");
assert.equal(
  websocketProtocolFor({ protocol: "HTTPS:", host: "a.ts.net" }),
  "wss:",
  "protocol comparison is case-insensitive",
);
assert.equal(
  websocketProtocolFor({ protocol: "wss:", host: "a.ts.net" }),
  "wss:",
  "an already-secure socket origin stays secure",
);

// Plain ws: on loopback is correct, not a downgrade: that is the desktop shell
// talking to its own sidecar on 127.0.0.1, where there is no TLS to preserve.
assert.equal(requiresSecureWebsocket({ protocol: "http:", host: "127.0.0.1:3020" }), false);
assert.equal(requiresSecureWebsocket({ protocol: "https:", host: "cave.ts.net" }), true);

// --- URL construction --------------------------------------------------------
assert.equal(
  websocketUrl("/api/pty-ws", { threadId: "t1" }, { protocol: "https:", host: "cave.ts.net" }),
  "wss://cave.ts.net/api/pty-ws?threadId=t1",
);
assert.equal(
  websocketUrl("/api/pty-ws", undefined, { protocol: "http:", host: "127.0.0.1:3000" }),
  "ws://127.0.0.1:3000/api/pty-ws",
  "no params means no trailing question mark",
);
assert.equal(
  websocketUrl(
    "/api/pty-ws",
    new URLSearchParams({ cols: "80", rows: "24" }),
    { protocol: "http:", host: "127.0.0.1:3000" },
  ),
  "ws://127.0.0.1:3000/api/pty-ws?cols=80&rows=24",
);

// The host comes from the page, never the caller, so no surface can point a
// socket carrying Cave's session at another host.
assert.throws(
  () => websocketUrl("api/pty-ws", undefined, { protocol: "http:", host: "127.0.0.1" }),
  /absolute path/,
  "a relative path is a mistake, not something to normalise",
);

// --- no surface derives the scheme on its own --------------------------------
const bridge = readFileSync(new URL("./pty-ws-bridge.ts", import.meta.url), "utf8");
assert.match(
  bridge,
  /websocketUrl\("\/api\/pty-ws", params\)/,
  "the PTY bridge builds its URL through the shared helper",
);
assert.doesNotMatch(
  bridge,
  /location\.protocol === "https:"/,
  "the inline scheme ternary is retired — one decision point, not one per caller",
);

// --- what the SERVER must NOT do ---------------------------------------------
// `tailscale serve` terminates TLS and forwards PLAINTEXT to loopback, so a
// paired phone's upgrade legitimately arrives as http/ws with x-forwarded-*
// headers. Refusing a plaintext upgrade that carries forwarded-TLS headers
// therefore breaks exactly the paired-phone terminal it would look like it was
// protecting. The scheme-agnostic host match in server.ts is deliberate; this
// pins it so it does not get "fixed" into a downgrade check.
const server = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
assert.match(
  server,
  /if \(url\.host === expected\.host\) return true;/,
  "the upgrade gate matches on host, not scheme — TLS terminates at tailscale serve",
);

console.log("websocket-url.test.ts: ok");
