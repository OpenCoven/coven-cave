import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  createClientV1Authenticator,
  type ClientV1AuthResult,
} from "./auth.ts";
import { CLIENT_V1_PUBLIC_ROUTES } from "./contract.ts";
import type {
  ClientV1CredentialRecord,
  CredentialStore,
} from "./credential-store.ts";
import { proxy } from "../../../proxy.ts";
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_QUERY_PARAM,
  CLIENT_V1_PUBLIC_INGRESS,
  LOCAL_PEER_HEADER,
  TAILNET_PEER_HEADER,
  clientV1IngressKind,
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

test("client-v1 ingress allowlists only the reviewed public and authenticated routes", () => {
  const publicRoutes = [
    "/api/client/v1/health",
    "/api/client/v1/pairing/requests",
    "/api/client/v1/pairing/requests/request-1",
    "/api/client/v1/pairing/requests/request-1/exchange",
  ];
  const authenticatedRoutes = [
    "/api/client/v1/familiars",
    "/api/client/v1/projects",
    "/api/client/v1/conversations",
    "/api/client/v1/conversations/search",
    "/api/client/v1/conversations/conversation-1",
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
  ];
  // Pinned to the contract so this literal cannot drift into a stale
  // restatement of it. Written out rather than derived because a list that
  // derives its own expectation asserts nothing about the proxy.
  assert.deepEqual(publicRoutes, contractPublicPaths());
  for (const route of publicRoutes) {
    assert.equal(clientV1IngressKind(route), CLIENT_V1_PUBLIC_INGRESS, route);
  }
  for (const route of authenticatedRoutes) {
    assert.equal(clientV1IngressKind(route), "authenticated", route);
  }
  for (const route of [
    "/api/client/v1",
    "/api/client/v1/admin",
    "/api/client/v1/admin/credentials",
    "/api/client/v1/admin/pairing-requests",
    "/api/client/v1/private",
    "/api/client/v1/conversations/conversation-1/messages",
    "/api/client/v10/health",
    "/api/chat/conversation",
    // Near-misses of the DERIVED public patterns. The four they replaced were
    // hand-written regexes a reviewer read directly; these are generated, so
    // the generator's anchoring and its one-segment `:id` scoping need
    // assertions of their own. Without them, widening `:id` to `.+` or
    // dropping the `^`/`$` anchors leaves every suite green while the
    // credential-free surface silently grows past the reviewed set —
    // credential-free being exactly what the bearer gate below does not
    // demand of public ingress (cave-d1sjz).
    "/api/client/v1/healthz",
    "/decoy/api/client/v1/health",
    "/api/client/v1/pairing/requests/",
    "/api/client/v1/pairing/requests/request-1/messages",
    "/api/client/v1/pairing/requests/request-1/exchange/extra",
  ]) {
    assert.equal(clientV1IngressKind(route), null, route);
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
// Shaped like an issued credential (32 random bytes, base64url) so the proxy's
// syntactic check is exercised against the real thing. It matches no stored
// credential — the proxy never looks one up, which is the point.
const PRESENTED_BEARER = "a".repeat(43);

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
    ]) {
      const response = await proxy(proxyRequest(route, { headers }));
      assert.equal(passedThrough(response), true, `${route} returned ${response.status}`);
    }

    // Resource ingress reaches the same pass-through, but only behind a
    // presented credential — see the bearer test below for the refusals.
    const resource = await proxy(proxyRequest("/api/client/v1/conversations", {
      headers: { ...headers, authorization: `Bearer ${PRESENTED_BEARER}` },
    }));
    assert.equal(passedThrough(resource), true, `conversations returned ${resource.status}`);

    for (const route of [
      "/api/client/v1/admin/credentials",
      "/api/client/v1/private",
      "/api/chat/conversation",
    ]) {
      const response = await proxy(proxyRequest(route, { headers }));
      assert.equal(passedThrough(response), false, route);
      assert.equal(response.status, 401, route);
    }
  } finally {
    restoreProxyEnv();
  }
});

test("client-v1 resource ingress refuses a request that presents no bearer", async () => {
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

    const resourceRoutes = [
      "/api/client/v1/conversations",
      "/api/client/v1/messages/send",
      "/api/client/v1/runs/run-1/stream",
      "/api/client/v1/github/actions",
    ];

    // The gate below only exists for RESOURCE ingress, and every assertion in
    // this test would still pass if these paths stopped classifying that way:
    // a path that classifies null falls through to the ordinary sidecar-token
    // gate, whose refusal is byte-identical — same 401, same
    // {ok:false,error:"unauthorized"} — so the whole test would go green while
    // never reaching the code it is about. Measured, not hypothetical: emptying
    // CLIENT_V1_AUTHENTICATED_PATHS turns three tests in this file red and
    // leaves this one passing. State the precondition so that stops being a
    // silent pass (cave-d1sjz).
    for (const route of resourceRoutes) {
      assert.equal(clientV1IngressKind(route), "authenticated", route);
    }

    // Resource ingress skips the sidecar token, so without this the only thing
    // between a loopback process and the handler is the handler's own
    // requireScope call.
    for (const route of resourceRoutes) {
      await assertProxyError(
        await proxy(proxyRequest(route, { headers })),
        401,
        "unauthorized",
      );
    }

    for (const authorization of [
      PRESENTED_BEARER,
      `Basic ${PRESENTED_BEARER}`,
      "Bearer",
      "Bearer ",
      "Bearer two words",
      `Bearer ${PRESENTED_BEARER}!`,
      // The credential is attacker-controlled and reaches a regex, so its
      // length is capped. An issued bearer is 43 characters; 4097 is the far
      // side of the cap.
      `Bearer ${"a".repeat(4097)}`,
    ]) {
      const response = await proxy(proxyRequest("/api/client/v1/conversations", {
        headers: { ...headers, authorization },
      }));
      assert.equal(response.status, 401, authorization);
      assert.deepEqual(await response.json(), { ok: false, error: "unauthorized" });
    }

    // The public set stays credential-free: pairing is how a client gets one.
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

    const authenticatedMissing = await proxy(proxyRequest("/api/client/v1/conversations", {
      method: "POST",
      headers: baseHeaders,
    }));
    await assertProxyError(authenticatedMissing, 411, "content-length required");
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

    const badHost = await proxy(proxyRequest("/api/client/v1/conversations", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        host: "evil.example",
      },
    }));
    assert.equal(badHost.status, 403);

    const badOrigin = await proxy(proxyRequest("/api/client/v1/conversations", {
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        origin: "https://evil.example",
      },
    }));
    assert.equal(badOrigin.status, 403);

    const badContentType = await proxy(proxyRequest("/api/client/v1/conversations", {
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
