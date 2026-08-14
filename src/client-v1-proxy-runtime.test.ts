// Real-runtime behavior test for `proxy()` (src/proxy.ts): actually imports
// `proxy()` and Next's `NextRequest`/`NextResponse` and invokes the function,
// rather than only asserting against the source text the way
// middleware.test.ts and proxy-behavior.test.ts do. A refactor that
// preserved every regex-matched string but broke the runtime behavior
// (wrong header stripped, wrong order of checks, wrong status) would pass
// both of those suites and still be a live vulnerability — this suite
// exists to catch exactly that class of regression on the client-v1
// boundary (quality review Task 3, Finding 2).
//
// Every test constructs its own fresh `NextRequest` and restores every env
// var it touches in `afterEach`, so no test can leak configuration into a
// later one.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "./proxy.ts";
import {
  CLIENT_V1_ADMIN_HEADER,
  CLIENT_V1_LOCAL_HEADER,
  LOCAL_PEER_HEADER,
  TAILNET_PEER_HEADER,
  TOKEN_HEADER,
} from "./proxy-helpers.ts";

const ENV_KEYS = [
  "COVEN_CAVE_LOCAL_PEER_SECRET",
  "COVEN_CAVE_TAILNET_PEER_SECRET",
  "COVEN_CAVE_AUTH_TOKEN",
  "COVEN_CAVE_ACCESS_TOKEN",
  "COVEN_CAVE_BUNDLE",
  "COVEN_CAVE_TAILNET_TRUST",
  "COVEN_CAVE_PASSKEY_REQUIRED",
  "COVEN_CAVE_PASSKEY_SESSION_SECRET",
] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const originalEnv = new Map<EnvKey, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

/** Clears every env var this suite touches, then applies only `overrides` —
 *  so each test declares its full env instead of inheriting stray state. */
function setEnv(overrides: Partial<Record<EnvKey, string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const key of Object.keys(overrides) as EnvKey[]) {
    const value = overrides[key];
    if (value !== undefined) process.env[key] = value;
  }
}

// Matches nextUrl.origin exactly for a request built with this same host, so
// expectedRequestOrigins() never needs to derive a second candidate origin.
const ORIGIN = "http://localhost:3000";

function makeRequest(
  pathname: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("host")) headers.set("host", "localhost:3000");
  return new NextRequest(`${ORIGIN}${pathname}`, {
    method: init.method ?? "GET",
    headers,
  });
}

function isPassedThrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

/**
 * Reads the value a `NextResponse.next({ request: { headers } })` return
 * actually forwards downstream for `name`. `NextResponse.next` doesn't hand
 * back the forwarded Headers object directly — it encodes the override on
 * the outer response as `x-middleware-override-headers` (a comma-separated
 * name list) plus one `x-middleware-request-<name>` header per overridden
 * name. Returns null if `name` was not part of the override set at all,
 * distinct from an overridden-but-empty value.
 */
function forwardedHeader(res: Response, name: string): string | null {
  const overrideList = res.headers.get("x-middleware-override-headers");
  if (!overrideList) return null;
  const names = overrideList.split(",").map((n) => n.trim().toLowerCase());
  if (!names.includes(name.toLowerCase())) return null;
  return res.headers.get(`x-middleware-request-${name.toLowerCase()}`);
}

// ─── 1. forged marker stripped; proven direct loopback gets the real stamp ─

test("client-v1 non-admin: a caller-forged marker is stripped and a proven direct loopback peer is stamped with the real per-boot marker", async () => {
  setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-1" });
  const req = makeRequest("/api/client/v1/conversations", {
    headers: {
      // The proof only server.ts can mint: a direct, unforwarded loopback peer.
      [LOCAL_PEER_HEADER]: "boot-secret-1",
      // A forged copy of the internal marker riding along on the same request.
      [CLIENT_V1_LOCAL_HEADER]: "attacker-forged-value",
    },
  });
  const res = await proxy(req);
  assert.ok(isPassedThrough(res), `expected the proven loopback peer through, got status ${res.status}`);
  const forwardedMarker = forwardedHeader(res, CLIENT_V1_LOCAL_HEADER);
  assert.equal(forwardedMarker, "boot-secret-1", "the forwarded marker must be the real per-boot secret");
  assert.notEqual(forwardedMarker, "attacker-forged-value", "the caller-forged marker must never survive");
});

test("client-v1 non-admin: an armed mobile access gate does not block a proven direct loopback peer", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-mobile-loopback",
    COVEN_CAVE_ACCESS_TOKEN: "armed-mobile-access-token",
  });
  const res = await proxy(makeRequest("/api/client/v1/conversations", {
    headers: { [LOCAL_PEER_HEADER]: "boot-secret-mobile-loopback" },
  }));
  assert.ok(isPassedThrough(res), `expected direct loopback client-v1 through, got ${res.status}`);
  assert.equal(
    forwardedHeader(res, CLIENT_V1_LOCAL_HEADER),
    "boot-secret-mobile-loopback",
    "only the proxy's direct-loopback marker reaches the route",
  );
});

test("client-v1 non-admin: an armed mobile access gate still blocks a non-loopback peer", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-mobile-remote",
    COVEN_CAVE_ACCESS_TOKEN: "armed-mobile-access-token",
  });
  const res = await proxy(makeRequest("/api/client/v1/conversations", {
    headers: { host: "cave.tailnet.example.ts.net" },
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

test("client-v1 admin: an armed mobile access gate still blocks a direct loopback peer", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-mobile-admin",
    COVEN_CAVE_ACCESS_TOKEN: "armed-mobile-access-token",
  });
  const res = await proxy(makeRequest("/api/client/v1/admin/credentials", {
    headers: { [LOCAL_PEER_HEADER]: "boot-secret-mobile-admin" },
  }));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "unauthorized");
});

// ─── 2. absent direct-local proof is 403; a forged marker has no authority ─

test("client-v1 non-admin: absent direct-local proof is 403, and a forged marker (even one guessing the real secret) grants no authority", async () => {
  setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-2" });
  const req = makeRequest("/api/client/v1/conversations", {
    headers: {
      // No LOCAL_PEER_HEADER at all — this is the header server.ts alone can
      // mint. Forging the DOWNSTREAM marker with the correct secret value
      // must still not substitute for that proof.
      [CLIENT_V1_LOCAL_HEADER]: "boot-secret-2",
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /direct loopback peer/);
});

// ─── 3. verified tailnet remote ingress is 403 for non-admin client-v1 ─────

test("client-v1 non-admin: a verified tailnet remote peer is 403 (the loopback-only bypass never extends to remote ingress)", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-3",
    COVEN_CAVE_TAILNET_PEER_SECRET: "tailnet-secret-3",
  });
  const req = makeRequest("/api/client/v1/conversations", {
    headers: {
      [TAILNET_PEER_HEADER]: "tailnet-secret-3:node-42",
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /direct loopback peer/);
});

// ─── 4. unsafe POST content-type from trusted loopback is 415 ─────────────

test("client-v1 non-admin: an unsafe POST content-type from a trusted loopback peer is 415", async () => {
  setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-4" });
  const req = makeRequest("/api/client/v1/conversations", {
    method: "POST",
    headers: {
      [LOCAL_PEER_HEADER]: "boot-secret-4",
      "content-type": "text/plain",
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 415);
});

test("client-v1 rejects every observable percent-encoded pathname before non-admin bypass classification", async () => {
  setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-encoded" });
  const encodedPaths = [
    "/api/client/v1/%61dmin/credentials",
    "/api/client/v1/%2561dmin/credentials",
    "/api/client/v1/admin%2fcredentials",
    "/api/client/v1/admin%2Fcredentials",
    "/api/client/v1/admin%5ccredentials",
    "/api/client/v1/admin%5Ccredentials",
    "/api/client/v1/admin%2e/credentials",
    "/api/client/v1/%61DmIn/credentials",
    "/api/client/v1/admin%",
  ];

  for (const pathname of encodedPaths) {
    const res = await proxy(makeRequest(pathname, {
      headers: { [LOCAL_PEER_HEADER]: "boot-secret-encoded" },
    }));
    assert.equal(res.status, 400, `${pathname} must be rejected`);
    assert.equal(isPassedThrough(res), false, `${pathname} must never reach a route handler`);
  }
});

// ─── 5. client-v1 admin with a configured sidecar token ───────────────────

test("client-v1 admin: verified remote ingress WITHOUT the sidecar token is 401", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-5",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret-5",
    COVEN_CAVE_TAILNET_PEER_SECRET: "tailnet-secret-5",
  });
  const req = makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [TAILNET_PEER_HEADER]: "tailnet-secret-5:node-99",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 401);
});

test("client-v1 admin: verified remote ingress WITH the correct sidecar header token and same-origin source succeeds", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-5b",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret-5b",
    COVEN_CAVE_TAILNET_PEER_SECRET: "tailnet-secret-5b",
  });
  const req = makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [TAILNET_PEER_HEADER]: "tailnet-secret-5b:node-99",
      [TOKEN_HEADER]: "sidecar-secret-5b",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  });
  const res = await proxy(req);
  assert.ok(isPassedThrough(res), `expected success, got status ${res.status}`);
  assert.equal(forwardedHeader(res, CLIENT_V1_ADMIN_HEADER), "boot-secret-5b");
});

test("client-v1 admin: an Authorization bearer or a forged internal marker alone never satisfies the sidecar-token gate", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-5c",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret-5c",
    COVEN_CAVE_TAILNET_PEER_SECRET: "tailnet-secret-5c",
  });
  const req = makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [TAILNET_PEER_HEADER]: "tailnet-secret-5c:node-99",
      // Putting the sidecar secret in Authorization: Bearer instead of the
      // dedicated TOKEN_HEADER must not count — only TOKEN_HEADER (or the
      // query param / referer-embedded token) is ever read as the sidecar
      // credential.
      authorization: "Bearer sidecar-secret-5c",
      // A forged copy of the loopback-only internal marker is irrelevant to
      // the admin sidecar-token gate entirely.
      [CLIENT_V1_LOCAL_HEADER]: "sidecar-secret-5c",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 401);
});

// ─── 6. tokenless dev admin (no COVEN_CAVE_AUTH_TOKEN configured) ─────────

test("client-v1 admin (tokenless dev): trusted direct loopback + same-origin source succeeds", async () => {
  setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-6" });
  const req = makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [LOCAL_PEER_HEADER]: "boot-secret-6",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  });
  const res = await proxy(req);
  assert.ok(isPassedThrough(res), `expected success, got status ${res.status}`);
  assert.equal(forwardedHeader(res, CLIENT_V1_ADMIN_HEADER), "boot-secret-6");
});

test("client-v1 admin: caller-forged admin markers are stripped on denied and successful requests", async () => {
  setEnv({
    COVEN_CAVE_LOCAL_PEER_SECRET: "boot-secret-admin-strip",
    COVEN_CAVE_AUTH_TOKEN: "sidecar-secret-admin-strip",
  });

  const denied = await proxy(makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [CLIENT_V1_ADMIN_HEADER]: "forged",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  }));
  assert.equal(denied.status, 401);
  assert.notEqual(forwardedHeader(denied, CLIENT_V1_ADMIN_HEADER), "forged");

  const allowed = await proxy(makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [CLIENT_V1_ADMIN_HEADER]: "forged",
      [TOKEN_HEADER]: "sidecar-secret-admin-strip",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  }));
  assert.ok(isPassedThrough(allowed));
  assert.equal(forwardedHeader(allowed, CLIENT_V1_ADMIN_HEADER), "boot-secret-admin-strip");
});

test("client-v1 admin (tokenless dev): a verified remote peer is still 403 (admin never opens to remote ingress, tokenless or not)", async () => {
  setEnv({ COVEN_CAVE_TAILNET_PEER_SECRET: "tailnet-secret-6b" });
  const req = makeRequest("/api/client/v1/admin/credentials", {
    headers: {
      [TAILNET_PEER_HEADER]: "tailnet-secret-6b:node-1",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    },
  });
  const res = await proxy(req);
  assert.equal(res.status, 403);
});

console.log("client-v1-proxy-runtime.test.ts: ok");
