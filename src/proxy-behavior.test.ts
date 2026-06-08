// @ts-nocheck
//
// Behavior test for the pure helpers in src/proxy.ts. Complements the
// regex-based middleware.test.ts by actually exercising the host /
// origin / content-type / timing-safe-compare functions with concrete
// inputs, so a future refactor that breaks the gate without changing
// the source text is still caught.
//
// Audit §7 called out that most tests are source-pattern only and
// can't detect runtime regressions — this is the conversion target for
// the security-critical surface. (Importing proxy() itself in plain
// Node ESM fails on next/server resolution, so we test the helpers
// directly and rely on middleware.test.ts to pin the ordering inside
// the proxy() body.)

import assert from "node:assert/strict";
import {
  isLoopbackHost,
  isAllowedApiHost,
  sameOrigin,
  bearerFromReferer,
  timingSafeEqualString,
} from "./proxy-helpers.ts";

// ─── isLoopbackHost ────────────────────────────────────────────────────────
// Host header per RFC 7230 §5.4: IPv6 must use `[...]` brackets; bare `::1`
// would never appear from a browser. The helper handles bracketed form.
assert.equal(isLoopbackHost("127.0.0.1"), true);
assert.equal(isLoopbackHost("127.0.0.1:3000"), true);
assert.equal(isLoopbackHost("localhost"), true);
assert.equal(isLoopbackHost("localhost:3000"), true);
assert.equal(isLoopbackHost("[::1]:3000"), true);
assert.equal(isLoopbackHost("8.8.8.8"), false);
assert.equal(isLoopbackHost("192.168.1.42:3000"), false);
assert.equal(
  isLoopbackHost("evil.example.com"),
  false,
  "domain hosts must be rejected even at default port",
);
assert.equal(isLoopbackHost(null), false, "null host must be rejected");
assert.equal(isLoopbackHost(""), false, "empty host must be rejected");
assert.equal(
  isLoopbackHost("127.0.0.1.evil.com"),
  false,
  "must not be fooled by suffix smuggling",
);
assert.equal(
  isLoopbackHost("localhost.evil.com"),
  false,
  "must not be fooled by subdomain smuggling",
);

// ─── isAllowedApiHost ──────────────────────────────────────────────────────
assert.equal(isAllowedApiHost("localhost:3000", false), true);
assert.equal(isAllowedApiHost("127.0.0.1:3000", false), true);
assert.equal(isAllowedApiHost("cave.tailnet.example.ts.net", false), false);
assert.equal(
  isAllowedApiHost("cave.tailnet.example.ts.net", true),
  true,
  "valid mobile access token should allow documented Tailscale hostnames",
);
assert.equal(
  isAllowedApiHost(null, true),
  true,
  "mobile token authentication should not depend on a loopback Host header",
);

// ─── sameOrigin ────────────────────────────────────────────────────────────
const expected = "http://localhost:3000";
assert.equal(sameOrigin("http://localhost:3000", expected), true);
assert.equal(sameOrigin("http://localhost:3000/", expected), true);
assert.equal(sameOrigin("http://localhost:3000/foo?bar=1", expected), true);
assert.equal(sameOrigin("http://localhost:3001", expected), false, "port mismatch");
assert.equal(sameOrigin("https://localhost:3000", expected), false, "scheme mismatch");
assert.equal(sameOrigin("http://evil.example.com", expected), false);
assert.equal(sameOrigin(null, expected), true, "absent origin header passes through");
assert.equal(sameOrigin("not a url", expected), false, "malformed url is rejected");
assert.equal(sameOrigin("", expected), true, "empty origin is treated as absent");

// Loopback hostnames (127.0.0.1 / localhost / ::1) must be treated as
// interchangeable on the same scheme + port. Tauri's WKWebView on macOS sends
// a referer whose hostname can differ from the loopback host the sidecar
// bound, so requiring an exact origin match falsely rejects same-machine
// traffic. Cross-loopback variants here, with port mismatches and
// non-loopback hosts still rejected, guards both ends.
assert.equal(
  sameOrigin("http://127.0.0.1:3000", expected),
  true,
  "127.0.0.1 ↔ localhost on same port should be treated as same origin",
);
assert.equal(
  sameOrigin("http://[::1]:3000", expected),
  true,
  "IPv6 loopback ↔ localhost on same port should be treated as same origin",
);
assert.equal(
  sameOrigin("http://localhost:3000", "http://127.0.0.1:3000"),
  true,
  "loopback variant tolerance is symmetric",
);
assert.equal(
  sameOrigin("http://127.0.0.1:3001", expected),
  false,
  "loopback variant with port mismatch must still be rejected",
);
assert.equal(
  sameOrigin("https://127.0.0.1:3000", expected),
  false,
  "loopback variant with scheme mismatch must still be rejected",
);
assert.equal(
  sameOrigin("http://example.com:3000", expected),
  false,
  "non-loopback hostname must still be rejected",
);

// ─── bearerFromReferer ─────────────────────────────────────────────────────
assert.equal(
  bearerFromReferer("http://localhost:3000/foo?covenCaveToken=abc", expected),
  "abc",
);
assert.equal(
  bearerFromReferer("http://localhost:3000/?covenCaveToken=multi%20word", expected),
  "multi word",
);
assert.equal(
  bearerFromReferer("http://evil.example.com/?covenCaveToken=abc", expected),
  null,
  "cross-origin referer must NOT yield its token",
);
assert.equal(
  bearerFromReferer("http://localhost:3000/?foo=bar", expected),
  null,
  "no token param means null",
);
assert.equal(bearerFromReferer(null, expected), null);
assert.equal(bearerFromReferer("garbage", expected), null);

// ─── timingSafeEqualString ─────────────────────────────────────────────────
assert.equal(timingSafeEqualString("hello", "hello"), true);
assert.equal(timingSafeEqualString("hello", "Hello"), false);
assert.equal(timingSafeEqualString("hello", "hell"), false, "length mismatch is false");
assert.equal(timingSafeEqualString("", ""), true, "empty equal is true");
assert.equal(timingSafeEqualString("a", ""), false);
assert.equal(timingSafeEqualString("é", "é"), true, "unicode equals itself");
assert.equal(
  timingSafeEqualString("é", "e"),
  false,
  "unicode é must not equal ascii e",
);
assert.equal(timingSafeEqualString("12345", "12346"), false);
{
  // Constant-time-ish: two strings of equal length must always run the
  // full comparison (we just verify the boolean result; timing properties
  // would need a separate microbench).
  const left = "a".repeat(1024);
  const right = "a".repeat(1023) + "b";
  assert.equal(timingSafeEqualString(left, right), false);
  assert.equal(timingSafeEqualString(left, left), true);
}

console.log("proxy-behavior.test.ts: ok");
