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
  isTailscaleServeHost,
  isAllowedApiHost,
  sameOrigin,
  isAllowedRequestSource,
  isAllowedRequestSourceAny,
  expectedRequestOrigins,
  bearerFromReferer,
  bearerFromRefererAny,
  shouldRequireMobileAccessCredential,
  timingSafeEqualString,
  isHtmlNavigationRequest,
  accessGatePage,
  ACCESS_TOKEN_QUERY_PARAM,
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
assert.equal(
  isAllowedApiHost("cave.tailnet.example.ts.net", false),
  false,
  "Tailscale Serve hosts require a verified mobile invite token",
);
assert.equal(
  isAllowedApiHost("cave.tailnet.example.ts.net.evil.com", false),
  false,
  "must not be fooled by suffix smuggling",
);
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
assert.equal(
  isAllowedApiHost("cave.tailnet.example.ts.net", false, true),
  true,
  "tokenless tailnet trust should allow Tailscale Serve hostnames",
);
assert.equal(
  isAllowedApiHost("100.100.100.100:3000", false, true),
  true,
  "tokenless tailnet trust should allow Tailscale 100.64.0.0/10 IP fallback hosts",
);
assert.equal(
  isAllowedApiHost("evil.example.com:3000", false, true),
  false,
  "tokenless tailnet trust must not bypass the loopback host gate for arbitrary hosts",
);
assert.equal(
  isAllowedApiHost("cave.tailnet.example.ts.net.evil.com", false, true),
  false,
  "tokenless tailnet trust must not allow suffix-smuggled Tailscale hostnames",
);

// ─── isTailscaleServeHost ──────────────────────────────────────────────────
assert.equal(isTailscaleServeHost("cave.tailnet.example.ts.net"), true);
assert.equal(isTailscaleServeHost("cave.tailnet.example.ts.net:8443"), true);
assert.equal(isTailscaleServeHost("localhost:3000"), false);
assert.equal(isTailscaleServeHost("127.0.0.1:3000"), false);

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
assert.equal(
  sameOrigin("https://cave.tailnet.example.ts.net", "http://cave.tailnet.example.ts.net"),
  false,
  "Tailscale Serve HTTPS/HTTP mismatch no longer allowed without mobile credential",
);

// ─── isAllowedRequestSource ────────────────────────────────────────────────
assert.equal(isAllowedRequestSource("https://tailnet.example.ts.net", expected), false);
assert.equal(
  isAllowedRequestSource(
    "https://cave.tailnet.example.ts.net",
    "http://cave.tailnet.example.ts.net",
    false,
  ),
  false,
  "Tailscale Serve HTTPS to HTTP same-origin normalization requires mobile credential",
);
assert.equal(
  isAllowedRequestSource(
    "https://cave.tailnet.example.ts.net",
    "http://127.0.0.1:3000",
    false,
    "cave.tailnet.example.ts.net",
  ),
  false,
  "Tailscale Serve forwarded Host matching must not bypass mobile invite authentication",
);
assert.equal(
  isAllowedRequestSource(
    "https://cave.tailnet.example.ts.net:8443",
    "http://127.0.0.1:3000",
    false,
    "cave.tailnet.example.ts.net:8443",
  ),
  false,
  "Tailscale Serve non-default HTTPS port without mobile credential must be rejected",
);
assert.equal(
  isAllowedRequestSource(
    "https://cave.tailnet.example.ts.net:8444",
    "http://127.0.0.1:3000",
    false,
    "cave.tailnet.example.ts.net:8443",
  ),
  false,
  "Tailscale Serve origins must not borrow a different HTTPS port from the same host",
);
assert.equal(
  isAllowedRequestSource(
    "https://other.tailnet.example.ts.net",
    "http://127.0.0.1:3000",
    false,
    "cave.tailnet.example.ts.net",
  ),
  false,
  "Tailscale Serve origin host must match the forwarded Host",
);
assert.equal(
  isAllowedRequestSource("https://tailnet.example.ts.net", expected),
  false,
  "mobile access must not bypass same-origin CSRF source checks",
);
assert.equal(
  isAllowedRequestSource("http://localhost:3000", expected),
  true,
  "normal same-origin browser dev mode remains allowed",
);

// ─── expectedRequestOrigins / host-derived CSRF (cave-5sg) ────────────────
// req.nextUrl.origin can stay pinned to the configured port while the real
// browser Origin is carried by Host, so both origins remain accepted.
{
  // Host reports :3458 while nextUrl still says :3457.
  const origins = expectedRequestOrigins("http://127.0.0.1:3457", "http:", "127.0.0.1:3458");
  assert.deepEqual(
    origins,
    ["http://127.0.0.1:3457", "http://127.0.0.1:3458"],
    "both the configured-port origin and the real Host-derived origin are accepted",
  );
  assert.equal(
    isAllowedRequestSourceAny("http://127.0.0.1:3458", origins),
    true,
    "the browser Origin on the real fallback port is now allowed (the bug)",
  );
  assert.equal(
    isAllowedRequestSourceAny("http://127.0.0.1:3457", origins),
    true,
    "the stale configured-port origin still passes (Serve/forwarded-host path)",
  );
  assert.equal(
    isAllowedRequestSourceAny("http://evil.example", origins),
    false,
    "a cross-site Origin matches neither and is rejected",
  );
  assert.equal(
    isAllowedRequestSourceAny(null, origins),
    true,
    "an absent Origin/Referer still passes (matches sameOrigin null tolerance)",
  );
}
{
  // No Host header: fall back to nextUrl.origin alone, no phantom entries.
  assert.deepEqual(
    expectedRequestOrigins("http://127.0.0.1:3000", "http:", null),
    ["http://127.0.0.1:3000"],
  );
  // Host equals the configured port: deduped to a single origin.
  assert.deepEqual(
    expectedRequestOrigins("http://127.0.0.1:3000", "http:", "127.0.0.1:3000"),
    ["http://127.0.0.1:3000"],
    "no duplicate when Host already matches nextUrl.origin",
  );
  // https preserved (never silently downgraded to http).
  assert.deepEqual(
    expectedRequestOrigins("https://cave.tailnet.example.ts.net", "https:", "cave.tailnet.example.ts.net"),
    ["https://cave.tailnet.example.ts.net"],
    "https scheme is preserved and deduped",
  );
  assert.deepEqual(
    expectedRequestOrigins("http://127.0.0.1:3000", "http:", "evil.example:8080"),
    ["http://127.0.0.1:3000"],
    "non-loopback Host headers must not become accepted CSRF origins in tokenless tailnet mode",
  );
  assert.equal(
    isAllowedRequestSourceAny(
      "http://evil.example:8080",
      expectedRequestOrigins("http://127.0.0.1:3000", "http:", "evil.example:8080"),
    ),
    false,
    "an Origin matching an arbitrary non-loopback Host is rejected",
  );
  // Missing protocol defaults to http (loopback is never TLS on the socket).
  assert.deepEqual(
    expectedRequestOrigins("http://127.0.0.1:3457", null, "127.0.0.1:3458"),
    ["http://127.0.0.1:3457", "http://127.0.0.1:3458"],
    "absent protocol falls back to http:",
  );
}
{
  // A referer carrying the real fallback port still yields its token.
  const origins = expectedRequestOrigins("http://127.0.0.1:3457", "http:", "127.0.0.1:3458");
  assert.equal(
    bearerFromRefererAny("http://127.0.0.1:3458/x?covenCaveToken=tok", origins),
    "tok",
    "token is extracted from a referer on the real fallback port",
  );
  assert.equal(
    bearerFromRefererAny("http://127.0.0.1:3457/x?covenCaveToken=tok", origins),
    "tok",
    "token is still extracted from a configured-port referer",
  );
  assert.equal(
    bearerFromRefererAny("http://evil.example/x?covenCaveToken=tok", origins),
    null,
    "a cross-origin referer never yields its token",
  );
}

// ─── Native iOS app (tokenless, over Tailscale Serve) contract ─────────────
// The native SwiftUI client (pnpm mobile:tailscale:app) is NOT a browser: it
// sends no Origin and no Referer, and Tailscale Serve forwards Host: 127.0.0.1
// to the loopback server. With neither COVEN_CAVE_ACCESS_TOKEN nor
// COVEN_CAVE_AUTH_TOKEN configured (and not bundled), proxy() falls through to
// NextResponse.next() AFTER these source gates pass. These assertions pin the
// gate-level behavior that flow depends on; the proxy() body ordering is pinned
// by middleware.test.ts. A malicious same-machine BROWSER page is still blocked
// because it always carries a cross-origin Origin (rejected just above).
assert.equal(
  isAllowedApiHost("127.0.0.1:3000", false),
  true,
  "tokenless app: Tailscale Serve forwards loopback Host, which is allowed",
);
assert.equal(
  isAllowedRequestSource(null, expected),
  true,
  "tokenless app: native client sends no Origin → source gate passes",
);
assert.equal(
  isAllowedRequestSource(null, "http://127.0.0.1:3000"),
  true,
  "tokenless app: absent Referer at the loopback Serve backend passes",
);

// ─── shouldRequireMobileAccessCredential ──────────────────────────────────
assert.equal(
  shouldRequireMobileAccessCredential("localhost:3000", false),
  true,
  "Host headers are spoofable and must not exempt requests from the mobile gate",
);
assert.equal(
  shouldRequireMobileAccessCredential("127.0.0.1:3000", false),
  true,
  "loopback-looking Host headers still require a valid invite",
);
assert.equal(
  shouldRequireMobileAccessCredential("cave.tailnet.example.ts.net", false),
  true,
  "non-loopback mobile entrypoints still require a valid invite",
);
assert.equal(
  shouldRequireMobileAccessCredential("localhost:3000", true),
  true,
  "supplied credentials should still be verified and redirected on loopback",
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

// ─── isHtmlNavigationRequest ───────────────────────────────────────────────
// Only browser PAGE navigations (HTML-accepting GET outside /api/) qualify
// for the HTML access gate; everything else must keep the JSON 401 envelope.
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
assert.equal(isHtmlNavigationRequest("GET", "/", BROWSER_ACCEPT), true);
assert.equal(isHtmlNavigationRequest("GET", "/dashboard/familiars/growth", BROWSER_ACCEPT), true);
assert.equal(
  isHtmlNavigationRequest("GET", "/api/familiars", BROWSER_ACCEPT),
  false,
  "API routes keep JSON even for HTML-accepting clients",
);
assert.equal(isHtmlNavigationRequest("GET", "/api", BROWSER_ACCEPT), false, "bare /api is an API path");
assert.equal(
  isHtmlNavigationRequest("GET", "/apidocs", BROWSER_ACCEPT),
  true,
  "prefix match must not swallow non-API paths that merely start with 'api'",
);
assert.equal(isHtmlNavigationRequest("POST", "/", BROWSER_ACCEPT), false, "mutations keep JSON");
assert.equal(isHtmlNavigationRequest("HEAD", "/", BROWSER_ACCEPT), false, "HEAD keeps JSON");
assert.equal(isHtmlNavigationRequest("GET", "/", "application/json"), false, "fetch/curl keep JSON");
assert.equal(isHtmlNavigationRequest("GET", "/", null), false, "no Accept header keeps JSON");

// ─── accessGatePage ────────────────────────────────────────────────────────
{
  const page = accessGatePage();
  assert.match(page, /Access token required/);
  // The form re-enters the audited query-token exchange — the input MUST be
  // named exactly ACCESS_TOKEN_QUERY_PARAM and submit via GET.
  assert.match(page, new RegExp(`name="${ACCESS_TOKEN_QUERY_PARAM}"`));
  assert.match(page, /method="get"/);
  assert.match(page, /type="password"/, "token input must not echo on screen");
  assert.doesNotMatch(page, /<script/i, "gate page must be script-free (CSP-immune, no new surface)");
  assert.doesNotMatch(page, /didn&rsquo;t verify/, "neutral prompt shows no failure note");

  const invalid = accessGatePage({ invalidToken: true });
  assert.match(invalid, /didn&rsquo;t verify/, "supplied-but-invalid tokens get the expiry hint");
  assert.match(invalid, /role="alert"/);
}

console.log("proxy-behavior.test.ts: ok");
