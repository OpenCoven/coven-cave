import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  CLIENT_V1_PAIRING_SECRET_HEADER,
  type ClientV1PairingCreateRequest,
} from "@/lib/server/client-v1/contract.ts";
import { createClientV1Runtime } from "@/lib/server/client-v1/runtime.ts";
import {
  ACCESS_TOKEN_COOKIE,
  CLIENT_V1_ADMIN_HEADER,
  LOCAL_PEER_HEADER,
  MOBILE_ACCESS_HEADER,
  TAILNET_PEER_HEADER,
  TOKEN_HEADER,
} from "@/proxy-helpers.ts";
import { proxy } from "@/proxy.ts";

import { createAdminCredentialDeleteHandler } from "./credentials/[id]/route.ts";
import { createAdminCredentialsGetHandler } from "./credentials/route.ts";
import {
  createAdminPairingDecisionPostHandler,
} from "./pairing-requests/[id]/decision/route.ts";
import { createAdminPairingRequestsGetHandler } from "./pairing-requests/route.ts";
import {
  createPairingExchangePostHandler,
} from "../pairing/requests/[id]/exchange/route.ts";
import { createPairingRequestPostHandler } from "../pairing/requests/route.ts";

const scratchPrefix = resolve(process.cwd(), ".scratch-client-v1-admin-security-");
const origin = "http://localhost:3000";
const loopbackSecret = "loopback-secret";
const adminSecret = "sidecar-admin-secret";
const pairingInput: ClientV1PairingCreateRequest = {
  appName: "OpenCoven Chat",
  installationId: "chat-install-security",
  scopes: [
    "chat:read",
    "chat:write",
    "conversations:write",
    "attachments:write",
    "tasks:write",
    "github:write",
  ],
};

const ENV_KEYS = [
  "COVEN_CAVE_ACCESS_TOKEN",
  "COVEN_CAVE_AUTH_TOKEN",
  "COVEN_CAVE_BUNDLE",
  "COVEN_CAVE_LOCAL_PEER_SECRET",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function request(
  method: string,
  pathname: string,
  options: {
    body?: string;
    headers?: HeadersInit;
  } = {},
): NextRequest {
  const headers = new Headers(options.headers);
  if (!headers.has("host")) headers.set("host", "localhost:3000");
  if (!headers.has(LOCAL_PEER_HEADER)) {
    headers.set(LOCAL_PEER_HEADER, loopbackSecret);
  }
  if (options.body !== undefined && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(options.body)));
  }
  return new NextRequest(`${origin}${pathname}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function passedThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

async function throughProxy(
  req: NextRequest,
  route: (request: Request) => Promise<Response>,
): Promise<Response> {
  const gate = await proxy(req);
  if (!passedThrough(gate)) return gate;
  const forwardedHeaders = new Headers();
  const overridden = gate.headers
    .get("x-middleware-override-headers")
    ?.split(",")
    .filter(Boolean) ?? [];
  for (const name of overridden) {
    const value = gate.headers.get(`x-middleware-request-${name}`);
    if (value === null) forwardedHeaders.delete(name);
    else forwardedHeaders.set(name, value);
  }
  return route(new Request(req, { headers: forwardedHeaders }));
}

test("tokenless direct loopback can administer client-v1 in non-bundled development", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret });
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret,
      now: () => 10_000,
    });
    const approved = runtime.pairingStore.create(pairingInput);
    const denied = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-denied",
    });
    const credential = await runtime.credentialStore.issue(pairingInput);

    const pairingList = await throughProxy(
      request("GET", "/api/client/v1/admin/pairing-requests"),
      createAdminPairingRequestsGetHandler(runtime),
    );
    const credentialList = await throughProxy(
      request("GET", "/api/client/v1/admin/credentials"),
      createAdminCredentialsGetHandler(runtime),
    );
    const approveBody = JSON.stringify({ decision: "approved" });
    const approve = await throughProxy(
      request(
        "POST",
        `/api/client/v1/admin/pairing-requests/${approved.id}/decision`,
        {
          body: approveBody,
          headers: {
            "content-type": "application/json",
            origin,
            referer: `${origin}/settings`,
          },
        },
      ),
      (req) => createAdminPairingDecisionPostHandler(runtime)(
        req,
        context(approved.id),
      ),
    );
    const denyBody = JSON.stringify({ decision: "denied" });
    const deny = await throughProxy(
      request(
        "POST",
        `/api/client/v1/admin/pairing-requests/${denied.id}/decision`,
        {
          body: denyBody,
          headers: {
            "content-type": "application/json",
            origin,
            referer: `${origin}/settings`,
          },
        },
      ),
      (req) => createAdminPairingDecisionPostHandler(runtime)(
        req,
        context(denied.id),
      ),
    );
    const revokeBody = JSON.stringify({ reason: "operator revoked" });
    const revoke = await throughProxy(
      request(
        "DELETE",
        `/api/client/v1/admin/credentials/${credential.credential.id}`,
        {
          body: revokeBody,
          headers: {
            "content-type": "application/json",
            origin,
            referer: `${origin}/settings`,
          },
        },
      ),
      (req) => createAdminCredentialDeleteHandler(runtime)(
        req,
        context(credential.credential.id),
      ),
    );

    for (const response of [pairingList, credentialList, approve, deny, revoke]) {
      assert.equal(response.status, 200);
    }
    assert.equal(runtime.pairingStore.get(approved.id)?.status, "approved");
    assert.equal(runtime.pairingStore.get(denied.id)?.status, "denied");
    assert.equal(
      (await runtime.credentialStore.reload()).get(credential.credential.id)?.revokedAt,
      10_000,
    );
  } finally {
    restoreEnv();
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("tokenless direct-loopback approval can complete local development pairing", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret });
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret,
      now: () => 20_000,
    });
    const createBody = JSON.stringify(pairingInput);
    const created = await throughProxy(
      request("POST", "/api/client/v1/pairing/requests", {
        body: createBody,
        headers: {
          "content-type": "application/json",
          origin,
          referer: `${origin}/`,
        },
      }),
      createPairingRequestPostHandler(runtime),
    );
    assert.equal(created.status, 201);
    const createdPayload = await created.json() as {
      data: { requestId: string; secret: string };
    };

    const decisionBody = JSON.stringify({ decision: "approved" });
    const approval = await throughProxy(
      request(
        "POST",
        `/api/client/v1/admin/pairing-requests/${createdPayload.data.requestId}/decision`,
        {
          body: decisionBody,
          headers: {
            "content-type": "application/json",
            origin,
            referer: `${origin}/settings`,
          },
        },
      ),
      (req) => createAdminPairingDecisionPostHandler(runtime)(
        req,
        context(createdPayload.data.requestId),
      ),
    );

    const exchange = await throughProxy(
      request(
        "POST",
        `/api/client/v1/pairing/requests/${createdPayload.data.requestId}/exchange`,
        {
          headers: {
            "content-length": "0",
            [CLIENT_V1_PAIRING_SECRET_HEADER]: createdPayload.data.secret,
            origin,
            referer: `${origin}/`,
          },
        },
      ),
      (req) => createPairingExchangePostHandler(runtime)(
        req,
        context(createdPayload.data.requestId),
      ),
    );

    assert.equal(approval.status, 200);
    assert.equal(exchange.status, 200);
    const exchangePayload = await exchange.json() as {
      data?: { bearer?: string };
    };
    assert.equal(typeof exchangePayload.data?.bearer, "string");
    assert.equal((await runtime.credentialStore.reload()).size, 1);
  } finally {
    restoreEnv();
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("missing packaged admin token and caller-spoofed development marker fail closed", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({
      COVEN_CAVE_BUNDLE: "1",
      COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret,
    });
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret,
      now: () => 25_000,
    });
    const bundled = await throughProxy(
      request("GET", "/api/client/v1/admin/credentials"),
      createAdminCredentialsGetHandler(runtime),
    );
    assert.equal(bundled.status, 500);

    setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret });
    const spoofed = await throughProxy(
      request("GET", "/api/client/v1/admin/credentials", {
        headers: {
          [CLIENT_V1_ADMIN_HEADER]: loopbackSecret,
          [LOCAL_PEER_HEADER]: "forged-loopback-secret",
        },
      }),
      createAdminCredentialsGetHandler(runtime),
    );
    assert.equal(spoofed.status, 403);

    const direct = await createAdminCredentialsGetHandler(runtime)(
      request("GET", "/api/client/v1/admin/credentials", {
        headers: {
          [CLIENT_V1_ADMIN_HEADER]: "1",
        },
      }),
    );
    assert.equal(direct.status, 503);
  } finally {
    restoreEnv();
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("proxy replaces caller-supplied development admin markers", async () => {
  try {
    setEnv({ COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret });
    const response = await throughProxy(
      request("GET", "/api/client/v1/admin/credentials", {
        headers: {
          [CLIENT_V1_ADMIN_HEADER]: "caller-spoof",
        },
      }),
      async (forwarded) => Response.json({
        marker: forwarded.headers.get(CLIENT_V1_ADMIN_HEADER),
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { marker: loopbackSecret });
  } finally {
    restoreEnv();
  }
});

test("configured Cave admin authorization works and mutations require CSRF", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({
      COVEN_CAVE_AUTH_TOKEN: adminSecret,
      COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret,
    });
    let now = 30_000;
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret,
      now: () => now,
    });
    const approved = runtime.pairingStore.create(pairingInput);
    const denied = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-valid-deny",
    });
    const missingCsrf = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-missing-csrf",
    });
    const invalidCsrf = runtime.pairingStore.create({
      ...pairingInput,
      installationId: "chat-install-invalid-csrf",
    });
    const credential = await runtime.credentialStore.issue(pairingInput);
    const missingCsrfCredential = await runtime.credentialStore.issue({
      ...pairingInput,
      installationId: "chat-install-revoke-missing-csrf",
    });
    const invalidCsrfCredential = await runtime.credentialStore.issue({
      ...pairingInput,
      installationId: "chat-install-revoke-invalid-csrf",
    });
    const authHeaders = { [TOKEN_HEADER]: adminSecret };

    const pairingList = await throughProxy(
      request("GET", "/api/client/v1/admin/pairing-requests", {
        headers: authHeaders,
      }),
      createAdminPairingRequestsGetHandler(runtime),
    );
    const credentialList = await throughProxy(
      request("GET", "/api/client/v1/admin/credentials", {
        headers: authHeaders,
      }),
      createAdminCredentialsGetHandler(runtime),
    );
    assert.equal(pairingList.status, 200, "read routes do not require CSRF headers");
    assert.equal(credentialList.status, 200, "read routes do not require CSRF headers");

    const decision = async (
      id: string,
      value: "approved" | "denied",
      headers: HeadersInit,
    ) => {
      const body = JSON.stringify({ decision: value });
      return throughProxy(
        request(
          "POST",
          `/api/client/v1/admin/pairing-requests/${id}/decision`,
          {
            body,
            headers: {
              "content-type": "application/json",
              ...Object.fromEntries(new Headers(headers)),
            },
          },
        ),
        (req) => createAdminPairingDecisionPostHandler(runtime)(
          req,
          context(id),
        ),
      );
    };
    const validMutationHeaders = {
      ...authHeaders,
      origin,
      referer: `${origin}/settings`,
    };
    assert.equal(
      (await decision(approved.id, "approved", validMutationHeaders)).status,
      200,
    );
    assert.equal(
      (await decision(denied.id, "denied", validMutationHeaders)).status,
      200,
    );

    const missing = await decision(missingCsrf.id, "approved", authHeaders);
    assert.equal(missing.status, 403);
    assert.equal(runtime.pairingStore.get(missingCsrf.id)?.status, "pending");

    const invalidBody = JSON.stringify({ decision: "approved" });
    const invalid = await createAdminPairingDecisionPostHandler(runtime)(
      request(
        "POST",
        `/api/client/v1/admin/pairing-requests/${invalidCsrf.id}/decision`,
        {
          body: invalidBody,
          headers: {
            "content-type": "application/json",
            [TOKEN_HEADER]: adminSecret,
            origin: "https://attacker.example",
            referer: "https://attacker.example/",
          },
        },
      ),
      context(invalidCsrf.id),
    );
    assert.equal(invalid.status, 403);
    assert.equal(runtime.pairingStore.get(invalidCsrf.id)?.status, "pending");

    now = 31_000;
    const revokeBody = JSON.stringify({ reason: "operator revoked" });
    const missingRevokeCsrf = await throughProxy(
      request(
        "DELETE",
        `/api/client/v1/admin/credentials/${missingCsrfCredential.credential.id}`,
        {
          body: revokeBody,
          headers: {
            "content-type": "application/json",
            ...authHeaders,
          },
        },
      ),
      (req) => createAdminCredentialDeleteHandler(runtime)(
        req,
        context(missingCsrfCredential.credential.id),
      ),
    );
    assert.equal(missingRevokeCsrf.status, 403);

    const invalidRevokeCsrf = await createAdminCredentialDeleteHandler(runtime)(
      request(
        "DELETE",
        `/api/client/v1/admin/credentials/${invalidCsrfCredential.credential.id}`,
        {
          body: revokeBody,
          headers: {
            "content-type": "application/json",
            [TOKEN_HEADER]: adminSecret,
            origin: "https://attacker.example",
            referer: "https://attacker.example/",
          },
        },
      ),
      context(invalidCsrfCredential.credential.id),
    );
    assert.equal(invalidRevokeCsrf.status, 403);

    const revoked = await throughProxy(
      request(
        "DELETE",
        `/api/client/v1/admin/credentials/${credential.credential.id}`,
        {
          body: revokeBody,
          headers: {
            "content-type": "application/json",
            ...validMutationHeaders,
          },
        },
      ),
      (req) => createAdminCredentialDeleteHandler(runtime)(
        req,
        context(credential.credential.id),
      ),
    );
    assert.equal(revoked.status, 200);
    assert.equal(
      (await runtime.credentialStore.reload()).get(credential.credential.id)?.revokedAt,
      now,
    );
    const records = await runtime.credentialStore.reload();
    assert.equal(
      records.get(missingCsrfCredential.credential.id)?.revokedAt,
      null,
    );
    assert.equal(
      records.get(invalidCsrfCredential.credential.id)?.revokedAt,
      null,
    );
  } finally {
    restoreEnv();
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});

test("caller-supplied internal markers and client bearers cannot spoof Cave admin", async () => {
  const root = await mkdtemp(scratchPrefix);
  try {
    setEnv({
      COVEN_CAVE_ACCESS_TOKEN: "mobile-access-secret",
      COVEN_CAVE_AUTH_TOKEN: adminSecret,
      COVEN_CAVE_LOCAL_PEER_SECRET: loopbackSecret,
    });
    const runtime = createClientV1Runtime({
      credentialRoot: root,
      loopbackSecret,
      now: () => 40_000,
    });
    const clientCredential = await runtime.credentialStore.issue(pairingInput);
    const spoofed = request("GET", "/api/client/v1/admin/credentials", {
      headers: {
        [LOCAL_PEER_HEADER]: loopbackSecret,
        [MOBILE_ACCESS_HEADER]: "1",
        [TAILNET_PEER_HEADER]: "caller-supplied-tailnet",
        authorization: `Bearer ${clientCredential.bearer}`,
        cookie: `${ACCESS_TOKEN_COOKIE}=mobile-access-secret`,
      },
    });
    const throughIngress = await throughProxy(
      spoofed,
      createAdminCredentialsGetHandler(runtime),
    );
    const direct = await createAdminCredentialsGetHandler(runtime)(
      request("GET", "/api/client/v1/admin/credentials", {
        headers: {
          [LOCAL_PEER_HEADER]: loopbackSecret,
          [MOBILE_ACCESS_HEADER]: "1",
          [TAILNET_PEER_HEADER]: "caller-supplied-tailnet",
          [TOKEN_HEADER]: "wrong-admin-secret",
          authorization: `Bearer ${clientCredential.bearer}`,
        },
      }),
    );

    for (const response of [throughIngress, direct]) {
      assert.equal(response.status, 401);
      const payload = await response.json() as {
        error: { code: string; message: string };
      };
      assert.equal(payload.error.code, "unauthorized");
      assert.equal(JSON.stringify(payload).includes(clientCredential.bearer), false);
      assert.equal(JSON.stringify(payload).includes(adminSecret), false);
    }
  } finally {
    restoreEnv();
    assert.equal(resolve(root).startsWith(scratchPrefix), true);
    await rm(root, { recursive: true, force: true });
  }
});
