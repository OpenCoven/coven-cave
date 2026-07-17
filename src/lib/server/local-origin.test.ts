import assert from "node:assert/strict";
import { MOBILE_ACCESS_HEADER } from "../../proxy-helpers.ts";
import { isLocalOrigin } from "./local-origin.ts";

const withHost = (host?: string, extraHeaders: Record<string, string> = {}) =>
  new Request("http://x/", {
    headers: host === undefined ? extraHeaders : { host, ...extraHeaders },
  });

// Loopback hosts (with or without a port) are accepted.
assert.equal(isLocalOrigin(withHost("127.0.0.1:3000")), true, "127.0.0.1 accepted");
assert.equal(isLocalOrigin(withHost("localhost:8443")), true, "localhost accepted");
assert.equal(isLocalOrigin(withHost("localhost")), true, "bare localhost accepted");
assert.equal(
  isLocalOrigin(withHost("127.0.0.1:3000", { [MOBILE_ACCESS_HEADER]: "1" })),
  false,
  "verified mobile/tailnet-forwarded requests cannot satisfy the desktop-only local-origin guard",
);

// Non-loopback hosts are rejected — including the tailnet host the phone uses
// (a 100.64.0.0/10 CGNAT address, or the equivalent magic-DNS name), which is
// the whole point: these routes are desktop-only, not phone-reachable.
assert.equal(isLocalOrigin(withHost("100.101.102.103:8443")), false, "tailnet host rejected (desktop-only)");
assert.equal(isLocalOrigin(withHost("192.168.1.5:8443")), false, "LAN host rejected");
assert.equal(isLocalOrigin(withHost("evil.example.com")), false, "remote host rejected");
assert.equal(isLocalOrigin(withHost(undefined)), false, "missing Host rejected");

console.log("local-origin.test.ts: ok");
