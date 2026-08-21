import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  createClientV1Authenticator,
  type ClientV1AuthResult,
} from "./auth.ts";
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
  ]) {
    assert.equal(clientV1IngressKind(route), null, route);
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
    headers?: Record<string, string>;
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
      "/api/client/v1/conversations",
    ]) {
      const response = await proxy(proxyRequest(route, { headers }));
      assert.equal(passedThrough(response), true, `${route} returned ${response.status}`);
    }

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

test("client-v1 rejects oversized pairing creation before route handling", async () => {
  try {
    setProxyEnv({
      COVEN_CAVE_LOCAL_PEER_SECRET: "loopback-secret",
    });

    const response = await proxy(proxyRequest("/api/client/v1/pairing/requests", {
      method: "POST",
      headers: {
        [LOCAL_PEER_HEADER]: "loopback-secret",
        "content-length": String(64 * 1024 + 1),
        "content-type": "application/json",
        origin: ORIGIN,
        referer: `${ORIGIN}/`,
      },
    }));

    assert.equal(response.status, 413);
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
