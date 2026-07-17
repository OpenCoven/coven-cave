import assert from "node:assert/strict";
import { MOBILE_ACCESS_HEADER, TOKEN_HEADER } from "../../proxy-helpers.ts";
import { isLocalOrigin } from "./local-origin.ts";

const ORIGINAL_SIDECAR_TOKEN = process.env.COVEN_CAVE_AUTH_TOKEN;

function restoreEnv() {
  if (ORIGINAL_SIDECAR_TOKEN === undefined) delete process.env.COVEN_CAVE_AUTH_TOKEN;
  else process.env.COVEN_CAVE_AUTH_TOKEN = ORIGINAL_SIDECAR_TOKEN;
}

const withHeaders = (headers: HeadersInit = {}) => new Request("http://x/", { headers });
const withHost = (host?: string) => withHeaders(host === undefined ? {} : { host });

try {
  delete process.env.COVEN_CAVE_AUTH_TOKEN;

  // Loopback hosts (with or without a port) are accepted in tokenless local dev.
  assert.equal(isLocalOrigin(withHost("127.0.0.1:3000")), true, "127.0.0.1 accepted");
  assert.equal(isLocalOrigin(withHost("localhost:8443")), true, "localhost accepted");
  assert.equal(isLocalOrigin(withHost("localhost")), true, "bare localhost accepted");
  assert.equal(isLocalOrigin(withHost("[::1]:3000")), true, "IPv6 loopback accepted");
  assert.equal(isLocalOrigin(withHost("[::1]")), true, "bare IPv6 loopback accepted");

  // Non-loopback hosts are rejected — including the tailnet host the phone uses
  // (a 100.64.0.0/10 CGNAT address, or the equivalent magic-DNS name), which is
  // the whole point: these routes are desktop-only, not phone-reachable.
  assert.equal(isLocalOrigin(withHost("100.101.102.103:8443")), false, "tailnet host rejected (desktop-only)");
  assert.equal(isLocalOrigin(withHost("192.168.1.5:8443")), false, "LAN host rejected");
  assert.equal(isLocalOrigin(withHost("evil.example.com")), false, "remote host rejected");
  assert.equal(isLocalOrigin(withHost(undefined)), false, "missing Host rejected");

  assert.equal(
    isLocalOrigin(withHeaders({ host: "127.0.0.1:3000", [MOBILE_ACCESS_HEADER]: "1" })),
    false,
    "verified mobile/tailnet-forwarded requests cannot satisfy the desktop-only local-origin guard",
  );

  process.env.COVEN_CAVE_AUTH_TOKEN = "sidecar-secret";
  assert.equal(
    isLocalOrigin(withHeaders({ host: "127.0.0.1:3000" })),
    false,
    "packaged sidecars require the first-party sidecar token header",
  );
  assert.equal(
    isLocalOrigin(withHeaders({ host: "127.0.0.1:3000", [TOKEN_HEADER]: "wrong" })),
    false,
    "wrong sidecar token rejected",
  );
  assert.equal(
    isLocalOrigin(withHeaders({ host: "127.0.0.1:3000", [TOKEN_HEADER]: "sidecar-secret" })),
    true,
    "matching sidecar token accepted on loopback Host",
  );
  assert.equal(
    isLocalOrigin(
      withHeaders({
        host: "127.0.0.1:3000",
        [TOKEN_HEADER]: "sidecar-secret",
        [MOBILE_ACCESS_HEADER]: "1",
      }),
    ),
    false,
    "mobile marker still rejects even if the sidecar token is present",
  );
} finally {
  restoreEnv();
}

console.log("local-origin.test.ts: ok");
