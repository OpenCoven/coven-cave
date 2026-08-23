import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  createClientV1Authenticator,
  type ClientV1AuthResult,
} from "./auth.ts";
import { CLIENT_V1_PUBLIC_ROUTES } from "./contract.ts";
import { CLIENT_V1_OPERATION_DEFINITIONS } from "./operations.ts";
import type {
  ClientV1CredentialRecord,
  CredentialStore,
} from "./credential-store.ts";
import { proxy } from "../../../proxy.ts";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_QUERY_PARAM,
  CLIENT_V1_AUTHENTICATED_PATHS,
  CLIENT_V1_PUBLIC_INGRESS,
  LEGACY_ACCESS_PROMPT_QUERY_PARAM,
  LOCAL_PEER_HEADER,
  TAILNET_PEER_HEADER,
  TOKEN_HEADER,
  clientV1IngressKind,
  isClientV1AdminPath,
  isClientV1Path,
  isRefusedClientV1Path,
} from "../../../proxy-helpers.ts";

const ACTIVE_CREDENTIAL: ClientV1CredentialRecord = {
  id: "credential-1",
  appName: "OpenCoven Mobile",
  installationId: "4e8b1b3e-9c1a-4f0a-8b1a-0c1d2e3f4a5b",
  scopes: ["chat:read", "chat:write"],
  bearerHash: "a".repeat(64),
  createdAt: 1_000,
  lastUsedAt: null,
  revokedAt: null,
  revocationReason: null,
};

function storeWithLookup(
  findByBearer: CredentialStore["findByBearer"],
): CredentialStore {
  const unsupported = async (): Promise<never> => {
    throw new Error("unsupported test operation");
  };
  return {
    findByBearer,
    issue: unsupported,
    readPersistedFile: unsupported,
    reload: unsupported,
    revoke: unsupported,
    verify: unsupported,
  };
}

async function assertAuthFailure(
  result: ClientV1AuthResult,
  expectedStatus: number,
  expectedCode: "unauthorized" | "scope_denied",
): Promise<void> {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, expectedStatus);
  const body = await result.response.json() as {
    error: { code: string; retryable: boolean };
  };
  assert.equal(body.error.code, expectedCode);
  assert.equal(body.error.retryable, false);
}

test("trusted loopback accepts only the exact server-stamped secret", () => {
  const authenticator = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => null),
    loopbackSecret: "per-boot-loopback-secret",
  });

  assert.equal(authenticator.isTrustedLoopback("per-boot-loopback-secret"), true);
  assert.equal(authenticator.isTrustedLoopback("per-boot-loopback-secreu"), false);
  assert.equal(authenticator.isTrustedLoopback("per-boot-loopback-secret "), false);
  assert.equal(authenticator.isTrustedLoopback(null), false);
});

test("trusted loopback uses the repository timing-safe string helper", async () => {
  const source = await readFile(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /import\s*\{[^}]*timingSafeEqualString[^}]*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/proxy-helpers\.ts["']/,
  );
  assert.match(source, /timingSafeEqualString\(headerValue,\s*loopbackSecret\)/);
});

test("missing bearer is unauthorized without calling findByBearer", async () => {
  let lookupCount = 0;
  const authenticator = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => {
      lookupCount += 1;
      return ACTIVE_CREDENTIAL;
    }),
    loopbackSecret: "loopback-secret",
  });

  await assertAuthFailure(
    await authenticator.requireScope({ bearer: null, scope: "chat:read" }),
    401,
    "unauthorized",
  );
  assert.equal(lookupCount, 0);
});

test("unknown and revoked bearers normalize to unauthorized", async () => {
  const lookedUp: string[] = [];
  const authenticator = createClientV1Authenticator({
    credentialStore: storeWithLookup(async (bearer) => {
      lookedUp.push(bearer);
      return null;
    }),
    loopbackSecret: "loopback-secret",
  });

  await assertAuthFailure(
    await authenticator.requireScope({ bearer: "unknown-bearer", scope: "chat:read" }),
    401,
    "unauthorized",
  );
  await assertAuthFailure(
    await authenticator.requireScope({ bearer: "revoked-bearer", scope: "chat:read" }),
    401,
    "unauthorized",
  );
  assert.deepEqual(lookedUp, ["unknown-bearer", "revoked-bearer"]);
});

test("under-scoped bearer returns normalized scope_denied", async () => {
  const authenticator = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => ({
      ...ACTIVE_CREDENTIAL,
      scopes: ["chat:read"],
    })),
    loopbackSecret: "loopback-secret",
  });

  await assertAuthFailure(
    await authenticator.requireScope({ bearer: "valid-bearer", scope: "chat:write" }),
    403,
    "scope_denied",
  );
});

test("valid scope returns only the active credential record", async () => {
  const authenticator = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => ACTIVE_CREDENTIAL),
    loopbackSecret: "loopback-secret",
  });

  const result = await authenticator.requireScope({
    bearer: "valid-bearer",
    scope: "chat:read",
  });
  assert.deepEqual(result, { ok: true, credential: ACTIVE_CREDENTIAL });
  assert.equal(JSON.stringify(result).includes("valid-bearer"), false);
});

test("an authentication failure names the budget its caller can be charged against", async () => {
  // requireScope normalizes both failures into a ready-made Response, which is
  // right for what the client sees and useless to the route: the two failures
  // are charged against *different* rate-limit buckets, and a Response cannot
  // be asked which one it is. Reading `response.status` back would work by
  // coincidence — it couples the metering decision to an HTTP status the
  // contract is free to remap. The discriminant states it directly.
  const unknownBearer = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => null),
    loopbackSecret: "loopback-secret",
  });
  const unknown = await unknownBearer.requireScope({
    bearer: "unknown-bearer",
    scope: "chat:read",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.reason, "unauthorized");
    // No credential was found, so there is no authenticated identity to meter;
    // the route has to fall back to its invalid-bearer bucket.
    assert.equal(unknown.credential, undefined);
  }

  const missing = await unknownBearer.requireScope({ bearer: null, scope: "chat:read" });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.reason, "unauthorized");
    assert.equal(missing.credential, undefined);
  }

  const underScoped = createClientV1Authenticator({
    credentialStore: storeWithLookup(async () => ({
      ...ACTIVE_CREDENTIAL,
      scopes: ["chat:read"],
    })),
    loopbackSecret: "loopback-secret",
  });
  const denied = await underScoped.requireScope({
    bearer: "valid-bearer",
    scope: "chat:write",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.reason, "scope_denied");
    // The credential rides along because this failure IS an authenticated
    // request — a real credential asking for something it was not granted. The
    // only other meterable key would be the bearer itself, and a rate-limit
    // bucket keyed by a secret is a secret written into a Map.
    assert.equal(denied.credential?.id, ACTIVE_CREDENTIAL.id);
    // Same discipline as the success branch below: the bearer is an input, and
    // it must not survive into anything a caller might log.
    assert.equal(JSON.stringify(denied.credential).includes("valid-bearer"), false);
  }
});

/**
 * The contract's public routes as request pathnames: `:id` templates filled in,
 * and the GET/POST pair on one path collapsed, because ingress classification
 * is method-blind.
 */
function contractPublicPaths(): string[] {
  const paths = CLIENT_V1_PUBLIC_ROUTES.map((route) =>
    route.path.replace(/:[A-Za-z0-9_]+/g, "request-1"),
  );
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

test("client-v1 ingress allowlists only the reviewed public routes", () => {
  const publicRoutes = [
    "/api/client/v1/health",
    "/api/client/v1/pairing/requests",
    "/api/client/v1/pairing/requests/request-1",
    "/api/client/v1/pairing/requests/request-1/exchange",
  ];
  // Pinned to the contract so this literal cannot drift into a stale
  // restatement of it. Written out rather than derived because a list that
  // derives its own expectation asserts nothing about the proxy.
  assert.deepEqual(publicRoutes, contractPublicPaths());
  for (const route of publicRoutes) {
    assert.equal(clientV1IngressKind(route), CLIENT_V1_PUBLIC_INGRESS, route);
  }
  // The canonical reads are pre-authorized, and only because their handlers
  // exist (cave-jfa9y). A client-v1 ingress match makes proxy() skip the mobile
  // access gate and return before the sidecar-token block, so it is only ever
  // safe for a path whose own handler authenticates — which is why cave-4841
  // emptied this list after it named thirteen Phase 2 paths against zero
  // handlers. Each entry below has a route.ts that calls requireScope, asserted
  // against the disk in src/app/api/api-contracts.test.ts.
  for (const route of [
    "/api/client/v1/familiars",
    "/api/client/v1/projects",
    "/api/client/v1/conversations",
    "/api/client/v1/conversations/conversation-1",
    "/api/client/v1/conversations/conversation-1/messages",
    // Not a real conversation, and deliberately still "authenticated": there is
    // no static `search` route under conversations, so the App Router serves
    // this path from the [id] handler with the id "search". Classifying it any
    // other way would describe a route that does not exist.
    "/api/client/v1/conversations/search",
  ]) {
    assert.equal(clientV1IngressKind(route), "authenticated", route);
  }
  // Everything else still classifies null. The Phase 2 paths below have no
  // handler at all, so listing them ahead of time would mean the first one to
  // land arrives already exempt from the sidecar-token gate.
  for (const route of [
    "/api/client/v1",
    "/api/client/v1/admin",
    "/api/client/v1/admin/credentials",
    "/api/client/v1/admin/pairing-requests",
    "/api/client/v1/private",
    "/api/client/v10/health",
    "/api/chat/conversation",
    "/api/client/v1/messages/send",
    "/api/client/v1/attachments",
    "/api/client/v1/attachments/attachment-1",
    "/api/client/v1/commands",
    "/api/client/v1/tasks/handoff",
    "/api/client/v1/runs/run-1/stream",
    "/api/client/v1/runs/run-1/stop",
    "/api/client/v1/runs/run-1/retry",
    "/api/client/v1/attention/attention-1/respond",
    "/api/client/v1/github/actions",
    // Near-misses of the DERIVED public patterns. The four regexes they
    // replaced were literals a reviewer read directly; these are generated, so
    // the generator's anchoring and its one-segment `:id` scoping need
    // assertions of their own. Without them, widening `:id` to `.+` or
    // dropping the `^`/`$` anchors leaves every suite green while the public
    // set silently grows past the reviewed one — and public is the set that
    // skips the mobile-access gate and returns before the sidecar-token block,
    // so growing it is a widening of credential-free ingress (cave-d1sjz).
    "/api/client/v1/healthz",
    "/decoy/api/client/v1/health",
    "/api/client/v1/pairing/requests/",
    "/api/client/v1/pairing/requests/request-1/messages",
    "/api/client/v1/pairing/requests/request-1/exchange/extra",
    // The same near-miss family for the newly authenticated set. These matter
    // more than the public ones do: an authenticated match ALSO returns before
    // the sidecar-token block, so an unanchored or over-wide pattern here hands
    // credential-free ingress to a path with no client-v1 handler behind it.
    "/decoy/api/client/v1/projects",
    "/api/client/v1/projectsz",
    "/api/client/v1/familiars/familiar-1",
    "/api/client/v1/conversations/",
    "/api/client/v1/conversations/conversation-1/messages/message-1",
    "/api/client/v1/conversations/conversation-1/turns",
  ]) {
    assert.equal(clientV1IngressKind(route), null, route);
  }
});

test("every pre-authorized path is one the proxy hands to a client-v1 handler", () => {
  // Matching CLIENT_V1_AUTHENTICATED_PATHS is a DEMOTION: proxy() skips the
  // mobile-access gate and returns before the sidecar-token block, so the
  // route's own requireScope is the only credential check left in the request.
  // The list therefore has to stay inside the client-v1 surface and out of the
  // admin family, which keeps the ordinary sidecar-token path on purpose.
  for (const pattern of CLIENT_V1_AUTHENTICATED_PATHS) {
    // RegExp#source escapes every forward slash, so this is the anchored
    // client-v1 prefix as the engine spells it.
    const source = pattern.source;
    assert.ok(source.startsWith("^\\/api\\/client\\/v1\\/"), source);
    assert.ok(source.endsWith("$"), source);
    assert.equal(source.includes("admin"), false, source);
    // Single-segment parameters only. `.+` or `[\s\S]` would let one entry
    // pre-authorize an unbounded tail of paths nobody reviewed.
    assert.equal(source.includes(".+"), false, source);
    assert.equal(source.includes(".*"), false, source);
  }
  // Public and authenticated are disjoint. An overlap would be ambiguous
  // rather than harmless: the public branch is consulted first, so a public
  // pattern that widened over an authenticated path would silently reclassify
  // an authenticated route as credential-free bootstrap.
  for (const path of [
    "/api/client/v1/familiars",
    "/api/client/v1/projects",
    "/api/client/v1/conversations",
    "/api/client/v1/conversations/conversation-1",
    "/api/client/v1/conversations/conversation-1/messages",
  ]) {
    assert.notEqual(clientV1IngressKind(path), CLIENT_V1_PUBLIC_INGRESS, path);
  }
});

test("every declared operation's authority class matches what the proxy enforces", () => {
  // The operation inventory publishes an authority class per operation
  // (cave-8a0s2), and a client reads it to decide what it can call. Metadata
  // that disagrees with the proxy would either promise access the proxy refuses
  // or, worse, describe an admin route as something a paired bearer reaches.
  //
  // The mapping is deliberately not one-to-one: `admin` classifies NULL here,
  // because the admin family keeps the ordinary sidecar-token gate rather than
  // taking the client-v1 demotion. Writing that out is the point — an admin
  // operation that started classifying "authenticated" would have been demoted
  // to a bearer check without anyone deciding to do that.
  for (const operation of CLIENT_V1_OPERATION_DEFINITIONS) {
    const probe = operation.path.replace(/:[^/]+/gu, "probe-segment");
    const expected =
      operation.ingress === "public"
        ? CLIENT_V1_PUBLIC_INGRESS
        : operation.ingress === "authenticated"
          ? "authenticated"
          : null;
    assert.equal(clientV1IngressKind(probe), expected, `${operation.id} (${probe})`);
    // And the converse of the demotion rule: an operation the proxy
    // pre-authorizes must be one whose own handler checks a credential, which
    // for this surface means it declares a scope.
    if (clientV1IngressKind(probe) === "authenticated") {
      assert.notEqual(operation.scope, null, operation.id);
    }
  }
  // No operation may claim the admin family and a non-admin authority at once.
  for (const operation of CLIENT_V1_OPERATION_DEFINITIONS) {
    assert.equal(
      operation.path.startsWith("/api/client/v1/admin/"),
      operation.ingress === "admin",
      operation.id,
    );
  }
});

test("proxy public ingress follows the contract's public routes", () => {
  // The list above states the reviewed set; this states where it comes from.
  // CLIENT_V1_PUBLIC_ROUTES is what the discovery fixture advertises, so a
  // route the contract publishes and the proxy does not classify is a route
  // clients are told to call and the proxy answers with 403 — a divergence no
  // suite could see while the proxy restated the set by hand (cave-d1sjz).
  for (const path of contractPublicPaths()) {
    assert.equal(clientV1IngressKind(path), CLIENT_V1_PUBLIC_INGRESS, path);
  }
  // Deriving the proxy's public set from the contract also hands contract.ts
  // authority over which paths skip the mobile-access gate and return before
  // the sidecar-token block. Bound that authority rather than inherit it: a
  // derived public path may only be a non-admin path inside the client-v1
  // surface, so a contract entry for, say, /api/mobile-token/refresh cannot
  // quietly buy credential-free ingress for a route outside client v1.
  for (const path of contractPublicPaths()) {
    assert.equal(path.startsWith("/api/client/v1/"), true, path);
    assert.equal(path.startsWith("/api/client/v1/admin"), false, path);
  }
});

/**
 * Client v1 request-targets carrying a percent-escape or a backslash
 * (cave-f1xki, #4854).
 *
 * The list this file shipped without: every `clientV1IngressKind` case here was
 * a clean path, which is precisely why the escaped-path hole reached a
 * production build unnoticed. Both segment positions are represented, because
 * they behave differently and only one of them was ever exploitable: Next
 * matches a STATIC segment against raw bytes (so `healt%68` is a 404), while a
 * DYNAMIC segment is percent-decoded for `[id]` matching before the route sees
 * it — so a `%` there routed while middleware still read the raw `%` and
 * classified the request as not-client-v1.
 */
const ESCAPED_CLIENT_V1_PATHS = [
  // The measured exploit shape: `%31` decodes to the id's own trailing `1`.
  "/api/client/v1/pairing/requests/018f4f1a-77c2-7a31-8a15-55a25aaba00%31",
  // Double-encoded. Next decodes exactly ONCE (measured: the route received a
  // literal `%31`), so this is the shape a decode-twice "normalization" fix
  // would have mishandled — the `%252e` class the refusal avoids entirely.
  "/api/client/v1/pairing/requests/018f4f1a-77c2-7a31-8a15-55a25aaba0%2531",
  // Encoded separator, both cases. Measured: Next routes this as ONE `[id]`
  // segment, so a fix that decoded the whole pathname would split it into two,
  // fail the single-segment public pattern, and go on returning null — the
  // same hole with more code.
  "/api/client/v1/pairing/requests/aaa%2Fbbb",
  "/api/client/v1/pairing/requests/aaa%2fbbb",
  // Encoded dot-dot, both cases. Note the WHATWG URL parser resolves these
  // itself, so proxy() never sees one; the classifier must still refuse the
  // string, because that resolution is a property of the caller's parser and
  // not of this function.
  "/api/client/v1/pairing/requests/%2e%2e/exchange",
  "/api/client/v1/pairing/requests/%2E%2E/exchange",
  // Encoded backslash — NOT folded to `/` by the URL parser, unlike a literal
  // one, so this really can arrive here.
  "/api/client/v1/pairing/requests/aaa%5Cbbb",
  "/api/client/v1/pairing/requests/aaa%5cbbb",
  // Not even well-formed escapes. Nothing may decode these to decide.
  "/api/client/v1/pairing/requests/aaa%zz",
  "/api/client/v1/pairing/requests/aaa%",
  // Static segments: a 404 at the router, but the classifier is not the thing
  // that says so and must not be relied on to.
  "/api/client/v1/healt%68",
  "/api/client/v1/health%20",
  "/api/client/v1/pairing/request%73",
  // Literal backslashes. The URL parser folds these to `/` for a special
  // scheme, so proxy() sees the slash form — which is exactly why the check
  // cannot assume someone else already folded them.
  "/api/client/v1/pairing/requests/aaa\\bbb",
  "/api\\client\\v1\\health",
  "/api/client/v1\\health",
  // The admin family is inside the refusal too, because the refusal is scoped
  // by prefix rather than by the two ingress lists — admin classifies null by
  // design and would otherwise have kept the hole after the classifier was
  // fixed.
  "/api/client/v1/admin/credential%73",
  "/api/client/v1/admin/credentials/aaa%2Fbbb",
  "/api/client/v1/admin/pairing-requests/aaa%34bbb/decision",
  "/api/client/v1/admin\\credentials",
];

test("client-v1 request-targets carrying an escape are refused, not classified", () => {
  for (const pathname of ESCAPED_CLIENT_V1_PATHS) {
    assert.equal(isClientV1Path(pathname), true, pathname);
    assert.equal(isRefusedClientV1Path(pathname), true, pathname);
    // Second layer, and it must stay the SAFE direction: an escaped id already
    // matches the `[^/]+` id pattern by raw bytes, so a classifier that stopped
    // bailing would promote these into the credential-free public set.
    assert.equal(clientV1IngressKind(pathname), null, pathname);
  }
});

test("the client-v1 escape refusal is scoped to the client-v1 path prefix", () => {
  // An escape outside this surface is none of the refusal's business — every
  // other API family accepts encoded path segments, and widening the refusal to
  // /api/ would break them.
  for (const pathname of [
    "/api/chat/conversation/aaa%2Fbbb",
    "/api/client/v10/health%20",
    "/decoy/api/client/v1/pairing/requests/aaa%34bbb",
    "/client/v1/pairing/requests/aaa%34bbb",
  ]) {
    assert.equal(isClientV1Path(pathname), false, pathname);
    assert.equal(isRefusedClientV1Path(pathname), false, pathname);
  }

  // And a clean client-v1 path is inside the surface without being refused —
  // otherwise the refusal would take the whole family down with it.
  for (const pathname of [
    "/api/client/v1",
    "/api/client/v1/health",
    "/api/client/v1/pairing/requests/018f4f1a-77c2-7a31-8a15-55a25aaba001",
    "/api/client/v1/admin/credentials",
  ]) {
    assert.equal(isClientV1Path(pathname), true, pathname);
    assert.equal(isRefusedClientV1Path(pathname), false, pathname);
  }
});

test("the client-v1 admin family is recognized as its own locality-bound set", () => {
  for (const pathname of [
    "/api/client/v1/admin",
    "/api/client/v1/admin/credentials",
    "/api/client/v1/admin/credentials/018f4f1a-77c2-7a31-8a15-55a25aaba002",
    "/api/client/v1/admin/pairing-requests",
    "/api/client/v1/admin/pairing-requests/018f4f1a-77c2-7a31-8a15-55a25aaba001/decision",
    "/api/client/v1/admin\\credentials",
  ]) {
    assert.equal(isClientV1AdminPath(pathname), true, pathname);
    // Bound, never excused: the admin family must not also become a client-v1
    // INGRESS, because matching there skips the mobile-access gate and returns
    // before the sidecar-token block that is admin's actual protection.
    assert.equal(clientV1IngressKind(pathname), null, pathname);
  }
  for (const pathname of [
    "/api/client/v1/health",
    "/api/client/v1/administrivia",
    "/api/client/v1/pairing/requests/admin",
    "/api/admin/credentials",
  ]) {
    assert.equal(isClientV1AdminPath(pathname), false, pathname);
  }
});

const ENV_KEYS = [
  "COVEN_CAVE_ACCESS_TOKEN",
  "COVEN_CAVE_AUTH_TOKEN",
  "COVEN_CAVE_BUNDLE",
  "COVEN_CAVE_LOCAL_PEER_SECRET",
  "COVEN_CAVE_PASSKEY_REQUIRED",
  "COVEN_CAVE_PASSKEY_SESSION_SECRET",
  "COVEN_CAVE_TAILNET_PEER_SECRET",
  "COVEN_CAVE_TAILNET_TRUST",
] as const;
const ORIGINAL_ENV = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGIN = "http://localhost:3000";

function setProxyEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function restoreProxyEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function proxyRequest(
  pathname: string,
  options: {
    method?: string;
    headers?: HeadersInit;
  } = {},
): NextRequest {
  const headers = new Headers(options.headers);
  if (!headers.has("host")) headers.set("host", "localhost:3000");
  return new NextRequest(`${ORIGIN}${pathname}`, {
    method: options.method ?? "GET",
    headers,
  });
}

function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

async function assertProxyError(
  response: Response,
  status: number,
  error: string,
): Promise<void> {
  assert.equal(response.status, status);
  assert.equal(response.headers.has("location"), false);
  assert.deepEqual(await response.json(), { ok: false, error });
}

test("reviewed client-v1 routes use loopback ingress without exposing private routes", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const headers = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    for (const route of [
      "/api/client/v1/pairing/requests",
      "/api/client/v1/pairing/requests/request-1/exchange",
      // The canonical reads pass the proxy with no sidecar token, which is
      // exactly the demotion CLIENT_V1_AUTHENTICATED_PATHS buys and the reason
      // each of these routes calls requireScope for itself (cave-jfa9y). What
      // reaches the handler here is an unauthenticated request; the route
      // tests assert it is refused there.
      "/api/client/v1/familiars",
      "/api/client/v1/projects",
      "/api/client/v1/conversations",
      "/api/client/v1/conversations/conversation-1",
      "/api/client/v1/conversations/conversation-1/messages",
    ]) {
      const response = await proxy(proxyRequest(route, { headers }));
      assert.equal(passedThrough(response), true, `${route} returned ${response.status}`);
    }

    // Admin and unhandled client-v1 paths stay on the ordinary sidecar-token
    // gate, so a bare loopback caller gets the ordinary 401 (cave-4841).
    for (const route of [
      "/api/client/v1/admin/credentials",
      "/api/client/v1/private",
      "/api/client/v1/messages/send",
    ]) {
      const response = await proxy(proxyRequest(route, { headers }));
      assert.equal(passedThrough(response), false, route);
      assert.equal(response.status, 401, route);
    }

    // Ordinary app APIs use the trusted-loopback browser exemption. They are
    // outside Client v1's separately reviewed ingress and admin boundaries.
    const appResponse = await proxy(proxyRequest("/api/chat/conversation", { headers }));
    assert.equal(passedThrough(appResponse), true);
  } finally {
    restoreProxyEnv();
  }
});

test("derived public ingress reaches the proxy pass-through with no credential", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const headers = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    // clientV1IngressKind is where the other derivation tests stop; this one
    // runs the derived patterns through proxy() itself, because the property
    // #4844 is about is end-to-end: a route the contract advertises must not be
    // one the proxy answers with 403. Credential-free by definition — pairing
    // is how a client obtains the credential these paths exist to hand out.
    for (const path of contractPublicPaths()) {
      const response = await proxy(proxyRequest(path, { headers }));
      assert.equal(passedThrough(response), true, `${path} returned ${response.status}`);
    }
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 ingress is classified before legacy mobile query-token redirects", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    const response = await proxy(proxyRequest(
      `/api/client/v1/health?${ACCESS_TOKEN_QUERY_PARAM}=configured-mobile-secret`,
    ));

    assert.equal(response.status, 403);
    assert.equal(response.headers.has("location"), false);
  } finally {
    restoreProxyEnv();
  }
});

test("trusted loopback pairing query tokens are stripped before the prompt-free bypass", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    for (const [token, shouldSetCookie] of [
      ["configured-mobile-secret", true],
      ["wrong-secret", false],
    ] as const) {
      const query = new URLSearchParams({
        [ACCESS_TOKEN_QUERY_PARAM]: token,
        [LEGACY_ACCESS_PROMPT_QUERY_PARAM]: "1",
        mode: "focus",
      });
      const response = await proxy(proxyRequest(`/chat?${query}`, {
        headers: {
          accept: "text/html",
          [LOCAL_PEER_HEADER]: "loopback-secret",
        },
      }));

      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), `${ORIGIN}/chat?mode=focus`);
      const cookie = response.headers.get("set-cookie");
      if (shouldSetCookie) {
        assert.match(cookie ?? "", /coven_cave_access=configured-mobile-secret/);
        assert.match(cookie ?? "", /Path=\//);
        assert.match(cookie ?? "", /HttpOnly/);
        assert.match(cookie ?? "", /SameSite=lax/);
      } else {
        assert.equal(cookie, null);
      }
    }
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 admin stays on the private authenticated boundary", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    const unauthenticated = await proxy(proxyRequest(
      "/api/client/v1/admin/credentials",
      { headers: baseHeaders },
    ));
    assert.equal(unauthenticated.status, 401);

    const authenticated = await proxy(proxyRequest(
      "/api/client/v1/admin/credentials",
      {
        headers: {
          ...baseHeaders,
          cookie: `${ACCESS_TOKEN_COOKIE}=configured-mobile-secret`,
        },
      },
    ));
    assert.equal(passedThrough(authenticated), true);
  } finally {
    restoreProxyEnv();
  }
});

test("a percent-escaped client-v1 target is refused before it can slip the ingress rules", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_ACCESS_TOKEN: "configured-mobile-secret",
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const id = "018f4f1a-77c2-7a31-8a15-55a25aaba001";
    const escapedId = "018f4f1a-77c2-7a31-8a15-55a25aaba00%31";
    // Remote ingress as Tailscale Serve produces it: no direct-loopback stamp,
    // and a credential that satisfies the ordinary gate. This is the caller the
    // 403 exists to refuse, and the exact caller that reached the handler
    // before this fix (measured against a production build: the plain path
    // answered 403, the escaped one answered 200 with the pairing record).
    const remote = { [TOKEN_HEADER]: "configured-sidecar-secret" };
    const local = { [LOCAL_PEER_HEADER]: "loopback-secret" };

    const plainRemote = await proxy(proxyRequest(
      `/api/client/v1/pairing/requests/${id}`,
      { headers: remote },
    ));
    await assertProxyError(
      plainRemote,
      403,
      "forbidden peer: client v1 requires direct loopback",
    );

    const escapedRemote = await proxy(proxyRequest(
      `/api/client/v1/pairing/requests/${escapedId}`,
      { headers: remote },
    ));
    await assertProxyError(escapedRemote, 400, "invalid client v1 path");

    // Refused for the local caller too. The point is not "remote callers are
    // refused" — it is that no request on an escaped client-v1 target is ever
    // handed to a route, so no future route can inherit the hole.
    const escapedLocal = await proxy(proxyRequest(
      `/api/client/v1/pairing/requests/${escapedId}`,
      { headers: { ...local, origin: ORIGIN, referer: `${ORIGIN}/` } },
    ));
    await assertProxyError(escapedLocal, 400, "invalid client v1 path");

    // Every escaped target the URL parser leaves intact, across both segment
    // positions, the admin family, and malformed escapes.
    for (const pathname of ESCAPED_CLIENT_V1_PATHS) {
      const request = proxyRequest(pathname, {
        headers: { ...local, origin: ORIGIN, referer: `${ORIGIN}/` },
      });
      // The parser folds a literal `\` to `/` and resolves `%2e%2e`, so those
      // entries arrive here as clean paths. Only assert about the ones that
      // still carry an escape by the time proxy() reads them.
      if (!isRefusedClientV1Path(request.nextUrl.pathname)) continue;
      const response = await proxy(request);
      assert.equal(passedThrough(response), false, pathname);
      await assertProxyError(response, 400, "invalid client v1 path");
    }
  } finally {
    restoreProxyEnv();
  }
});

test("the client-v1 body rules cannot be shed by escaping the path", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      "content-type": "application/json",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };
    const id = "018f4f1a-77c2-7a31-8a15-55a25aaba001";
    const escapedId = "018f4f1a-77c2-7a31-8a15-55a25aaba00%31";

    // The loopback gate was not the only control lost when an escaped path
    // classified null: clientV1RequestBodyError hangs off the same
    // classification, so the 411/413 rules and the 64 KiB cap went with it.
    // Measured against a production build before the fix, with the sidecar
    // token: chunked was 400 on the plain path and reached the route on the
    // escaped one; a 70 KB body was 413 on the plain path and reached the route
    // on the escaped one.
    const shapes: {
      label: string;
      headers: Record<string, string>;
      status: number;
      error: string;
    }[] = [
      { label: "no content-length", headers: {}, status: 411, error: "content-length required" },
      {
        label: "chunked",
        headers: { "content-length": "1", "transfer-encoding": "chunked" },
        status: 400,
        error: "invalid content-length",
      },
      {
        label: "over the 64 KiB cap",
        headers: { "content-length": String(64 * 1024 + 1) },
        status: 413,
        error: "request body too large",
      },
    ];

    for (const shape of shapes) {
      const plain = await proxy(proxyRequest(
        `/api/client/v1/pairing/requests/${id}/exchange`,
        { method: "POST", headers: { ...baseHeaders, ...shape.headers } },
      ));
      await assertProxyError(plain, shape.status, shape.error);

      const escaped = await proxy(proxyRequest(
        `/api/client/v1/pairing/requests/${escapedId}/exchange`,
        { method: "POST", headers: { ...baseHeaders, ...shape.headers } },
      ));
      assert.equal(passedThrough(escaped), false, shape.label);
      // Refused earlier than the body rule rather than by it: the target is
      // rejected outright, so the body never becomes a question. What must
      // never happen again is the third answer — passing through.
      await assertProxyError(escaped, 400, "invalid client v1 path");
    }

    // A well-formed body on the escaped path is refused too, so the refusal is
    // about the target and not about the body being wrong.
    const wellFormed = await proxy(proxyRequest(
      `/api/client/v1/pairing/requests/${escapedId}/exchange`,
      { method: "POST", headers: { ...baseHeaders, "content-length": "0" } },
    ));
    await assertProxyError(wellFormed, 400, "invalid client v1 path");
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 percent-encoding stays legal in the query string", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    // The refusal reads nextUrl.pathname, and it has to stay there: query
    // values are percent-encoded by every correct client, and refusing on the
    // whole URL would break the surface it is meant to protect.
    const response = await proxy(proxyRequest(
      "/api/client/v1/health?probe=a%20b%2Fc",
      {
        headers: {
          [LOCAL_PEER_HEADER]: "loopback-secret",
          origin: ORIGIN,
          referer: `${ORIGIN}/`,
        },
      },
    ));

    assert.equal(passedThrough(response), true);
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 admin requires the listener's direct-loopback peer", async () => {
  try {
    // No COVEN_CAVE_ACCESS_TOKEN: with mobile access armed, its gate answers
    // an unauthenticated admin request first (401) and the peer gate under test
    // is never reached. The sibling test above covers that arrangement.
    setProxyEnv({
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    // #4843: a forwarded caller holding the sidecar token and sending no
    // Origin/Referer — a native client rather than a browser — could read the
    // credential list and the pending-pairing queue from off the machine. The
    // mutation CSRF check never applied to it, because reads do not take one.
    for (const pathname of [
      "/api/client/v1/admin/credentials",
      "/api/client/v1/admin/pairing-requests",
      "/api/client/v1/admin/credentials/018f4f1a-77c2-7a31-8a15-55a25aaba002",
      "/api/client/v1/admin/pairing-requests/018f4f1a-77c2-7a31-8a15-55a25aaba001/decision",
    ]) {
      const remote = await proxy(proxyRequest(pathname, {
        headers: { [TOKEN_HEADER]: "configured-sidecar-secret" },
      }));
      assert.equal(passedThrough(remote), false, pathname);
      await assertProxyError(
        remote,
        403,
        "forbidden peer: client v1 admin requires direct loopback",
      );
    }

    // A caller with no stamp and no credential is refused by the same gate, so
    // the peer requirement does not depend on which credential is presented.
    const unstamped = await proxy(proxyRequest("/api/client/v1/admin/credentials"));
    await assertProxyError(
      unstamped,
      403,
      "forbidden peer: client v1 admin requires direct loopback",
    );

    // Bound, not excused. The stamped caller reaches the ORDINARY gate — it is
    // still refused without a credential, because admin must never take the
    // client-v1 ingress branch's pass-through.
    const stampedTokenless = await proxy(proxyRequest("/api/client/v1/admin/credentials", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
      },
    }));
    assert.equal(passedThrough(stampedTokenless), false);
    assert.equal(stampedTokenless.status, 401);

    // And the real administrator — on the machine, holding the credential —
    // still gets through to requireClientV1Admin.
    const stampedAuthenticated = await proxy(proxyRequest("/api/client/v1/admin/credentials", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        [TOKEN_HEADER]: "configured-sidecar-secret",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
      },
    }));
    assert.equal(passedThrough(stampedAuthenticated), true);
  } finally {
    restoreProxyEnv();
  }
});

test("public pairing creation accepts only reviewed JSON media types", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    for (const contentType of [
      "multipart/form-data; boundary=pairing",
      "image/png",
      "application/x-www-form-urlencoded",
    ]) {
      const response = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
        method: "POST",
        headers: {
          ...baseHeaders,
          "content-length": String(64 * 1024 + 1),
          "content-type": contentType,
        },
      }));
      await assertProxyError(response, 415, "unsupported content-type");
    }

    const missingContentType = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-length": "1",
      },
    }));
    await assertProxyError(missingContentType, 415, "unsupported content-type");
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 body-bearing ingress requires a known Content-Length", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      "content-type": "application/json",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    const missing = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: baseHeaders,
    }));
    await assertProxyError(missing, 411, "content-length required");

    const chunked = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-length": "1",
        "transfer-encoding": "chunked",
      },
    }));
    await assertProxyError(chunked, 400, "invalid content-length");

    // The rule is a property of client-v1 ingress, not of one route, so check a
    // second ingress path. It has to be a path that classifies — since
    // cave-4841 that is the reviewed public set, because nothing is
    // pre-authorized ahead of its handler.
    const exchangeMissing = await proxy(proxyRequest(
      "/api/client/v1/pairing/requests/request-1/exchange",
      { method: "POST", headers: baseHeaders },
    ));
    await assertProxyError(exchangeMissing, 411, "content-length required");
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 rejects malformed and duplicate Content-Length values", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = [
      [LOCAL_PEER_HEADER, "loopback-secret"],
      ["content-type", "application/json"],
      ["origin", ORIGIN],
      ["referer", `${ORIGIN}/`],
    ] satisfies [string, string][];

    for (const contentLength of ["-1", "not-a-number"]) {
      const response = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
        method: "POST",
        headers: [...baseHeaders, ["content-length", contentLength]],
      }));
      await assertProxyError(response, 400, "invalid content-length");
    }

    const duplicate = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: [
        ...baseHeaders,
        ["content-length", "1"],
        ["content-length", "2"],
      ],
    }));
    await assertProxyError(duplicate, 400, "invalid content-length");
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 enforces the exact control-body size boundary", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });
    const baseHeaders = {
      [LOCAL_PEER_HEADER]: "loopback-secret",
      "content-type": "application/json; charset=utf-8",
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
    };

    const exactBoundary = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-length": String(64 * 1024),
      },
    }));
    assert.equal(passedThrough(exactBoundary), true);

    const oversized = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        ...baseHeaders,
        "content-length": String(64 * 1024 + 1),
      },
    }));
    await assertProxyError(oversized, 413, "request body too large");
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 health is not subjected to a request-body size rule", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    const response = await proxy(proxyRequest("/api/client/v1/health", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        "content-length": String(64 * 1024 + 1),
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
      },
    }));

    assert.equal(passedThrough(response), true);
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 loopback bypass preserves host, origin, and content-type gates", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_AUTH_TOKEN: "configured-sidecar-secret",
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    const badHost = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        host: "evil.example",
      },
    }));
    assert.equal(badHost.status, 403);

    const badOrigin = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        origin: "https://evil.example",
      },
    }));
    assert.equal(badOrigin.status, 403);

    const badContentType = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        "content-type": "text/plain",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
      },
    }));
    assert.equal(badContentType.status, 415);
  } finally {
    restoreProxyEnv();
  }
});

test("server request stamping removes spoofed loopback and tailnet markers before applying trusted values", async () => {
  const source = await readFile(new URL("../../../../server.ts", import.meta.url), "utf8");
  const match = source.match(
    /const server = createServer\(\(req, res\) => \{([\s\S]*?)\n\}\);/,
  );
  assert.ok(match);
  const applyServerStamp = new Function(
    "req",
    "res",
    "LOCAL_PEER_HEADER",
    "TAILNET_PEER_HEADER",
    "LOCAL_PEER_SECRET",
    "TAILNET_PEER_SECRET",
    "isDirectLoopbackRequest",
    "resolveTailnetPeer",
    "handle",
    match[1],
  );
  const request = {
    headers: {
      [LOCAL_PEER_HEADER]: "caller-spoofed-loopback",
      [TAILNET_PEER_HEADER]: "caller-spoofed-tailnet",
    },
  };

  applyServerStamp(
    request,
    {},
    LOCAL_PEER_HEADER,
    TAILNET_PEER_HEADER,
    "trusted-loopback",
    "trusted-tailnet",
    () => true,
    () => null,
    () => undefined,
  );

  assert.equal(request.headers[LOCAL_PEER_HEADER], "trusted-loopback");
  assert.equal(request.headers[TAILNET_PEER_HEADER], undefined);
  assert.equal(JSON.stringify(request.headers).includes("caller-spoofed"), false);
});
